import { AnchoredNote } from '@better-giving/operator/behaviour/AnchoredCard';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { CodeSlab } from '@better-giving/operator/components/data/CodeSlab';
import { CheckboxGroup } from '@better-giving/operator/components/forms/CheckboxGroup';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Section } from '@better-giving/operator/components/shell/Layout';
import { StatusLedger, StatusLine } from '@better-giving/operator/components/status/StatusLine';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { useSavedFormState } from '@better-giving/operator/saved-form-state.react';
import type { ReactNode } from 'react';
import { Suspense, useId } from 'react';
import { Await, Form } from 'react-router';
import type {
	NoReport,
	PaymentsRead,
	ProcessorPayments,
	RecurringRead,
	RecurringReading,
	ValuesRefusal,
	VarsWritten
} from '../api/types';
import type { HeldValues } from './held-values';
import { withheldAmong } from './held-values';
import {
	CHARITY_APPROVED,
	CHARITY_FIELD,
	CHARITY_INTENT,
	CHARITY_RATE,
	charityApproved
} from './paypal-charity';
import type { ConfiguredPayments } from './processor-payments';
import {
	EVIDENCE_SAYS,
	STANDING,
	configuredStanding,
	unmanagedEndpoint
} from './processor-payments';
import { recurringReading } from './recurring-rows';
import type { GroupReport } from './secret-group-form';
import { SecretGroupForm } from './secret-group-form';
import { refusalIn } from './secret-trouble';
import { PAYPAL_GROUP, SECRET_GROUPS, groupIntent } from './secret-groups';
import { FREE_INTENT, WithheldValues } from './withheld-values';

// the whole of PayPal on this deployment — what its account answered, where it has to be told to
// report, the three credentials that configure it, and the one answer about the organisation that
// prices a gift.
//
// **it is a second section of the payments fold and not a fold of its own.** the two processors are
// alternatives and a deployment set up on either is set up (`CHARGE_PAIRS` in
// packages/app/src/lib/server/config/readiness.ts), so they answer to one row on the page above
// (./home-sections.ts) and stand one above the other under it, divided by the rule
// packages/operator/src/styles/adm.css draws between two sections in a panel.
//
// **a processor nobody has configured draws no reading at all, and that is not a failure.** the
// deployment answers `unconfigured` carrying the names it is short of and no reading whatever
// (`ProcessorPayments` in ../api/types.ts) — the wire is shaped that way precisely so a blank cannot
// be coloured in as a red row — so what stands here for such a deployment is the boxes that
// configure it and nothing else. that is every deployment on Stripe alone, and every fresh fork.
//
// **there is no registration press on this section and building one would be taking a Stripe shape
// somewhere it does not fit.** PayPal publishes no endpoint-management API this release uses, so the
// deployment answers `unmanaged` and hands back the address instead: the operator registers a
// webhook by hand in PayPal's own dashboard, PayPal mints the id there, and they paste it into the
// box below. so the whole of this section's job about webhooks is to say the address plainly enough
// to take, which is what the one-line slab is for.
//
// **and nothing here draws the signing-secret reading.** a deployment whose endpoint this release
// does not register carries `unconfirmable` for ever (`WEBHOOK_SECRET_STANDINGS` in
// `packages/operator/src/console/payments.ts`), so a row for it would be a row that never changes on
// any deployment, under a word an operator would read as a fault.
//
// **two presses and not one.** the three credentials are one group because an operator holds all
// three off one PayPal app (`PAYPAL_GROUP` in ./secret-groups.ts); the charity rate is an answer
// about the organisation, given months after the keys are, and folding it into that press would
// make changing it a re-commit of every credential beside it (./paypal-charity.ts).
//
// **it is a component and not a screen.** every read it draws was taken by ../routes/_index.tsx and
// the presses it makes are answered there.

/** where PayPal's own credentials are made, one press off the heading. */
const DASHBOARD = 'https://developer.paypal.com/dashboard/applications/live';

/** the one group this section stores, taken out of the enumeration rather than named again. */
const PAYPAL_CREDENTIALS = SECRET_GROUPS.filter((group) => group.id === PAYPAL_GROUP);

/**
 * what each box is called, where the variable name is not what to put in front of an operator.
 *
 * PayPal's own words for them, so an operator reading down its dashboard page finds each one under
 * the name it is printed there — with one departure: `Client secret` rather than the `Secret key`
 * the dashboard prints, because the Stripe boxes a step above this on the same fold already draw a
 * box called `Secret key`, and two boxes sharing an accessible name on one screen is a control a
 * reader cannot tell from the other.
 */
const LABEL: Record<string, string> = {
	PAYPAL_CLIENT_ID: 'Client ID',
	PAYPAL_CLIENT_SECRET: 'Client secret',
	PAYPAL_WEBHOOK_ID: 'Webhook ID'
};

export type PaypalSectionProps = {
	/**
	 * where every processor account stands, on the promise the loader handed down.
	 *
	 * the same promise the Stripe half above awaits: one read answers for both processors, so a
	 * second request here would be two views of one deployment able to disagree by the time an
	 * operator reads them.
	 */
	payments: Promise<PaymentsRead | null>;
	/**
	 * where every account stands on gifts that repeat, on the loader's other promise.
	 *
	 * awaited here for the one thing this section can say about it and the fold above cannot: a read
	 * of the PayPal account that did not land draws no line in the fold's repeating-gift band
	 * (`recurringRows` in ./recurring-rows.ts), so the sentence naming what to do about it stands
	 * with this account's other failed readings or nowhere.
	 */
	recurring: Promise<RecurringRead | null>;
	/** what the deployment is holding, which is what the boxes are drawn with (./held-values.ts). */
	values: HeldValues;
	/** how the last press over the credentials group went, or `null`. */
	secrets: GroupReport | null;
	/** how the last press of the charity-rate switch went, or `null`. */
	charity: VarsWritten | null;
	/** how the last press that frees a value held in a form nothing can read back went, or `null`. */
	freed: VarsWritten | null;
	/** what a failed write says, in the words the fold holding the account name has for it. */
	trouble: (written: ValuesRefusal) => ReactNode;
	/** what a deployment that answered nothing says, in the same fold's words. */
	noAnswer: (read: NoReport, what: string) => ReactNode;
	/** something else on the page is writing, which holds every control on it closed. */
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
	/** the router is re-reading the page over an answer it has already committed. */
	revalidating: boolean;
};

export function PaypalSection({
	payments,
	recurring,
	values,
	secrets,
	charity,
	freed,
	trouble,
	noAnswer,
	busy,
	pending,
	revalidating
}: PaypalSectionProps): ReactNode {
	/* the same sentence over both boundaries: what an operator is waiting on is one account's
	   readings, and two waits worded apart would be two subjects where there is one. */
	const asking = <p className="adm-hint">Asking this deployment…</p>;
	return (
		<Section>
			{/* what the account answered, drawn above the boxes that change it for the reason the Stripe
			    half states: the reading is what an operator opened the fold to find out, and the press
			    that would rewrite it comes last. */}
			<Suspense fallback={asking}>
				<Await resolve={payments}>
					{(read) => (
						<Suspense fallback={asking}>
							<Await resolve={recurring}>
								{(gifts) => <PaypalReadings read={read} gifts={gifts} noAnswer={noAnswer} />}
							</Await>
						</Suspense>
					)}
				</Await>
			</Suspense>

			<div className="adm-named">
				<h3>
					Your PayPal keys{' '}
					<AnchoredNote mark="info" label="Where to get your PayPal keys">
						<PaypalKeys />
					</AnchoredNote>
				</h3>
				{/* a list of one, drawn by mapping: an id that stops matching the enumeration draws no
				    boxes rather than throwing at an operator who came to read them. ./smtp-fold.tsx
				    answers the same thing the same way. */}
				{PAYPAL_CREDENTIALS.map((group) => (
					<SecretGroupForm
						key={group.id}
						group={group}
						values={values}
						report={secrets?.group === group.id ? secrets : null}
						busy={busy}
						pending={pending === groupIntent(group)}
						revalidating={revalidating}
						trouble={trouble}
						boxLabel={(name) => LABEL[name] ?? name}
						/* where the third value comes from, which the other two do not need: an operator
						   holding a PayPal app has the pair in front of them and has never seen this one.
						   it names no position on the screen — the block that carries the address is drawn
						   only once this deployment holds credentials, so a hint pointing above it would
						   point at nothing on the deployment being set up for the first time. */
						boxHint={(name) =>
							name === 'PAYPAL_WEBHOOK_ID'
								? 'PayPal gives you this when you add a webhook on your account.'
								: undefined
						}
						withheldSays="Until these are saved again, this deployment takes no gift through PayPal."
						withheldWritten={freed}
						freeing={pending === FREE_INTENT}
					/>
				))}
			</div>

			<CharityRate
				values={values}
				written={charity}
				freed={freed}
				trouble={trouble}
				busy={busy}
				pending={pending}
			/>
		</Section>
	);
}

/**
 * what PayPal's own account answered, or nothing at all where it was never asked.
 *
 * **a deployment holding no PayPal credentials draws nothing up here**, exactly as the Stripe half
 * draws nothing over a deployment holding no key: nothing was asked, so there is no row, no band and
 * no waiting sentence — and the boxes underneath are the whole truth of that state.
 */
function PaypalReadings({
	read,
	gifts,
	noAnswer
}: {
	read: PaymentsRead | null;
	gifts: RecurringRead | null;
	noAnswer: (read: NoReport, what: string) => ReactNode;
}): ReactNode {
	if (read === null) return null;
	if (read.kind === 'unread') {
		return noAnswer(read.read, "it can't say where this PayPal account stands");
	}
	const entry: ProcessorPayments | undefined = read.report.processors.find(
		(one) => one.processor === 'paypal'
	);
	const standing = configuredStanding(entry ?? null);
	if (standing === null) return null;
	return (
		<>
			<Unreadable standing={standing} repeats={recurringReading(gifts, 'paypal')} />
			<Rails standing={standing} />
			<Endpoint standing={standing} />
		</>
	);
}

/**
 * the one thing to say about a read this deployment tried to make against PayPal and could not.
 *
 * **said once and never once per reading**, the same rule the Stripe half keeps: all three go
 * through one port with one set of credentials, so several failing is one fact — drawn as a row in
 * each, an operator is told the same thing twice and has two places to look for the one sentence
 * that names what to do.
 *
 * **and nothing at all where nothing was asked**: a processor holding no credentials carries no
 * reading whatever, and this is only reached under one that does. so what stands here is a
 * deployment whose PayPal keys were rejected or whose PayPal did not answer, which is exactly the
 * state nothing else on the screen can say — a reading that did not land draws no block under this
 * and no line in the fold's repeating-gift band above it (`recurringRows` in ./recurring-rows.ts),
 * and an operator reading that as nothing to do would leave a deployment taking no gift at all.
 *
 * the deployment's own detail goes underneath and is drawn rather than printed: it names the value
 * to fix and marks it (`@better-giving/operator/code-spans`). the account-level read's where more
 * than one failed, since that is the one whose cause the others inherit.
 */
function Unreadable({
	standing,
	repeats
}: {
	standing: ConfiguredPayments;
	/**
	 * where this account stands on gifts that repeat, and `null` where the report carries nothing for
	 * it — including the read that did not land at all, which the fold above says once for both
	 * accounts.
	 */
	repeats: RecurringReading | null;
}): ReactNode {
	const unread: { says: string; detail: string }[] = [];
	if (standing.rails.state === 'unreadable') {
		unread.push({ says: 'which ways of paying it can take', detail: standing.rails.detail });
	}
	if (standing.subscription.state === 'unreadable') {
		unread.push({
			says: 'where PayPal has to report settlements',
			detail: standing.subscription.detail
		});
	}
	if (repeats?.state === 'unreadable') {
		unread.push({ says: 'whether repeating gifts are set up', detail: repeats.detail });
	}
	const first = unread[0];
	if (first === undefined) return null;
	return (
		<div className="adm-stack">
			<FieldMessage>
				This deployment couldn’t read your PayPal account, so it can’t say{' '}
				{unread.map((one) => one.says).join(' or ')}.
			</FieldMessage>
			<p className="adm-prose">
				<MarkedText text={first.detail} />
			</p>
		</div>
	);
}

/**
 * which ways of paying this PayPal account may take, and what the answer is worth.
 *
 * **a green row here says the credentials work and says nothing about the rail beside it.** PayPal
 * publishes no per-rail approval to a merchant holding only its own credentials, so every rail comes
 * back `approved` on the strength of the pair authenticating — and the deployment writes that in
 * words as each row's own note, which is why nothing is said over the ledger
 * (`EVIDENCE_SAYS` in ./processor-payments.ts).
 *
 * **so it reads the evidence the deployment sent and never the processor it is drawing.** the two
 * are the same answer today and the evidence is on the wire because they need not stay so: a
 * processor that starts publishing approvals is a ledger that gains its sentence here rather than
 * one that keeps drawing a green row with nothing over it.
 *
 * the ledger is drawn as columns for the reason the Stripe half's is: every row is the same two
 * things, so an operator reads down a column rather than across a line.
 */
function Rails({ standing }: { standing: ConfiguredPayments }): ReactNode {
	if (standing.rails.state !== 'read') return null;
	const says = EVIDENCE_SAYS[standing.rails.evidence];
	return (
		<div className="adm-named">
			<h3>PayPal donation methods</h3>
			{says === null ? null : <p className="adm-prose">{says}</p>}
			<StatusLedger aligned>
				{standing.rails.rails.map((line) => (
					<StatusLine
						key={line.rail}
						labelAs="span"
						label={line.label}
						word={STANDING[line.standing].word}
						/* an approved rail says so with the tick and nothing else, and the word goes on to
						   the mark as its name so a reader who cannot see the shape is told what the tick
						   says — the Stripe ledger's own rule over the same shape. */
						wordOnMark={STANDING[line.standing].tone === 'done'}
						tone={STANDING[line.standing].tone}
						note={line.note === null ? undefined : <MarkedText text={line.note} />}
					/>
				))}
			</StatusLedger>
		</div>
	);
}

/**
 * where PayPal has to be told to report settlements, and nothing at all where this release registers
 * the endpoint itself.
 *
 * **the address is the whole of what an operator does here and it is the one thing only the
 * deployment knows**: no hostname is committed to this repository (CLAUDE.md), so the deployment
 * learns its own off the request that reached it and this arm is the only place it is ever said. an
 * operator who is not told it registers a listener pointed at nothing, and a processor with nowhere
 * to deliver settles gifts that never reach the books.
 *
 * the one-line slab rather than a sentence with the address in it: it is one unbroken literal nobody
 * reads and somebody copies, which is exactly what that form is for
 * (`CodeSlab` in packages/operator/src/components/data/CodeSlab.jsx).
 *
 * the sentence above it is the deployment's own and is drawn rather than printed, because it marks a
 * variable name (`@better-giving/operator/code-spans`).
 */
function Endpoint({ standing }: { standing: ConfiguredPayments }): ReactNode {
	const endpoint = unmanagedEndpoint(standing);
	if (endpoint === null) return null;
	return (
		<div className="adm-named">
			<h3>PayPal webhooks</h3>
			<p className="adm-prose">
				<MarkedText text={endpoint.detail} />
			</p>
			<CodeSlab content={endpoint.address} oneline copyable />
		</div>
	);
}

/**
 * whether PayPal has approved this organisation for its charity rate, as a switch with two
 * positions.
 *
 * **there is no third position and no rate is typed.** what the answer picks between is two tables
 * of published rates that stay constants in the tree (`paypalFeeRules` in
 * packages/app/src/lib/server/payments/fees.ts), and off is the value taken away rather than a
 * stored no — ./paypal-charity.ts argues both.
 *
 * **it is a fact about the account and never a preference**, which is what the label says: PayPal
 * reports it on no call, so the operator is the only party that can answer, and the deployment
 * quotes a donor covering fees off whichever table they said.
 *
 * its own press and its own form, for the reason ./paypal-charity.ts states — and one `<form>`
 * inside another is not a tree the parser keeps, so it stands beside the credentials rather than
 * inside them.
 */
function CharityRate({
	values,
	written,
	freed,
	trouble,
	busy,
	pending
}: {
	values: HeldValues;
	written: VarsWritten | null;
	/** how the last press that frees a withheld value went, drawn in the block that frees this one. */
	freed: VarsWritten | null;
	trouble: (written: ValuesRefusal) => ReactNode;
	busy: boolean;
	pending: string | null;
}): ReactNode {
	const box = `${useId()}-charity-rate`;
	const approved = charityApproved(values.seeds[CHARITY_RATE] ?? '');
	const sending = pending === CHARITY_INTENT;
	const failure = written === null ? null : refusalIn(written);

	const { form, state, onInput, onSubmit } = useSavedFormState({
		report: written,
		landed: written?.kind === 'set',
		// the switch is read off the element at every press of it, which is the reading a block with
		// no form layer takes (`SavedFormInputs.changed` in
		// packages/operator/src/saved-form-state.react.ts).
		changed: (element) => {
			const control = element.elements.namedItem(CHARITY_FIELD);
			return (control instanceof HTMLInputElement ? control.checked : false) !== approved;
		},
		busy,
		pending: sending
	});

	return (
		<div className="adm-named">
			<h3>PayPal’s charity rate</h3>
			<Form
				className="adm-stack"
				method="post"
				preventScrollReset
				ref={form}
				onInput={onInput}
				onSubmit={onSubmit}
			>
				<CheckboxGroup
					id={box}
					items={[
						{
							id: box,
							name: CHARITY_FIELD,
							value: CHARITY_APPROVED,
							label: 'PayPal has approved this organisation for its charity rate',
							// the consequence of getting it wrong, which is the one thing the label cannot
							// carry and the one direction that costs the organisation money: the two tables
							// are asymmetric, and `paypalFeeRules` in
							// packages/app/src/lib/server/payments/fees.ts is where that is argued. what the
							// switch is for is the heading over it, so nothing here says it again.
							note: 'Ticked without PayPal’s approval, a donor covering the fee is quoted less than PayPal takes and this organisation makes up the difference.',
							defaultChecked: approved,
							// closed while this press is in flight and while another press on the page
							// writes: the position is read once, at the press.
							disabled: busy || sending
						}
					]}
				/>

				{/* the name in this state has no box to be typed out of, and this press is the only one
				    that writes it — so the block that frees it stands here or nowhere. */}
				<WithheldValues
					names={withheldAmong(values, [CHARITY_RATE])}
					all={values.withheld}
					consequence="Until this is saved again, every donor covering a PayPal fee is quoted the standard rate."
					written={freed}
					trouble={trouble}
					busy={busy}
					freeing={pending === FREE_INTENT}
				/>

				<div className="adm-actions">
					<SaveButton name="intent" value={CHARITY_INTENT} state={state} />
				</div>

				{/* an outcome reports at the control that made it, and a press that landed is the
				    button's own tick — so what is left is the ways it did not happen. a press refused
				    over a name held as a credential is drawn at the block above, which is where the way
				    out of that state is (`refusalIn` in ./secret-trouble.tsx). */}
				{failure === null ? null : trouble(failure)}
			</Form>
		</div>
	);
}

/**
 * where PayPal's two credentials and its webhook id come from.
 *
 * the one fact a box cannot carry — that all three are behind one app in PayPal's developer
 * dashboard, and which dashboard. ./payments-fold.tsx's `StripeKeys` says the same kind of thing
 * about the other processor.
 */
function PaypalKeys(): ReactNode {
	return (
		<p>
			Make a live app in your PayPal developer dashboard:{' '}
			<a href={DASHBOARD} target="_blank" rel="noreferrer">
				Apps &amp; Credentials &rarr; Live
			</a>
			. The client ID and the secret key are on that app, and so is the webhook you add at the
			address above — its ID is the third box.
		</p>
	);
}
