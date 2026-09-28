import { PAGE_KEYS, type PageState } from './keys';

// whether a campaign has ended, which every reader of it asks here: its address, the served config
// and the gift against its owned settings row, and the Campaigns list. a campaign ends by End,
// which stores `ended`, or by its end date, which stores nothing: a `live` one whose published
// document's `endsAt` has come reads as ended from that instant, and there is no scheduled run to
// write it. the draft's end date ends nothing — it is not donors' until it is published.
//
// `endsAt` is the last millisecond of the chosen day in the zone it was chosen in (./end-date.ts),
// so the instant is the same whatever zone reads it. reached, it is over, as publish reads it
// (`endOfDay` refuses a day whose end has come).
//
// pure and not under `$lib/server/**`, for the reason ./keys.ts gives.

export function isEnded(
	page: { readonly state: PageState; readonly published: string | null },
	now: number
): boolean {
	if (page.state === 'ended') return true;
	if (page.state !== 'live' || page.published === null) return false;
	const endsAt: unknown = JSON.parse(page.published)[PAGE_KEYS.endsAt];
	return typeof endsAt === 'number' && endsAt <= now;
}

/** the page's state as its readers take it: `ended` where `isEnded`, else the state stored. */
export function stateAt(
	page: { readonly state: PageState; readonly published: string | null },
	now: number
): PageState {
	return isEnded(page, now) ? 'ended' : page.state;
}
