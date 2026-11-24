import { describe, expect, it } from 'vitest';
import { instructionsMailto, pledgeIsUsable } from './pledge';
import type { Pledge } from './v1';

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

/** the subject and body a mail client reads off the link, decoded. */
function read(href: string): { to: string; subject: string; body: string } {
	const url = new URL(href);
	return {
		to: url.pathname,
		subject: url.searchParams.get('subject') ?? '',
		body: url.searchParams.get('body') ?? ''
	};
}

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

describe('the instructions a donor emails themselves', () => {
	it('names no recipient, and the organisation and the reference in the subject', () => {
		const mail = read(instructionsMailto(STOCK, 'Cedar Fork Community Pantry Inc.', money));
		expect(mail.to).toBe('');
		expect(mail.subject).toBe(
			'Stock gift to Cedar Fork Community Pantry Inc., reference CFCP-AAPL-7Q2D'
		);
	});

	it('lists a stock gift’s transfer details and the reference, one per line', () => {
		const { body } = read(instructionsMailto(STOCK, 'Cedar Fork Community Pantry Inc.', money));
		expect(body.split('\r\n')).toEqual([
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
		const mail = read(instructionsMailto(IRA, 'Cedar Fork Community Pantry Inc.', money));
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
		const href = instructionsMailto(
			{ ...STOCK, accountName: 'A & B?=#' },
			'Cedar Fork Community Pantry Inc.',
			money
		);
		expect(href.startsWith('mailto:?subject=')).toBe(true);
		expect(read(href).body).toContain('Account name: A & B?=#');
	});
});

describe('a pledge a screen may draw', () => {
	it('takes the pledge the save named, whole', () => {
		expect(pledgeIsUsable(STOCK, 'stock', 'p1')).toBe(true);
		expect(pledgeIsUsable(IRA, 'ira_qcd', 'p2')).toBe(true);
	});

	it('takes a pledge with no address to send its receipt to', () => {
		expect(pledgeIsUsable({ ...STOCK, receiptTo: '' }, 'stock', 'p1')).toBe(true);
		expect(pledgeIsUsable({ ...IRA, receiptTo: '' }, 'ira_qcd', 'p2')).toBe(true);
		expect(pledgeIsUsable({ ...IRA, receiptTo: ' ' }, 'ira_qcd', 'p2')).toBe(true);
	});

	it.each([
		['a missing receipt address', { ...STOCK, receiptTo: undefined }, 'stock'],
		['another id', { ...STOCK, id: 'p9' }, 'stock'],
		['another rail', STOCK, 'ira_qcd'],
		['a blank reference', { ...STOCK, reference: ' ' }, 'stock'],
		['a missing DTC number', { ...STOCK, dtcNumber: undefined }, 'stock'],
		['no pledge at all', undefined, 'stock'],
		['null', null, 'stock'],
		['a string', 'p1', 'stock']
	] as const)('refuses %s', (_case, value, method) => {
		expect(pledgeIsUsable(value, method, 'p1')).toBe(false);
	});

	it.each(['id', 'reference', 'receiptTo'] as const)(
		'refuses an IRA (QCD) pledge answered without its %s',
		(field) => {
			expect(pledgeIsUsable({ ...IRA, [field]: undefined }, 'ira_qcd', 'p2')).toBe(false);
		}
	);

	it('refuses an IRA (QCD) pledge answered for another id', () => {
		expect(pledgeIsUsable(IRA, 'ira_qcd', 'p9')).toBe(false);
	});

	it.each(['ticker', 'shares', 'deliverTo', 'dtcNumber', 'accountNumber', 'accountName'] as const)(
		'refuses a stock pledge whose %s is missing, blank or not text',
		(field) => {
			for (const value of [undefined, '', '   ', null, 50]) {
				expect(pledgeIsUsable({ ...STOCK, [field]: value }, 'stock', 'p1')).toBe(false);
			}
		}
	);

	it.each(['custodian', 'payeeName', 'ein', 'mailingAddress'] as const)(
		'refuses an IRA (QCD) pledge whose %s is missing, blank or not text',
		(field) => {
			for (const value of [undefined, '', '   ', null, 47]) {
				expect(pledgeIsUsable({ ...IRA, [field]: value }, 'ira_qcd', 'p2')).toBe(false);
			}
		}
	);

	it.each([
		['missing', undefined],
		['zero', 0],
		['negative', -100],
		['not whole', 10.5],
		['not a number', Number.NaN],
		['infinite', Number.POSITIVE_INFINITY],
		['past the safe integers', Number.MAX_SAFE_INTEGER + 1],
		['text', '10000']
	])('refuses an IRA (QCD) pledge whose amount is %s', (_case, amountMinor) => {
		expect(pledgeIsUsable({ ...IRA, amountMinor }, 'ira_qcd', 'p2')).toBe(false);
	});

	it('takes the smallest amount, one minor unit', () => {
		expect(pledgeIsUsable({ ...IRA, amountMinor: 1 }, 'ira_qcd', 'p2')).toBe(true);
	});

	it.each([
		['an IRA (QCD) pledge on the stock rail', IRA, 'stock', 'p2'],
		['a stock pledge on the IRA (QCD) rail', STOCK, 'ira_qcd', 'p1'],
		['an IRA (QCD) pledge claiming the stock method', { ...IRA, method: 'stock' }, 'ira_qcd', 'p2'],
		['a stock pledge claiming the IRA (QCD) method', { ...STOCK, method: 'ira_qcd' }, 'stock', 'p1']
	] as const)('refuses %s, though the id matches', (_case, value, method, id) => {
		expect(pledgeIsUsable(value, method, id)).toBe(false);
	});
});
