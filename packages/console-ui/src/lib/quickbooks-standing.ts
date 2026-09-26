import type {
	ChosenAccountLine,
	LedgerAccountLine,
	QuickbooksCompany,
	QuickbooksPress,
	QuickbooksPressReport,
	QuickbooksReport,
	QuickbooksStartAtSide
} from '@better-giving/operator/console/quickbooks';
import {
	QUICKBOOKS_ACCOUNT_ROLES,
	QUICKBOOKS_RECOURSES
} from '@better-giving/operator/console/quickbooks';
import type { SavedFormState } from '@better-giving/operator/saved-form-state.react';
import { z } from 'zod';
import type {
	HoldingPick,
	NoReport,
	PaymentProcessor,
	QuickbooksRead,
	VarsWritten
} from '../api/types';
import { CHARGE_PAIRS, PROCESSORS } from './processor-links';
import { readableRefusal } from './unread-answer';
import type { SecretEdits } from './secret-edits';
import { VALUE_FIELD } from './secret-groups';
import type { StatedForm } from './use-console-form';

// every decision the QuickBooks section makes about a value, out of the drawing so that a case can
// be written against it — ./chariot-setup.ts beside ./chariot-section.tsx is the arrangement, and
// the reason is this package's pool: ../../vite.config.ts pins `node` and there is no dom, so a
// rule left inside the component is one no spec can reach.
//
// **which control an answer belongs to is one of those decisions.** one section draws several
// presses and one answer comes back for whichever was made, so the readings of an answer here are
// what put an outcome at the control that caused it — and a mismatch there reports a save at the
// button that disconnected.
//
// **the picks are one act.** the deployment stores them together and refuses a save without income
// and fees (packages/operator/src/console/quickbooks.ts), so what arms the save is those two chosen
// and at least one pick different — never a box at a time. a holding may stay unchosen.
//
// **no sentence here quotes the deployment.** its own detail names status codes and exception
// names an operator does nothing with, so every trouble is one plain sentence at the step it
// blocks: a press answered by nothing reads {@link UNANSWERED}, one the deployment refused reads
// {@link REFUSED}, and one it failed at reads {@link FAILED} ({@link unansweredSays}). the one
// answer quoted is a revoke Intuit did not confirm ({@link revokeStands}): its trace is at Intuit,
// where nothing on this screen can show it, and the deployment's fix is the only word on where.
//
// **how long the oldest has waited is said in the coarsest unit that is still true.** an operator
// reading it is deciding whether the books are behind, and a figure to the minute over four days
// is a precision that answers a question nobody asked.

/**
 * the three boxes the credentials press carries, keyed by what each of them posts.
 *
 * **every one is optional, because an empty box is not a box left blank.** over a stored value it
 * is that value asked to be removed, and over nothing at all it is a name this deployment goes on
 * holding nothing under (`secretEdits` in ./secret-edits.ts) — so a rule marking an empty box as
 * wanted would be a value with no way off the deployment.
 *
 * **and there is no rule beyond the shape, because nothing about these three is decidable here.**
 * what a client id may be is Intuit's, and what this deployment will store is the deployment's:
 * a whitespace-only box is the one refusal either end makes, and it is made at the press with the
 * words the deployment uses for it. what the schema is for is the seam — it states which boxes the
 * form counts as its own, which is what the save is armed over (./use-console-form.ts).
 */
const quickbooksBoxes = z.object({
	[VALUE_FIELD('QUICKBOOKS_CLIENT_ID')]: z.string().optional(),
	[VALUE_FIELD('QUICKBOOKS_CLIENT_SECRET')]: z.string().optional(),
	[VALUE_FIELD('QUICKBOOKS_API_URL')]: z.string().optional()
});

/** the boxes as the seam takes them, with the id every box id on the section is composed off. */
export const QUICKBOOKS_FORM: StatedForm<typeof quickbooksBoxes> = {
	id: 'quickbooks',
	schema: quickbooksBoxes
};

/**
 * the deployment's own refusal carried onto the boxes this section draws, or `null` where it named
 * none of them.
 *
 * **the two ends name a box differently and this is the one place that is reconciled.** the binary
 * answers by the value's own name — `QUICKBOOKS_API_URL`, what it is called on the deployment
 * (`secretEdits` in ./secret-edits.ts) — and the seam finds a box by what that box posts, which is
 * `VALUE_FIELD`'s name. a key that is neither is a sentence drawn under nothing, with focus moved
 * to nothing, and the next press held back over a box the operator has already put right.
 *
 * a name no box is drawn for is dropped rather than carried, for the same reason.
 */
export const quickbooksRefused = (
	said: Record<string, string> | null,
	names: readonly string[]
): Record<string, string> | null => {
	if (said === null) return null;
	const named = names.filter((name) => said[name] !== undefined);
	if (named.length === 0) return null;
	return Object.fromEntries(named.map((name) => [VALUE_FIELD(name), said[name] as string]));
};

/** what the press answers with where it stored nothing because there was nothing to store. */
const NOTHING_TO_STORE = 'Your deployment was already holding these, so nothing was stored.';

/** what one press of the three boxes did, as the form under them reads its own answer. */
export type CredentialsStanding = {
	/** the write left something on the deployment, which is what the button confirms. */
	readonly landed: boolean;
	/** the boxes have nothing left to say: stored now, or already what the deployment holds. */
	readonly settled: boolean;
	/** the one sentence a press that stored nothing is answered by, or `null`. */
	readonly says: string | null;
};

/**
 * how the last press of the three boxes went, or nothing where none has been made.
 *
 * **three of the arms are one fact to whoever pressed.** `unchanged` is the deployment already
 * holding what the boxes asked for and `nothing` is no box differing from it in the first place
 * (`secretEdits` in ./secret-edits.ts), so both leave a deployment configured exactly as the boxes
 * read — and both leave the boxes to be put back, or the same press stays armed to do the same
 * nothing (`useSavedFormState` in packages/operator/src/saved-form-state.react.ts).
 *
 * **neither of those two is a save, so neither draws the button's confirmation.** what they are is
 * a press answered by nothing moving, which is a press an operator makes again — so they carry a
 * sentence of their own, at the control, and the word for the write is kept for the write
 * ({@link retriedStands} is the same rule over the retry press).
 *
 * the two arms this says nothing about are drawn elsewhere and are the whole of what is left: a
 * refusal goes under the press (`refusalIn` in ./secret-trouble.tsx), and a name the deployment
 * holds in a form nothing can read back goes at the block that frees it (./withheld-values.tsx).
 */
export function credentialsStands(written: VarsWritten | null): CredentialsStanding {
	if (written === null) return { landed: false, settled: false, says: null };
	const nothingToStore = written.kind === 'unchanged' || written.kind === 'nothing';
	return {
		landed: written.kind === 'set',
		settled: written.kind === 'set' || nothingToStore,
		says: nothingToStore ? NOTHING_TO_STORE : null
	};
}

/**
 * where the press of the three boxes stands, and whether they are closed with it.
 *
 * **a press is two router phases and the answer lands between them** (./stripe-press.ts), so the
 * posted intent alone is true for the whole of the re-read that press sets off — and that re-read
 * is every reading of the deployment, which takes seconds. what the phase adds is which half.
 *
 * **the one thing that does not close them is a press that settled nothing being re-read.** it
 * began nothing on the deployment and what has to change is a box, so those seconds are seconds an
 * operator spends in front of a sentence about a box they cannot type in — and it is the whole of
 * why the answer can place focus at all, because a disabled box takes none and the move runs on the
 * render the answer arrives in (`useConsoleForm` in ./use-console-form.ts).
 *
 * **a press that settled holds them closed until the boxes have been put back.** the put-back is a
 * reset onto the reading that write left behind (./reseed.ts), so a box open in between is one
 * whose contents are taken away under the hand typing them.
 *
 * `busy` is the page's one flag for "something on this screen is writing" and is true of this
 * form's own press as well, so what is taken from it is the rest of the page.
 */
export function credentialsPhase(press: {
	/** this form's own press is the one in flight, both phases of it. */
	readonly own: boolean;
	/** the router has the answer and is reading the page again over it. */
	readonly revalidating: boolean;
	/** a press anywhere on the page is in flight. */
	readonly busy: boolean;
	/** the answer standing leaves the boxes with nothing left to say ({@link credentialsStands}). */
	readonly settled: boolean;
	/** the reading after that press is on the screen, and the boxes have been put back. */
	readonly spent: boolean;
}): { readonly underway: boolean; readonly closed: boolean } {
	const inFlight = press.own && !press.revalidating;
	const underway = inFlight || (press.settled && !press.spent);
	return { underway, closed: underway || (press.busy && !press.own) };
}

/**
 * how the last press on the connection was answered.
 *
 * the two kinds a repeating-gifts press answers in (`RecurringSetup` in ../api/types.ts):
 * `reported` is the deployment saying what the press did, and `unanswered` is nothing coming back
 * that says. the press is named on both arms, because an outcome reports at the control that
 * caused it and one section draws six of them.
 */
export type QuickbooksAnswer =
	| { kind: 'reported'; report: QuickbooksPressReport }
	| { kind: 'unanswered'; press: QuickbooksPress; read: NoReport };

/**
 * how the start-date preview was answered: the preview's own arm of {@link QuickbooksAnswer}.
 *
 * it is posted apart from every other press, on a fetcher, so its answer arrives beside `answer`
 * rather than in its place and a move's answer never overwrites it.
 */
export type QuickbooksStartAtPreview =
	| {
			kind: 'reported';
			report: Extract<QuickbooksPressReport, { press: 'start-date-preview' }>;
	  }
	| { kind: 'unanswered'; press: 'start-date-preview'; read: NoReport };

/** whether the last answer is this press's, landed. */
export const landedPress = (answer: QuickbooksAnswer | null, press: QuickbooksPress): boolean =>
	answer?.kind === 'reported' && answer.report.press === press;

/** the address the connect press answered with, or `null` where the last answer is another press's. */
export const connectAddress = (answer: QuickbooksAnswer | null): string | null =>
	answer?.kind === 'reported' && answer.report.press === 'connect' ? answer.report.url : null;

/**
 * the address a connect press drawn now may offer: only one answered since it was pressed, which
 * is an answer other than the one standing at the press (`over`), and never one standing before it
 * was pressed at all (`asked` null).
 *
 * **an address is spent once Intuit has sent a browser back with it**, and the answer that carried
 * it outlives the press: the same answer stands when the press is drawn again over a connection
 * gone stale, so a link drawn off it is a trip Intuit turns away.
 */
export const pressedAddress = (
	answer: QuickbooksAnswer | null,
	asked: Asked | null
): string | null => connectAddress(answeredSince(answer, asked));

/**
 * the Intuit link a connect press shows next, from the one it `held` last.
 *
 * **it outlives the answer that brought it.** the operator finishes the trip in another tab and
 * the page is read again when they come back, and a re-read that is no press's answer carries none
 * (`useRevalidator` in react-router) — so a link read off the answer alone would be gone before the
 * trip it is for is over. it goes once the reading shows a company connected, which is that trip
 * done, and once another press on the page is made, which is the operator doing something else; a
 * new connect press's address (`fresh`, {@link pressedAddress}) replaces it.
 */
export function connectLink(
	held: string | null,
	facts: {
		readonly fresh: string | null;
		/** the reading shows a company connected that this press no longer has to connect. */
		readonly connected: boolean;
		/** a press on the page other than this one is in flight. */
		readonly otherPress: boolean;
	}
): string | null {
	if (facts.connected || facts.otherPress) return null;
	return facts.fresh ?? held;
}

/** a press made from a control, and the answer standing when it was. */
export type Asked = { readonly over: QuickbooksAnswer | null };

/**
 * the answer standing, where it arrived after the control's own press, or `null`. a control drawn
 * over an answer it never pressed for (`asked` null) has had none.
 */
export const answeredSince = (
	answer: QuickbooksAnswer | null,
	asked: Asked | null
): QuickbooksAnswer | null => (asked === null || answer === asked.over ? null : answer);

/**
 * how many gifts the retry press queued again, or `null` for the same reason.
 *
 * none queued is a count and not a silence: a sweep that drained the queue between the read and
 * the press answers zero, and that is the press's own outcome to report.
 */
export const retriedGifts = (answer: QuickbooksAnswer | null): number | null =>
	answer?.kind === 'reported' && answer.report.press === 'retry' ? answer.report.retried : null;

/** the deployment answering nothing to one press, drawn at that press and at no other. */
export const unanswered = (
	answer: QuickbooksAnswer | null,
	press: QuickbooksPress
): NoReport | null =>
	answer?.kind === 'unanswered' && answer.press === press ? answer.read : null;

/** the accounts a gift is posted into, in the order the section draws them: the wire's roles. */
export const PICKS = QUICKBOOKS_ACCOUNT_ROLES;

export type AccountPick = (typeof PICKS)[number];

/** what a gift is recorded as: the two every gift needs, and the first group the section draws. */
export const GIFT_PICKS = ['income', 'fee'] as const satisfies readonly AccountPick[];

const REQUIRED_PICKS: readonly AccountPick[] = GIFT_PICKS;

/**
 * where money waits before it reaches the bank, one account per processor and one for the gifts
 * recorded by hand: the second group. each may stay unchosen.
 */
export const HOLDING_PICKS = [
	'stripeBalance',
	'paypalBalance',
	'chariotBalance',
	'nowpaymentsBalance',
	'undepositedFunds'
] as const satisfies readonly HoldingPick[];

/** the holding each processor's gifts wait in until it pays out. */
const HOLDING_OF: Readonly<Record<PaymentProcessor, HoldingPick>> = {
	stripe: 'stripeBalance',
	paypal: 'paypalBalance',
	chariot: 'chariotBalance',
	nowpayments: 'nowpaymentsBalance'
};

const isHolding = (pick: AccountPick): pick is HoldingPick =>
	(HOLDING_PICKS as readonly AccountPick[]).includes(pick);

/**
 * the holdings the section draws a picker for: each processor this deployment takes gifts through,
 * the one for gifts recorded by hand always, and any holding the connection already stores.
 *
 * **which processors those are is read off the held values**, the deployment's own reading
 * (`CHARGE_PAIRS` in ./processor-links.ts): the QuickBooks report says nothing about processors,
 * and the connect fills a holding for exactly these (`fillAccountsFromChart` in
 * packages/app/src/lib/server/accounting/connection.ts). a picker for a processor nobody set up is
 * a choice about gifts that never arrive.
 *
 * **a stored holding is drawn whatever the processor**, because the screen says where the books
 * post today — keys removed since the pick leave it stored, and the picker is how it comes off. one
 * not drawn is still posted as stored, since every role rides every save.
 */
export function holdingsDrawn(
	company: QuickbooksCompany,
	held: ReadonlySet<string>
): HoldingPick[] {
	const taken = new Set(
		(Object.keys(HOLDING_OF) as PaymentProcessor[])
			.filter((processor) => CHARGE_PAIRS[processor].every((name) => held.has(name)))
			.map((processor) => HOLDING_OF[processor])
	);
	return HOLDING_PICKS.filter(
		(pick) => pick === 'undepositedFunds' || taken.has(pick) || company[pick] !== null
	);
}

/** what each picker is called: the legend over its group says what the group is for. */
export const PICK_LABEL: Readonly<Record<AccountPick, string>> = {
	income: 'Income',
	fee: 'Processing fees',
	stripeBalance: `${PROCESSORS.stripe.name} balance`,
	paypalBalance: `${PROCESSORS.paypal.name} balance`,
	chariotBalance: `${PROCESSORS.chariot.name} balance`,
	nowpaymentsBalance: `${PROCESSORS.nowpayments.name} balance`,
	undepositedFunds: 'Gifts recorded by hand'
};

/** the legend over each of the two groups. */
export const PICK_GROUP_LEGEND = {
	gift: 'What a gift is recorded as',
	holding: 'Where money waits before it reaches your bank'
} as const;

/**
 * the line over each holding's picker: what the bookkeeper does when the money moves on.
 *
 * the deployment hears no payout (`QUICKBOOKS_ACCOUNT_ROLES` in
 * packages/operator/src/console/quickbooks.ts), so the money leaving a holding is recorded off the
 * bank feed and never by this deployment — and a holding left unrecorded reads as money the
 * processor still owes.
 */
export const HOLDING_HINT: Readonly<Record<HoldingPick, string>> = {
	stripeBalance: payoutHint(PROCESSORS.stripe.name),
	paypalBalance: payoutHint(PROCESSORS.paypal.name),
	chariotBalance: payoutHint(PROCESSORS.chariot.name),
	nowpaymentsBalance: payoutHint(PROCESSORS.nowpayments.name),
	undepositedFunds: 'Record each deposit from your bank feed as a transfer out of this account.'
};

function payoutHint(processor: string): string {
	return `Record each ${processor} payout from your bank feed as a transfer out of this account.`;
}

/** the picks as the boxes hold them: an account id each, and `''` where one is unchosen. */
export type QuickbooksPicks = Readonly<Record<AccountPick, string>>;

/** what one press posts as its intent, which is what an outcome is reported against. */
export const quickbooksIntent = (press: QuickbooksPress): string => `quickbooks:${press}`;

/** one line of a picker: the id the press sends, and the name an operator reads. */
export type AccountOption = { readonly value: string; readonly label: string };

/** what one picker offers, and the pick the company's chart no longer holds. */
export type AccountPicker = {
	readonly options: readonly AccountOption[];
	/**
	 * the account the picker is showing that its list does not offer — deactivated in the company's
	 * books since it was picked, or stored before the list was held to what fits the picker. it
	 * stays in the list until another is chosen, so a screen never silently moves where gifts are
	 * posted.
	 */
	readonly retired: AccountOption | undefined;
};

/** the empty line income or fees offers while it is showing nothing. */
export const CHOOSE = 'Choose an account';

/** the empty line every holding offers, stored or not: the gifts it would hold wait unsent. */
export const NONE = 'None';

/**
 * one picker over the company's own chart, for a picker showing `showing`.
 *
 * **it offers only the accounts that fit it.** the deployment says which of the roles each account
 * may be picked for (`roles` on `LedgerAccountLine` in packages/operator/src/console/quickbooks.ts)
 * and refuses a save naming one outside its role, so an account offered where it does not fit is a
 * pick the press is certain to be refused over. a stored pick that does not fit is kept the way a
 * deactivated one is — shown, and retired — so the screen says what the books post to today until
 * the operator replaces it.
 *
 * the type rides the name because a chart holds several accounts called Donations and an operator
 * tells them apart by it. it is Intuit's own word, carried rather than translated
 * (packages/operator/src/console/quickbooks.ts).
 *
 * **the list always holds what the picker is showing**, whether that is a line of the chart, an
 * account its list does not offer ({@link AccountPicker.retired}), or nothing at all. a list
 * with no line matching the selection does not draw an empty box: the picker falls to the first
 * line in it, which is displayed and posted as an account nobody chose. the selection is the
 * operator's and the stored account is the deployment's, so neither reading answers for the other —
 * an account picked off one read of the chart and deactivated at Intuit before the next is showing
 * and in neither.
 *
 * that account has no name anywhere on this screen, so the line carries the id the press would
 * send. a stored one does have a name and is drawn under it.
 *
 * **the empty line is what "nothing chosen" is, so income and fees offer it while the company
 * stores nothing.** a list that lost it on the first pick leaves a mis-pick on a fresh connection
 * with no way back to it, and the two are required together (`picksToSave` below) — so there is
 * nothing to go back to once the connection holds one.
 *
 * **a holding offers it always, as {@link NONE}**, because none is a choice a holding may be saved
 * with: it holds that one processor's gifts and nothing else, so a processor this organisation has
 * stopped using is set back to none rather than left pointing at an account.
 */
export function accountPicker(
	chart: readonly LedgerAccountLine[],
	role: AccountPick,
	pick: ChosenAccountLine | null,
	showing: string
): AccountPicker {
	const options = chart
		.filter((account) => account.roles.includes(role))
		.map((account) => ({ value: account.id, label: `${account.name} — ${account.type}` }));
	const offered = showing === '' || options.some((option) => option.value === showing);
	const empty = isHolding(role)
		? [{ value: '', label: NONE }]
		: pick === null || showing === ''
			? [{ value: '', label: CHOOSE }]
			: [];
	return {
		options: [...empty, ...options],
		retired: offered ? undefined : { value: showing, label: retiredLabel(chart, pick, showing) }
	};
}

/**
 * what a line the picker does not offer is called: `name — type` off the chart where it still
 * holds the account, since the type is why it does not fit; the stored name where the chart has
 * dropped it; the id the press would send where neither knows it.
 */
function retiredLabel(
	chart: readonly LedgerAccountLine[],
	pick: ChosenAccountLine | null,
	showing: string
): string {
	const held = chart.find((account) => account.id === showing);
	if (held !== undefined) return `${held.name} — ${held.type}`;
	return pick !== null && pick.id === showing ? pick.name : showing;
}

/** the accounts this connection posts to, as the boxes are drawn with them. */
export const picksHeld = (company: QuickbooksCompany): QuickbooksPicks =>
	Object.fromEntries(PICKS.map((pick) => [pick, company[pick]?.id ?? ''])) as Record<
		AccountPick,
		string
	>;

/**
 * whether the picks in the boxes are a press: income and fees chosen, every pick showing an account
 * its picker offers or a holding left unchosen, and not what is already stored.
 *
 * a connection awaiting its accounts is a press over picks identical to the stored ones: the save
 * is what releases it (`awaitingAccounts` in packages/operator/src/console/quickbooks.ts).
 *
 * it is all three halves rather than the last alone because the picks are stored together — income
 * or fees empty is a press the deployment refuses, and so is one still showing a retired pick
 * ({@link accountPicker}): an account that does not fit its place, or that the chart no longer
 * holds. arming either would spend a round trip to be told so.
 */
export function picksToSave(
	held: QuickbooksPicks,
	company: QuickbooksCompany,
	chart: readonly LedgerAccountLine[]
): boolean {
	const offered = (pick: AccountPick): boolean =>
		(held[pick] === '' && !REQUIRED_PICKS.includes(pick)) ||
		chart.some((account) => account.id === held[pick] && account.roles.includes(pick));
	if (!PICKS.every(offered)) return false;
	if (company.awaitingAccounts) return true;
	const stored = picksHeld(company);
	return PICKS.some((pick) => held[pick] !== stored[pick]);
}

/** what a picker left unchosen at the press says. */
export const PICK_BLANK = 'required';

/** the pickers that must show something and show nothing, in the order they are drawn. */
export const picksMissing = (held: QuickbooksPicks): AccountPick[] =>
	REQUIRED_PICKS.filter((pick) => held[pick] === '');

/**
 * whether the pickers' save can be pressed: a press ({@link picksToSave}), or one left unchosen —
 * pressing then marks it (`PICK_BLANK`) rather than leaving an operator in front of a closed
 * button with no word on why. a connect fills what it can off the chart and can leave income or
 * fees empty, so a save closed over that is a step with no way on.
 */
export const picksArmed = (
	held: QuickbooksPicks,
	company: QuickbooksCompany,
	chart: readonly LedgerAccountLine[]
): boolean => picksMissing(held).length > 0 || picksToSave(held, company, chart);

/** the day a box is drawn holding, out of the instant the connection stores. */
export function startDay(startAt: string): string {
	const at = Date.parse(startAt);
	if (Number.isNaN(at)) return '';
	return new Date(at).toISOString().slice(0, 10);
}

/** whether the day in the box is a press: a day at all, and not the one already stored. */
export const startToSave = (day: string, company: QuickbooksCompany): boolean =>
	day !== '' && day !== startDay(company.startAt);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * how long the oldest gift still owed has been waiting, and `null` where there is none or where
 * the instant is not one. a figure and its unit are joined by a no-break space, so "3 hours" never
 * splits across two lines.
 *
 * a deployment's clock and this machine's are two clocks, so a gift queued a moment ago can read
 * as queued in the future here. that is the same answer as a gift queued a minute ago and is said
 * the same way.
 */
export function waitedSays(since: string | null, now: Date): string | null {
	if (since === null) return null;
	const at = Date.parse(since);
	if (Number.isNaN(at)) return null;
	const waited = now.getTime() - at;
	if (waited < HOUR) return 'under an hour';
	if (waited < 2 * DAY) {
		const hours = Math.floor(waited / HOUR);
		return hours === 1 ? 'an hour' : `${hours}\u00a0hours`;
	}
	return `${Math.floor(waited / DAY)}\u00a0days`;
}

/** what the backlog has to say, or `null` where it has nothing: no gift was given up on. */
export type BacklogStanding = {
	readonly failed: number;
	readonly waited: string | null;
	/** the refunds waiting behind those gifts, or `null` where none is. */
	readonly held: HeldStanding | null;
};

/** how many refunds wait behind a gift given up on, and how many gifts they wait on between them. */
export type HeldStanding = { readonly refunds: number; readonly gifts: number };

/**
 * the backlog where it is worth a word, and `null` where it is not.
 *
 * working is the silent default, so a deployment whose gifts are going over says nothing at all —
 * and a gift merely waiting on a backoff is on its way. what speaks is a gift that was given up
 * on, which is also the whole of what the retry press acts on.
 *
 * the refunds held behind such a gift speak with it and never alone: each waits on a gift the
 * same read counts in `failed` (`readQuickbooksBacklog` in
 * packages/app/src/lib/server/accounting/backlog.ts reads both in one batch), so a held refund is
 * never without a gift given up on to stand behind.
 *
 * **a deployment with no company connected says nothing either, whatever the rows hold.** the
 * backlog is read without a credential, so a deployment that has just disconnected still counts
 * every gift it gave up on — and the press under those words queues them for a company that is
 * gone, which the deployment refuses (`notConnected` in
 * packages/app/src/routes/console.quickbooks.ts). the whole read is taken rather than the backlog
 * alone so that this is one rule in one place, reachable by a case.
 */
export function backlogStands(report: QuickbooksReport, now: Date): BacklogStanding | null {
	if (report.connection.state !== 'connected') return null;
	const { failed, oldestWaitingAt, heldBehindFailed } = report.backlog;
	if (failed < 1) return null;
	const held =
		heldBehindFailed.length === 0
			? null
			: {
					refunds: heldBehindFailed.length,
					gifts: new Set(heldBehindFailed.map((line) => line.waitsOn)).size
				};
	return { failed, waited: waitedSays(oldestWaitingAt, now), held };
}

/**
 * what the backlog says, in a fundraiser's words: two figures, each said as what it is.
 *
 * they are two sentences because they are two measurements. the count is the gifts that were given
 * up on; the wait spans every gift still owed, healthy ones included
 * (`oldestWaitingAt` in packages/operator/src/console/quickbooks.ts), so one sentence over both
 * would report a gift queued behind a backfill as a failure four days old.
 */
export function backlogSays({ failed, waited }: BacklogStanding): string {
	const gifts = failed === 1 ? '1 gift didn’t sync' : `${failed} gifts didn’t sync`;
	return waited === null ? `${gifts}.` : `${gifts}. QuickBooks is ${waited} behind.`;
}

/**
 * the refunds waiting behind a gift given up on, in a fundraiser's words.
 *
 * the second sentence is the one the operator acts on. a held refund is tried only once its gift is
 * sent, so a gift recorded in QuickBooks by hand rather than tried again sends none of its refunds,
 * and each is theirs to record there too (`heldBehindFailed` in
 * packages/operator/src/console/quickbooks.ts).
 */
export function heldSays({ refunds, gifts }: HeldStanding): string {
	const waiting = refunds === 1 ? '1 refund is waiting' : `${refunds} refunds are waiting`;
	const on = gifts === 1 ? 'a gift' : 'gifts';
	const which = gifts === 1 ? 'that gift' : 'one of those gifts';
	const its = refunds === 1 ? 'its refund' : 'its refunds';
	return `${waiting} on ${on} that didn’t sync. If you record ${which} in QuickBooks by hand, record ${its} there by hand too.`;
}

/** what the press that queues them again reports, at itself. */
export type RetriedStanding = {
	/** the button's own confirmation, or `null` where nothing moved and there is none. */
	readonly doneLabel: string | null;
	/** the sentence beside the button where nothing moved, or `null`. */
	readonly says: string | null;
};

/**
 * what the press that queues them again says it did.
 *
 * **a tick is for a press that moved something.** none left to send is a real answer — a sweep
 * drained the queue between the read and the press, or this is the second press — and a tick over
 * it would confirm a write that did not happen, so it is a sentence at the button instead
 * ({@link credentialsStands} is the same rule over the boxes).
 */
export const retriedStands = (retried: number): RetriedStanding =>
	retried === 0
		? { doneLabel: null, says: 'Nothing was left to send.' }
		: { doneLabel: `${retried} retrying`, says: null };

/** the retry press as its one button draws it, or not at all. */
export type RetryButton = {
	readonly shown: boolean;
	readonly state: 'idle' | 'pending' | 'done';
};

/**
 * the retry press through a press: one button from rest to its report, so the element the keyboard
 * is on is the one that says what it queued. it stands while there is anything to retry, while its
 * own press is going, and while its report is showing — the backlog has gone by then, and the
 * button going with it would take the report and the reader's place together.
 */
export function retryButton(facts: {
	/** gifts were given up on and are there to retry ({@link backlogStands}). */
	readonly backlog: boolean;
	readonly pending: boolean;
	/** the press's report is inside its four seconds (packages/operator/src/save-state.ts). */
	readonly done: boolean;
	/** the report's own words, or `null` where nothing moved ({@link retriedStands}). */
	readonly doneLabel: string | null;
}): RetryButton {
	const reporting = facts.done && facts.doneLabel !== null;
	return {
		shown: facts.backlog || facts.pending || reporting,
		state: facts.pending ? 'pending' : reporting ? 'done' : 'idle'
	};
}

/** the one sentence every press answered by nothing reads, wherever it was made. */
export const UNANSWERED = 'This deployment didn’t answer.';

/** the sentence a press the deployment refused reads — a coded 4xx is an answer, and a no. */
export const REFUSED = 'This deployment turned that down.';

/** the sentence a press the deployment failed at reads — a coded answer outside 4xx. */
export const FAILED = 'This deployment couldn’t do that.';

/**
 * which of the three a press that did not land reads (`readableRefusal` in ./unread-answer.ts).
 * a code is the deployment answering, so only an answer carrying none reads as no answer.
 */
export function unansweredSays(read: NoReport): string {
	if (readableRefusal(read) !== null) return REFUSED;
	return read.kind === 'unreadable' && read.error !== null ? FAILED : UNANSWERED;
}

/** where an unreadable chart is said, and what is said there. */
export type ChartStanding = {
	/**
	 * the step it blocks. a lapsed credential is Connect's — connecting again is what mends it —
	 * and anything else leaves the connection standing and the accounts unpickable.
	 */
	readonly step: 'connect' | 'accounts';
	readonly says: string;
};

/**
 * what a chart that could not be read says, and where, or `null` where it was read or nothing is
 * connected.
 *
 * **the name is checked against the set rather than trusted to be in it.** it arrives off the wire
 * with no parse in front of it (`ask` in ../api/client.ts) and the binary forwards the
 * deployment's body unread, so a deployment a release ahead of this console names a recourse this
 * has no entry for — and the type says otherwise. that one, and none at all, read as the plain
 * fact, at the step the accounts would be picked in.
 */
export function chartStands(accounts: QuickbooksReport['accounts']): ChartStanding | null {
	if (accounts === null || accounts.state === 'read') return null;
	const known = QUICKBOOKS_RECOURSES.find((name) => name === accounts.recourse);
	if (known === 'reconnect')
		return { step: 'connect', says: 'QuickBooks turned this connection down.' };
	if (known === 'wait')
		return {
			step: 'accounts',
			says: 'QuickBooks can’t be reached right now. This deployment keeps trying.'
		};
	return { step: 'accounts', says: 'This deployment couldn’t read your chart of accounts.' };
}

/**
 * what the Accounts step says over a connection that moved to another company, or `null` where it
 * did not. the name stands mid-sentence, where a name that ends in a stop still reads whole.
 */
export const awaitingSays = (company: QuickbooksCompany): string | null =>
	company.awaitingAccounts
		? `This connection moved to ${companyCalled(company)}, and nothing is sent to QuickBooks until its accounts are saved.`
		: null;

/** the code the deployment refuses an account whose type does not fit its place under. */
const WRONG_TYPE = 'account_wrong_type';

/** the first name a refusal marks as code, which is the value it refuses. */
const MARKED_NAME = /`([A-Za-z]+)`/;

/**
 * the drawn picker an accounts press was refused over, or `null` where the refusal is not that one
 * or names no picker on the screen — which is then said at the press, as every other refusal is.
 *
 * **the code says which refusal it is and the refusal's first marked name says which picker.** the
 * deployment writes a 4xx body for an agent to act on and names the offending value in it
 * (CLAUDE.md → Boundaries), as a role in backticks leading its sentence
 * (`misfit` in packages/app/src/routes/console.quickbooks.ts), and the binary forwards the sentence
 * and not a field (`readNoReport` in packages/console/internal/deployment/report.go). the name is
 * checked against what is drawn rather than trusted, so wording that stops leading with it falls
 * back to the press and never marks the wrong picker.
 *
 * it reaches the pickers only where the chart moved under them: each offers only what fits it
 * (`accountPicker` above), so an account changed to a Bank at Intuit after this chart was read is
 * the refusal's one way here.
 */
export function misfitPick(
	answer: QuickbooksAnswer | null,
	drawn: readonly AccountPick[]
): AccountPick | null {
	const read = unanswered(answer, 'accounts');
	if (read === null || read.kind !== 'unreadable' || read.error !== WRONG_TYPE) return null;
	if (readableRefusal(read) === null) return null;
	const named = MARKED_NAME.exec(read.detail)?.[1];
	return drawn.find((pick) => pick === named) ?? null;
}

/**
 * what a picker refused for its account's type says: the predicate its label completes. a holding
 * takes an Other Current Asset of its own, and income or fees take what the re-read list offers.
 */
export const misfitSays = (pick: AccountPick): string =>
	isHolding(pick)
		? 'pick an Other Current Asset account, never a bank account'
		: 'pick another account from this list';

/**
 * a disconnect whose revoke Intuit did not confirm, as the deployment said it, or `null`.
 *
 * the connection is gone on both arms, so the state the press leaves is its report — except that
 * the app may still stand among the company's connected apps, which is a trace somewhere this
 * screen cannot show (`QuickbooksRevoke` in packages/operator/src/console/quickbooks.ts). so this
 * arm, and only this one, is said: the deployment's detail quoted and its fix saying where.
 */
export function revokeStands(
	answer: QuickbooksAnswer | null
): { readonly detail: string; readonly fix: string } | null {
	if (answer?.kind !== 'reported' || answer.report.press !== 'disconnect') return null;
	const { revoke } = answer.report;
	return revoke.state === 'not_revoked' ? { detail: revoke.detail, fix: revoke.fix } : null;
}

/** the sentence over a revoke Intuit did not confirm. */
export const NOT_REVOKED = 'Intuit didn’t confirm the disconnect.';

/** a step's button saying `Saving` or `Saved`, reported up so the step stays open under it. */
export type OnConfirming = (active: boolean) => void;

/** whether a button's rung is one a finished step stays open for. */
export const confirmingIn = (state: SavedFormState): boolean =>
	state === 'pending' || state === 'done';

/** the three steps the section draws as a checklist, in order. */
export const STEPS = ['setup', 'connect', 'accounts'] as const;

export type StepName = (typeof STEPS)[number];

/** where one step stands. */
export type StepStanding = {
	readonly done: boolean;
	/** something blocks it, which is what opens it and turns its mark. */
	readonly trouble: boolean;
	/** it cannot be taken until the one before it is done, so it is drawn shut and refuses to open. */
	readonly locked: boolean;
	readonly open: boolean;
};

/**
 * the step whose button is drawing `Saving` or `Saved`, and whether that save is the one finishing
 * the step — which is read once, as the save starts, since by its tick the step is done either way.
 */
export type Confirming = { readonly step: StepName; readonly finishing: boolean };

/**
 * the hold a step's button puts on it as it starts or stops drawing its save: taken with whether
 * the step was `done` at that moment, kept as first taken while the save goes on, and let go by
 * that step alone.
 */
export const holdOpen =
	(step: StepName, active: boolean, done: boolean) =>
	(held: Confirming | null): Confirming | null => {
		if (!active) return held?.step === step ? null : held;
		return held?.step === step ? held : { step, finishing: !done };
	};

/**
 * whether a save that is answered before the page is read again is still saving: its request, and
 * then the read that answer sets off, until that read is on the screen (`spent`, ./reseed.ts). the
 * confirmation begins over the page the save left, so what it says about the page is true of it.
 */
export const savingUntilRead = (press: {
	readonly own: boolean;
	readonly landed: boolean;
	readonly spent: boolean;
}): boolean => press.own || (press.landed && !press.spent);

export type StepsStanding = Readonly<Record<StepName, StepStanding>> & {
	/** the sync group under the checklist, drawn once every step is done, trouble or not. */
	readonly sync: boolean;
};

/**
 * which step is open, shut, locked or in trouble, and whether sync is drawn at all.
 *
 * **the order is the code's.** Connect is locked until the keys are held, because every call to
 * Intuit is built from all three; Accounts until a company is connected, because the connect is
 * what fills them off the chart (`fillAccountsFromChart` in
 * packages/app/src/routes/quickbooks.callback.tsx); and sync is out of sight until income and
 * fees are picked and a moved connection's accounts saved, because nothing is sent before
 * (`chosenAccounts` in packages/app/src/lib/server/accounting/quickbooks.ts, and
 * `awaitingAccounts` in packages/operator/src/console/quickbooks.ts) — never drawn locked, since it
 * is not a step. trouble does not take it away: an outage is when an operator needs the backlog and
 * its retry.
 *
 * **the first unfinished step is open and a finished one is shut** — once its button has shown
 * the save that finished it: `confirming` is the step whose button is drawing `Saving` or `Saved`,
 * and it stays open under that. a step saved again after it was done is held by nothing: its
 * `open` never moves, so the fold stays however the operator left it. trouble opens its step, and
 * so does a press on it that went unanswered or a company Intuit has not named yet. a locked step
 * opens for nothing.
 */
export function stepsStand(facts: {
	/** all three keys are held. */
	readonly configured: boolean;
	readonly books: QuickbooksRead;
	readonly answer: QuickbooksAnswer | null;
	readonly confirming: Confirming | null;
}): StepsStanding {
	const { configured, books, answer, confirming } = facts;
	const connection = books.kind === 'read' ? books.report.connection : null;
	const company = connection?.state === 'connected' ? connection : null;
	const chart = books.kind === 'read' ? chartStands(books.report.accounts) : null;

	const done: Record<StepName, boolean> = {
		setup: configured,
		connect: company !== null,
		accounts:
			company !== null &&
			!company.awaitingAccounts &&
			REQUIRED_PICKS.every((pick) => company[pick] !== null)
	};
	const trouble: Record<StepName, boolean> = {
		setup: false,
		connect:
			books.kind === 'unread' ||
			unanswered(answer, 'connect') !== null ||
			chart?.step === 'connect',
		accounts: chart?.step === 'accounts'
	};
	const locked: Record<StepName, boolean> = {
		setup: false,
		connect: !done.setup,
		accounts: !done.connect
	};
	const asked: Record<StepName, boolean> = {
		setup: false,
		connect: company !== null && company.companyName === null,
		accounts: unanswered(answer, 'accounts') !== null
	};
	const current = STEPS.find((name) => !done[name]);
	const step = (name: StepName): StepStanding => ({
		done: done[name],
		trouble: trouble[name],
		locked: locked[name],
		open:
			!locked[name] &&
			(name === current ||
				trouble[name] ||
				asked[name] ||
				(confirming?.step === name && confirming.finishing))
	});
	return {
		setup: step('setup'),
		connect: step('connect'),
		accounts: step('accounts'),
		sync: STEPS.every((name) => done[name])
	};
}

/** what a step's mark is called for a reader who cannot see its shape. */
export const stepWord = (step: StepStanding): string =>
	step.trouble ? 'Needs attention' : step.done ? 'Done' : 'To do';

/** what each step and the sync group are called on the screen. */
export const STEP_LABEL: Readonly<Record<StepName | 'sync', string>> = {
	setup: 'Setup',
	connect: 'Connect',
	accounts: 'Accounts',
	sync: 'Sync'
};

/**
 * where a save that shuts `saved` sends the reader: the first open step after it, else the sync
 * group where it stands and `saved` is the last step, else nowhere.
 *
 * a step open before the one saved is not what the save opened, and is not where a reader standing
 * on that save is taken.
 */
export function opensNext(steps: StepsStanding, saved: StepName): StepName | 'sync' | null {
	const next = STEPS.slice(STEPS.indexOf(saved) + 1).find((name) => steps[name].open);
	if (next !== undefined) return next;
	return saved === 'accounts' && steps.sync ? 'sync' : null;
}

/**
 * what a save that opened `next` says after its confirmation, or `undefined` for the button's own
 * sentence, which is true of a save that opened nothing.
 */
export const openedSays = (next: StepName | 'sync' | null): string | undefined =>
	next === null ? undefined : `${STEP_LABEL[next]} is open.`;

/**
 * what `step`'s save says after its confirmation: what it opened where it is the save finishing
 * the step, and the button's own sentence otherwise — a step saved again opens nothing that was
 * not already there.
 */
export const savedSays = (
	steps: StepsStanding,
	confirming: Confirming | null,
	step: StepName
): string | undefined =>
	confirming?.step === step && confirming.finishing
		? openedSays(opensNext(steps, step))
		: undefined;

/**
 * where a reader standing in a step is sent as its hold goes: what the save opened, else the
 * step's own label, since the step shuts under them. a step saved again never shut, so the reader
 * stays on its button.
 */
export const shutSendsTo = (steps: StepsStanding, shut: Confirming): StepName | 'sync' | null =>
	shut.finishing ? (opensNext(steps, shut.step) ?? shut.step) : null;

/** what the company is called on this screen: its name, or the id Intuit addresses it by. */
export const companyCalled = (company: QuickbooksCompany): string =>
	company.companyName ?? company.realmId;

/** a sentence ending on a name that already ends in a stop takes no second one. */
const stopped = (text: string): string => (text.endsWith('.') ? text : `${text}.`);

/** what disconnecting costs, itemised for the confirm. */
export const disconnectLines = (company: QuickbooksCompany): string[] => [
	stopped(`Gifts stop syncing to ${companyCalled(company)}`),
	'This deployment forgets the company, its accounts and the day gifts sync from.'
];

/** what each of the three boxes is called. the pair takes Intuit's own labels. */
export const KEY_LABEL: Readonly<Record<string, string>> = {
	QUICKBOOKS_CLIENT_ID: 'Client ID',
	QUICKBOOKS_CLIENT_SECRET: 'Client secret',
	QUICKBOOKS_API_URL: 'API address'
};

/**
 * the lines the confirm over changed keys itemises, or `null` where the press goes without one.
 *
 * one per box the press changes, named against the value it was, then the cost: a token was
 * bought with the old pair, so the company is unreachable until it is connected again. a press
 * that changes nothing, or that the rules refuse before it goes (./secret-edits.ts), asks nothing —
 * there is nothing to agree to.
 */
export function keysAsk(
	edits: SecretEdits,
	seeds: Readonly<Record<string, string>>,
	company: QuickbooksCompany
): string[] | null {
	if (!edits.ok) return null;
	const changed = Object.entries(edits.payload);
	if (changed.length === 0) return null;
	return [
		...changed.map(([name, value]) => {
			const act = value === null ? 'Removed' : (seeds[name] ?? '') === '' ? 'Set' : 'Replaced';
			return `${KEY_LABEL[name] ?? name} · ${act}`;
		}),
		`${companyCalled(company)} stops syncing until you sign in again.`
	];
}

/** the confirm a move of the start date puts up. */
export type StartDateAsk = {
	readonly title: string;
	readonly press: string;
	/** sending is the job asked for and takes the primary rank; skipping loses gifts and is danger. */
	readonly rank: 'exit' | 'danger';
	readonly lines: readonly string[];
};

/** the two sides of a move, as the preview press answers them. */
export type StartDatePreview = {
	readonly queues: QuickbooksStartAtSide;
	readonly drops: QuickbooksStartAtSide;
};

/** business dates are days and not instants, so they are said in utc, where the day was stored. */
const DAY_WORDS = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'long',
	year: 'numeric',
	timeZone: 'UTC'
});

/**
 * the business dates a side spans, each part said once: `2 to 12 September 2026`,
 * `3 June to 31 August 2026`, `30 December 2025 to 2 January 2026`, or the one day.
 */
function datedSays(earliest: string, latest: string): string {
	const from = DAY_WORDS.formatToParts(new Date(earliest));
	const to = DAY_WORDS.formatToParts(new Date(latest));
	const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string =>
		parts.find((one) => one.type === type)?.value ?? '';
	const whole = DAY_WORDS.format(new Date(latest));
	if (DAY_WORDS.format(new Date(earliest)) === whole) return whole;
	const sameYear = part(from, 'year') === part(to, 'year');
	const sameMonth = sameYear && part(from, 'month') === part(to, 'month');
	const start = sameMonth
		? part(from, 'day')
		: sameYear
			? `${part(from, 'day')} ${part(from, 'month')}`
			: DAY_WORDS.format(new Date(earliest));
	return `${start} to ${whole}`;
}

/**
 * a side's counts, a line each, leaving out a count that is zero, then the dates the gifts and
 * corrections span — a side of refunds and disputes alone names no dates.
 */
function counted(side: QuickbooksStartAtSide): string[] {
	return [
		side.gifts > 0 ? `Gifts · ${side.gifts}` : null,
		side.corrections > 0 ? `Corrections · ${side.corrections}` : null,
		side.reversals > 0 ? `Refunds and disputes · ${side.reversals}` : null,
		side.earliest !== null && side.latest !== null
			? `Dated · ${datedSays(side.earliest, side.latest)}`
			: null
	].filter((line): line is string => line !== null);
}

/**
 * the confirm moving the start date to `day` puts up, off the deployment's count of what the move
 * touches — or `null`, where the press goes without one.
 *
 * **the day decides a move earlier's queues and a move later's drops**, so the side read is the
 * direction's and the other is ignored. a refund or dispute moves with the gift it reverses rather
 * than by its own date, and one of a gift the books keep that holds no row of its own — it landed
 * while no company was connected — is queued by any move, whichever way it goes; a move later's
 * queues are those alone. a side counting nothing is a move with nothing to agree to and asks
 * nothing.
 */
export function startDateAsk(
	day: string,
	company: QuickbooksCompany,
	preview: StartDatePreview
): StartDateAsk | null {
	const earlier = day < startDay(company.startAt);
	const side = earlier ? preview.queues : preview.drops;
	if (side.gifts + side.corrections + side.reversals === 0) return null;
	const name = companyCalled(company);
	return earlier
		? {
				title: 'Send past gifts?',
				press: 'Send gifts',
				rank: 'exit',
				lines: [
					...counted(side),
					`Company · ${name}`,
					'Any of these already entered in QuickBooks by hand will appear there twice.'
				]
			}
		: {
				title: 'Skip unsent gifts?',
				press: 'Skip gifts',
				rank: 'danger',
				lines: [...counted(side), stopped(`These won’t be sent to ${name}`)]
			};
}

/** what a press of the day does next: waits on its preview, asks over it, or moves. */
export type StartDateNext =
	| { readonly kind: 'wait' }
	| { readonly kind: 'ask'; readonly ask: StartDateAsk }
	| { readonly kind: 'move' };

/**
 * what the answer standing does to a press moving the day to `day`.
 *
 * **only a preview of that day counts.** a preview counted for another day reads that day's
 * direction and not this one's — an earlier day's preview has no drops, so against a later day it
 * says the move touches nothing and the move goes unasked. so a preview whose `startAt` is not the
 * day asked, on the calendar day the box posted, is ignored exactly as another press's answer is.
 */
export function startDateNext(
	day: string,
	company: QuickbooksCompany,
	answer: QuickbooksAnswer | null
): StartDateNext {
	if (answer?.kind !== 'reported' || answer.report.press !== 'start-date-preview')
		return { kind: 'wait' };
	if (startDay(answer.report.startAt) !== day) return { kind: 'wait' };
	const ask = startDateAsk(day, company, answer.report);
	return ask === null ? { kind: 'move' } : { kind: 'ask', ask };
}

/**
 * whether the intent in flight is one of this control's presses. a control can make more than one
 * — the day's save previews and then moves — and is closed under either.
 */
export const ownPress = (pending: string | null, ...presses: readonly QuickbooksPress[]): boolean =>
	presses.some((press) => pending === quickbooksIntent(press));
