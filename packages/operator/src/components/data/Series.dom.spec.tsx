import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { Series } from './Series.jsx';

// a year of a count, drawn as a shape. what a case here is about is the one thing this part
// computes rather than takes: a column's height is its share of the tallest column in the run, so
// the run decides the shape and the room it was drawn in never does.
//
// none of that shape is visible to this pool and none of it needs to be — ../../../vitest.config.ts
// renders into happy-dom, which lays nothing out. what is asserted is the markup that decides it:
// how many columns there are, the height written on each fill, and which fills are hidden. the
// sheet that draws them is ../../styles/adm.css.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** a twelve-month run whose tallest month is neither its first nor its last. */
const YEAR = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 40, 10];

/** the fills the series drew, in month order. */
function fills(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>('.adm-series__fill')];
}

/** the height written on each fill, in month order. */
function heights(root: HTMLElement): string[] {
	return fills(root).map((fill) => fill.style.blockSize);
}

describe('a year of a count mounted into a document', () => {
	it('draws a column for every month it was given', () => {
		const root = render(Series, {
			label: 'New donors, last 12 months',
			points: YEAR,
			first: 'Oct 2025',
			last: 'Sep 2026'
		});

		expect(root.querySelectorAll('.adm-series__col')).toHaveLength(12);
	});

	it('gives the tallest month the whole plot and every other its share of that month', () => {
		// the shape is the counts against each other and never against a figure stated anywhere:
		// a run of the same twelve numbers doubled draws the same series.
		const root = render(Series, {
			label: 'New donors, last 12 months',
			points: YEAR,
			first: 'Oct 2025',
			last: 'Sep 2026'
		});

		expect(heights(root)).toEqual([
			'5%',
			'10%',
			'15%',
			'20%',
			'25%',
			'30%',
			'35%',
			'40%',
			'45%',
			'50%',
			'100%',
			'25%'
		]);
	});

	it('keeps a month with nothing in it as a track and hides only its fill', () => {
		// a column dropped for an empty month is a gap in the run, and the run is what says which
		// month is which: the track stays and the band inside it goes.
		const root = render(Series, {
			label: 'New donors, last 12 months',
			points: [3, 0, 6],
			first: 'Jul 2026',
			last: 'Sep 2026'
		});

		expect(root.querySelectorAll('.adm-series__col')).toHaveLength(3);
		expect(fills(root).map((fill) => fill.hidden)).toEqual([false, true, false]);
	});

	it('draws a flat year as twelve empty tracks rather than as nothing at all', () => {
		// a deployment that took no gift all year has a series, and it is the answer: an absent
		// shape reads as a screen that failed to draw one. the tallest month is held at one so the
		// share every month takes is nought rather than a division nobody can write down.
		const root = render(Series, {
			label: 'New donors, last 12 months',
			points: Array(12).fill(0),
			first: 'Oct 2025',
			last: 'Sep 2026'
		});

		expect(root.querySelectorAll('.adm-series__col')).toHaveLength(12);
		expect(fills(root).every((fill) => fill.hidden)).toBe(true);
		expect(heights(root)).toEqual(Array(12).fill('0%'));
	});

	it('labels the two ends of the run and no month between them', () => {
		const root = render(Series, {
			label: 'New donors, last 12 months',
			points: YEAR,
			first: 'Oct 2025',
			last: 'Sep 2026'
		});

		expect([...root.querySelectorAll('.adm-caption')].map((m) => m.textContent)).toEqual([
			'Oct 2025',
			'Sep 2026'
		]);
	});

	it('states what the run is a count of', () => {
		const root = render(Series, {
			label: 'New donors, last 12 months',
			points: YEAR,
			first: 'Oct 2025',
			last: 'Sep 2026'
		});

		expect(root.querySelector('.adm-stated__label')?.textContent).toBe(
			'New donors, last 12 months'
		);
	});
});
