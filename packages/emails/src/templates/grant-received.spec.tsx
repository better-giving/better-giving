import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import { NOT_A_TAX_RECEIPT } from './grant';
import * as grantReceived from './grant-received';
import type { GrantReceivedData } from './grant-received';

// pure, the same as the receipt: object literals in, a message out, no database in the file.

function data(overrides: Partial<GrantReceivedData> = {}): GrantReceivedData {
	return {
		legalName: 'Hope Foundation',
		donorName: 'Ada Lovelace',
		amountMinor: 50_000,
		currency: 'USD',
		dedication: null,
		...overrides
	};
}

/** renders, and hands back both arms. */
async function arms(overrides: Partial<GrantReceivedData> = {}): Promise<string[]> {
	const message = await renderEmail(grantReceived.template(data(overrides)));
	return [message.text, message.html];
}

describe('grantReceived.template — the thank-you once the fund has paid', () => {
	it('says the organisation received the gift', () => {
		expect(grantReceived.template(data()).subject).toBe('Hope Foundation received your gift');
	});

	it('thanks the donor for the amount, formatted, in both arms', async () => {
		for (const arm of await arms()) {
			expect(arm).toContain('Thank you for your gift.');
			expect(arm).toContain('USD 500.00');
		}
	});

	/** the same words the request mail used, so the two cannot disagree about one gift. */
	it('says plainly it is not a tax receipt', async () => {
		for (const arm of await arms()) expect(arm).toContain(NOT_A_TAX_RECEIPT);
	});

	it('addresses the donor by name, and greets neutrally without one', async () => {
		expect((await arms())[0]).toContain('Dear Ada Lovelace,');
		for (const arm of await arms({ donorName: null })) {
			expect(arm).toContain('Hello,');
			expect(arm).not.toContain('null');
		}
	});

	it('states the dedication when the gift has one, and nothing when it has none', async () => {
		for (const arm of await arms({
			dedication: { label: 'In honor of', honoree: 'Grace Hopper' }
		})) {
			expect(arm).toContain('The gift is in honor of Grace Hopper.');
		}
		for (const arm of await arms()) expect(arm).not.toContain('The gift is');
	});

	/** fundraiser words only: the processor behind the fund's window is never the donor's business. */
	it('names no processor', async () => {
		const subject = grantReceived.template(data()).subject;
		for (const arm of [subject, ...(await arms())]) {
			expect(arm).not.toMatch(/chariot|dafpay/i);
		}
	});
});
