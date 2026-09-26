import type { MarkName } from '@better-giving/operator/components/status/Mark';
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
// **the key is read back on every visit** (packages/operator/src/console/zapier.ts), and a press
// that made one carries it too, so a key that landed is on the screen even where the reading after it
// did not come back.
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
export const freshKey = (answer: ZapierAnswer | null): string | null =>
	answer?.kind === 'reported' && answer.report.ok ? answer.report.key : null;

/** what the key's item shows: no key to create, or a key to read. */
export type KeyStanding = { kind: 'none' } | { kind: 'known'; key: string };

/**
 * the reading's key wins wherever it has one: the page reads again after every press, so the
 * reading is the later of the two, and a key replaced from another console since the answer came
 * back is the reading's and not the answer's. the answer's key stands in where the reading has none
 * to show, and where there is no reading at all (`null`) because the one after the press did not
 * come back.
 */
export function keyStanding(report: ZapierReport | null, answer: ZapierAnswer | null): KeyStanding {
	const read = report?.key?.key ?? null;
	if (read !== null) return { kind: 'known', key: read };
	const made = freshKey(answer);
	return made === null ? { kind: 'none' } : { kind: 'known', key: made };
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

/** the events the app hands to a Zap, keyed as the reading counts their listeners. */
export type ZapierTrigger = keyof ZapierReport['listening'];

/**
 * the title on each trigger's card, naming what one event is. the refund trigger fires on every
 * refund of a gift, a partial one and a dispute lost included
 * (packages/app/src/lib/server/zapier/events.ts), so its unit is the refund and not the gift.
 */
export const TRIGGER_NAME: Record<ZapierTrigger, string> = {
	newGift: 'Settled gifts',
	newDonor: 'New donors',
	giftRefunded: 'Refunds'
};

/** the mark at the leading edge of each trigger's card. */
export const TRIGGER_MARK: Record<ZapierTrigger, MarkName> = {
	newDonor: 'user-plus',
	newGift: 'stamp',
	giftRefunded: 'arrow-left'
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
	Object.values(report.listening).reduce((total, count) => total + count, 0);

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
		'Zapier turns off each Zap it can reach. Reconnect each one with the new key, then turn it on: Zapier only subscribes a Zap when it is turned on, so a Zap still on after the replace has to be turned off and on again.'
	];
}

/**
 * what a landed replace did to the Zaps on the old key, one sentence each, or an empty list where
 * it touched none — which is every make, and every other answer.
 *
 * two sentences because they ask two different things of a Zap's owner: a paused Zap reads as off
 * in Zapier and only wants reconnecting and turning back on, while one whose hook did not answer
 * still reads as on and hears nothing until it is turned off and on by hand — nothing asks
 * Zapier again (packages/operator/src/console/zapier.ts).
 */
export function replacedSays(answer: ZapierAnswer | null): string[] {
	if (answer?.kind !== 'reported' || !answer.report.ok) return [];
	const { paused, notPaused } = answer.report;
	const said: string[] = [];
	if (paused > 0)
		said.push(
			paused === 1
				? 'Zapier has turned off 1 Zap that used the old key. Its owner needs to reconnect it with the new key and turn it back on.'
				: `Zapier has turned off ${paused} Zaps that used the old key. Their owners need to reconnect them with the new key and turn them back on.`
		);
	if (notPaused > 0) {
		const more = paused > 0 ? ' more' : '';
		said.push(
			notPaused === 1
				? `1${more} Zap may still show as on in Zapier, but it hears nothing. Its owner needs to reconnect it with the new key, then turn it off and on again.`
				: `${notPaused}${more} Zaps may still show as on in Zapier, but they hear nothing. Their owners need to reconnect them with the new key, then turn them off and on again.`
		);
	}
	return said;
}

const HOUR = 60 * 60_000;

/**
 * what the deliveries have to say, one sentence each, or an empty list where they have nothing.
 *
 * working is the silent default: a delivery waiting on a backoff is on its way, and a queue a few
 * minutes deep is the every-minute cron doing its job. what speaks is a delivery given up on, and a
 * queue whose oldest delivery has waited past the hour. a failure is counted as a delivery and never
 * as a gift: the count spans every trigger (packages/app/src/lib/server/zapier/report.ts), and a new
 * donor's delivery failing is no gift going astray.
 *
 * two sentences because they are two measurements: the wait spans every delivery still owed, healthy
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
			failed === 1 ? '1 delivery to your Zaps failed.' : `${failed} deliveries to your Zaps failed.`
		);
	const at = oldestWaitingAt === null ? Number.NaN : Date.parse(oldestWaitingAt);
	if (!Number.isNaN(at) && now.getTime() - at > HOUR)
		said.push(`Your Zaps are ${waitedSays(oldestWaitingAt, now)} behind.`);
	return said;
}
