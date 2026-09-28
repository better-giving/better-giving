import { describe, expect, it } from 'vitest';
import { isEnded } from './ended';
import { endOfDay } from './end-date';

// node pool: whether a page has ended is its stored state and its published end against a clock the
// test holds.

const END = Date.parse('2026-12-31T04:59:59.999Z');

const live = (published: object) => ({
	state: 'live' as const,
	published: JSON.stringify(published)
});

describe('whether a campaign has ended', () => {
	it('is live up to its published end instant, and ended from it', () => {
		const campaign = live({ endsAt: END, endsZone: 'America/New_York' });
		expect(isEnded(campaign, END - 1)).toBe(false);
		expect(isEnded(campaign, END)).toBe(true);
	});

	it('ends at the midnight of the zone its end date was set in, read on a UTC clock', () => {
		const set = endOfDay({ day: '2026-12-31', timeZone: 'Pacific/Auckland', now: 0 });
		if (!set.ok) throw new Error(set.reason);
		const campaign = live({ endsAt: set.endsAt, endsZone: 'Pacific/Auckland' });
		// Auckland is UTC+13 in December: its new year is 11:00 on Dec 31 in UTC.
		expect(isEnded(campaign, Date.parse('2026-12-31T10:59:59Z'))).toBe(false);
		expect(isEnded(campaign, Date.parse('2026-12-31T11:00:00Z'))).toBe(true);
	});

	it('never ends by itself without an end date', () => {
		expect(isEnded(live({}), Number.MAX_SAFE_INTEGER)).toBe(false);
	});

	it('has ended once End ended it, whatever its end date', () => {
		const published = JSON.stringify({ endsAt: END, endsZone: 'America/New_York' });
		expect(isEnded({ state: 'ended', published }, END - 86_400_000)).toBe(true);
	});

	it('is not ended by an end date in a draft never published', () => {
		expect(isEnded({ state: 'never_published', published: null }, END)).toBe(false);
	});
});
