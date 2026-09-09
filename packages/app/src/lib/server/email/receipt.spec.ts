import type { receipt } from '@better-giving/emails';
import { describe, expect, it } from 'vitest';
import type { OrgProfile } from '../db/schema';
import { RECEIPT_FIELDS } from '../org/receipt-fields';
import { renderReceipt, type ReceiptContribution, type ReceiptInput } from './receipt';

// what this app refuses to print, and nothing about what a receipt says — that is the package's,
// and packages/emails/src/templates/receipt.spec.tsx holds it. so every case here is an object
// literal and there is no database anywhere in the file.

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
	// set because this fixture stands for a fully configured org, not because the receipt reads
	// it: the quid-pro-quo disclosure is derived from `GoodsOrServices` per gift, while this column
	// is the standing line the embedded form shows before a gift exists.
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.'
};

const CONTRIBUTION: ReceiptContribution = {
	totalMinor: 10_000,
	nonDeductibleMinor: 0,
	// the ordinary gift: nobody covered a fee.
	coveredFeeMinor: 0,
	currency: 'USD',
	receivedAt: new Date('2026-01-05T12:00:00Z')
};

function input(overrides: Partial<ReceiptInput> = {}): ReceiptInput {
	return {
		org: ORG,
		donorName: 'Ada Lovelace',
		contribution: CONTRIBUTION,
		goodsOrServices: { kind: 'none' },
		// the ordinary gift, given for nobody and credited to no cause.
		tribute: null,
		program: null,
		...overrides
	};
}

/** renders, requiring success, and hands back the message. */
async function rendered(overrides: Partial<ReceiptInput> = {}) {
	const result = await renderReceipt(input(overrides));
	if (!result.ok) throw new Error(`expected a receipt, got ${result.reason}: ${result.detail}`);
	return result.message;
}

describe('renderReceipt — when it refuses', () => {
	/**
	 * `org/queries.ts` states the rule: a receipt template that finds no profile must not
	 * render a blank one. it refuses instead — and it does not throw, because the caller has
	 * already committed the gift to the ledger and mail must never be able to steer that.
	 */
	it('refuses when no organisation profile is saved, naming every field', async () => {
		const result = await renderReceipt(input({ org: null }));
		// the guard narrows the union and is the assertion — `expect(...).toBe` proves the
		// reason at runtime but tells the compiler nothing, so `missing` would not typecheck.
		if (result.ok || result.reason !== 'org_profile_incomplete') {
			throw new Error('a receipt was rendered with no organisation profile');
		}
		expect(result.missing).toEqual(RECEIPT_FIELDS);
		expect(result.detail).toContain('better-giving open');
	});

	/**
	 * words on a screen, never column names (CLAUDE.md): a sentence naming `legal_name` or
	 * `tax_id` is schema vocabulary handed to a fundraiser, and `org/receipt-fields.ts` holds the
	 * words for each of them. `missing` stays field names because it is the machine half a page
	 * marks inputs with.
	 */
	it('names the missing fields in words, never in columns', async () => {
		const result = await renderReceipt(input({ org: null }));
		if (result.ok || result.reason !== 'org_profile_incomplete') throw new Error('it rendered');
		expect(result.detail).toContain('registered name');
		expect(result.detail).toContain('EIN');
		expect(result.detail).toContain('street address');
		// only the fields whose column name differs from their word can be asserted this way —
		// `city` and `country` are spelled the same either side of the mapping.
		for (const field of RECEIPT_FIELDS.filter((name) => name.includes('_'))) {
			expect(result.detail).not.toContain(field);
		}
	});

	/**
	 * and it does not claim a gift was recorded. this function does not know whether anything was
	 * posted, so any such claim is a sentence it cannot stand behind.
	 */
	it('says nothing about whether a gift was recorded', async () => {
		const result = await renderReceipt(input({ org: null }));
		if (result.ok) throw new Error('it rendered');
		expect(result.detail).not.toContain('gift is recorded');
		expect(result.detail).not.toContain('nothing was lost');
	});

	/**
	 * a blank is not a null, so a check testing only for `null` is not enough. a row written by
	 * `wrangler d1 execute` or an importer can hold `tax_id = ''` — the column allows it and
	 * `parseOrgProfile` is not on that path — which would pass as complete and print the empty
	 * field this refusal exists to prevent.
	 */
	it.each([
		{ label: 'an empty string', taxId: '' },
		{ label: 'whitespace', taxId: '   ' }
	])('refuses an EIN that is $label, not just one that is null', async ({ taxId }) => {
		const result = await renderReceipt(input({ org: { ...ORG, taxId } }));
		if (result.ok || result.reason !== 'org_profile_incomplete') {
			throw new Error(`a receipt was rendered with a blank EIN (${JSON.stringify(taxId)})`);
		}
		expect(result.missing).toEqual(['tax_id']);
	});

	/**
	 * the required set comes from `org/receipt-fields.ts`, not from a second list over here — so a
	 * field added to that list becomes a field this refuses without, and the two cannot drift into
	 * a receipt going out missing something no screen reported.
	 */
	it.each([
		{ field: 'tax_id', profile: { ...ORG, taxId: null } },
		{ field: 'address_line1', profile: { ...ORG, addressLine1: null } },
		{ field: 'city', profile: { ...ORG, city: null } },
		{ field: 'country', profile: { ...ORG, country: null } }
	])('refuses when $field is not saved', async ({ field, profile }) => {
		const result = await renderReceipt(input({ org: profile }));
		if (result.ok || result.reason !== 'org_profile_incomplete') {
			throw new Error(`a receipt was rendered without ${field}`);
		}
		expect(result.missing).toEqual([field]);
	});

	// the fields plenty of countries do not have. requiring them would report a complete
	// Irish or Emirati address as incomplete, so a receipt has to read correctly without them.
	it('renders without a region, postcode or second address line', async () => {
		const message = await rendered({
			org: { ...ORG, region: null, postalCode: null, addressLine2: null }
		});
		expect(message.text).toContain('Springfield');
		expect(message.text).not.toContain('null');
	});

	/**
	 * a receipt claiming goods were provided while estimating their value at nothing is a
	 * §6115 violation with a friendly tone. both halves — a description and a figure — or
	 * neither.
	 */
	it.each([
		{
			half: 'no description',
			goods: { kind: 'provided', description: '  ' } as receipt.GoodsOrServices,
			contribution: { ...CONTRIBUTION, nonDeductibleMinor: 4_000 }
		},
		{
			half: 'no fair market value',
			goods: { kind: 'provided', description: 'two gala tickets' } as receipt.GoodsOrServices,
			contribution: { ...CONTRIBUTION, nonDeductibleMinor: 0 }
		}
	])('refuses a goods-or-services gift with $half', async ({ goods, contribution }) => {
		const result = await renderReceipt(input({ goodsOrServices: goods, contribution }));
		if (result.ok) throw new Error('a receipt was rendered with an incomplete goods statement');
		expect(result.reason).toBe('goods_or_services_incomplete');
	});

	/**
	 * the mirror image, which the guard above does not cover.
	 * `{ totalMinor: 20_000, nonDeductibleMinor: 6_000 }` with `kind: 'none'` otherwise renders
	 * happily: it prints "No goods or services were provided to you in exchange for this
	 * contribution", omits the §6115 disclosure — the template discloses only on
	 * `kind === 'provided'` — and contradicts the books, on a document a donor files with a tax
	 * return. a non-zero fair market value is the record that something was provided.
	 */
	it.each([
		{ branch: 'nothing was provided', goods: { kind: 'none' } as receipt.GoodsOrServices },
		{
			branch: 'only intangible religious benefits',
			goods: { kind: 'intangible_religious' } as receipt.GoodsOrServices
		}
	])('refuses a non-zero fair market value when $branch', async ({ goods }) => {
		const result = await renderReceipt(
			input({
				goodsOrServices: goods,
				contribution: { ...CONTRIBUTION, totalMinor: 20_000, nonDeductibleMinor: 6_000 }
			})
		);
		if (result.ok) throw new Error('a receipt was rendered contradicting the ledger');
		expect(result.reason).toBe('goods_or_services_inconsistent');
	});

	// a negative figure is the same contradiction from the other side, and would print a
	// negative "value of what you received".
	it('refuses a negative fair market value', async () => {
		const result = await renderReceipt(
			input({ contribution: { ...CONTRIBUTION, nonDeductibleMinor: -100 } })
		);
		if (result.ok) throw new Error('a receipt was rendered with a negative value received');
		expect(result.reason).toBe('goods_or_services_inconsistent');
	});

	/**
	 * more received than paid is not a contribution, and nothing else refuses it: the receipt
	 * prints a payment with a larger "value of what you received" beside it, under a disclosure
	 * explaining that the deductible part is the excess of the first over the second.
	 */
	it('refuses a fair market value larger than the payment', async () => {
		const result = await renderReceipt(
			input({
				goodsOrServices: { kind: 'provided', description: 'a gala ticket' },
				contribution: { ...CONTRIBUTION, totalMinor: 5_000, nonDeductibleMinor: 6_000 }
			})
		);
		if (result.ok) throw new Error('a receipt was rendered for a gift worth less than its perks');
		expect(result.reason).toBe('goods_or_services_inconsistent');
	});

	// equal is not refused: a $50 ticket for a $50 payment is a real transaction with a
	// deductible part of nothing, and the receipt is what says so.
	it('allows a fair market value equal to the payment', async () => {
		const result = await renderReceipt(
			input({
				goodsOrServices: { kind: 'provided', description: 'a gala ticket' },
				contribution: { ...CONTRIBUTION, totalMinor: 5_000, nonDeductibleMinor: 5_000 }
			})
		);
		expect(result.ok).toBe(true);
	});

	/**
	 * a fee larger than the payment it was added to is a donation row contradicting itself, and
	 * nothing upstream stops it: `donation_fee_minor_check` asserts only `>= 0`, and the schema
	 * carries no cross-column check by design. the same shape as the fair market value refusal
	 * above, from the other column.
	 */
	it('refuses a covered fee larger than the payment', async () => {
		const result = await renderReceipt(
			input({ contribution: { ...CONTRIBUTION, totalMinor: 5_000, coveredFeeMinor: 6_000 } })
		);
		if (result.ok) throw new Error('a receipt was rendered over a self-contradicting gift');
		expect(result.reason).toBe('covered_fee_inconsistent');
		expect(result.detail).toContain('donation.fee_minor');
		// the reason is the record, not what the record would have printed — nothing on the
		// document breaks the payment down, so a detail claiming a figure would come out wrong and
		// send whoever reads it looking for a line that is not there.
		expect(result.detail).not.toContain('negative');
	});

	// equal is not refused and is not nonsense either: it is a payment that was all fee, which the
	// books can hold and the receipt can state as the total it was.
	it('allows a covered fee equal to the payment', async () => {
		const result = await renderReceipt(
			input({ contribution: { ...CONTRIBUTION, totalMinor: 5_000, coveredFeeMinor: 5_000 } })
		);
		expect(result.ok).toBe(true);
	});
});
