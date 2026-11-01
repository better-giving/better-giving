import { describe, expect, it } from 'vitest';
import { amountsChanged, programChanged, storyKey, textsChanged, ticksChanged } from './changed';

// a card offers its Save only where its save would write something: each box is compared as the
// save stores it, so a box that only looks different is no change.

describe('an amount box', () => {
	it('is no change written another way', () => {
		expect(
			amountsChanged({ min_minor: '1000' }, { min_minor: '1,000.00' }, ['min_minor'], 'USD')
		).toBe(false);
	});

	it('is a change at another amount, and where it reads as none', () => {
		expect(amountsChanged({ min_minor: '10' }, { min_minor: '11' }, ['min_minor'], 'USD')).toBe(
			true
		);
		expect(amountsChanged({ min_minor: '10' }, { min_minor: 'ten' }, ['min_minor'], 'USD')).toBe(
			true
		);
	});

	it('compares a list as stored: blanks and repeats dropped, order kept', () => {
		const seed = { suggested_amounts: ['25', '50'] };
		expect(
			amountsChanged(
				seed,
				{ suggested_amounts: ['25.00', '', '50', '25'] },
				['suggested_amounts'],
				'USD'
			)
		).toBe(false);
		expect(
			amountsChanged(seed, { suggested_amounts: ['50', '25'] }, ['suggested_amounts'], 'USD')
		).toBe(true);
	});
});

describe('a checkbox', () => {
	it('reads conform’s `on` and a seed’s boolean alike', () => {
		expect(ticksChanged({ dedication_on: true }, { dedication_on: 'on' }, ['dedication_on'])).toBe(
			false
		);
		expect(ticksChanged({ dedication_on: true }, {}, ['dedication_on'])).toBe(true);
	});
});

describe('a text box', () => {
	it('is no change trimmed, nor emptied against an empty seed', () => {
		expect(
			textsChanged({ share_message: 'Hi' }, { share_message: ' Hi ' }, ['share_message'])
		).toBe(false);
		expect(textsChanged({ share_message: '' }, {}, ['share_message'])).toBe(false);
	});
});

describe('the program group', () => {
	it('ignores the id a hidden select holds while the mode pins none', () => {
		expect(
			programChanged(
				{ program_mode: 'none', program_id: '' },
				{ program_mode: 'none', program_id: 'p1' }
			)
		).toBe(false);
	});

	it('is a change of mode, or of the program pinned', () => {
		expect(
			programChanged({ program_mode: 'none', program_id: '' }, { program_mode: 'choice' })
		).toBe(true);
		expect(
			programChanged(
				{ program_mode: 'pinned', program_id: 'p1' },
				{ program_mode: 'pinned', program_id: 'p2' }
			)
		).toBe(true);
	});
});

describe('a description', () => {
	it('reads two spellings of one document as one', () => {
		const text = { type: 'text' as const, text: 'Warm coats' };
		expect(storyKey({ type: 'doc', content: [{ type: 'paragraph', content: [text] }] })).toBe(
			storyKey({ content: [{ content: [text], type: 'paragraph' }], type: 'doc' } as never)
		);
	});
});
