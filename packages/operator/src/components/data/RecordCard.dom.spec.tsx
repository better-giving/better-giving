import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { RecordCard } from './RecordCard.jsx';

// a record is a heading a reader jumps to and one labelled value under it. what a case here is
// about is the two things a card cannot decide for itself: which level the name is at, which
// depends on what stands above the list, and what the run of identifiers under it is called.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

const ORIGINS = ['riverbank.org', 'give.riverbank.org'];

describe('a record card mounted into a document', () => {
	it('opens the name at the level the screen states', () => {
		// a record standing directly under a page's own `h1` is at level 2, and the same card inside
		// a section is not — so the level is the screen's and a card that picked one would be wrong
		// on every screen but the one it was written for.
		const root = render(RecordCard, {
			title: 'General fund',
			titleAs: 'h2',
			originsLabel: 'Sites',
			emptyOrigins: 'None yet.',
			origins: ORIGINS
		});

		expect(root.querySelector('.adm-record__title')?.tagName).toBe('H2');
	});

	it('opens it at another level on a screen that states another', () => {
		const root = render(RecordCard, {
			title: 'General fund',
			titleAs: 'h4',
			originsLabel: 'Sites',
			emptyOrigins: 'None yet.',
			origins: ORIGINS
		});

		expect(root.querySelector('.adm-record__title')?.tagName).toBe('H4');
	});

	it('names the run of origins and keeps it reported as a list', () => {
		// the role is not decoration: ../../styles/base.css takes `list-style` off every list and
		// `.adm-record__origins` lays the items out as a flex row, and either on its own is enough
		// for a browser to stop reporting how many there are.
		const root = render(RecordCard, {
			title: 'General fund',
			titleAs: 'h2',
			originsLabel: 'Sites',
			emptyOrigins: 'None yet.',
			origins: ORIGINS
		});
		const list = root.querySelector('ul');

		expect(list?.getAttribute('role')).toBe('list');
		expect(root.querySelector(`#${list?.getAttribute('aria-labelledby')}`)?.textContent).toBe(
			'Sites'
		);
		expect(list?.querySelectorAll('li')).toHaveLength(2);
	});

	it('says in words that a record no site may use yet has none', () => {
		// a blank value beside a label reads as a screen that failed to load one.
		const root = render(RecordCard, {
			title: 'General fund',
			titleAs: 'h2',
			originsLabel: 'Sites',
			emptyOrigins: 'None yet.'
		});

		expect(root.querySelector('ul')).toBeNull();
		expect(root.querySelector('.adm-setting__value')?.textContent).toBe('None yet.');
	});

	it('speaks the status word in the register the screen states', () => {
		// Live is the word somebody scanning a list is looking for, so Draft is the quieter of the
		// two — and which is which is the screen's, not this card's.
		const root = render(RecordCard, {
			title: 'General fund',
			titleAs: 'h2',
			originsLabel: 'Sites',
			emptyOrigins: 'None yet.',
			state: 'Draft',
			secondary: true
		});

		expect(root.querySelector('.adm-record__head > span')?.getAttribute('class')).toBe(
			'adm-state adm-state--secondary'
		);
	});
});
