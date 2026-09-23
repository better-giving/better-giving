import type {
	ZapierPress,
	ZapierPressReport,
	ZapierReport
} from '@better-giving/operator/console/zapier';
import type { NoReport } from '../api/types';
import { waitedSays } from './quickbooks-standing';

// every decision the Zapier section makes about a value, out of the drawing so that a case can be
// written against it — ./quickbooks-standing.ts beside ./quickbooks-section.tsx is the arrangement,
// and the reason is the same: ../../vite.config.ts pins `node` and there is no dom, so a rule left
// inside the component is one no spec can reach.
//
// **the key is read back on every visit** (packages/operator/src/console/zapier.ts), except one made
// before the deployment stored it, which the console cannot show and only a replace brings onto the
// screen.
//
// **the section draws one press at a time, so every answer reports there.** a make refused because
// a key now exists lands on a section drawing the replace press, and its sentence names that press
// — the control that was pressed is gone, and the one standing in its place is what the sentence
// is about.

/**
 * how the last press was answered.
 *
 * `reported` is the deployment saying what the press did, a refusal included; `unanswered` is
 * nothing coming back that says, and names the press because nothing on the wire does.
 */
export type ZapierAnswer =
	| { kind: 'reported'; report: ZapierPressReport }
	| { kind: 'unanswered'; press: ZapierPress; read: NoReport };

/** what one press posts as its intent. */
export const zapierIntent = (press: ZapierPress): string => `zapier:${press}`;

/** the key the last press made, or `null` where the last answer carries none. */
const freshKey = (answer: ZapierAnswer | null): string | null =>
	answer?.kind === 'reported' && answer.report.ok ? answer.report.key : null;

/**
 * what the key's item shows: no key to create, a key to read, or a key that stands but that the
 * console cannot show, made before the deployment stored it.
 */
export type KeyStanding = { kind: 'none' } | { kind: 'known'; key: string } | { kind: 'unshown' };

/**
 * the reading's key wins wherever it has one: the page reads again after every press, so the
 * reading is the later of the two, and a key replaced from another console since the answer came
 * back is the reading's and not the answer's. the answer's key stands in only where the reading has
 * none to show.
 */
export function keyStanding(report: ZapierReport, answer: ZapierAnswer | null): KeyStanding {
	const read = report.key?.key ?? null;
	if (read !== null) return { kind: 'known', key: read };
	const made = freshKey(answer);
	if (made !== null) return { kind: 'known', key: made };
	return report.key === null ? { kind: 'none' } : { kind: 'unshown' };
}

/** what stands under the press after an answer that did not land, or `null` where it landed. */
export type PressTrouble =
	| { kind: 'refused'; detail: string }
	| { kind: 'unanswered'; press: ZapierPress; read: NoReport };

export function pressTrouble(answer: ZapierAnswer | null): PressTrouble | null {
	if (answer === null) return null;
	if (answer.kind === 'unanswered') return answer;
	return answer.report.ok ? null : { kind: 'refused', detail: answer.report.detail };
}

/** what an unanswered press left unknown, completing "…, so it can’t say …". */
export const UNKNOWN: Record<ZapierPress, string> = {
	make: 'it can’t say whether a key was made',
	replace: 'it can’t say whether the key was replaced'
};

/** the two events the app hands to a Zap, keyed as the reading counts their listeners. */
export type ZapierTrigger = keyof ZapierReport['listening'];

/** the title on each trigger's card. */
export const TRIGGER_NAME: Record<ZapierTrigger, string> = {
	newGift: 'Settled gifts',
	newDonor: 'New donors'
};

/**
 * the listeners on one trigger, for the trailing end of its card's row, or `null` where there are
 * none: a trigger nothing listens on is the default and says nothing.
 */
export function listeningSays(count: number): string | null {
	if (count === 0) return null;
	return count === 1 ? '1 Zap listening' : `${count} Zaps listening`;
}

/** every subscription the current key holds open, which is what a replace ends. */
export const listeningTotal = (report: ZapierReport): number =>
	report.listening.newGift + report.listening.newDonor;

/**
 * what a replace costs, one line each, for the confirm and for nowhere else.
 *
 * with nothing listening there is no Zap to count, but the key still stops working and a Zapier
 * account connected with it and running no Zap has to be connected again all the same.
 */
export function replaceCosts(listening: number): string[] {
	if (listening === 0)
		return [
			'The current key stops working.',
			'Anything connected with it has to be connected again.'
		];
	return [
		listening === 1
			? '1 Zap listening on the current key stops.'
			: `${listening} Zaps listening on the current key stop.`,
		'Each has to be connected again with the new key.'
	];
}

const HOUR = 60 * 60_000;

/**
 * what the deliveries have to say, one sentence each, or an empty list where they have nothing.
 *
 * working is the silent default: a gift waiting on a backoff is on its way, and a queue a few
 * minutes deep is the every-minute cron doing its job. what speaks is an event given up on, and a
 * queue whose oldest event has waited past the hour.
 *
 * two sentences because they are two measurements: the wait spans every event still owed, healthy
 * ones included, so one sentence over both would report a slow queue as a failure.
 *
 * **a deployment with no key says nothing, whatever the rows hold.** no Zap can listen without one,
 * so there is nothing an operator could be told to mend.
 */
export function deliveriesSay(report: ZapierReport, now: Date): string[] {
	if (report.key === null) return [];
	const { failed, oldestWaitingAt } = report.deliveries;
	const said: string[] = [];
	if (failed > 0)
		said.push(
			failed === 1 ? '1 gift couldn’t be delivered.' : `${failed} gifts couldn’t be delivered.`
		);
	const at = oldestWaitingAt === null ? Number.NaN : Date.parse(oldestWaitingAt);
	if (!Number.isNaN(at) && now.getTime() - at > HOUR)
		said.push(`Your Zaps are ${waitedSays(oldestWaitingAt, now)} behind.`);
	return said;
}
