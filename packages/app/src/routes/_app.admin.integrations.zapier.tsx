import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { ShownOnce, useShownOnce } from '@better-giving/operator/behaviour/ShownOnce';
import { Button } from '@better-giving/operator/components/controls/Button';
import { CodeSlab } from '@better-giving/operator/components/data/CodeSlab';
import { TriggerList } from '@better-giving/operator/components/data/TriggerList';
import { Field } from '@better-giving/operator/components/forms/Field';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { Column, Grouped, Groups } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { type RefObject, useEffect, useRef } from 'react';
import {
	Form,
	Link,
	type ShouldRevalidateFunctionArgs,
	useNavigate,
	useNavigation
} from 'react-router';
import { z } from 'zod';
import { FreePlanPace } from '$lib/admin/free-plan-pace';
import { screenTitle } from '$lib/admin/screen-title';
import { type AdminActionData, resultFor, whichForm } from '$lib/admin/use-admin-form';
import type { ZapierPressReport, ZapierReport } from '$lib/zapier/report';
import { defineForm, WHICH_FORM } from '$lib/forms/definition';
import { publishedOrigin, readAuthEnv, readPin, STAFF_USER_ID } from '$lib/server/auth';
import { invalid, parseForm, submittedForm, unread } from '$lib/server/conform';
import { notFound } from '$lib/server/db/load-failure';
import { freePlanPace } from '$lib/server/outbox/budget';
import { makeZapierKey, readZapierKey, replaceZapierKey } from '$lib/server/zapier/key';
import { readZapierDeliveries } from '$lib/server/zapier/report';
import { countListening } from '$lib/server/zapier/subscriptions';
import { database, platform, staff } from '../context';
import type { Route } from './+types/_app.admin.integrations.zapier';

// the one key Zapier presents to this deployment: made and replaced here, shown once, and after
// that shown only by its head and tail — with the two things Zapier asks for when an account
// connects (this address and the key), the Zaps listening on each trigger, and a strip over a feed
// that stopped reaching them. DEPLOY.md → "Sending gifts to Zapier" is the operator's account of
// this page.
//
// what the key is and why nothing can show it twice is `$lib/server/zapier/key.ts`'s header; what
// a replace does to the Zaps on the old key is `replaceZapierKey` there. this route turns a press
// into one of those calls.
//
// **only the deployer's session reaches this page**, the predicate ./_app.admin.members.tsx reads
// — `context.get(staff).id === STAFF_USER_ID` — read here by the loader and by the action alike, and
// by ./_app.tsx to leave the rail's Integrations group out for anyone else. a member's GET and
// POST alike are answered with the dashboard's not-found (`notFound` in
// $lib/server/db/load-failure.ts); its body names the rule for an agent that sent the request by
// hand.
//
// **the key is in the press's answer and nowhere else.** the action answers it rather than
// redirecting, so it rides that one response into `ShownOnce`; no loader returns it.
//
// **a replace names the key it was asked about**, the id the page was shown, so a second press
// sent against a page still showing that key ends nothing: it answers `conflict`. a refused press —
// a second make, a replace naming a key already replaced — answers 409 with a sentence under the
// key box, and `shouldRevalidate` reads the page again after it, so the row the sentence sits in
// shows the key that stands and the press it offers.
//
// the address is the origin the API page publishes (`publishedOrigin` in $lib/server/auth/env.ts):
// the pinned one where `BETTER_AUTH_URL` names one, this request's own where not, and `https:`
// whichever it is, so a page reached over plain http never hands Zapier an address it would send
// the key over in the clear.

/** the screen's name in the document title. ./_app.tsx names the page in a hidden `h1`. */
const SCREEN_TITLE = 'Zapier';

/** the address this screen answers on, and the one every press posts to. */
const SCREEN = '/admin/integrations/zapier';

/** the operator's own list of Zaps on Zapier, where an erroring or switched-off Zap is found. */
const YOUR_ZAPS = 'https://zapier.com/app/zaps';

const NOT_HERE =
	`No page at ${SCREEN} for a member’s session. Zapier’s key is made and replaced from the ` +
	'deployer’s session: sign in with `ADMIN_PASSWORD` at /login.';

const MAKE_FORM_ID = 'zapier-key-make';
const REPLACE_FORM_ID = 'zapier-key-replace';
const SCREEN_FORMS = [MAKE_FORM_ID, REPLACE_FORM_ID] as const;

/** what a box the request did not carry is told. */
const MISSING = 'required';

/** the make states no box; the body says which form it came from, and nothing else. */
const MAKE_FORM = defineForm({ id: MAKE_FORM_ID, schema: z.object({}) });

/** the replace states the id of the key the question was asked about; the header says why. */
const REPLACE_FORM = defineForm({
	id: REPLACE_FORM_ID,
	schema: z.object({
		key_id: z
			.string({ error: MISSING })
			.min(1, { error: MISSING })
			.max(64, { error: 'must be at most 64 characters' })
	})
});

/** what each refusal `makeZapierKey` and `replaceZapierKey` can answer with says, under the key. */
const REFUSED = {
	key_exists: 'A key was already made, so no second one was. Replace it to get a key you can copy.',
	no_key: 'There was no key to replace, so nothing changed. Make one.',
	conflict:
		'The key this page showed was already replaced, so nothing changed. The key shown now is the current one: replace it to get a key you can copy.'
} as const;

/** how long the oldest event still owed may wait before the page says your Zaps are behind. */
const LATE_MS = 60 * 60_000;

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, url }: Route.LoaderArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const db = context.get(database);
	const now = new Date();
	const [key, listening, deliveries] = await Promise.all([
		readZapierKey(db),
		countListening(db),
		readZapierDeliveries(db, now)
	]);
	const report: ZapierReport = {
		key:
			key === null
				? null
				: {
						id: key.id,
						prefix: key.prefix,
						lastFour: key.lastFour,
						madeAt: key.madeAt.toISOString()
					},
		listening,
		deliveries: {
			waiting: deliveries.waiting,
			failed: deliveries.failed,
			oldestWaitingAt: deliveries.oldestWaitingAt?.toISOString() ?? null
		}
	};
	const late =
		deliveries.oldestWaitingAt !== null &&
		now.getTime() - deliveries.oldestWaitingAt.getTime() > LATE_MS;
	const { env } = context.get(platform);

	return {
		address: publishedOrigin(url, readPin(readAuthEnv(env))),
		freePlanPace: freePlanPace(env, 'zapier'),
		report,
		late,
		replacing: key !== null && url.searchParams.get('confirm') === 'replace'
	};
}

/**
 * both presses this screen takes. **the request body is read exactly once, here** — and not at all
 * for a member, who is answered before it.
 */
export async function action(args: Route.ActionArgs) {
	if (args.context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const body = await args.request.formData();
	switch (submittedForm(body, SCREEN_FORMS)) {
		case MAKE_FORM_ID:
			return make(args, body);
		case REPLACE_FORM_ID:
			return replace(args, body);
	}

	// the arms are declared inside the action for the reason ./_app.admin.integrations.api.tsx gives:
	// react router strips the `action` export from the browser bundle and nothing else.

	async function make({ context }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, MAKE_FORM);
		if (!submission.ok) return invalid(400, submission.reject());

		const made = await makeZapierKey(context.get(database));
		if (!made.ok) return invalid(409, unread(MAKE_FORM, REFUSED[made.reason]));
		const report: ZapierPressReport = {
			press: 'make',
			key: made.key,
			madeAt: made.madeAt.toISOString(),
			disconnected: 0,
			paused: 0,
			notPaused: 0
		};
		return { made: report };
	}

	async function replace({ context }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, REPLACE_FORM);
		if (!submission.ok) return invalid(400, submission.reject());

		const replaced = await replaceZapierKey(context.get(database), fetch, submission.value.key_id);
		if (!replaced.ok) return invalid(409, unread(REPLACE_FORM, REFUSED[replaced.reason]));
		const report: ZapierPressReport = {
			press: 'replace',
			key: replaced.key,
			madeAt: replaced.madeAt.toISOString(),
			disconnected: replaced.disconnected,
			paused: replaced.paused,
			notPaused: replaced.notPaused
		};
		return { made: report };
	}
}

/**
 * the page is read again after this screen's own refused press, which react router skips for a
 * 4xx by default: a 409 here means the key changed under the page, and the sentence it answers
 * with names the key the row now shows.
 */
export function shouldRevalidate({
	actionStatus,
	formData,
	defaultShouldRevalidate
}: ShouldRevalidateFunctionArgs) {
	const form = formData?.get(WHICH_FORM);
	const ours = SCREEN_FORMS.some((id) => id === form);
	return actionStatus === 409 && ours ? true : defaultShouldRevalidate;
}

type Listening = ZapierReport['listening'];

export default function Zapier({ loaderData, actionData }: Route.ComponentProps) {
	const { address, report, late, replacing, freePlanPace } = loaderData;
	const made = actionData && 'made' in actionData ? actionData.made : undefined;
	const [shown, done] = useShownOnce(made?.key);

	// the key row's press — Make key or Replace key, whichever stands — handed to both dialogs as
	// `fallbackFocus` and focused when a refusal lands. a refusal commits before the read that follows
	// it, and that read can swap Make key for Replace key under the focus, so the effect runs again
	// once the key the page shows has changed and focuses whichever press stands then.
	const press = useRef<HTMLElement>(null);
	const refused = pressRefusal(actionData);
	const shownKey = report.key?.id;
	useEffect(() => {
		if (refused !== undefined) press.current?.focus();
	}, [refused, shownKey]);

	return (
		<Column>
			<FeedStrips deliveries={report.deliveries} late={late} />
			<FreePlanPace
				perMinute={freePlanPace}
				deliveries="deliveries to your Zaps"
				reach="every Zap"
			/>
			<Groups>
				<Grouped>
					{/* the app has no public address in this repository to link: it is private, and reached
					    by the invite Zapier gives whoever pushed packages/zapier (DEPLOY.md). */}
					<p className="adm-prose">The Better Giving Zapier app notifies you about</p>
					<TriggerList items={triggers(report.listening)} />
				</Grouped>
				<Grouped>
					<p className="adm-prose">and requires:</p>
					<StatedValue
						flush
						label="Your deployment address"
						block={<CodeSlab content={address} oneline copyable copyLabel="Copy address" />}
					/>
					<KeyRow held={report.key} refused={refused} press={press} />
				</Grouped>
			</Groups>
			{replacing && report.key !== null ? (
				<ReplaceCard held={report.key} listening={report.listening} press={press} />
			) : null}
			{shown ? (
				<ShownOnce
					title="Copy the key for Zapier"
					secret={shown}
					copyLabel="Copy the key"
					onDone={done}
					fallbackFocus={press}
				>
					{made?.press === 'replace' && made.disconnected > 0 ? <Disconnected made={made} /> : null}
				</ShownOnce>
			) : null}
		</Column>
	);
}

/** the sentence a refused press answered with, from whichever of the two it was. */
function pressRefusal(actionData: AdminActionData): string | undefined {
	return (
		resultFor(MAKE_FORM, actionData)?.error?.['']?.at(-1) ??
		resultFor(REPLACE_FORM, actionData)?.error?.['']?.at(-1)
	);
}

const zaps = (n: number) => `${n} ${n === 1 ? 'Zap' : 'Zaps'}`;

/** what the owner of `n` disconnected Zaps does next, whichever Zapier turned off. */
const reconnect = (n: number) =>
	`Reconnect ${n === 1 ? 'it' : 'each'} in Zapier with the new key, then turn it back on.`;

/** the three triggers in a fundraiser's words, each counted where any Zap listens. */
function triggers(listening: Listening) {
	const count = (n: number) => (n > 0 ? `${zaps(n)} listening` : undefined);
	return [
		{ id: 'new_gift', mark: 'stamp', name: 'Settled gifts', count: count(listening.newGift) },
		{ id: 'new_donor', mark: 'user-plus', name: 'New donors', count: count(listening.newDonor) },
		{
			id: 'gift_refunded',
			mark: 'arrow-left',
			name: 'Refunds',
			count: count(listening.giftRefunded)
		}
	] as const;
}

/**
 * the key as a page may show it — its head and tail, never the key — in a box that states it,
 * and the press that acts on it: Make key where there is none, and Replace key, which asks first,
 * where there is one. a refused press is said under the box, and the press is pointed at it.
 */
function KeyRow({
	held,
	refused,
	press
}: {
	readonly held: ZapierReport['key'];
	readonly refused: string | undefined;
	readonly press: RefObject<HTMLElement | null>;
}) {
	const navigation = useNavigation();
	// the make's own submission, through the `loading` that follows it: a press re-armed before the
	// answer lands is a second make, which is refused.
	const making =
		navigation.state !== 'idle' && navigation.formData?.get(WHICH_FORM) === MAKE_FORM.id;
	const describedBy = refused === undefined ? undefined : `${KEY_BOX}-err`;
	const hold = (node: HTMLElement | null) => {
		press.current = node;
	};

	const row = (
		<Field
			id={KEY_BOX}
			label="Zapier key"
			error={refused}
			code
			readOnly
			spellCheck={false}
			value={held === null ? '' : `${held.prefix}${'•'.repeat(12)}${held.lastFour}`}
			beside={
				held === null ? (
					<Button
						ref={hold}
						type="submit"
						mark="key-round"
						aria-label="Make key"
						aria-describedby={describedBy}
						aria-busy={making}
						aria-disabled={making || undefined}
						onClick={(event) => {
							if (making) event.preventDefault();
						}}
					/>
				) : (
					// a link dressed as a button, because it writes nothing: it asks.
					<Button
						ref={hold}
						as={Link}
						to={`${SCREEN}?confirm=replace`}
						preventScrollReset
						mark="refresh-cw"
						aria-label="Replace key"
						aria-describedby={describedBy}
					/>
				)
			}
		/>
	);

	return held === null ? (
		<Form method="post" preventScrollReset>
			<input {...whichForm(MAKE_FORM.id)} />
			{row}
		</Form>
	) : (
		row
	);
}

/** the key box's id, which `Field` names its refusal row from (`${id}-err`). */
const KEY_BOX = 'zapier-key';

/**
 * the question over the page, in the top layer: a replace ends every Zap on the old key, and that
 * cannot be taken back. it states what the press costs against this deployment's own Zaps.
 *
 * the form states the key the question names, and the press posts to the screen's own address
 * rather than to this question's, in place of it in the history: whatever the action answers
 * lands on the page with the question down — the new key shown once in its own card, or a refusal
 * said under the key box once the page is read again — and Back does not ask it again.
 */
function ReplaceCard({
	held,
	listening,
	press
}: {
	readonly held: NonNullable<ZapierReport['key']>;
	readonly listening: Listening;
	readonly press: RefObject<HTMLElement | null>;
}) {
	const navigate = useNavigate();
	const navigation = useNavigation();
	const replacing =
		navigation.state !== 'idle' && navigation.formData?.get(WHICH_FORM) === REPLACE_FORM.id;
	const total = listening.newGift + listening.newDonor + listening.giftRefunded;
	const each = [
		{ n: listening.newGift, on: 'settled gifts' },
		{ n: listening.newDonor, on: 'new donors' },
		{ n: listening.giftRefunded, on: 'refunds' }
	]
		.filter(({ n }) => n > 0)
		.map(({ n, on }) => `${n} on ${on}`)
		.join(', ');

	return (
		<Form method="post" replace preventScrollReset>
			<input {...whichForm(REPLACE_FORM.id)} />
			<input type="hidden" name="key_id" value={held.id} />
			<Modal
				title="Replace the Zapier key?"
				danger="Yes, replace"
				dangerProps={{
					type: 'submit',
					// the press's own `formaction`, which react router reads before the form's. the form
					// takes no `action` attribute: ../routes.spec.ts's bundle sweep reads that name as
					// this module's `action` export, which the browser bundle never carries.
					formAction: SCREEN,
					'aria-busy': replacing,
					'aria-disabled': replacing || undefined,
					onClick: (event) => {
						if (replacing) event.preventDefault();
					}
				}}
				cancel="Cancel"
				cancelProps={{ as: Link, to: SCREEN, preventScrollReset: true }}
				onDismiss={() => navigate(SCREEN, { preventScrollReset: true })}
				fallbackFocus={press}
			>
				<p className="adm-prose">The key ending {held.lastFour} stops working.</p>
				{total > 0 ? (
					<p className="adm-prose">
						{zaps(total)} {total === 1 ? 'disconnects' : 'disconnect'}: {each}.
					</p>
				) : null}
				<p className="adm-prose">
					{total > 0 ? reconnect(total) : 'Paste the new key into Zapier.'}
				</p>
			</Modal>
		</Form>
	);
}

/**
 * what a replace did to the Zaps on the old key, said in the card that shows the new key: how many
 * it disconnected, and how many of those Zapier did not turn off — they still read as on there,
 * and only turning them off and on again subscribes them on the new key (`pauseZaps` in
 * $lib/server/zapier/subscriptions.ts).
 */
function Disconnected({ made }: { readonly made: ZapierPressReport }) {
	const { disconnected, notPaused: still } = made;
	const one = disconnected === 1;
	const sentence =
		still === 0
			? reconnect(disconnected)
			: still === disconnected
				? `${one ? 'It still reads' : 'They still read'} as on in Zapier. Reconnect ${one ? 'it' : 'each'} with the new key, then turn ${one ? 'it' : 'each'} off and on again.`
				: `${reconnect(disconnected)} ${still} of them still ${still === 1 ? 'reads' : 'read'} as on in Zapier: turn ${still === 1 ? 'it' : 'those'} off and on again.`;
	return (
		<p className="adm-prose">
			{zaps(disconnected)} disconnected. {sentence}
		</p>
	);
}

/**
 * the strip over a feed that stopped reaching the Zaps: red for deliveries given up in the past
 * week, amber for the oldest one still owed waiting past an hour. neither has a press here — a
 * given-up delivery is never sent again ($lib/server/zapier/report.ts) — so each links to the
 * operator's Zaps, where the cause is.
 */
function FeedStrips({
	deliveries,
	late
}: {
	readonly deliveries: ZapierReport['deliveries'];
	readonly late: boolean;
}) {
	const toZaps = (
		<Button as="a" href={YOUR_ZAPS} target="_blank" rel="noreferrer" markAfter="external-link">
			Open your Zaps
		</Button>
	);
	const { failed, waiting } = deliveries;
	return (
		<>
			{failed > 0 ? (
				<Banner tone="blocker" word="Deliveries given up" actions={toZaps}>
					{failed} {failed === 1 ? 'delivery' : 'deliveries'} to your Zaps{' '}
					{failed === 1 ? 'was' : 'were'} given up in the past week, after three days of retries. A
					Zap that is off or erroring is the usual cause.
				</Banner>
			) : null}
			{late ? (
				<Banner tone="attention" word="Your Zaps are behind" actions={toZaps}>
					{waiting} {waiting === 1 ? 'delivery is' : 'deliveries are'} waiting, the oldest for over
					an hour. A Zap that is off or erroring is the usual cause.
				</Banner>
			) : null}
		</>
	);
}
