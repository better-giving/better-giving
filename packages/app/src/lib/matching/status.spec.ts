import { describe, expect, it } from 'vitest';
import { matchStatus, type MatchStamps } from './status';

const none: MatchStamps = {
	employer: null,
	packSentAt: null,
	packFailedAt: null,
	remindedAt: null,
	filedAt: null,
	matchedAt: null,
	voidedAt: null
};
const at = new Date('2026-11-12T12:00:00.000Z');

describe('the one word a match shows', () => {
	it('is none with no employer and no stamps', () => {
		expect(matchStatus(none)).toBeNull();
	});

	it('is none with an employer named and nothing sent yet', () => {
		expect(matchStatus({ ...none, employer: 'Northwind' })).toBeNull();
	});

	it.each([
		['voided', { voidedAt: at, matchedAt: at, filedAt: at, packFailedAt: at, remindedAt: at }],
		['matched', { matchedAt: at, filedAt: at, packFailedAt: at, remindedAt: at, packSentAt: at }],
		['filed', { filedAt: at, packFailedAt: at, remindedAt: at, packSentAt: at }],
		['send_failed', { packFailedAt: at, remindedAt: at }],
		['reminded', { remindedAt: at, packSentAt: at }],
		['pack_sent', { packSentAt: at }]
	] as const)('is %s by priority over every stamp below it', (word, stamps) => {
		expect(matchStatus({ ...none, employer: 'Northwind', ...stamps })).toBe(word);
	});

	it('is filed for a donor who never named an employer and marked it filed', () => {
		expect(matchStatus({ ...none, filedAt: at })).toBe('filed');
	});
});
