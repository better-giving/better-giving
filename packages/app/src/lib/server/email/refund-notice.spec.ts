import { describe, expect, it } from 'vitest';
import type { OrgProfile } from '../db/schema';
import { renderRefundNotice, type RefundNoticeInput } from './refund-notice';

// what this app refuses to write, and that what it does write is the package's template over the
// figures it was handed. what the notice says is packages/emails/src/templates/refund-notice.spec.tsx's.

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

function input(overrides: Partial<RefundNoticeInput> = {}): RefundNoticeInput {
	return {
		org: ORG,
		donorName: 'Ada Lovelace',
		giftMinor: 10_000,
		givenAt: new Date('2026-08-03T12:00:00Z'),
		refundedMinor: 2_500,
		deductibleMinor: 7_500,
		currency: 'USD',
		...overrides
	};
}

describe('renderRefundNotice', () => {
	it('writes the notice from the figures it is handed, in both arms', async () => {
		const result = await renderRefundNotice(input());

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.message.subject).toBe('Part of your gift to Hope Foundation has been refunded');
		for (const arm of [result.message.text, result.message.html]) {
			expect(arm).toContain('USD 25.00');
			expect(arm).toContain('USD 75.00');
		}
	});

	/**
	 * the one refusal, the uncollected notice's: nobody files this, so the address and the EIN are
	 * not what makes it printable. the name is — money leaving a donor's gift, reported by somebody
	 * they cannot identify, is news from a stranger.
	 */
	it.each([
		{ state: 'nothing saved at all', org: null },
		{ state: 'a blank name', org: { ...ORG, legalName: '  ' } }
	])('refuses to write to a donor as $state', async ({ org }) => {
		const result = await renderRefundNotice(input({ org }));

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('org_name_unknown');
		// the sentence reaches an operator through an alert, so it says which box to fill in.
		expect(result.detail).toContain('Organisation');
	});
});
