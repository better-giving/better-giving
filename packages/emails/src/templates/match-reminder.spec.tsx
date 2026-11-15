import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import * as matchReminder from './match-reminder';
import type { MatchReminderData } from './match-reminder';

// pure, the same as the receipt: object literals in, a message out, no database in the file.

const URL = 'https://giving.example.org/gift/7Qk3-mVx9Lr2NpA4';

function data(overrides: Partial<MatchReminderData> = {}): MatchReminderData {
	return {
		displayName: 'Greenfield Food Bank',
		donorName: 'Maya Reyes',
		employer: 'Northwind Logistics',
		amountMinor: 15_000,
		currency: 'USD',
		givenAt: new Date('2026-11-12T15:00:00Z'),
		giftPageUrl: URL,
		...overrides
	};
}

/** renders, and hands back both arms. */
async function arms(
	overrides: Partial<MatchReminderData> = {}
): Promise<[text: string, html: string]> {
	const message = await renderEmail(matchReminder.template(data(overrides)));
	return [message.text, message.html];
}

describe('matchReminder.template — the one reminder to file', () => {
	/** the display name, not the legal one: this is a nudge, not a filing document. */
	it('asks after the gift by the organisation’s display name in the subject', () => {
		expect(matchReminder.template(data()).subject).toBe(
			'Did you file the match for your gift to Greenfield Food Bank?'
		);
	});

	it('says what it says in the order the copy settles, in both arms', async () => {
		const [text, html] = await arms();
		const sentences = [
			'Did you file the match for your gift to Greenfield Food Bank?',
			'Dear Maya,',
			'You told us Northwind Logistics may match your USD 150.00 gift from November 12, 2026.',
			'If you already filed, mark it there and we won',
			'This is the only reminder we will send.'
		];
		for (const arm of [text, html]) {
			let from = -1;
			for (const sentence of sentences) {
				const at = arm.indexOf(sentence, from + 1);
				expect(at, sentence).toBeGreaterThan(from);
				from = at;
			}
		}
		expect(text).toContain(`If you haven't filed yet, the details are on your gift page: ${URL}`);
		expect(text).toContain("we won't write again.");
		expect(html).toContain(`<a href="${URL}"`);
	});

	it('escapes the employer the donor typed', async () => {
		const [, html] = await arms({ employer: '<b>Northwind</b> & Co' });
		expect(html).not.toContain('<b>Northwind');
		expect(html).toContain('&lt;b&gt;Northwind&lt;/b&gt; &amp; Co');
	});

	it('caps the employer at 200 characters and keeps it on one line', async () => {
		const [text] = await arms({ employer: `North\r\nwind ${'A'.repeat(250)}` });
		expect(text).toContain(`You told us North wind ${'A'.repeat(188)}… may match`);
	});

	it('keeps line breaks out of the subject', () => {
		expect(matchReminder.template(data({ displayName: 'Greenfield\r\nFood Bank' })).subject).toBe(
			'Did you file the match for your gift to Greenfield Food Bank?'
		);
	});

	it.each(['ratio', 'deadline', '%', 'up to', 'double'])('never says "%s"', async (word) => {
		const [text] = await arms();
		expect(text.toLowerCase()).not.toContain(word);
	});
});
