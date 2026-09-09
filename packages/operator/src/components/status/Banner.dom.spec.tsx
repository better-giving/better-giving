import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { Banner } from './Banner.jsx';

// a banner is drawn from copy a screen computes, and computed copy comes back blank. what a case
// here is about is what the band does when it does: a row it was given nothing for is a line of
// nothing at the height of a sentence, and a band holding two of them is a coloured box that says
// nothing at all. the tone, its mark and its role are the band itself and are drawn whatever it
// holds.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** the paragraphs the banner drew, by the class each wears. */
function rows(root: HTMLElement): (string | null)[] {
	return [...root.querySelectorAll('p')].map((p) => p.getAttribute('class'));
}

describe('a banner mounted into a document', () => {
	it('draws a row for the word and a row for the sentence it was given', () => {
		const root = render(Banner, {
			tone: 'blocker',
			word: 'Cards are refused',
			children: 'No Stripe secret key is set.'
		});

		expect(rows(root)).toEqual(['adm-banner__word', 'adm-banner__text']);
	});

	it('draws no row for a word it was not given', () => {
		const root = render(Banner, { tone: 'attention', children: 'The sentence stands alone.' });

		expect(rows(root)).toEqual(['adm-banner__text']);
	});

	it('draws no row for a sentence it was not given', () => {
		const root = render(Banner, { tone: 'blocker', word: 'Cards are refused' });

		expect(rows(root)).toEqual(['adm-banner__word']);
	});

	it('draws no rows at all where it was given neither', () => {
		// the band is still the tone's own and still announces itself; what it must not be is the
		// height of a two-line message with nothing on either line.
		const root = render(Banner, { tone: 'done' });

		expect(rows(root)).toEqual([]);
		expect(root.querySelector('.adm-banner__mark')).not.toBeNull();
		expect(root.querySelector('.adm-banner')?.getAttribute('role')).toBe('status');
	});
});
