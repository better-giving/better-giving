import {
	CHARIOT_EVENT_CATEGORY,
	CHARIOT_WEBHOOK_PATH
} from '@better-giving/operator/chariot/webhook-subscription';
import type { Tone } from '@better-giving/operator/components/closed-sets';
import { Button } from '@better-giving/operator/components/controls/Button';
import { CodeChip, CodeSlab, InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { Disclosure } from '@better-giving/operator/components/data/Disclosure';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Column, Section } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusLedger, StatusLine } from '@better-giving/operator/components/status/StatusLine';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { RECREATE_APP, setupWebhookCommand } from '@better-giving/operator/deploy-split';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import {
	STRIPE_WEBHOOK_PATH,
	SUBSCRIBED_EVENT_TYPES
} from '@better-giving/operator/stripe/webhook-endpoint';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { useFetcher } from 'react-router';
import { z } from 'zod';
import { screenTitle } from '$lib/admin/screen-title';
import { formPress } from '$lib/admin/unreached';
import { resultFor, whichForm } from '$lib/admin/use-admin-form';
import { defineForm, type FormRejection } from '$lib/forms/definition';
import { STAFF_USER_ID } from '$lib/server/auth';
import { invalid, parseForm, submittedForm } from '$lib/server/conform';
import { notFound } from '$lib/server/db/load-failure';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { readPaymentsScreen } from '$lib/server/payments/processor-cards';
import {
	PROCESSOR_LABELS,
	PROCESSOR_NAMES,
	takesRepeatingGifts
} from '$lib/server/payments/provider';
import { setUpRecurringGifts } from '$lib/server/payments/recurring-provision';
import { levelWalletDomains } from '$lib/server/payments/wallet-domains';
import { walletHosts } from '$lib/server/payments/wallet-hosts';
import { database, platform, staff } from '../context';
import type { Route } from './+types/_app.admin.payments';

const SCREEN_TITLE = 'Payments';

const SCREEN = '/admin/payments';

const NOT_HERE =
	`No page at ${SCREEN} for a member’s session. Where each payment processor stands is the ` +
	'deployer’s: sign in with `ADMIN_PASSWORD` at /login.';

/** the two presses, as the literals a body names itself with. */
const RECURRING_FORM_ID = 'payments-recurring';
const WALLETS_FORM_ID = 'payments-wallets';
const SCREEN_FORMS = [RECURRING_FORM_ID, WALLETS_FORM_ID] as const;

/**
 * Set up recurring gifts, on the one account its card is about. the name is checked against the
 * processors that take repeating gifts in the action, where that list is.
 */
const RECURRING_FORM = defineForm({
	id: RECURRING_FORM_ID,
	schema: z.object({ processor: z.string({ error: 'required' }) })
});

/**
 * Register all sites, which states nothing: the hostnames are this request's own address and the
 * deployment's `site` rows, never a value a body could name ($lib/server/payments/wallet-hosts.ts).
 */
const WALLETS_FORM = defineForm({ id: WALLETS_FORM_ID, schema: z.object({}) });

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);
	return readPaymentsScreen(context.get(platform).env, context.get(database), request.url);
}

/**
 * the two presses. **the request body is read exactly once, here** — and not at all for a member,
 * who is answered before it.
 */
export async function action(args: Route.ActionArgs) {
	if (args.context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const body = await args.request.formData();
	switch (submittedForm(body, SCREEN_FORMS)) {
		case RECURRING_FORM_ID:
			return setUpRecurring(args, body);
		case WALLETS_FORM_ID:
			return registerSites(args, body);
	}

	// the arms are declared inside the action because react router strips the `action` export from
	// the browser bundle and nothing else: a module-scope helper reaching `$lib/server/**` would ship
	// it (../routes.spec.ts holds that over the module graph).

	/**
	 * the item repeating gifts are collected against, put on the named account. a refusal from the
	 * processor is a 500 carrying its sentence: no value the press could send fixes it.
	 */
	async function setUpRecurring({ context }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, RECURRING_FORM);
		if (!submission.ok) return invalid(400, submission.reject());
		const processor = PROCESSOR_NAMES.find((name) => name === submission.value.processor);
		if (processor === undefined || !takesRepeatingGifts(processor)) {
			return invalid(
				400,
				submission.reject({
					fieldErrors: { processor: ['names no processor that takes repeating gifts'] }
				})
			);
		}

		const provider = createPaymentProviders(context.get(platform).env).for(processor);
		const recurring = {
			label: PROCESSOR_LABELS[processor],
			...(await setUpRecurringGifts(provider))
		};
		if (recurring.outcome === 'failed') return invalid(500, submission.reject(), { recurring });
		return { recurring };
	}

	/**
	 * this address and every listed site registered on the Stripe account, one hostname's failure
	 * stopping no other (`levelWalletDomains` in $lib/server/payments/wallet-domains.ts). the account
	 * read that opens the press is the one failure of the whole request.
	 */
	async function registerSites({ context, request }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, WALLETS_FORM);
		if (!submission.ok) return invalid(400, submission.reject());

		const asked = await walletHosts(context.get(database), request.url);
		const stripe = createPaymentProviders(context.get(platform).env).for('stripe');
		const levelled = await levelWalletDomains(stripe, asked.hosts);
		if (levelled.state === 'unreadable') {
			return invalid(500, submission.reject(), {
				wallets: { state: 'unreadable' as const, detail: levelled.detail }
			});
		}
		const failed = levelled.hosts.flatMap((host) =>
			host.detail === null ? [] : [{ host: host.standing.host, detail: host.detail }]
		);
		return { wallets: { state: 'levelled' as const, failed } };
	}
}

/**
 * a press whose request never reached the server, answered in the browser as the refusal of the
 * form that was pressed rather than with the error boundary ($lib/admin/unreached.ts).
 */
export function clientAction({ request, serverAction }: Route.ClientActionArgs) {
	return formPress(request, serverAction);
}

export default function Payments({ loaderData }: Route.ComponentProps) {
	const { cards, others } = loaderData;
	return (
		<Column>
			{cards.length === 0 ? <NoProcessor /> : null}
			{cards.map((card) => (
				<ProcessorCard key={card.processor} card={card} />
			))}
			{others.length === 0 ? null : <NotSetUp others={others} />}
		</Column>
	);
}

type LoaderData = Route.ComponentProps['loaderData'];
type Card = LoaderData['cards'][number];
type Processor = Card['processor'];

/**
 * what each processor takes, in a fundraiser's words: the line under a card that draws no ledger
 * of its own, and the line under its name on the not-set-up card.
 */
const TAKES: Record<Processor, string> = {
	stripe: 'Cards, Apple Pay, Google Pay, bank transfer',
	paypal: 'PayPal and Venmo',
	chariot: 'Gifts from a donor-advised fund',
	nowpayments: 'Crypto'
};

/** where DEPLOY.md says how a processor's keys go into `.env`. */
const HOW_TO_ADD = 'https://github.com/better-giving/better-giving/blob/main/DEPLOY.md#payments';

/**
 * what a rail's standing is called and how loudly it is said: named for approval and never for a
 * rail working, since an approved rail can still fail a gift on its amount or currency
 * ($lib/server/payments/rail-chargeability.ts).
 */
const STANDING: Record<
	NonNullable<Card['rails']>[number]['standing'],
	{ word: string; tone: Tone }
> = {
	approved: { word: 'Approved', tone: 'done' },
	in_review: { word: 'Being reviewed', tone: 'note' },
	not_approved: { word: 'Not usable yet', tone: 'attention' },
	never_requested: { word: 'Not asked for', tone: 'attention' },
	switched_off: { word: 'Switched off', tone: 'attention' },
	account_cannot_charge: { word: 'Blocked', tone: 'blocker' }
};

/** the server half of a notices banner, for a processor `scripts/setup-webhook.ts` registers. */
const scripted = (processor: Parameters<typeof setupWebhookCommand>[0]) => ({
	says: 'Run this, put the line it prints in `.env`, and recreate the app:',
	commands: [setupWebhookCommand(processor), RECREATE_APP]
});

/**
 * the server half of each processor's notices banner. NOWPayments has no listener to register: its
 * IPN secret is copied from its own dashboard.
 */
const NOTICES_STEPS: Record<Processor, { says: string; commands: readonly string[] }> = {
	stripe: scripted('stripe'),
	paypal: scripted('paypal'),
	chariot: scripted('chariot'),
	nowpayments: {
		says: 'Copy the IPN secret from your NOWPayments dashboard into `.env` as `NOWPAYMENTS_IPN_SECRET`, then recreate the app:',
		commands: [RECREATE_APP]
	}
};

/** where each processor that keeps an endpoint reports to this site, and what it reports. */
const WEBHOOKS: Partial<Record<Processor, { path: string; events: readonly string[] }>> = {
	stripe: { path: STRIPE_WEBHOOK_PATH, events: SUBSCRIBED_EVENT_TYPES },
	chariot: { path: CHARIOT_WEBHOOK_PATH, events: [CHARIOT_EVENT_CATEGORY] }
};

/** the two cadences a donor may repeat a gift at. both stand on the one item, so on one standing. */
const CADENCES = ['Monthly', 'Yearly'] as const;

/**
 * the one banner a deployment with no processor gets, in two parts for two readers: the staff
 * sentence, and under it the steps for whoever runs the server, since no box here sets a key.
 */
function NoProcessor() {
	return (
		<Banner
			word="No payment processor is set up"
			body={
				<ServerSteps
					says="Add one processor’s keys to `.env` (DEPLOY.md, Payments), register its payment notices, put the line that prints in `.env`, and recreate the app:"
					commands={[setupWebhookCommand('stripe'), RECREATE_APP]}
				/>
			}
		>
			No donation form can go live until one is. Ask whoever set up this site to add one. The steps
			below are for them.
		</Banner>
	);
}

/** the part of a banner for whoever runs the server: what to do, then each command to copy. */
function ServerSteps({
	says,
	commands
}: {
	readonly says: string;
	readonly commands: readonly string[];
}) {
	return (
		<>
			<h3 className="adm-banner__head">For whoever runs the server</h3>
			<p>
				<MarkedText text={says} />
			</p>
			{commands.map((command) => (
				<CodeSlab key={command} oneline content={command} copyable copyLabel="Copy the command" />
			))}
		</>
	);
}

function NotSetUp({ others }: { readonly others: LoaderData['others'] }) {
	return (
		<Section card>
			<h2>Not set up</h2>
			<StatusLedger>
				{others.map((other) => (
					<StatusLine
						key={other.processor}
						labelAs="span"
						label={other.label}
						tone="note"
						mark="circle-dashed"
						note={TAKES[other.processor]}
					/>
				))}
			</StatusLedger>
			<p>
				<a href={HOW_TO_ADD}>How to add one</a>
			</p>
		</Section>
	);
}

/** one processor's card, each reading under its own heading in the order a donor meets them. */
function ProcessorCard({ card }: { readonly card: Card }) {
	return (
		<Section card>
			<div className="adm-record__head">
				<h2>{card.label}</h2>
				<StatusWord tone="done">Set up</StatusWord>
			</div>
			{card.rails === null && card.link === null ? (
				<p className="adm-hint">{TAKES[card.processor]}</p>
			) : null}
			{card.unreadable === null ? null : (
				<Unreadable label={card.label} unreadable={card.unreadable} />
			)}
			<DonationMethods card={card} />
			<PaymentNotices card={card} />
			<RecurringDonations card={card} />
			<CharityRate approved={card.charityRate} />
			<Webhooks card={card} />
		</Section>
	);
}

/**
 * the reads the card lost, said once rather than as a row in each: they go through one port with
 * one set of keys, so several failing is one fact. the port's sentence names the value to fix.
 */
function Unreadable({
	label,
	unreadable
}: {
	readonly label: string;
	readonly unreadable: NonNullable<Card['unreadable']>;
}) {
	return (
		<div className="adm-stack">
			<FieldMessage>
				This deployment couldn’t read your {label} account, so it can’t say{' '}
				{unreadable.says.join(' or ')}.
			</FieldMessage>
			<p className="adm-prose">
				<MarkedText text={unreadable.detail} />
			</p>
		</div>
	);
}

/** what the Register all sites press answers, or the refusal of a press that never reached it. */
type WalletsAnswer = {
	readonly form?: FormRejection;
	readonly wallets?:
		| { readonly state: 'levelled'; readonly failed: readonly { host: string; detail: string }[] }
		| { readonly state: 'unreadable'; readonly detail: string };
};

/**
 * the ledger of ways a donor may give on this account, Link last, and the press that registers
 * this site's addresses where Link is not drawn on all of them.
 */
function DonationMethods({ card }: { readonly card: Card }) {
	const linkRow = `${useId()}-link`;
	const fetcher = useFetcher<WalletsAnswer>();
	const busy = fetcher.state !== 'idle';
	const pressable = card.link === 'not_everywhere';
	useFocusWhenGone(pressable, linkRow);

	if (card.rails === null && card.link === null) return null;
	return (
		<div className="adm-named">
			<h3>Donation methods</h3>
			<StatusLedger aligned>
				{(card.rails ?? []).map((row) => (
					<StatusLine
						key={row.rail}
						labelAs="span"
						label={row.label}
						word={STANDING[row.standing].word}
						wordOnMark={STANDING[row.standing].tone === 'done'}
						tone={STANDING[row.standing].tone}
						note={row.note === null ? undefined : <MarkedText text={row.note} />}
					/>
				))}
				{card.link === null ? null : (
					<StatusLine
						id={linkRow}
						labelAs="span"
						label="Link"
						word={pressable ? 'Not showing everywhere' : 'Showing'}
						wordOnMark={!pressable}
						tone={pressable ? 'attention' : 'done'}
						note={pressable ? 'Link shows only on sites registered with Stripe.' : undefined}
					/>
				)}
			</StatusLedger>
			{pressable ? (
				<fetcher.Form method="post">
					<input {...whichForm(WALLETS_FORM.id)} />
					<div className="adm-actions">
						<HeldButton busy={busy} size="sm">
							Register all sites
						</HeldButton>
					</div>
				</fetcher.Form>
			) : null}
			{busy ? null : <WalletsOutcome answer={fetcher.data} />}
		</div>
	);
}

/**
 * what the last Register all sites press could not do. a press that registered everything says
 * nothing here: the Link row it redraws is the answer.
 */
function WalletsOutcome({ answer }: { readonly answer: WalletsAnswer | undefined }) {
	const unreached = resultFor(WALLETS_FORM, answer)?.error?.['']?.[0];
	if (unreached !== undefined) return <FieldMessage>{unreached}</FieldMessage>;
	const wallets = answer?.wallets;
	if (wallets === undefined) return null;
	if (wallets.state === 'unreadable') {
		return (
			<>
				<FieldMessage>
					This deployment couldn’t read your Stripe account, so no site was registered for wallet
					buttons.
				</FieldMessage>
				<p className="adm-prose">
					<MarkedText text={wallets.detail} />
				</p>
			</>
		);
	}
	// one site's failure stops no other, so each is reported against its own name.
	return wallets.failed.map((one) => (
		<FieldMessage key={one.host}>
			<CodeChip>{one.host}</CodeChip> <MarkedText text={one.detail} />
		</FieldMessage>
	));
}

/**
 * whether the processor tells this site a gift was paid: a line where it does, and where it does
 * not a banner saying what that costs and, for whoever runs the server, what puts it right.
 */
function PaymentNotices({ card }: { readonly card: Card }) {
	if (card.notices === null) return null;
	const steps = NOTICES_STEPS[card.processor];
	return (
		<div className="adm-named">
			<h3>Payment notices</h3>
			{card.notices === 'working' ? (
				<StatusLedger>
					<StatusLine
						labelAs="span"
						label="Payment notices"
						word="Working"
						wordOnMark
						tone="done"
						note={`${card.label} tells this site each time a gift is paid.`}
					/>
				</StatusLedger>
			) : (
				<Banner
					tone="attention"
					word={
						card.notices === 'unset'
							? 'Payment notices aren’t set up'
							: 'Payment notices are not arriving'
					}
					body={<ServerSteps says={steps.says} commands={steps.commands} />}
				>
					{card.notices === 'unset'
						? `Gifts are charged, but none is marked paid here until ${card.label} can tell this site about it. Ask whoever set up this site to set it up. The steps below are for them.`
						: `Donors are being charged, but their gifts stay pending here until ${card.label} confirms them. Ask whoever set up this site to fix it. The steps below are for them.`}
				</Banner>
			)}
		</div>
	);
}

/** what the Set up recurring gifts press answers, or the refusal of a press that never reached it. */
type RecurringAnswer = {
	readonly form?: FormRejection;
	readonly recurring?: {
		readonly label: string;
		readonly outcome: 'set_up' | 'already_set_up' | 'failed';
		readonly detail: string | null;
	};
};

/**
 * where this account stands on gifts that repeat, one line per cadence, and the press that puts the
 * one item they are collected against on the account where it is missing.
 */
function RecurringDonations({ card }: { readonly card: Card }) {
	const firstLine = `${useId()}-monthly`;
	const fetcher = useFetcher<RecurringAnswer>();
	const busy = fetcher.state !== 'idle';
	const absent = card.recurring === 'absent';
	useFocusWhenGone(absent, firstLine);

	if (card.recurring === null) return null;
	const standing = RECURRING[card.recurring];
	const answer = busy ? undefined : fetcher.data;
	const unreached = resultFor(RECURRING_FORM, answer)?.error?.['']?.[0];
	const report = answer?.recurring;
	return (
		<div className="adm-named">
			<h3>Recurring donations</h3>
			<StatusLedger>
				{CADENCES.map((cadence, at) => (
					<StatusLine
						key={cadence}
						id={at === 0 ? firstLine : undefined}
						labelAs="span"
						label={cadence}
						word={standing.word}
						wordOnMark={standing.tone === 'done'}
						tone={standing.tone}
					/>
				))}
			</StatusLedger>
			{card.recurring === 'archived' ? (
				<p className="adm-prose">
					Recurring gifts are collected against one item on your account, and it has to exist before
					the first one is. Yours is archived, so nothing can be collected against it. Unarchive it
					in the {card.label} dashboard, under Product catalogue.
				</p>
			) : null}
			{absent ? (
				<>
					<p className="adm-prose">
						Donors can give once only until this is set up. It adds the one item repeating gifts are
						collected against to your {card.label} account.
					</p>
					<fetcher.Form method="post">
						<input {...whichForm(RECURRING_FORM.id)} />
						<input type="hidden" name="processor" value={card.processor} />
						<div className="adm-actions">
							<HeldButton busy={busy}>Set up recurring gifts</HeldButton>
						</div>
					</fetcher.Form>
				</>
			) : null}
			{/* mounted in every state, so the sentence arriving in it is a change a reader is told. */}
			<p className="adm-hint" role="status">
				{report?.outcome === 'set_up'
					? `Your ${report.label} account can now collect gifts that repeat.`
					: report?.outcome === 'already_set_up'
						? `Your ${report.label} account already had this, so nothing was changed.`
						: null}
			</p>
			{unreached !== undefined ? <FieldMessage>{unreached}</FieldMessage> : null}
			{report?.outcome === 'failed' ? (
				<>
					<FieldMessage>
						This deployment could not set it up on your {report.label} account, and nothing was
						changed.
					</FieldMessage>
					{report.detail === null ? null : (
						<p className="adm-prose">
							<MarkedText text={report.detail} />
						</p>
					)}
				</>
			) : null}
		</div>
	);
}

/** what each standing of the repeating-gift item is called on both cadence lines. */
const RECURRING: Record<NonNullable<Card['recurring']>, { word: string; tone: Tone }> = {
	ready: { word: 'Set up', tone: 'done' },
	absent: { word: 'Not set up', tone: 'attention' },
	archived: { word: 'Archived', tone: 'attention' }
};

/** which of PayPal's two fee tables a donor covering the fee is quoted from. */
function CharityRate({ approved }: { readonly approved: boolean | null }) {
	if (approved === null) return null;
	return (
		<div className="adm-named">
			<h3>Charity rate</h3>
			<StatusLedger>
				{approved ? (
					<StatusLine
						labelAs="span"
						label="Approved by PayPal"
						word="Approved"
						wordOnMark
						tone="done"
						note="A donor covering the fee is quoted PayPal’s charity rate."
					/>
				) : (
					<StatusLine
						labelAs="span"
						label="Standard rate"
						tone="note"
						note={
							<MarkedText text="A donor covering the fee is quoted PayPal’s standard rate. Once PayPal approves this organisation for its charity rate, ask whoever set up this site to set `PAYPAL_CHARITY_RATE_APPROVED` to `true` in `.env`." />
						}
					/>
				)}
			</StatusLedger>
		</div>
	);
}

/**
 * what the processor reports to this site, and at which path. drawn once the value that verifies a
 * notice is in `.env`; the count is the label and the events are opened on demand.
 */
function Webhooks({ card }: { readonly card: Card }) {
	const events = `${useId()}-webhook-events`;
	const hook = WEBHOOKS[card.processor];
	if (hook === undefined || card.notices === 'unset') return null;
	const many = hook.events.length > 1;
	const list = (
		// biome-ignore lint/a11y/noRedundantRoles: base.css takes the marker off every list and `.adm-list` stands its items in a grid, and either stops a browser reporting this as a list.
		<ul role="list" aria-labelledby={events} className="adm-list">
			{hook.events.map((event) => (
				<li key={event}>
					<CodeChip>{event}</CodeChip>
				</li>
			))}
		</ul>
	);
	return (
		<div className="adm-named">
			<h3>Webhooks</h3>
			<p className="adm-prose" id={many ? undefined : events}>
				{card.label} reports {many ? 'these events' : 'this event'} to this site, at{' '}
				<InlineCode>{hook.path}</InlineCode>.
			</p>
			{many ? (
				<Disclosure summary={<span id={events}>{hook.events.length} events</span>}>
					{list}
				</Disclosure>
			) : (
				list
			)}
		</div>
	);
}

/**
 * a press held with `aria-disabled` and turned away in its own handler while its request is out,
 * never closed by `disabled`, which would drop the focus standing on it.
 */
function HeldButton({
	busy,
	size,
	children
}: {
	readonly busy: boolean;
	readonly size?: 'sm';
	readonly children: ReactNode;
}) {
	return (
		<Button
			type="submit"
			{...(size === undefined ? {} : { size })}
			aria-busy={busy || undefined}
			aria-disabled={busy || undefined}
			onClick={(event) => {
				if (busy) event.preventDefault();
			}}
		>
			{children}
		</Button>
	);
}

/**
 * focus moved to `target` on the render a press's own control goes away — its answer redrew the
 * line it was about — where the reader was left on the document. keyed on the control going, so a
 * page opened on that state takes no focus.
 */
function useFocusWhenGone(present: boolean, target: string) {
	const was = useRef(present);
	useEffect(() => {
		const went = was.current && !present;
		was.current = present;
		if (!went) return;
		const active = document.activeElement;
		if (active === null || active === document.body) document.getElementById(target)?.focus();
	}, [present, target]);
}
