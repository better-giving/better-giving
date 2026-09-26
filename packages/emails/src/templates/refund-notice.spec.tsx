import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import * as refundNotice from './refund-notice';
import type { RefundNoticeData } from './refund-notice';

// pure, the same as the receipt: object literals in, a message out, no database in the file.

function data(overrides: Partial<RefundNoticeData> = {}): RefundNoticeData {
	return {
		legalName: 'Hope Foundation',
		donorName: 'Ada Lovelace',
		giftMinor: 10_000,
		givenAt: new Date('2026-08-03T12:00:00Z'),
		refundedMinor: 2_500,
		remainingMinor: 7_500,
		deductibleMinor: 7_500,
		currency: 'USD',
		...overrides
	};
}

/** renders, and hands back both arms. */
async function arms(overrides: Partial<RefundNoticeData> = {}): Promise<string[]> {
	const message = await renderEmail(refundNotice.template(data(overrides)));
	return [message.text, message.html];
}

describe('refundNotice.template — what the donor is told of a refund', () => {
	/**
	 * the two figures the notice exists for, in both arms: the plain-text one is what some clients
	 * render, and it carries the same message rather than a stub of it.
	 */
	it('names the amount refunded and the amount now deductible, in both arms', async () => {
		for (const arm of await arms()) {
			expect(arm).toContain('We have refunded USD 25.00 of your gift');
			expect(arm).toContain('the deductible amount of this gift is now USD 75.00');
		}
	});

	/**
	 * zero is printed rather than left out. a donor holding a receipt for the whole gift reads the
	 * figure that replaces it, and "nothing" said as a number is the one they cannot misread.
	 */
	it('names a full refund as one, and zero as what is now deductible', async () => {
		const full = { refundedMinor: 10_000, remainingMinor: 0, deductibleMinor: 0 };
		expect(refundNotice.template(data(full)).subject).toBe(
			'Your gift to Hope Foundation has been refunded'
		);
		for (const arm of await arms(full)) {
			expect(arm).toContain('We have refunded your gift of USD 100.00');
			expect(arm).toContain('the deductible amount of this gift is now USD 0.00');
		}
	});

	it('says in the subject when only part of the gift was refunded', () => {
		expect(refundNotice.template(data()).subject).toBe(
			'Part of your gift to Hope Foundation has been refunded'
		);
	});

	/**
	 * the subject reads what is left of the gift, never what is deductible: a gift with a part that
	 * was never deductible has nothing deductible long before nothing is left of it.
	 */
	it('says part of the gift was refunded while some is left, though none of it is deductible', () => {
		const partOfAPartlyDeductibleGift = {
			refundedMinor: 8_000,
			remainingMinor: 2_000,
			deductibleMinor: 0
		};
		expect(refundNotice.template(data(partOfAPartlyDeductibleGift)).subject).toBe(
			'Part of your gift to Hope Foundation has been refunded'
		);
	});

	/**
	 * a gift refunded in parts: each notice names the part it is about, never the running total,
	 * and the last one takes what is deductible to zero.
	 */
	it('names only its own part when the last of a gift is refunded', async () => {
		const last = { refundedMinor: 7_500, remainingMinor: 0, deductibleMinor: 0 };
		expect(refundNotice.template(data(last)).subject).toBe(
			'Your gift to Hope Foundation has been refunded'
		);
		for (const arm of await arms(last)) {
			expect(arm).toContain('We have refunded USD 75.00 of your gift of USD 100.00');
			expect(arm).toContain('the deductible amount of this gift is now USD 0.00');
		}
	});

	/** a donor who gave more than once has to be able to tell which gift this is. */
	it('names the gift by its amount and the day it was made', async () => {
		for (const arm of await arms()) {
			expect(arm).toContain('your gift of USD 100.00, made on August 3, 2026');
		}
	});

	/**
	 * the receipt the donor already holds names the whole gift, and it is the document they file.
	 * this notice is not a second receipt; it tells them which figure now stands in its place.
	 */
	it('tells the donor this figure replaces the one on their receipt', async () => {
		for (const arm of await arms()) {
			expect(arm).toContain('Use this amount in place of the one on your original receipt.');
		}
	});

	it('names the organisation it comes from, in both arms', async () => {
		for (const arm of await arms()) expect(arm).toContain('Hope Foundation');
	});

	it('addresses the donor by name, and greets neutrally without one', async () => {
		expect((await arms())[0]).toContain('Dear Ada Lovelace,');
		for (const arm of await arms({ donorName: null })) {
			expect(arm).toContain('Hello,');
			expect(arm).not.toContain('null');
		}
	});

	/** the refund was the organisation's to make and it is made; the donor is left holding nothing. */
	it('closes the matter rather than leaving the donor holding it', async () => {
		for (const arm of await arms()) expect(arm).toContain('There is nothing you need to do');
	});

	/**
	 * no address this message could carry is one the deployment knows the donor was on, the same
	 * as ./uncollected.spec.tsx argues. the doctype's W3C URL is the shell's, not the template's.
	 */
	it('carries no link at all', async () => {
		const [text, html] = await arms();
		expect(text).not.toContain('http');
		for (const arm of [text, html]) {
			expect(arm).not.toContain('<a ');
			expect(arm).not.toContain('href=');
		}
	});

	/** the words the books use for this are not the words a donor reads (CLAUDE.md, Product surface). */
	it.each(['reversal', 'ledger', 'minor units', 'payment', 'constituent'])(
		'never says "%s"',
		async (word) => {
			for (const arm of await arms()) expect(arm.toLowerCase()).not.toContain(word);
		}
	);
});
