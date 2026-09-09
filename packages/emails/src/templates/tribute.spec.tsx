import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import * as tribute from './tribute';
import type { TributeData } from './tribute';

// pure, the same as the receipt: object literals in, a message out, no database in the file.

function data(overrides: Partial<TributeData> = {}): TributeData {
	return {
		legalName: 'Hope Foundation',
		notifyName: 'Margaret Chen',
		donorName: 'Ada Lovelace',
		tribute: { label: 'In memory of', honoree: 'Grace Hopper' },
		...overrides
	};
}

/** renders both arms. */
function rendered(overrides: Partial<TributeData> = {}) {
	return renderEmail(tribute.template(data(overrides)));
}

/** every case must hold in both arms — a claim about the text alone proves half a message. */
async function arms(overrides: Partial<TributeData> = {}): Promise<string[]> {
	const message = await rendered(overrides);
	return [message.text, message.html];
}

describe('tribute.template — what the family is told', () => {
	/**
	 * the subject is the whole message to somebody reading an inbox list, and the honoree's name is
	 * what makes it land as being about them rather than about a charity they have never heard of.
	 */
	it.each([
		{ kind: 'a gift in memory', label: 'In memory of', subject: 'in memory of Grace Hopper' },
		{ kind: 'a gift in honor', label: 'In honor of', subject: 'in honor of Grace Hopper' }
	])('names $kind and its honoree in the subject', async ({ label, subject }) => {
		const message = await rendered({ tribute: { label, honoree: 'Grace Hopper' } });
		expect(message.subject).toBe(`A gift was made ${subject}`);
	});

	/**
	 * the phrase arrives worded for the head of a receipt row and both of its uses here are inside a
	 * sentence, so the capital comes down and the words stay the caller's. asserted against the
	 * capitalised form as well: a template that stopped lowering it would still print a true
	 * sentence, one word into the middle of it, and nothing else in the suite would notice.
	 */
	it.each([
		{ kind: 'in memory', label: 'In memory of', phrase: 'in memory of Grace Hopper' },
		{ kind: 'in honor', label: 'In honor of', phrase: 'in honor of Grace Hopper' }
	])('words $kind into both sentences, in both arms', async ({ label, phrase }) => {
		for (const arm of await arms({ tribute: { label, honoree: 'Grace Hopper' } })) {
			expect(arm).toContain(`A gift was made ${phrase}`);
			expect(arm).toContain(
				`A gift ${phrase} was made to Hope Foundation by Ada Lovelace, who asked that you be told.`
			);
			expect(arm).not.toContain(label);
		}
	});

	/**
	 * the two facts the message is about, in both arms — the plain-text one is what some clients
	 * render and it has to carry the same message rather than a stub of it.
	 */
	it.each([
		{ element: 'the honoree', text: 'Grace Hopper' },
		{ element: 'the organisation', text: 'Hope Foundation' }
	])('names $element in both arms', async ({ text }) => {
		for (const arm of await arms()) expect(arm).toContain(text);
	});

	/**
	 * addressed to the person the donor named, and not to the donor. this is the one mail this
	 * deployment sends to somebody who never gave it an address, and a greeting that got the wrong
	 * name on it is the whole message read as a mistake.
	 */
	it('greets the person the donor asked us to tell', async () => {
		for (const arm of await arms({ notifyName: 'Robert Chen' })) {
			expect(arm).toContain('Dear Robert Chen,');
		}
	});

	/**
	 * a gift with nobody's name on it is still a gift somebody was asked to be told about, so the
	 * donor's absence takes a word rather than the message.
	 */
	it('says "the donor" where the gift names nobody', async () => {
		for (const arm of await arms({ donorName: null })) {
			expect(arm).toContain('was made to Hope Foundation by the donor');
			expect(arm).not.toContain('null');
		}
	});

	/**
	 * the reader is not a donor, has no account, and owes nobody anything — so the message closes
	 * the matter rather than leaving them wondering what is expected of them.
	 */
	it('closes the matter rather than leaving the reader holding it', async () => {
		for (const arm of await arms()) expect(arm).toContain('There is nothing you need to do.');
	});

	/**
	 * the family is told the gift happened, not what it cost. a figure turns a condolence into a
	 * statement of account, and the amount is the donor's business with the organisation.
	 *
	 * the text arm carries no digit at all, which is the strong form of the claim. the HTML arm is
	 * swept with the styles and react's own comment markers taken off first: the shell spells
	 * lengths into every style attribute and writes a literal `$` into a suspense marker, and
	 * neither is anything this template said. what is left is the content, and ../format.ts spells
	 * money into it as a code and a figure — `USD 100.00`, never a symbol.
	 */
	it('carries no figure, in either arm', async () => {
		const { text, html } = await rendered();
		expect(text).not.toMatch(/\d/);
		const content = html.replace(/<!--.*?-->/g, '').replace(/ style="[^"]*"/g, '');
		for (const arm of [text, content]) {
			expect(arm).not.toMatch(/[$€£¥]/);
			expect(arm).not.toMatch(/\b[A-Z]{3}\s\d/);
		}
	});

	/**
	 * and it carries no way to state one. the case is structural rather than about the rendered
	 * words, so that a field added for an amount — or for a note the donor wrote to the
	 * organisation — fails here rather than printing.
	 */
	it('carries no field for an amount or for the donor’s note', () => {
		const keys = Object.keys(data());
		expect(keys.filter((key) => /amount|minor|currency|total|note|message/i.test(key))).toEqual([]);
	});

	/** who sent it, under the rule, the way every other notice in this package closes. */
	it('closes with the organisation under the rule', async () => {
		const { html } = await rendered();
		const rule = html.indexOf('<hr');
		expect(rule).toBeGreaterThan(-1);
		expect(html.slice(rule)).toContain('Hope Foundation');
	});

	/**
	 * every name on this message was typed into a public, unauthenticated form — the donor's, the
	 * honoree's, and the name of the person being written to.
	 */
	it('escapes every name typed into the form', async () => {
		const message = await rendered({
			notifyName: '<script>alert(1)</script>',
			donorName: 'Smith & Sons',
			tribute: { label: 'In memory of', honoree: '<b>Grace</b>' }
		});
		expect(message.html).not.toContain('<script>');
		expect(message.html).toContain('Smith &amp; Sons');
		expect(message.html).toContain('&lt;b&gt;Grace&lt;/b&gt;');
	});
});
