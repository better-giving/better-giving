import { FREQUENCY_LABELS } from '@better-giving/form/v1';
import { BackLink } from '@better-giving/operator/components/controls/BackLink';
import { CodeChip } from '@better-giving/operator/components/data/CodeSlab';
import { DestructiveConfirm } from '@better-giving/operator/components/shell/DestructiveConfirm';
import { Column, Section } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { useEffect, useRef } from 'react';
import { data, Form, href, Link, useNavigation } from 'react-router';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { RouterLink } from '$lib/admin/router-link';
import { screenTitle } from '$lib/admin/screen-title';
import { formatMinor } from '$lib/donations/money';
import {
	recurringStatusNote,
	RECURRING_STATUS_LABELS,
	type RecurringPlanStatus
} from '$lib/recurring/statuses';
import { readContactSummaries } from '$lib/server/contacts/queries';
import { loadFailed, notFound } from '$lib/server/db/load-failure';
import { redirectWithFlash, SAVED_FLASH, takeFlash } from '$lib/server/flash';
import { readForm } from '$lib/server/forms/queries';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { isProcessor, PROCESSOR_LABELS } from '$lib/server/payments/provider';
import { readRecurringPlan } from '$lib/server/recurring/queries';
import { stopRecurringGift } from '$lib/server/recurring/stop';
import { database, platform } from '../context';
import type { Route } from './+types/_app.admin.recurring.$id';

// one standing commitment: what it is, and the one act this dashboard performs on it.
//
// this file is deliberately thin. what reaches the database lives in
// `$lib/server/recurring/queries.ts`, the order the stop's two writes happen in lives in
// `$lib/server/recurring/stop.ts`, and the only job here is turning a row into what the page
// renders and an outcome into a sentence.
//
// **nothing here writes a commitment row.** `collect.ts` is the only module that may `INSERT` into
// `recurring_plan` (CLAUDE.md) — a row is written by the first charge that settles, from what
// actually moved — and the two calls this file makes are a read and an update. an id no row answers
// to is a 404 rather than a row minted to answer it.
//
// there is no stated form on this screen and there must not be one, which is the retired screen's
// own carve-out carried over. the stop submits no values at all — the id comes from the route,
// which is what keeps a stale tab from stopping a gift nobody was looking at — so `defineForm`
// would buy an empty schema and a form id to keep apart from nothing: this screen carries one
// submission, so there is nothing for `WHICH_FORM` to tell it apart from. the archive on
// ./_app.admin.forms.$id.tsx is a stated form because that screen carries four submissions under
// one `action` and they have to be told apart; `$lib/server/conform.ts`'s header is where the rule
// and its shape are argued. the refusal below therefore travels in its own keys rather than under a
// form's, which is also where it belongs: there is no input on this screen for a message to sit
// under.
//
// no provider read is performed to draw this page. everything on it is this deployment's own row,
// and a screen that asked the processor anything would fail or hang whenever that processor did —
// on the screen an operator opened to stop a gift.
//
// **every sentence here that names a processor is written off the commitment's own `provider`
// column.** a deployment may hold keys for either, and a commitment lives on whichever one collected
// its first charge — so a name written in rather than read off the row is a staff member sent to an
// account they hold nothing on. the column also keeps `manual`, which no processor answers for, and
// a sentence that would need a name there is not softened but left unwritten.

/**
 * the two markers a stop leaves for the GET it redirects to, one per landing this screen has a
 * different sentence for: a subscription this act cancelled, and one the processor never had.
 *
 * deliberately not one of any screen's saved sections, for the reason `ARCHIVED` is on
 * /admin/forms/[id]: a marker no button answers to is what keeps `savedSection` from lighting a
 * control over a record that has just lost its control.
 *
 * exported because `./_app.admin.recurring.$id.workers.spec.ts` writes them into its jar — a marker
 * renamed here and left spelled out there would be a rename nothing fails over, on the pair of
 * strings this screen's outcome banner depends on agreeing.
 */
export const STOPPED = 'stopped';
export const NOTHING_TO_STOP = 'nothing-to-stop';

/** what a stop just landed here, or `null` on any other visit. */
type StopLanding = typeof STOPPED | typeof NOTHING_TO_STOP | null;

/**
 * the sentence for a stop the processor refused, which of two depends on whether making the
 * identical call again is worth anything.
 *
 * `isRetryable`'s partition is what decides it, one module over, so this screen never guesses: a
 * "try again" over a terminal refusal is an operator pressing a button that will answer the same
 * way every time, and a dead end over a retryable one sends them to the processor's dashboard for a
 * minute of bad weather.
 *
 * neither says what the gift is now, and that is the rule this pair is written under: this row was
 * not written, and what happened at the processor is something no refusal establishes. the retryable one
 * is where it bites — a lost answer is `unreachable`, whose own detail says in as many words that
 * whether the call took effect is unknown ($lib/server/payments/stripe.ts), so a sentence in front
 * of it claiming the gift is still collecting is one banner making two opposite claims. the failure
 * that makes it more than untidy: a lapsed gift whose subscription really was cancelled sits at
 * `lapsed` for good, because the `customer.subscription.deleted` that follows is written only over
 * `status = 'active'` (`recordStanding` in $lib/server/donations/collect.ts) — so a screen that told
 * an operator to leave it alone would be telling them to leave a row nothing repairs.
 *
 * `processor` is which one refused, in the words an operator reads, and `null` is the one refusal
 * no processor issued — a commitment recorded against a provider no adapter answers for
 * ($lib/server/recurring/stop.ts). both sentences send somebody to a dashboard, so with no
 * processor to name there is nowhere to send them and the port's own sentence stands alone: it
 * says what the column holds, which is the whole of what is wrong.
 */
function refusalSentence(retryable: boolean, detail: string, processor: string | null): string {
	if (processor === null) return detail;
	return retryable
		? `This attempt did not finish, so whether ${processor} stopped collecting this gift is ` +
				'unknown here and nothing was recorded. Reload the page and try again. Stopping a gift ' +
				'twice does nothing extra. If it keeps failing, check the subscription id on this ' +
				`screen against your ${processor} dashboard. ${detail}`
		: `${processor} refused to stop this gift and nothing was recorded here. Repeating this ` +
				`will answer the same way. Find this subscription in your ${processor} dashboard, check ` +
				`whether it is still collecting, and cancel it there if it is. ${detail}`;
}

/**
 * what stopping this commitment does to the money, which is the first half of what the
 * confirmation states.
 *
 * a lapsed gift is the one worth telling apart: the processor is not collecting it now, and
 * `revives` in `$lib/server/donations/collect.ts` moves the row back to `active` when the rail
 * reports the card went through — so "stops collecting it straight away" would describe a gift
 * nothing is charging, and leave the reason to press unstated.
 *
 * a commitment no processor answers for gets the consequence with no processor in it, and the same
 * one in both states: nothing can revive it, because reviving is a delivery from a processor. the
 * clause is never dropped — this is the press's own cost, and a destructive confirmation that
 * states none is one an operator answers blind.
 */
function stopConsequence(status: RecurringPlanStatus, processor: string | null): string {
	if (processor === null) return 'Nothing further is collected.';
	return status === 'lapsed'
		? `${processor} is not collecting this now, but it can start again on its own if this ` +
				'donor’s card goes through.'
		: `${processor} stops collecting it straight away.`;
}

/**
 * a marker read as one of this screen's two landings, or `null` for anything else.
 *
 * a marker no landing answers to reports nothing, the rule `savedSection` keeps for a section
 * name: the string crosses a boundary, and this is where the screen says which strings it has a
 * sentence for.
 */
function landing(marker: string | null): StopLanding {
	if (marker === STOPPED) return STOPPED;
	if (marker === NOTHING_TO_STOP) return NOTHING_TO_STOP;
	return null;
}

/** what to say when there is no such commitment, wherever it is asked. */
const NO_SUCH_GIFT =
	'No recurring gift here has that address. It may have been opened from an old link. Go back to Recurring gifts and pick it from the list.';

/** where this screen's own write sends the browser back to. */
function screen(id: string): string {
	return href('/admin/recurring/:id', { id });
}

/** the section this screen sits under, named on the way back and in the tab. */
const SECTION = 'Recurring gifts';

export function meta({ loaderData, matches }: Route.MetaArgs): Route.MetaDescriptors {
	// the donor's name, and the section's word where there is no commitment to name — an old link,
	// a read that failed. the fallback is what keeps a tab saying something on every reading of
	// this address.
	return [{ title: screenTitle(loaderData?.donorName ?? SECTION, matches) }];
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
	const db = context.get(database);

	let plan: Awaited<ReturnType<typeof readRecurringPlan>>;
	try {
		plan = await readRecurringPlan(db, params.id);
	} catch (e) {
		console.error('reading a recurring gift failed:', e);
		loadFailed('This recurring gift');
	}

	// a stopped commitment comes back and renders as a record, so the only 404 here is an address
	// no row answers to. the id is not echoed: unlike a form id, a commitment's is not public by
	// construction, and the address bar already holds the one that was typed.
	if (plan === null) notFound(NO_SUCH_GIFT);

	// two independent reads, so they go together: neither is an input to the other, and awaiting
	// them in turn pays two round trips for one screen.
	const [donors, form] = await Promise.all([
		readContactSummaries(db, [plan.contactId]),
		readForm(db, plan.formId)
	]);
	const donor = donors.get(plan.contactId);

	// taken after every read and every refusal above, so a screen that could not be drawn burns no
	// marker — and taken exactly once, because the header that comes back with it is what clears it.
	const landed = await takeFlash(request, SAVED_FLASH);

	return data(
		{
			id: plan.id,
			// unreachable — `contact_id` is NOT NULL and its foreign key is `NO ACTION` — and answered
			// rather than asserted away, because a heading with no name on the screen whose whole job is
			// a named person is a worse answer to a state that cannot happen than a word saying so.
			donorName: donor?.displayName ?? 'Unknown donor',
			donorEmail: donor?.primaryEmail ?? null,
			// formatted here rather than in the page: the stored value is an integer number of minor
			// units, so a component rendering it renders a gift a hundred times its size.
			amount: formatMinor(plan.amountMinor, plan.currency),
			// the value, not the word: `FREQUENCY_LABELS` in `packages/form/src/v1.ts` is what the page renders
			// it with, and a cadence with no label there is a type error.
			interval: plan.interval,
			// the value, not the word: `RECURRING_STATUS_LABELS` and `recurringStatusNote` in
			// `$lib/recurring/statuses.ts` are what the page renders it with.
			status: plan.status,
			// the dates only, ISO, formatted here for the reason /admin/donations formats its own here:
			// an `Intl.DateTimeFormat` in the page would run once on the Worker during ssr and again in
			// the browser, in two different locales and time zones — a hydration mismatch as well as a
			// lie about whose "today" it is.
			startedOn: plan.startedAt.toISOString().slice(0, 10),
			// `null` travels as `null`, because it means "none expected" and covers both an ended
			// commitment and one whose rail has not yet said — two different sentences on the screen.
			nextChargeOn:
				plan.nextChargeAt === null ? null : plan.nextChargeAt.toISOString().slice(0, 10),
			endedOn: plan.endedAt === null ? null : plan.endedAt.toISOString().slice(0, 10),
			formId: plan.formId,
			// the form's name and never the fund it posts to. `writeAgainstPlan` reads the fund off the
			// form at the moment each charge settles ($lib/server/donations/collect.ts), so a fund
			// stated here would be today's answer over a series whose earlier charges posted somewhere
			// else — a value that reads clean and is wrong. the form is the fact this row holds, and it
			// reaches the fund in one click on the screen that states the fund as a fact about a form.
			//
			// the fallback is unreachable — `form_id` is NOT NULL and its foreign key is `NO ACTION` —
			// and is the row's own label rather than a minted sentence, so a state that cannot happen
			// costs the screen no copy nobody reviewed.
			formName: form?.name ?? 'Donation form',
			// which processor this commitment lives on, in the words an operator reads, or `null` where
			// no processor answers for it. every sentence on this screen that names one is written off
			// this value.
			//
			// the word and not the row's value, which is where this parts company with `status` above:
			// `PROCESSOR_LABELS` is in `$lib/server/payments/provider.ts`, beside the processors it
			// spells, and a component may not import from `$lib/server/**` at all — so the lookup is
			// here and what crosses is the spelling. `isProcessor` is the narrowing rather than a
			// comparison, so `manual` is answered with nothing rather than shown to an operator.
			processor: isProcessor(plan.provider) ? PROCESSOR_LABELS[plan.provider] : null,
			// the processor's own id for the commitment, and the one deliberate processor reference on
			// this screen: it is what a staff member looks the gift up by in that processor's dashboard
			// when a stop half-lands, which is the state the outcome copy sends them there for.
			subscriptionId: plan.providerSubscriptionId,
			// which stop just landed here, if either. it is a banner rather than a mark on the control
			// that carried it, because after it lands there is no stop control left on the page — the
			// stated carve-out in the operator surfaces' rule about where a write reports.
			//
			// a landing rather than a boolean, because the two are different sentences: one gift was
			// being collected until this act, the other was not being collected at all — the processor
			// held no subscription for it — and the page says which.
			stopLanded: landing(landed?.marker ?? null),
			// whether the operator has asked to stop and is being asked again.
			//
			// the state lives in the URL because that is where a question an operator can share,
			// reload and back out of lives.
			//
			// never offered for a commitment that is already stopped: the action refuses it, so a panel
			// asking about it is a question with one wrong answer.
			confirmStop:
				plan.status !== 'cancelled' && new URL(request.url).searchParams.get('confirm') === 'stop'
		},
		// the header that burns the marker rides on the response that publishes it, so a reload of
		// this screen announces nothing. a `Set-Cookie` from a loader is sent without this route
		// exporting `headers` — react router preserves that one header on its own
		// (react-router/docs/how-to/headers.md).
		landed === null ? {} : { headers: { 'Set-Cookie': landed.clear } }
	);
}

/**
 * stop this commitment: nothing further is collected, and nothing already collected is returned.
 *
 * permanent, and structurally so rather than by policy. `revives` in
 * `$lib/server/donations/collect.ts` requires `status = 'lapsed'`, so moving the row to `cancelled`
 * is what guarantees no delivery can bring it back — and there is no un-stopping in this product,
 * at the rail or on any screen. the confirmation says so before the button is reached.
 *
 * the act itself is `$lib/server/recurring/stop.ts`, and every decision in it is there rather than
 * here: what this file owns is which sentence each outcome gets and what http status it carries.
 *
 * the body is never read, which is the strongest form of "no field can aim this elsewhere": the id
 * comes from the route.
 *
 * `notFound` for a commitment that is not there rather than a banner, because the screen the banner
 * would be drawn on is a screen with no record on it.
 */
export async function action({ context, params, request }: Route.ActionArgs) {
	// the provider is built here, per request, from the platform env — never a module-scope
	// singleton (CLAUDE.md). a deployment with no keys set opens no socket at all: the provider
	// refuses and the refusal names the variable to set.
	const result = await stopRecurringGift(
		context.get(database),
		createPaymentProviders(context.get(platform).env),
		params.id
	);

	// out here rather than in the switch below, because it is the one outcome that is not a state of
	// this page: there is no record to draw a banner over.
	if (result.outcome === 'gone') notFound(NO_SUCH_GIFT);

	switch (result.outcome) {
		case 'already-stopped':
			// a double press or a stale tab. refusing it is what keeps `ended_at` from being
			// overwritten, the same reason `archiveForm` refuses a form that is already archived.
			return refused(400, {
				stopWord: 'Nothing was stopped',
				stopError: 'This gift is already stopped. Reload the page to see how it stands.'
			});

		case 'refused':
			// a 500 rather than a 400, for the reason the console's webhook presses answer with one:
			// no input on this page fixes a processor that refused.
			return refused(500, {
				stopWord: 'Not stopped',
				stopError: refusalSentence(
					result.retryable,
					result.detail,
					// the processor that refused, off the outcome rather than off the row this action
					// never read: which one a commitment lives on is what `stopRecurringGift` learns
					// first, and it carries the answer back so this sentence cannot name the other.
					result.processor === null ? null : PROCESSOR_LABELS[result.processor]
				)
			});

		case 'unrecorded':
			// the state worth designing carefully: money has stopped and this screen may still say
			// Active. it says both halves plainly and promises no self-healing — the webhook's own
			// write is guarded on `status = 'active'`, so it would repair an active row and not a
			// lapsed one, and a promise would be true two-thirds of the time.
			return refused(500, {
				stopWord: 'Partly done',
				stopError:
					`${PROCESSOR_LABELS[result.processor]} has stopped collecting this gift, so nothing ` +
					'further will be charged. This deployment could not record that, so it may still ' +
					'read as collecting here. Reload the page; if it has not caught up, the ' +
					'subscription id on this screen is what to check against your ' +
					`${PROCESSOR_LABELS[result.processor]} dashboard.`
			});

		// the two successes, one arm because what they do is identical and one marker each because
		// they are different facts about what was collecting before the button was pressed. both
		// redirect, which is what puts the banner over a record that has been read again — a stopped
		// row saying Active under a banner saying Stopped is the state this avoids.
		case 'nothing-to-stop':
		case 'stopped':
			return redirectWithFlash(
				request,
				SAVED_FLASH,
				screen(params.id),
				result.outcome === 'stopped' ? STOPPED : NOTHING_TO_STOP
			);
	}
}

/**
 * what a stop that did not fully land sends back.
 *
 * its own channel rather than a form's, because there is no input on this screen for a message to
 * sit under — routing it through one would render a refused stop as a complaint about a box a
 * fundraiser filled in correctly.
 *
 * it carries the banner's word as well as its sentence, which is where it parts company with the
 * archive's on /admin/forms/[id]. that screen has one failure and one word; this one has three, and
 * they are not interchangeable — `Not stopped` and `Partly done` are opposite claims about whether
 * the donor is still being charged. the word is resolved here rather than derived in the page from
 * the sentence, because every word an operator reads in this dashboard is copy in this repository.
 */
function refused(status: 400 | 500, failure: { stopWord: string; stopError: string }) {
	return data(failure, { status });
}

// what this page owes is that a staff member holding an email from a donor can read this gift and
// stop it, and come away in no doubt that stopping it told the donor nothing.

export default function RecurringGift({ loaderData, actionData }: Route.ComponentProps) {
	const {
		amount,
		confirmStop,
		donorEmail,
		donorName,
		endedOn,
		formId,
		formName,
		id,
		interval,
		nextChargeOn,
		processor,
		startedOn,
		status,
		stopLanded,
		subscriptionId
	} = loaderData;

	const navigation = useNavigation();
	const stopping = navigation.state === 'submitting';

	const stopped = status === 'cancelled';

	// whether the question is on the screen, which is what decides where a refusal is reported and
	// where focus lands. it is drawn by the two conditions below and read by both.
	const asking = !stopped && confirmStop;

	// the question in the words it is asked in, stated once and read twice: it is the banner's own
	// word and it is the name of the group holding the banner and the two controls. one expression
	// rather than two strings, so the name a voice user says cannot drift from what is on the screen
	// (WCAG 2.5.3).
	const question = `Stop this gift from ${donorName}?`;

	// where the answer lands on the two navigations that open and leave the question. both are links
	// to this same address, and a navigation carrying nothing puts focus back at the top of the
	// document — while the question, its two buttons and the control that opens them are all at the
	// foot of the page. `preventScrollReset` on each link is what keeps the page where it is; this
	// is the other half, and without it a reader being read to is returned to the masthead by a
	// press they made at the bottom of the page.
	//
	// the confirmation itself takes the focus rather than the button inside it: the question is what
	// has to be read before either control means anything, and the two are one Tab away. it is a
	// named group, so what a reader is moved to announces itself as the question rather than as an
	// unnamed box.
	//
	// the third navigation is not this effect's and cannot be: a stop that lands redirects onto a
	// record with no question and no control left on it, so there is nothing here to move focus to
	// and both of these are gone by the time the effect runs. what answers focus there is the
	// router's own reset to the top of the document, which is where the banner reporting the stop is
	// drawn.
	//
	// only when the state changes, so a page opened straight at `?confirm=stop` — a reload, an
	// address somebody pasted — lands where the browser puts it rather than being moved by a press
	// nobody made.
	const confirmation = useRef<HTMLDivElement>(null);
	const ask = useRef<HTMLAnchorElement>(null);
	const wasAsking = useRef(asking);
	useEffect(() => {
		if (asking === wasAsking.current) return;
		wasAsking.current = asking;
		(asking ? confirmation.current : ask.current)?.focus();
	}, [asking]);

	// what a stop that did not fully land said. one node and two places, because the two are one
	// sentence about one press: it belongs beside the button at the foot of the page, and there is
	// one state — a gift stopped from somewhere else, with the question no longer drawn — where
	// there is no button left to stand beside.
	//
	// keyed to no field, deliberately: a write that failed is not something an operator can fix by
	// editing an input, and rendering it under one tells them the input is wrong.
	//
	// rendered through `MarkedText` rather than printed, because the sentences above mark what an
	// operator has to act on with backticks — a variable to set, a subscription id to look up — and
	// that is the one thing that turns those marks into inline code. never a raw html render.
	const refusal = actionData ? (
		<Banner tone="blocker" word={actionData.stopWord}>
			<MarkedText text={actionData.stopError} />
		</Banner>
	) : null;

	// what the status word costs, said in the words this commitment's own processor is named in. a
	// commitment no processor answers for gets no sentence that would need one — see
	// `recurringStatusNote` in `$lib/recurring/statuses.ts`.
	const note = recurringStatusNote(status, processor);

	return (
		// one column and the column is what spaces it: every block below carries no margin of its
		// own, so one that is not rendered leaves no space behind it.
		<Column>
			{/* the outcome of the one write this page performs, above everything, surviving its own
			    redirect because it came back on the response that landed.

			    a banner rather than a mark on the button that carried it, which is the stated
			    carve-out in the operator surfaces' rule about where a write reports: after a stop lands the
			    status is Stopped, the confirmation is gone and there is no stop control left on this
			    page for a tick to sit on. `note` and not `done` — `done` is for a write that created
			    something, and this created nothing; it reports that something happened.

			    dropped the moment an attempt comes back rejected: a refused write performs no
			    navigation, so no loader runs and `loaderData` still holds what the last landing
			    published — "Stopped" sitting above "Not stopped" is one screen saying two things
			    about one request. */}
			{stopLanded && !actionData ? (
				<Banner tone="note" word="Stopped">
					{/* two landings, because what was happening before the button was pressed is not
					    the same fact: a gift the processor was collecting has been cancelled, or it
					    held no subscription at all and this record was the half that was out of date.
					    an operator who cancelled in that processor's own dashboard first is owed the
					    second one plainly, rather than a sentence implying this act reached the
					    processor. both end on the donor not having been told, which is the one fact
					    nothing else on this landing states.

					    a landing with no processor to name falls to the plain sentence rather than
					    naming one: the stop refuses a commitment no processor answers for before it
					    calls anything, so neither marker can be written under one — and a state that
					    cannot happen gets the sentence that is true rather than a name invented for
					    it. */}
					{stopLanded === NOTHING_TO_STOP && processor !== null ? (
						<>
							{processor} had no subscription with this id, so nothing was collecting. Nothing here
							has told {donorName}. Reply to the message you have from them.
						</>
					) : (
						<>Nothing here has told {donorName}. Reply to the message you have from them.</>
					)}
				</Banner>
			) : null}

			{/* the refusal, in the one state where the question it was answered from is no longer on
			    the page: a gift already stopped, which is what a second tab or a second press
			    produces. every other refusal is drawn at the foot with the button that carried it. */}
			{asking ? null : refusal}

			{/* the way back to the section this screen sits under, and one link rather than a trail:
			    the second half of a "Recurring gifts / Ada Okafor" trail is the heading directly
			    beneath.

			    the record is a person, and the person is who the staff member is holding an email
			    from — so the heading is their name and the status qualifies it on its own baseline.
			    the header is written out of the classes packages/operator/src/styles/adm.css already
			    draws rather than mounted from the library's `PageHeader`, which has no slot for a
			    word qualifying the title — the gap /admin/forms/[id] was reported against. nothing
			    new is drawn and no value is stated.

			    `secondary` on a stopped commitment for the reason an archived form takes it: a status
			    that has run its course. `Payment failed` keeps the full weight — it has not run its
			    course, it is the state most worth reading, and it is the one a donor is most likely
			    to be writing about. it gets no red either: colour in /admin means "act on this", and
			    this is descriptive. */}
			<header className="adm-pageheader">
				<BackLink href={href('/admin/recurring')} link={RouterLink}>
					{SECTION}
				</BackLink>
				<div className="adm-pageheader__row">
					<h1>{donorName}</h1>
					<StatusWord secondary={stopped}>{RECURRING_STATUS_LABELS[status]}</StatusWord>
				</div>
			</header>

			{/* what the status word on the heading's row costs, where the word alone does not say it —
			    `active` carries no note, so this is drawn only when there is one. the payment-failed
			    one is the sentence that stops a staff member concluding "it already failed, leave it"
			    — `revives` in $lib/server/donations/collect.ts is what makes that conclusion wrong. */}
			{note ? <p className="adm-hint">{note}</p> : null}

			{/* the record vocabulary and not an editor's: nothing about a commitment is editable — an
			    amount and an interval are fixed at creation, and to give differently a donor's
			    commitment is stopped and a new one made — so these are the answers stated flat rather
			    than the questions a box would ask.

			    no fund row, and that is a decision rather than an omission: `writeAgainstPlan` reads
			    the fund off the form at the moment each charge settles, so a fund stated here would
			    be today's answer over a series whose earlier charges posted somewhere else. the
			    donation form is the fact this row holds, and it reaches the fund in one click on the
			    screen that states it.

			    no charges either. the index is there for them (`donation_recurring_id_idx`) and they
			    are the obvious second half of this screen, but they serve reconciliation where this
			    screen serves stopping a gift. */}
			<Section>
				<dl>
					<div className="adm-setting">
						<dt className="adm-setting__label">Amount</dt>
						{/* `.adm-num` is what compares a figure down its own column. */}
						<dd className="adm-setting__value adm-num">{amount}</dd>
					</div>

					<div className="adm-setting">
						<dt className="adm-setting__label">How often</dt>
						<dd className="adm-setting__value">{FREQUENCY_LABELS[interval]}</dd>
					</div>

					<div className="adm-setting">
						<dt className="adm-setting__label">Started</dt>
						<dd className="adm-setting__value">
							<time dateTime={startedOn}>{startedOn}</time>
						</dd>
					</div>

					{/* three renderings of one value, for the reason the list gives: null means "none
					    expected", which covers a commitment that has ended and one whose rail has not
					    yet said. a gift still collecting with no date is worth noticing and takes a
					    word; one that has stopped or failed is the status word said twice and takes
					    the dash. */}
					<div className="adm-setting">
						<dt className="adm-setting__label">Next charge</dt>
						{nextChargeOn ? (
							<dd className="adm-setting__value">
								<time dateTime={nextChargeOn}>{nextChargeOn}</time>
							</dd>
						) : status === 'active' ? (
							<dd className="adm-setting__value">
								<StatusWord>Not scheduled yet</StatusWord>
							</dd>
						) : (
							<dd className="adm-setting__value">None</dd>
						)}
					</div>

					{/* the label changes with the status and the date does not, which is the whole of
					    the decision behind it: `ended_at` means when collection really ended, and on a
					    gift the rail gave up on that is the day the payments stopped going through
					    rather than the day somebody pressed a button. so on that gift the row says
					    `Stopped collecting` — the rail gave up, nobody stopped it. */}
					{endedOn ? (
						<div className="adm-setting">
							<dt className="adm-setting__label">
								{status === 'lapsed' ? 'Stopped collecting' : 'Stopped'}
							</dt>
							<dd className="adm-setting__value">
								<time dateTime={endedOn}>{endedOn}</time>
							</dd>
						</div>
					) : null}

					<div className="adm-setting">
						<dt className="adm-setting__label">Donation form</dt>
						<dd className="adm-setting__value">
							<Link to={href('/admin/forms/:id', { id: formId })}>{formName}</Link>
						</dd>
					</div>

					<div className="adm-setting">
						<dt className="adm-setting__label">Email</dt>
						<dd className="adm-setting__value">{donorEmail ?? 'None'}</dd>
					</div>

					{/* the one deliberate processor reference among these rows, and it earns its place:
					    it names the object in that processor's own dashboard that a staff member goes
					    and looks at when a stop half-lands, which is exactly where the `Partly done`
					    sentence sends them.

					    the processor's name in front of the same word, because both of them call it a
					    subscription — what changes between a Stripe commitment and a PayPal one is
					    whose account the id is in, which is the whole of what this row is for.

					    and drawn only where there is a processor to name: an id in no account an
					    operator can open sends them nowhere, so on a commitment no processor answers
					    for the row is not written rather than headed by a word that points at
					    nothing. */}
					{processor === null ? null : (
						<div className="adm-setting">
							<dt className="adm-setting__label">{processor} subscription</dt>
							<dd className="adm-setting__value">
								<CodeChip>{subscriptionId}</CodeChip>
							</dd>
						</div>
					)}
				</dl>
			</Section>

			{stopped ? null : (
				<Section>
					{/* outside the confirmation and above the control, so a staff member who did not
					    come here to stop anything learns what the control costs without pressing it.
					    what it leaves the donor owed is in the confirmation, where somebody is about
					    to press it.

					    the control below names it through `aria-describedby`, so a reader who arrives
					    at the link by tabbing is told what it costs rather than only somebody reading
					    down the page. */}
					<p className="adm-hint" id="stop-cost">
						Stopping is permanent and this deployment cannot start it again.
					</p>

					{asking ? (
						// the second step. a link got here and a POST leaves.
						//
						// it stays in the page rather than taking the top layer, and the dashboard's own
						// test is what decides that: /admin spends the top layer only where an act
						// reachable from the surface destroys something that already exists. every gift
						// this commitment collected is still in the books, the record is still readable,
						// and what changed is that no new charge can be made under it — so the question
						// stays where the record it is about is. permanence is not the test and could
						// not be: the console's credential replacement is modal because it destroys
						// something Stripe cannot re-issue.
						//
						// there is therefore no dialog, no scrim, no focus trap and no `onCancel`.
						// Escape does nothing here because there is nothing modal to dismiss;
						// cancelling is a link back without the parameter.
						//
						// the `<form>` stands around the whole confirmation rather than around the
						// control that submits it, which is the rule `DestructiveConfirm` states: its
						// actions row holds controls, and a submit belongs to the form enclosing it.
						//
						// the block is a named group rather than a fieldset: a fieldset is named by a
						// legend, so the question would be on the screen a second time directly under the
						// banner already asking it, and a fieldset groups form controls where the way out
						// of this one is a link. the name is stated rather than read off the banner's
						// word, because a word is a node and the string a voice user says has to be one
						// this screen wrote — it is `question`, so what is said and what is on the screen
						// are one expression (WCAG 2.5.3).
						<Form method="post">
							<DestructiveConfirm
								ref={confirmation}
								role="group"
								aria-label={question}
								tabIndex={-1}
								tone="attention"
								word={question}
								report={refusal}
								confirm="Yes, stop this gift"
								/* no confirmation on this button and it must not gain one: it cannot
								   survive its own success. the write redirects, the status becomes Stopped
								   and this whole block is gone, so a tick here would be one nobody ever
								   sees. */
								confirmProps={{ disabled: stopping, 'aria-busy': stopping || undefined }}
								cancel="Cancel"
								/* `preventScrollReset` because this lands on the address it was pressed
								   from and the whole of this block is at the foot of the page; where focus
								   goes is answered in the effect above. */
								cancelProps={{ as: Link, to: screen(id), preventScrollReset: true }}
							>
								{/* what pressing it does, then what it does not do. the first clause is the
								    only half that names a processor and it is `stopConsequence` above,
								    so the two states and the commitment with no processor behind it are
								    decided in one place; the rest is one sentence for all of them,
								    because what is not returned and who is not told is this product's
								    own behaviour rather than any processor's. */}
								{stopConsequence(status, processor)} Nothing already collected is returned, and
								nothing here tells {donorName}. Reply to them yourself.
							</DestructiveConfirm>
						</Form>
					) : (
						// a link dressed as a button, because it writes nothing: it asks. not
						// danger-toned either — the critical tone belongs to the control that acts,
						// which is the one inside the confirmation.
						//
						// `preventScrollReset` for the reason the Cancel beside the answer carries it:
						// the question opens at this same address, at the foot of the page the press was
						// made at. it names the sentence above it, which is what the press costs.
						<div className="adm-actions">
							<Link
								aria-describedby="stop-cost"
								className="adm-btn"
								preventScrollReset
								ref={ask}
								to={`${screen(id)}?confirm=stop`}
							>
								Stop this gift
							</Link>
						</div>
					)}
				</Section>
			)}
		</Column>
	);
}
