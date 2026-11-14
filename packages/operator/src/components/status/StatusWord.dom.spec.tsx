import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { Mark } from './Mark.jsx';
import { StatusWord } from './StatusWord.jsx';

// the momentary word's mark, when the caller hands none. each register draws its own, and a
// refusal that draws the check says the press worked. what is compared is the glyph a bare
// ./Mark.jsx draws for the name, so a case reads the same drawing a reader sees rather than a class
// the icon set happens to write.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** the glyph the word drew. */
function glyph(root: HTMLElement): string {
	const found = root.querySelector('.adm-momentary svg');
	if (found === null) throw new Error('the word drew no mark');
	return found.innerHTML;
}

/** the glyph ./Mark.jsx draws for `name` on its own. */
function markFor(name: 'check' | 'info' | 'triangle-alert' | 'clock'): string {
	const found = render(Mark, { name }).querySelector('svg');
	if (found === null) throw new Error(`no mark was drawn for ${name}`);
	return found.innerHTML;
}

describe('a momentary word with no mark handed in', () => {
	it('draws the check when the press was done', () => {
		const root = render(StatusWord, { register: 'momentary', children: 'Saved' });

		expect(glyph(root)).toBe(markFor('check'));
	});

	it('draws the triangle when the press was refused, never the check', () => {
		const root = render(StatusWord, {
			register: 'momentary',
			blocked: true,
			children: 'Not paused'
		});

		expect(glyph(root)).toBe(markFor('triangle-alert'));
		expect(glyph(root)).not.toBe(markFor('check'));
	});

	it('draws the info mark when the press changed nothing', () => {
		const root = render(StatusWord, {
			register: 'momentary',
			neutral: true,
			children: 'Already running'
		});

		expect(glyph(root)).toBe(markFor('info'));
	});

	it('draws the mark it is handed over the register’s own', () => {
		const root = render(StatusWord, {
			register: 'momentary',
			blocked: true,
			mark: 'clock',
			children: 'Timed out'
		});

		expect(glyph(root)).toBe(markFor('clock'));
	});
});

describe('a descriptive word', () => {
	const drawn = (props: Record<string, unknown>) =>
		render(StatusWord, { children: 'Live', ...props }).firstElementChild?.className;

	it('is the registry’s neutral badge when it carries no tone', () => {
		expect(drawn({})).toBe('ds-badge ds-badge-neutral');
	});

	it('is the badge in each tone’s variant, done the accent’s chip and never the success one', () => {
		expect(
			(['done', 'attention', 'blocker', 'note'] as const).map((tone) => drawn({ tone }))
		).toEqual([
			'ds-badge ds-badge-primary',
			'ds-badge ds-badge-warning',
			'ds-badge ds-badge-destructive',
			// an ended record is the registry's outline chip, with no ground, so it is told from one at
			// rest (../../styles/state-in-a-cell.spec.ts).
			'ds-badge ds-badge-outline'
		]);
	});

	it('draws the quiet word as the registry’s quiet chip and the unset word as the neutral one', () => {
		expect([drawn({ secondary: true }), drawn({ unset: true })]).toEqual([
			'ds-badge ds-badge-quiet',
			'ds-badge ds-badge-neutral'
		]);
	});
});
