import { describe, expect, it } from 'vitest';
import type { OrgProfile } from '../db/schema';
import { renderUncollectedNotice, type UncollectedInput } from './uncollected';

// what this app refuses to write, and nothing about what the notice says — that is the package's,
// and packages/emails/src/templates/uncollected.spec.tsx holds it.

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
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.'
};

function input(overrides: Partial<UncollectedInput> = {}): UncollectedInput {
	return {
		org: ORG,
		donorName: 'Ada Lovelace',
		amountMinor: 10_000,
		currency: 'USD',
		...overrides
	};
}

describe('renderUncollectedNotice — what it will not write', () => {
	/**
	 * the one refusal, and it is narrower than the receipt's five fields on purpose: a donor files
	 * a receipt with a tax authority and nobody files this, so the address and the EIN are
	 * not what makes it printable. the name is, because a message from an organisation the donor
	 * cannot identify is a message about their bank account from a stranger.
	 */
	it.each([
		{ state: 'nothing saved at all', org: null },
		{ state: 'a blank name', org: { ...ORG, legalName: '  ' } }
	])('refuses to write to a donor as $state', async ({ org }) => {
		const result = await renderUncollectedNotice(input({ org }));

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('org_name_unknown');
		// the sentence reaches an operator through an alert, so it says which box to fill in.
		expect(result.detail).toContain('Organisation');
	});
});
