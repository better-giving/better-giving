import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import * as matchPack from './match-pack';
import type { MatchPackData } from './match-pack';

// pure, the same as the receipt: object literals in, a message out, no database in the file.

const URL = 'https://giving.example.org/gift/7Qk3-mVx9Lr2NpA4';

function data(overrides: Partial<MatchPackData> = {}): MatchPackData {
	return {
		donorName: 'Maya Reyes',
		employer: 'Northwind Logistics',
		filer: {
			legalName: 'Greenfield Community Food Bank, Inc.',
			ein: '84-2761093',
			address: '1250 Mill Street, Suite 200, Cincinnati, OH 45202, United States'
		},
		amountMinor: 15_000,
		currency: 'USD',
		givenAt: new Date('2026-11-12T15:00:00Z'),
		receiptSentAt: new Date('2026-11-12T15:01:00Z'),
		giftPageUrl: URL,
		reminds: true,
		...overrides
	};
}

/** renders, and hands back both arms. */
async function arms(overrides: Partial<MatchPackData> = {}): Promise<[text: string, html: string]> {
	const message = await renderEmail(matchPack.template(data(overrides)));
	return [message.text, message.html];
}

describe('matchPack.template — the details a donor files with their employer', () => {
	it('asks the employer by name in the subject', () => {
		expect(matchPack.template(data()).subject).toBe(
			'Details to ask Northwind Logistics to match your gift'
		);
	});

	it('says what it says in the order the copy settles, in both arms', async () => {
		const [text, html] = await arms();
		const sentences = [
			'Details to ask Northwind Logistics to match your gift',
			'Dear Maya,',
			'Thank you for naming your employer. If Northwind Logistics matches gifts, you claim the ' +
				'match yourself through its giving portal.',
			'Here is what the portal will ask for:',
			'When you have filed, mark it on your gift page so we stop reminding you:',
			'We will remind you once, in three days, if it isn'
		];
		for (const arm of [text, html]) {
			let from = -1;
			for (const sentence of sentences) {
				const at = arm.indexOf(sentence, from + 1);
				expect(at, sentence).toBeGreaterThan(from);
				from = at;
			}
		}
		expect(text).toContain(
			"We can't say whether it matches or how much; its portal or HR team can."
		);
		expect(text).toContain(`so we stop reminding you: ${URL}`);
		expect(html).toContain(`<a href="${URL}"`);
	});

	it('promises no reminder, and asks to mark the gift filed, where none will be sent', async () => {
		const [text, html] = await arms({ reminds: false });
		for (const arm of [text, html]) {
			expect(arm).not.toMatch(/remind/i);
			expect(arm).toContain('When you have filed, mark it on your gift page:');
		}
		expect(text).toContain(`mark it on your gift page: ${URL}`);
	});

	it('states the filing details with the nonprofit as the filer, in both arms', async () => {
		const [text, html] = await arms();
		expect(text).toContain('Nonprofit    Greenfield Community Food Bank, Inc.');
		expect(text).toContain('EIN          84-2761093');
		expect(text).toContain(
			'Address      1250 Mill Street, Suite 200, Cincinnati, OH 45202, United States'
		);
		expect(text).toContain('Gift amount  USD 150.00');
		expect(text).toContain('Gift date    November 12, 2026');
		expect(text).toContain('Receipt      Emailed to you on November 12, 2026');
		for (const label of ['Nonprofit', 'EIN', 'Address', 'Gift amount', 'Gift date', 'Receipt']) {
			expect(html).toContain(`>${label}</td>`);
		}
		expect(html).toContain('<strong>USD 150.00</strong>');
	});

	/**
	 * the frame (u0iJjljOBA) sets every label on one line and at the top of its row, so a value that
	 * wraps — the legal name, the address — hangs under its label rather than centring against it.
	 */
	it('keeps each label on one line, at the top of its row', async () => {
		const [, html] = await arms();
		const label = /<td style="([^"]*)">Gift amount<\/td>/.exec(html);
		expect(label?.[1]).toContain('white-space:nowrap');
		expect(label?.[1]).toContain('vertical-align:top');
		const value = /<td style="([^"]*)">1250 Mill Street/.exec(html);
		expect(value?.[1]).toContain('vertical-align:top');
	});

	/** never invent an address: a profile without one drops the row in both arms. */
	it('leaves the address row out when the profile holds no mailing address', async () => {
		const [text, html] = await arms({ filer: { ...data().filer, address: null } });
		for (const arm of [text, html]) {
			expect(arm).not.toContain('Address');
			expect(arm).toContain('84-2761093');
			expect(arm).toContain('USD 150.00');
		}
	});

	it('leaves the receipt row out when no receipt has gone out', async () => {
		for (const arm of await arms({ receiptSentAt: null })) {
			expect(arm).not.toContain('Emailed to you');
			expect(arm).toContain('November 12, 2026');
		}
	});

	it('escapes the employer the donor typed', async () => {
		const [, html] = await arms({ employer: '<img src=x onerror=alert(1)> & Co' });
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; Co');
	});

	it('keeps line breaks out of the subject and the body', async () => {
		const employer = 'Northwind\r\nBcc: everyone@example.org\nLogistics';
		const message = await renderEmail(matchPack.template(data({ employer })));
		expect(message.subject).toBe(
			'Details to ask Northwind Bcc: everyone@example.org Logistics to match your gift'
		);
		expect(message.subject).not.toMatch(/[\r\n]/);
		expect(message.text).toContain('If Northwind Bcc: everyone@example.org Logistics matches');
	});

	it('cuts the employer at 60 characters in the subject and 200 in the body', async () => {
		const employer = `${'A'.repeat(250)}Z`;
		const message = await renderEmail(matchPack.template(data({ employer })));
		expect(message.subject).toBe(`Details to ask ${'A'.repeat(59)}… to match your gift`);
		expect(message.text).toContain(`If ${'A'.repeat(199)}… matches gifts`);
		expect(message.html).not.toContain('Z');
	});

	/**
	 * only the employer's own portal knows; a mail that guessed would be quoted back. read off the
	 * text arm, which carries every sentence the html arm does and none of its markup.
	 */
	it.each(['ratio', 'deadline', '%', 'up to', 'double'])('never says "%s"', async (word) => {
		const [text] = await arms();
		expect(text.toLowerCase()).not.toContain(word);
	});
});
