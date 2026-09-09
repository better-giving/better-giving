import { describe, expect, it } from 'vitest';
import { PRE_UPGRADE_RESERVATION } from './reservation';
import { elementSnippet, formSnippet, runtimeSnippet } from './snippet';

// node pool: two strings, compared. what the two documented copies (README.md, DEPLOY.md) say is
// held in scripts/embed-snippet.spec.ts instead — an app-side spec, because packages/form/** reads
// nothing outside its own tree.

describe('the snippet an operator pastes', () => {
	it('carries the reservation that holds the element’s box before it upgrades', () => {
		expect(formSnippet('https://donate.example.org', 'frm_a8x2k9')).toContain(
			PRE_UPGRADE_RESERVATION
		);
	});

	it('loads the runtime from the origin it was asked about, and names the form', () => {
		const snippet = formSnippet('https://donate.example.org', 'frm_a8x2k9');

		expect(snippet).toContain('<script src="https://donate.example.org/embed.js" async></script>');
		expect(snippet).toContain('<bg-donate-form form="frm_a8x2k9"></bg-donate-form>');
	});
});

describe('the two halves a screen hands over one at a time', () => {
	it('are the pasted block when joined, so neither can be edited alone', () => {
		expect(`${runtimeSnippet('https://donate.example.org')}\n${elementSnippet('frm_a8x2k9')}`).toBe(
			formSnippet('https://donate.example.org', 'frm_a8x2k9')
		);
	});

	it('asks the once-per-page half for the runtime and the box, and for no form', () => {
		const half = runtimeSnippet('https://donate.example.org');

		expect(half).toContain('<script src="https://donate.example.org/embed.js" async></script>');
		expect(half).toContain(PRE_UPGRADE_RESERVATION);
		expect(half).not.toContain('frm_a8x2k9');
	});

	it('asks the placed half for the form alone, and for nothing a second one would repeat', () => {
		const half = elementSnippet('frm_a8x2k9');

		expect(half).toBe('<bg-donate-form form="frm_a8x2k9"></bg-donate-form>');
		expect(half).not.toContain('<script');
		expect(half).not.toContain('<style');
	});
});
