import { describe, expect, it } from 'vitest';
import { ENTRY_SOURCE_TYPES } from '../server/db/schema';
import { ENTRY_SOURCE_LABELS } from './sources';

describe('what a journal entry was posted because of', () => {
	it('has a word for every source there is', () => {
		// keyed by `EntrySourceType` rather than by `string`, so a sixth source is a type error here
		// rather than a raw `adjustment` rendered on the books screen by a `?? value` fallback —
		// the discipline `FORM_STATUS_LABELS` in ../forms/statuses.ts is under.
		expect(Object.keys(ENTRY_SOURCE_LABELS).sort()).toEqual([...ENTRY_SOURCE_TYPES].sort());
	});

	it('says what a fundraiser says, and never the column value', () => {
		// CLAUDE.md → Product surface: the schema models more than donations and its table names
		// show it; those names never reach a screen. asserted over every member rather than one, so
		// a sixth source added with its own name copied into the label is caught by the rule rather
		// than by whoever happens to read the map.
		expect(ENTRY_SOURCE_LABELS.adjustment).toBe('Correction');

		const labels = ENTRY_SOURCE_TYPES.map((source) => {
			const label = ENTRY_SOURCE_LABELS[source];
			// never the column value as the column spells it, and never a blank a screen would draw
			// as an empty cell.
			expect(label).not.toBe(source);
			expect(label.trim()).toBe(label);
			expect(label.length).toBeGreaterThan(0);
			return label;
		});

		// and no two sources read as one word. `donation` and `payment` are the pair that matters —
		// a gift is recorded when the donor authorises it and claimed when the processor settles it,
		// and an operator reconciling against a bank statement is reading for the second.
		expect(new Set(labels).size).toBe(ENTRY_SOURCE_TYPES.length);
	});
});
