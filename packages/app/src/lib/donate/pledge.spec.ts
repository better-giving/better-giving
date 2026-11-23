import type { Pledge } from '@better-giving/form/v1';
import { describe, expect, it } from 'vitest';
import { instructionsMailto, pledgeDetails, pledgeSummary } from './pledge';

// the instructions this page's card links, held to the same pledges, subjects and body lines that
// packages/form/src/pledge.spec.ts holds the element's `instructionsMailto` to. the two specs share
// no code, so a wording changed on one side fails only that side's spec, and the other is changed by
// hand to match.

const STOCK: Pledge = {
	id: 'p1',
	method: 'stock',
	reference: 'CFCP-AAPL-7Q2D',
	receiptTo: 'maya.okafor@example.org',
	ticker: 'AAPL',
	shares: '50',
	deliverTo: 'Harbor Street Securities',
	dtcNumber: '0164',
	accountNumber: 'Z12-345678',
	accountName: 'Cedar Fork Community Pantry Inc.'
};

const IRA: Pledge = {
	id: 'p2',
	method: 'ira_qcd',
	reference: 'CFCP-IRA-4K9M',
	receiptTo: 'maya.okafor@example.org',
	amountMinor: 10_000,
	custodian: 'Fidelity Investments',
	payeeName: 'Cedar Fork Community Pantry Inc.',
	ein: '47-3829105',
	mailingAddress: '412 Alder Lane, Suite 3\nCedar Fork, OR 97330'
};

const ORG = 'Cedar Fork Community Pantry Inc.';
const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

/** the subject and body a mail client reads off the link, decoded. */
function read(href: string): { to: string; subject: string; body: string } {
	const url = new URL(href);
	return {
		to: url.pathname,
		subject: url.searchParams.get('subject') ?? '',
		body: url.searchParams.get('body') ?? ''
	};
}

describe('the instructions a donor emails themselves', () => {
	it('names no recipient, and the organisation and the reference in the subject', () => {
		const mail = read(instructionsMailto(STOCK, ORG, money));
		expect(mail.to).toBe('');
		expect(mail.subject).toBe(
			'Stock gift to Cedar Fork Community Pantry Inc., reference CFCP-AAPL-7Q2D'
		);
	});

	it('lists a stock gift’s transfer details and the reference, one per CRLF line', () => {
		const href = instructionsMailto(STOCK, ORG, money);
		expect(href).toContain(encodeURIComponent('Ticker: AAPL\r\n\r\nDeliver to:'));
		expect(read(href).body.split('\r\n')).toEqual([
			'Shares: 50',
			'Ticker: AAPL',
			'',
			'Deliver to: Harbor Street Securities',
			'DTC number: 0164',
			'Account number: Z12-345678',
			'Account name: Cedar Fork Community Pantry Inc.',
			'Reference: CFCP-AAPL-7Q2D'
		]);
	});

	it('lists an IRA (QCD) gift’s payee details, its address on one line', () => {
		const mail = read(instructionsMailto(IRA, ORG, money));
		expect(mail.subject).toBe(
			'IRA (QCD) gift to Cedar Fork Community Pantry Inc., reference CFCP-IRA-4K9M'
		);
		expect(mail.body.split('\r\n')).toEqual([
			'Amount: $100.00',
			'Custodian: Fidelity Investments',
			'',
			'Payee name: Cedar Fork Community Pantry Inc.',
			'EIN: 47-3829105',
			'Mailing address: 412 Alder Lane, Suite 3, Cedar Fork, OR 97330',
			'Reference: CFCP-IRA-4K9M'
		]);
	});

	it('encodes what a value could break the link with', () => {
		const href = instructionsMailto({ ...STOCK, accountName: 'A & B?=#' }, ORG, money);
		expect(href.startsWith('mailto:?subject=')).toBe(true);
		expect(read(href).body).toContain('Account name: A & B?=#');
	});
});

describe('the rows the screens list', () => {
	it('names the Copy of each value a donor hands on, and sets codes in the monospace face', () => {
		expect(pledgeDetails(STOCK).map((row) => [row.label, row.copy, row.mono])).toEqual([
			['Deliver to', undefined, undefined],
			['DTC number', 'DTC number', true],
			['Account number', 'account number', true],
			['Account name', undefined, undefined],
			['Reference', 'reference', true]
		]);
		expect(pledgeDetails(IRA).map((row) => [row.label, row.copy, row.mono])).toEqual([
			['Payee name', undefined, undefined],
			['EIN', 'EIN', true],
			['Mailing address', 'mailing address', undefined],
			['Reference', 'reference', true]
		]);
		expect(pledgeSummary(STOCK, money).every((row) => row.copy === undefined)).toBe(true);
	});
});
