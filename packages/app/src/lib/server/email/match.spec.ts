import { describe, expect, it } from 'vitest';
import type { OrgProfile } from '../db/schema';
import {
	type MatchPackInput,
	type MatchReminderInput,
	renderMatchPack,
	renderMatchReminder
} from './match';

// what this app refuses to send about an employer match, and what it reads off the profile for the
// filing block. what the mails say is packages/emails/src/templates/match-pack.spec.tsx's and
// match-reminder.spec.tsx's.

const ORG: OrgProfile = {
	id: 'default',
	legalName: 'Greenfield Community Food Bank, Inc.',
	taxId: '84-2761093',
	addressLine1: '1250 Mill Street',
	addressLine2: 'Suite 200',
	city: 'Cincinnati',
	region: 'OH',
	postalCode: '45202',
	country: 'United States',
	notificationEmail: 'staff@example.org',
	createdAt: new Date('2026-01-01T00:00:00Z'),
	updatedAt: new Date('2026-01-01T00:00:00Z'),
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.',
	mission: null,
	vision: null,
	brandColour: null,
	socialLinks: [],
	logoImageId: null,
	bannerImageId: null,
	supporterFundraisersEnabled: true
};

const URL = 'https://giving.example.org/gift/7Qk3-mVx9Lr2NpA4';

function pack(overrides: Partial<MatchPackInput> = {}): MatchPackInput {
	return {
		org: ORG,
		donorName: 'Maya Reyes',
		employer: 'Northwind Logistics',
		amountMinor: 15_000,
		givenMinor: 15_000,
		currency: 'USD',
		givenAt: new Date('2026-11-12T15:00:00Z'),
		receiptSentAt: new Date('2026-11-12T15:01:00Z'),
		giftPageUrl: URL,
		reminds: true,
		...overrides
	};
}

function reminder(overrides: Partial<MatchReminderInput> = {}): MatchReminderInput {
	return {
		displayName: 'Greenfield Food Bank',
		donorName: 'Maya Reyes',
		employer: 'Northwind Logistics',
		amountMinor: 15_000,
		givenMinor: 15_000,
		currency: 'USD',
		givenAt: new Date('2026-11-12T15:00:00Z'),
		giftPageUrl: URL,
		...overrides
	};
}

describe('renderMatchPack', () => {
	it('writes the pack with the nonprofit as the filer, address and all', async () => {
		const result = await renderMatchPack(pack());

		if (!result.ok) throw new Error(result.detail);
		expect(result.message.subject).toBe('Details to ask Northwind Logistics to match your gift');
		for (const arm of [result.message.text, result.message.html]) {
			expect(arm).toContain('Greenfield Community Food Bank, Inc.');
			expect(arm).toContain('84-2761093');
			expect(arm).toContain('1250 Mill Street, Suite 200, Cincinnati, OH 45202, United States');
			expect(arm).toContain('USD 150.00');
		}
	});

	it('states what is left after refunds beside what was given, in both arms', async () => {
		const result = await renderMatchPack(pack({ amountMinor: 10_000 }));

		if (!result.ok) throw new Error(result.detail);
		for (const arm of [result.message.text, result.message.html]) {
			expect(arm).toContain('USD 100.00 after refunds, of USD 150.00 given');
		}
	});

	it('joins an address with no second line, region or postcode', async () => {
		const result = await renderMatchPack(
			pack({ org: { ...ORG, addressLine2: null, region: null, postalCode: null } })
		);

		if (!result.ok) throw new Error(result.detail);
		expect(result.message.text).toContain('1250 Mill Street, Cincinnati, United States');
	});

	/** never invent one: an address missing its street, city or country is no address to file. */
	it.each([
		{ missing: 'street', org: { ...ORG, addressLine1: null } },
		{ missing: 'city', org: { ...ORG, city: null } },
		{ missing: 'country', org: { ...ORG, country: '  ' } }
	])('leaves the address row out when the profile has no $missing', async ({ org }) => {
		const result = await renderMatchPack(pack({ org }));

		if (!result.ok) throw new Error(result.detail);
		for (const arm of [result.message.text, result.message.html]) {
			expect(arm).not.toContain('Address');
			expect(arm).not.toContain('Mill Street');
			expect(arm).toContain('84-2761093');
		}
	});

	/** a portal matches the legal name against the EIN; a pack missing either files nothing. */
	it.each([
		{ missing: ['legal_name', 'tax_id'], org: null },
		{ missing: ['tax_id'], org: { ...ORG, taxId: null } },
		{ missing: ['legal_name'], org: { ...ORG, legalName: ' ' } }
	])('refuses without $missing', async ({ missing, org }) => {
		const result = await renderMatchPack(pack({ org }));

		if (result.ok || result.reason !== 'filer_incomplete') throw new Error('a pack was written');
		expect(result.missing).toEqual(missing);
		expect(result.detail).toContain('Settings');
		expect(result.detail).not.toMatch(/legal_name|tax_id/);
	});

	it('refuses an employer that is only whitespace', async () => {
		const result = await renderMatchPack(pack({ employer: ' \r\n ' }));

		expect(result.ok || result.reason).toBe('employer_unnamed');
	});

	/** the employer is the donor's: a refusal a caller logs carries none of it. */
	it('keeps the employer out of a refusal', async () => {
		const result = await renderMatchPack(pack({ org: null, employer: 'Northwind Logistics' }));

		expect(JSON.stringify(result)).not.toContain('Northwind');
	});
});

describe('renderMatchReminder', () => {
	it('states what is left after refunds beside what was given, in both arms', async () => {
		const result = await renderMatchReminder(reminder({ amountMinor: 10_000 }));

		if (!result.ok) throw new Error(result.detail);
		for (const arm of [result.message.text, result.message.html]) {
			expect(arm).toContain('USD 100.00 after refunds, of USD 150.00 given');
		}
	});

	it('writes the reminder by the display name', async () => {
		const result = await renderMatchReminder(reminder());

		if (!result.ok) throw new Error(result.detail);
		expect(result.message.subject).toBe(
			'Did you file the match for your gift to Greenfield Food Bank?'
		);
		expect(result.message.text).toContain(URL);
	});

	it('refuses an employer that is only whitespace', async () => {
		const result = await renderMatchReminder(reminder({ employer: '\t' }));

		expect(result.ok || result.reason).toBe('employer_unnamed');
	});

	it('refuses a blank display name', async () => {
		const result = await renderMatchReminder(reminder({ displayName: ' ' }));

		expect(result.ok || result.reason).toBe('org_name_unknown');
	});
});
