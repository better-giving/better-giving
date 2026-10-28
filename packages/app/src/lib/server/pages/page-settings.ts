import { dayWords, endOfDay, isTimeZone } from '../../page/end-date';
import type { DraftKeys } from './queries';

// a campaign's end date as its Settings card posts it (./section-saves.ts): a day and the IANA zone
// of the browser that chose it. the draft stores the day's end in that zone (`endOfDay` in
// ../../page/end-date.ts) beside the zone, both or neither, and a day already over is refused
// naming it.

/**
 * an end date as its two boxes post it, a day and the IANA zone it ends in, read as `now` stands:
 * the draft keys it sets, both removed for no day, or the sentence each refused box carries.
 */
export function readEndDay(
	day: string | undefined,
	zone: string | undefined,
	now: number
):
	| { readonly ok: true; readonly keys: Pick<DraftKeys, 'endsAt' | 'endsZone'> }
	| { readonly ok: false; readonly boxes: Readonly<Record<string, string>> } {
	if (day === undefined) return { ok: true, keys: { endsAt: undefined, endsZone: undefined } };
	if (zone === undefined || !isTimeZone(zone)) {
		return {
			ok: false,
			boxes: {
				time_zone:
					zone === undefined
						? 'required with an end date: the IANA time zone its day ends in'
						: `${JSON.stringify(zone)} is not a time zone`
			}
		};
	}
	// the day's end is read whatever the clock says, so a day already over is told apart from one
	// that is no day at all.
	const ends = endOfDay({ day, timeZone: zone, now: Number.NEGATIVE_INFINITY });
	if (!ends.ok) return { ok: false, boxes: { end_date: ends.reason } };
	if (ends.endsAt <= now) {
		return { ok: false, boxes: { end_date: `today or later; ${dayWords(day)} is already over` } };
	}
	return { ok: true, keys: { endsAt: ends.endsAt, endsZone: zone } };
}
