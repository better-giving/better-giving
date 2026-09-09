import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import * as uncollected from './uncollected';
import type { UncollectedData } from './uncollected';

// pure, the same as the receipt: object literals in, a message out, no database in the file.

function data(overrides: Partial<UncollectedData> = {}): UncollectedData {
	return {
		legalName: 'Hope Foundation',
		donorName: 'Ada Lovelace',
		amountMinor: 10_000,
		currency: 'USD',
		...overrides
	};
}

/** renders, and hands back both arms. */
async function arms(overrides: Partial<UncollectedData> = {}): Promise<string[]> {
	const message = await renderEmail(uncollected.template(data(overrides)));
	return [message.text, message.html];
}

describe('uncollected.template — what the donor is told', () => {
	/**
	 * the two facts the message is about, in both arms — the plain-text one is what some clients
	 * render and it has to carry the same message rather than a stub of it.
	 */
	it.each([
		{ element: 'the organisation', text: 'Hope Foundation' },
		{ element: 'the amount', text: 'USD 100.00' }
	])('names $element in both arms', async ({ text }) => {
		for (const arm of await arms()) expect(arm).toContain(text);
	});

	/**
	 * the sentence the whole message exists for. a donor who reads "your gift was not collected"
	 * and is not told the money stayed put has been given a reason to go looking at their
	 * statement — and on the one rail that reaches this template, a bank debit, that is exactly
	 * the fear an unexplained failure produces.
	 */
	it('says plainly that nothing was charged', async () => {
		for (const arm of await arms()) expect(arm).toContain('Nothing was charged');
	});

	/**
	 * the one rail that reaches this template is a bank debit, and naming it is the explanation:
	 * "your payment did not go through" leaves a donor guessing which card it was.
	 */
	it('names the bank debit as what did not complete', async () => {
		for (const arm of await arms()) expect(arm).toContain('bank debit');
	});

	/**
	 * the form is served on a site this code cannot name — the donation page this project deploys
	 * is one address a gift may have come from and the org's own sites are the rest, and nothing on
	 * the row says which — so every URL this message could carry would be one somebody invented. an
	 * origin off the form record is not a substitute: it is an attribution signal rather than an
	 * address the donor was on, and a gift given on the donation page carries none at all.
	 *
	 * the claim is that the message has no anchor and no address of its own. it is not that the
	 * string `http` is absent from the markup: the doctype react-email writes carries the W3C's
	 * own URL, and that is the shell rather than anything this template said.
	 */
	it('carries no link at all', async () => {
		const [text, html] = await arms();
		expect(text).not.toContain('http');
		for (const arm of [text, html]) {
			expect(arm).not.toContain('<a ');
			expect(arm).not.toContain('href=');
		}
	});

	/**
	 * a donor told a payment failed and left there will assume the failure is theirs to fix. it
	 * is not: this deployment cannot re-run a bank debit, and nothing is owed.
	 */
	it('closes the matter rather than leaving the donor holding it', async () => {
		for (const arm of await arms()) expect(arm).toContain('There is nothing you need to do');
	});

	it('addresses the donor by name, and greets neutrally without one', async () => {
		expect((await arms())[0]).toContain('Dear Ada Lovelace,');
		for (const arm of await arms({ donorName: null })) {
			expect(arm).toContain('Hello,');
			expect(arm).not.toContain('null');
		}
	});
});
