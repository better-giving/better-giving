import { describe, expect, it } from 'vitest';
import type { OrgProfile } from '../db/schema';
import { renderCryptoPending, type CryptoPendingInput } from './crypto-pending';

// what this app refuses to write, and that what it writes reaches the template whole — what the
// notice says is packages/emails/src/templates/crypto-pending.spec.tsx's.

const ORG: OrgProfile = {
	id: 'default',
	legalName: 'Hope Foundation',
	taxId: '12-3456789',
	addressLine1: '1 Charity Way',
	addressLine2: null,
	city: 'Springfield',
	region: 'IL',
	postalCode: '62701',
	country: 'United States',
	notificationEmail: 'staff@example.org',
	createdAt: new Date('2026-01-01T00:00:00Z'),
	updatedAt: new Date('2026-01-01T00:00:00Z'),
	deductibilityStatement: null
};

function input(overrides: Partial<CryptoPendingInput> = {}): CryptoPendingInput {
	return {
		org: ORG,
		donorName: 'Ada Lovelace',
		coinName: 'XRP',
		network: 'XRP',
		coinAmount: '87.412305000000000001',
		address: 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh',
		memo: '104729',
		memoRequired: true,
		validUntil: new Date('2026-09-24T15:04:00Z'),
		...overrides
	};
}

describe('renderCryptoPending', () => {
	it('refuses without a saved registered name, and says where to fix it', async () => {
		for (const org of [null, { ...ORG, legalName: '  ' }]) {
			const result = await renderCryptoPending(input({ org }));
			expect(result).toMatchObject({ ok: false, reason: 'org_name_unknown' });
			if (!result.ok) expect(result.detail).toContain('under Organisation');
		}
	});

	it('hands every deposit fact to the template, the amount verbatim', async () => {
		const result = await renderCryptoPending(input());
		if (!result.ok) throw new Error(result.detail);
		expect(result.message.subject).toBe('Send your XRP gift to Hope Foundation');
		for (const arm of [result.message.text, result.message.html]) {
			expect(arm).toContain('87.412305000000000001');
			expect(arm).toContain('rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh');
			expect(arm).toContain('104729');
			expect(arm).toContain('Include the memo when you send.');
			expect(arm).toContain('September 24, 2026 at 3:04 PM UTC');
		}
	});
});
