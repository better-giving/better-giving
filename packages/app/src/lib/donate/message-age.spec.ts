import { describe, expect, it } from 'vitest';
import { messageAge } from './message-age';

// the words beside a donor's message, against the `now` the page was read at.

const NOW = '2026-11-09T12:00:00.000Z';
const before = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('message age', () => {
	it.each([
		[before(0), 'now'],
		[before(5 * 60_000), '5 minutes ago'],
		[before(3 * HOUR), '3 hours ago'],
		[before(DAY + HOUR), 'yesterday'],
		[before(3 * DAY), '3 days ago'],
		[before(7 * DAY - 1), '6 days ago'],
		[before(7 * DAY), 'last week'],
		[before(8 * DAY), 'last week'],
		[before(15 * DAY), '2 weeks ago'],
		[before(34 * DAY), '4 weeks ago'],
		[before(35 * DAY - 1), '4 weeks ago'],
		[before(35 * DAY), 'October'],
		['2026-03-14T09:00:00.000Z', 'March'],
		['2025-12-24T09:00:00.000Z', 'December 2025']
	])('says %s as "%s"', (at, words) => {
		expect(messageAge(at, NOW, 'en-US')).toBe(words);
	});

	it('reads a time past `now` as just now rather than in the future', () => {
		expect(messageAge('2026-11-09T12:05:00.000Z', NOW, 'en-US')).toBe('now');
	});
});
