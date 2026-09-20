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
import type { NoReport } from '../api/types';

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
	 * the account this connection posts to that is not in the chart any more — deactivated in the
	 * company's books since it was picked. it stays selected until another is chosen, so a screen
	 * never silently moves where gifts are posted.
	 */
	readonly retired: AccountOption | undefined;
};

/** the empty line a picker opens on where nothing has been picked yet. */
export const CHOOSE = 'Choose an account';

/**
 * one picker over the company's own chart.
 *
 * the type rides the name because a chart holds several accounts called Donations and an operator
 * tells them apart by it. it is Intuit's own word, carried rather than translated
 * (packages/operator/src/console/quickbooks.ts).
 */
export function accountPicker(
	chart: readonly LedgerAccountLine[],
	pick: ChosenAccountLine | null
): AccountPicker {
	const options = chart.map((account) => ({
		value: account.id,
		label: `${account.name} — ${account.type}`
	}));
	const held = pick === null ? undefined : chart.find((account) => account.id === pick.id);
	return {
		options: pick === null ? [{ value: '', label: CHOOSE }, ...options] : options,
		retired: pick !== null && held === undefined ? { value: pick.id, label: pick.name } : undefined
	};
}

/** the three this connection posts to, as the boxes are drawn with them. */
export const picksHeld = (company: QuickbooksCompany): QuickbooksPicks => ({
	income: company.income?.id ?? '',
	fee: company.fee?.id ?? '',
	deposit: company.deposit?.id ?? ''
});

/**
 * whether the three in the boxes are a press: all of them chosen, and not what is already stored.
 *
 * it is both halves rather than the second alone because the three are stored together — two
 * chosen and one empty is a press the deployment refuses, and arming it would spend a round trip
 * to be told so.
 */
export function picksToSave(held: QuickbooksPicks, company: QuickbooksCompany): boolean {
	if (PICKS.some((pick) => held[pick] === '')) return false;
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
 * the instant is not one.
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
		return hours === 1 ? 'an hour' : `${hours} hours`;
	}
	return `${Math.floor(waited / DAY)} days`;
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
