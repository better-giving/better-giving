import { describe, expect, it } from 'vitest';
import { POSTING_ACCOUNTS, pickableAccounts, postableIdFromSubmitted, ROLLUPS } from './accounts';

// the account picker and the door a submitted pick comes back through. both are derived from the
// constant map rather than read from `account`; ./accounts.workers.spec.ts is what holds that map to
// the seed, so these assert against the map and against literals from the seed alike.

describe('pickableAccounts()', () => {
	it('offers the nine postable accounts by code, and no rollup', () => {
		expect(pickableAccounts().map((a) => a.code)).toEqual([
			'1010',
			'1020',
			'1200',
			'2200',
			'3000',
			'3100',
			'4110',
			'4120',
			'5200'
		]);
	});

	it('carries each account its id and its seeded name', () => {
		expect(pickableAccounts()[0]).toEqual({
			id: '019fb0b4-ec6c-7fbb-aa36-4ff01f1781b9',
			code: '1010',
			name: 'Bank / Cash'
		});
	});
});

describe('postableIdFromSubmitted()', () => {
	it('accepts each of the nine postable ids', () => {
		for (const account of Object.values(POSTING_ACCOUNTS)) {
			expect(postableIdFromSubmitted(account.id), account.code).toBe(account.id);
		}
	});

	it('refuses the rollup, whose children already sum into it', () => {
		expect(postableIdFromSubmitted(ROLLUPS.donations.id)).toBeNull();
	});

	it('refuses an id the chart does not carry', () => {
		expect(postableIdFromSubmitted('019fb0b4-ec6c-7fbb-aa36-000000000000')).toBeNull();
		expect(postableIdFromSubmitted('')).toBeNull();
		expect(postableIdFromSubmitted('bankCash')).toBeNull();
	});
});
