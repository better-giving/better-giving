import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import * as cryptoPending from './crypto-pending';
import type { CryptoPendingData } from './crypto-pending';

// pure, the same as the receipt: object literals in, a message out, no database in the file.

const MEMO_WARNING = 'Include the memo when you send.';

function data(overrides: Partial<CryptoPendingData> = {}): CryptoPendingData {
	return {
		legalName: 'Hope Foundation',
		donorName: 'Ada Lovelace',
		coinName: 'Tether USD',
		network: 'TRX',
		coinAmount: '50.123456789012345678',
		address: 'TXYZabcdefghijklmnopqrstuvwxyz1234',
		memo: null,
		memoRequired: false,
		validUntil: new Date('2026-09-24T15:04:00Z'),
		...overrides
	};
}

/** renders, and hands back both arms. */
async function arms(overrides: Partial<CryptoPendingData> = {}): Promise<string[]> {
	const message = await renderEmail(cryptoPending.template(data(overrides)));
	return [message.text, message.html];
}

describe('cryptoPending.template — where a donor sends a crypto gift', () => {
	it('names the coin and the organisation in the subject', () => {
		expect(cryptoPending.template(data()).subject).toBe(
			'Send your Tether USD gift to Hope Foundation'
		);
	});

	it('names the coin with its network beside it, in both arms', async () => {
		for (const arm of await arms()) expect(arm).toContain('Tether USD (TRX network)');
	});

	/** a decimal string survives a float by nothing: past 17 digits a parse would round it. */
	it('prints the amount verbatim, named as today’s', async () => {
		for (const arm of await arms()) {
			expect(arm).toContain('50.123456789012345678');
			expect(arm).toContain('Amount today');
		}
	});

	/** a stripper would glue the address to its label; the text arm keeps it clean to copy. */
	it('prints the address in both arms, alone after its label in the text arm', async () => {
		const [text, html] = await arms();
		expect(html).toContain('TXYZabcdefghijklmnopqrstuvwxyz1234');
		expect(text).toContain('\nAddress       TXYZabcdefghijklmnopqrstuvwxyz1234\n');
	});

	it('states when to send by, to the minute, in UTC', async () => {
		for (const arm of await arms()) expect(arm).toContain('September 24, 2026 at 3:04 PM UTC');
	});

	it('warns that another network cannot be received', async () => {
		for (const arm of await arms()) {
			expect(arm).toContain('Send on the TRX network only.');
		}
	});

	it('says it is not a receipt and states no dollar figure', async () => {
		for (const arm of await arms()) {
			expect(arm).toContain(cryptoPending.NOT_A_RECEIPT);
			expect(arm).not.toMatch(/USD \d/);
		}
	});

	it('addresses the donor by name, and greets neutrally without one', async () => {
		expect((await arms())[0]).toContain('Dear Ada Lovelace,');
		for (const arm of await arms({ donorName: null })) {
			expect(arm).toContain('Hello,');
			expect(arm).not.toContain('null');
		}
	});

	/** fundraiser words only: the processor behind the address is never the donor's business. */
	it('names no processor', async () => {
		const subject = cryptoPending.template(data()).subject;
		for (const arm of [subject, ...(await arms())]) expect(arm).not.toMatch(/nowpayments/i);
	});
});

describe('cryptoPending.template — the memo', () => {
	it('prints no memo row and no warning where the payment carries none', async () => {
		for (const arm of await arms()) {
			expect(arm).not.toContain('Memo');
			expect(arm).not.toContain(MEMO_WARNING);
		}
	});

	it('prints the memo with its warning where the coin requires one', async () => {
		const [text, html] = await arms({ memo: '104729', memoRequired: true });
		expect(text).toContain('\nMemo          104729\n');
		expect(html).toContain('104729');
		for (const arm of [text, html]) expect(arm).toContain(MEMO_WARNING);
		expect(html).toContain(`<strong>${MEMO_WARNING}`);
	});

	it('prints an optional memo the payment carries, without the warning', async () => {
		for (const arm of await arms({ memo: '104729', memoRequired: false })) {
			expect(arm).toContain('104729');
			expect(arm).not.toContain(MEMO_WARNING);
		}
	});

	/** the address rows sit in order, the memo after the address it belongs to. */
	it('orders coin, amount, address, memo, send-by in both arms', async () => {
		for (const arm of await arms({ memo: '104729', memoRequired: true })) {
			const order = ['Coin', 'Amount today', 'Address', 'Memo', 'Send by'].map((label) =>
				arm.indexOf(label)
			);
			expect(order).toEqual([...order].sort((a, b) => a - b));
			expect(order).not.toContain(-1);
		}
	});
});

describe('cryptoPending.template — the HTML arm', () => {
	it('escapes the address and the memo', async () => {
		const [, html] = await arms({ address: '<b>x</b>', memo: '<i>y</i>', memoRequired: true });
		expect(html).not.toContain('<b>x</b>');
		expect(html).not.toContain('<i>y</i>');
	});
});
