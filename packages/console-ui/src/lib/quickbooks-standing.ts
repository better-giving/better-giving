import type { Tone } from '@better-giving/operator/components/closed-sets';
import type {
	ChosenAccountLine,
	LedgerAccountLine,
	QuickbooksCompany,
	QuickbooksPress,
	QuickbooksPressReport,
	QuickbooksRecourse,
	QuickbooksReport
} from '@better-giving/operator/console/quickbooks';
import { QUICKBOOKS_RECOURSES } from '@better-giving/operator/console/quickbooks';
import { z } from 'zod';
import type { NoReport, VarsWritten } from '../api/types';
import { VALUE_FIELD } from './secret-groups';
import type { StatedForm } from './use-console-form';

// every decision the QuickBooks section makes about a value, out of the drawing so that a case can
// be written against it — ./chariot-setup.ts beside ./chariot-section.tsx is the arrangement, and
// the reason is this package's pool: ../../vite.config.ts pins `node` and there is no dom, so a
// rule left inside the component is one no spec can reach.
//
// **which control an answer belongs to is one of those decisions.** one section draws five presses
// and one answer comes back for whichever was made, so the four readings at the top of this file
// are what put an outcome at the control that caused it — and a mismatch there reports a save at
// the button that disconnected.
//
// **the three picks are one act.** a connection holding one of the three is a state the deployment
// refuses to write (packages/operator/src/console/quickbooks.ts), so what arms the save is all
// three chosen and at least one of them different — never a box at a time.
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
 * caused it and one section draws five of them.
 */
export type QuickbooksAnswer =
	| { kind: 'reported'; report: QuickbooksPressReport }
	| { kind: 'unanswered'; press: QuickbooksPress; read: NoReport };

/** whether the last answer is this press's, landed. */
export const landedPress = (answer: QuickbooksAnswer | null, press: QuickbooksPress): boolean =>
	answer?.kind === 'reported' && answer.report.press === press;

/** the address the connect press answered with, or `null` where the last answer is another press's. */
export const connectAddress = (answer: QuickbooksAnswer | null): string | null =>
	answer?.kind === 'reported' && answer.report.press === 'connect' ? answer.report.url : null;

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

/** the three accounts a gift is posted into, in the order the section draws them. */
export const PICKS = ['income', 'fee', 'deposit'] as const;

export type AccountPick = (typeof PICKS)[number];

/** the three as the boxes hold them: an account id each, and `''` where one is unchosen. */
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

/** the empty line a picker offers while it is showing nothing. */
export const CHOOSE = 'Choose an account';

/**
 * one picker over the company's own chart, for a picker showing `showing`.
 *
 * **it offers only the accounts that fit it.** the deployment says which of the three each account
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
 * **the empty line is what "nothing chosen" is, so it stands while the company stores nothing.** a
 * list that lost it on the first pick leaves a mis-pick on a fresh connection with no way back to
 * it, and the three are stored together (`picksToSave` below) — so there is nothing to go back to
 * once the connection holds one.
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
	return {
		options: pick === null || showing === '' ? [{ value: '', label: CHOOSE }, ...options] : options,
		retired: offered
			? undefined
			: { value: showing, label: pick !== null && pick.id === showing ? pick.name : showing }
	};
}

/** the three this connection posts to, as the boxes are drawn with them. */
export const picksHeld = (company: QuickbooksCompany): QuickbooksPicks => ({
	income: company.income?.id ?? '',
	fee: company.fee?.id ?? '',
	deposit: company.deposit?.id ?? ''
});

/**
 * whether the three in the boxes are a press: all of them chosen, every one an account its picker
 * offers, and not what is already stored.
 *
 * it is all three halves rather than the last alone because the three are stored together — two
 * chosen and one empty is a press the deployment refuses, and so is one still showing a retired
 * pick ({@link accountPicker}): an account that does not fit its place, or that the chart no longer
 * holds. arming either would spend a round trip to be told so.
 */
export function picksToSave(
	held: QuickbooksPicks,
	company: QuickbooksCompany,
	chart: readonly LedgerAccountLine[]
): boolean {
	const offered = (pick: AccountPick): boolean =>
		chart.some((account) => account.id === held[pick] && account.roles.includes(pick));
	if (!PICKS.every(offered)) return false;
	const stored = picksHeld(company);
	return PICKS.some((pick) => held[pick] !== stored[pick]);
}

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
export type BacklogStanding = { readonly failed: number; readonly waited: string | null };

/**
 * the backlog where it is worth a word, and `null` where it is not.
 *
 * working is the silent default, so a deployment whose gifts are going over says nothing at all —
 * and a gift merely waiting on a backoff is on its way. what speaks is a gift that was given up
 * on, which is also the whole of what the retry press acts on.
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
	const { failed, oldestWaitingAt } = report.backlog;
	if (failed < 1) return null;
	return { failed, waited: waitedSays(oldestWaitingAt, now) };
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
	const gifts = failed === 1 ? '1 gift hasn’t gone over' : `${failed} gifts haven’t gone over`;
	return waited === null ? `${gifts}.` : `${gifts}. The books are ${waited} behind.`;
}

/** what the press that queues them again reports, as the band over it is drawn. */
export type RetriedStanding = {
	readonly word: string;
	readonly tone: Tone;
	readonly says: string;
};

/**
 * what the press that queues them again says it did.
 *
 * **the word comes off the sentence and never off the press.** none left to send is a real answer
 * — a sweep drained the queue between the read and the press, or this is the second press — and
 * "Queued" over it would be a heading contradicting the line under it.
 */
export const retriedStands = (retried: number): RetriedStanding =>
	retried === 0
		? { word: 'Nothing queued', tone: 'note', says: 'Nothing was left to send.' }
		: {
				word: 'Queued',
				tone: 'done',
				says:
					retried === 1 ? '1 gift will be tried again.' : `${retried} gifts will be tried again.`
			};

/** what stands where the three pickers would be, past the picks and the deployment's own sentence. */
export type UnpickableStanding = {
	/** whether the press that connects the company again stands here. */
	readonly connect: boolean;
	/** the one sentence this console adds of its own, or `null` where it adds none. */
	readonly says: string | null;
};

/**
 * what an unreadable chart offers, off what the deployment said an operator can do about it.
 *
 * a lapsed credential is the only one of the three a press mends, so it is the only one that draws
 * one: a button offered over an Intuit that was briefly unreachable asks for a whole round trip
 * through Intuit to fix nothing, and one offered over a recourse the deployment did not name asks
 * for it over something like a rate limit (`recourseFor` in
 * packages/app/src/routes/console.quickbooks.ts).
 *
 * the sentence is added only where there is something the screen cannot otherwise show. a reader
 * seeing no press over an unreachable Intuit has no way to tell that the read comes back by
 * itself; a reader seeing no press over an unnamed recourse is told the whole of what the
 * deployment said, which is its own sentence and nothing after it.
 *
 * the sentence opens on a pronoun because it is drawn directly under the one naming the deployment
 * (`Unpickable` in ./quickbooks-section.tsx), which is what the pronoun binds to.
 *
 * a record rather than a chain of tests, so a recourse added to the closed set in this repository
 * is a type error here rather than one more falling quietly through to the silent arm.
 */
const UNPICKABLE: Record<QuickbooksRecourse, UnpickableStanding> = {
	reconnect: { connect: true, says: null },
	wait: { connect: false, says: 'It keeps trying on its own.' }
};

/** nothing to do about it here: the deployment's own sentence is the whole of what is said. */
const NO_RECOURSE: UnpickableStanding = { connect: false, says: null };

/**
 * the block as it stands, where no recourse was named as well as where one was.
 *
 * **the name is checked against the set rather than trusted to be in it.** it arrives off the wire
 * with no parse in front of it (`ask` in ../api/client.ts) and the binary forwards the
 * deployment's body unread, so a deployment a release ahead of this console names a recourse the
 * record above has no entry for — and the type says otherwise. drawing nothing is what keeps the
 * screen opening: a console one thing short still says which company is connected and still offers
 * the way out.
 */
export const unpickableStands = (recourse: QuickbooksRecourse | null): UnpickableStanding => {
	const known = QUICKBOOKS_RECOURSES.find((name) => name === recourse);
	return known === undefined ? NO_RECOURSE : UNPICKABLE[known];
};
