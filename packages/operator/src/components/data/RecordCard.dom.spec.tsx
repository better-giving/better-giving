import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { RecordCard } from './RecordCard.jsx';

// a record is a heading a reader jumps to and its origins under it. what a case here is about is
// what a card cannot decide for itself: which level the name is at, which depends on what stands
// above the list; what the run of identifiers under it is called; and which of the two readings of
// those origins the screen wants — named and read, or taken as presses at the foot.
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

	it('draws no mark, and the head every other screen draws, when the screen states none', () => {
		// the absent reading is what every screen mounting this card draws today: two things on a
		// baseline. it is asserted rather than assumed, because a modifier arriving unasked would
		// move all of them without a screen changing.
		const root = render(RecordCard, {
			title: 'General fund',
			titleAs: 'h2',
			originsLabel: 'Sites',
			emptyOrigins: 'None yet.',
			origins: ORIGINS
		});

		expect(root.querySelector('.adm-record__head')?.className).toBe('adm-record__head');
		expect(root.querySelector('.adm-record__mark')).toBeNull();
	});

	it('marks the head when the screen states a mark, and keeps the mark out of the tree', () => {
		// every record in a list that carries one carries the same glyph, so a reader told it on each
		// of twenty is told nothing twenty times. what names the record is the name.
		const root = render(RecordCard, {
			title: 'General fund',
			titleAs: 'h2',
			mark: 'form',
			originsLabel: 'Sites',
			emptyOrigins: 'None yet.',
			origins: ORIGINS
		});

		expect(root.querySelector('.adm-record__head')?.className).toBe(
			'adm-record__head adm-record__head--marked'
		);
		expect(root.querySelector('.adm-record__mark > svg')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('takes the origins as presses at the foot instead, with nothing naming them', () => {
		// the other reading, and what it drops is the point of it: no `<dl>`, no label and no
		// sentence for the empty case, because a run of presses is acted on rather than scanned for.
		// the list itself survives both readings — it is still a run a reader counts.
		const root = render(RecordCard, {
			title: 'General fund',
			titleAs: 'h2',
			foot: (
				<li>
					<button type="button">riverbank.org</button>
				</li>
			)
		});
		const list = root.querySelector('ul');

		expect(root.querySelector('dl')).toBeNull();
		expect(list?.className).toBe('adm-record__origins adm-record__foot');
		expect(list?.getAttribute('role')).toBe('list');
		expect(list?.getAttribute('aria-labelledby')).toBeNull();
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
