import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import { NOT_A_TAX_RECEIPT } from './grant';
import * as grantRequested from './grant-requested';
import type { GrantRequestedData } from './grant-requested';

// pure, the same as the receipt: object literals in, a message out, no database in the file.

function data(overrides: Partial<GrantRequestedData> = {}): GrantRequestedData {
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
async function arms(overrides: Partial<GrantRequestedData> = {}): Promise<string[]> {
	const message = await renderEmail(grantRequested.template(data(overrides)));
	return [message.text, message.html];
}

describe('grantRequested.template — what the donor is told when their fund has the request', () => {
	it('says the request is on its way to the organisation', () => {
		expect(grantRequested.template(data()).subject).toBe(
			'Your grant request to Hope Foundation is on its way'
		);
	});

	it('names the amount, formatted, in both arms', async () => {
		for (const arm of await arms()) expect(arm).toContain('USD 500.00');
	});

	/** the fund pays on its own timing, and a donor left wondering whether to chase it will. */
	it('says the fund pays the organisation directly and nothing more is needed', async () => {
		for (const arm of await arms()) {
			expect(arm).toContain('Your fund pays Hope Foundation directly, usually within a few weeks.');
			expect(arm).toContain('There is nothing more you need to do.');
		}
	});

	/**
	 * the gift was deducted when the donor funded their account; a mail from the organisation that
	 * reads like a receipt is a second deduction somebody claims.
	 */
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
			dedication: { label: 'In memory of', honoree: 'Grace Hopper' }
		})) {
			expect(arm).toContain('The gift is in memory of Grace Hopper.');
		}
		for (const arm of await arms()) expect(arm).not.toContain('The gift is');
	});

	/** fundraiser words only: the processor behind the fund's window is never the donor's business. */
	it('names no processor', async () => {
		const subject = grantRequested.template(data()).subject;
		for (const arm of [subject, ...(await arms())]) {
			expect(arm).not.toMatch(/chariot|dafpay/i);
		}
	});
});
