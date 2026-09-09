import { describe, expect, it } from 'vitest';
import {
	EDITABLE_FORM_STATUSES,
	FORM_STATUSES,
	FORM_STATUS_LABELS,
	FORM_STATUS_NOTES
} from './statuses';

// node pool, no database: this module is a vocabulary and imports nothing.

describe('the form status vocabulary', () => {
	it('names every status a row can hold', () => {
		// totality is the claim, not the words. the maps are keyed by `FormStatus`, so a fourth
		// status is already a type error — what this catches is the array and the maps being
		// edited apart, which the compiler cannot see once a key is merely spare.
		expect(Object.keys(FORM_STATUS_LABELS).sort()).toEqual([...FORM_STATUSES].sort());
		expect(Object.keys(FORM_STATUS_NOTES).sort()).toEqual([...FORM_STATUSES].sort());
	});

	it('offers an operator draft and live, and never archived', () => {
		// `FORM_STATUSES` and `archived_at` are two representations of one fact, so a `<select>`
		// writing `archived` without the timestamp leaves a form that reads archived on a screen
		// and live to `readForms`. archiving is its own action against its own query.
		expect([...EDITABLE_FORM_STATUSES]).toEqual(['draft', 'live']);
	});

	it('says something extra about every status but the one that needs nothing said', () => {
		// `live` is the state the label already explains. the other two carry a sentence because
		// the label alone reads as an oversight: a snippet beside "Draft" looks unfinished, and a
		// screen showing "Archived" has to say why nothing on it can be edited.
		expect(FORM_STATUS_NOTES.live).toBe(null);
		expect(FORM_STATUS_NOTES.draft).toBeTypeOf('string');
		expect(FORM_STATUS_NOTES.archived).toBeTypeOf('string');
	});

	it('tells a draft form’s reader which status publishes it, in the word the screen offers', () => {
		// the note is the only place either screen says how a form goes live, and the word it names
		// has to be the one on the `<select>` — an operator told to choose a status that is not in
		// the list is being sent to look for a control that is not there. asserting the label rather
		// than the letters is what ties the two together: renaming the status renames both.
		//
		// wording is otherwise not this file's business. what is held is that the sentence names a
		// way out rather than only reporting that there is none.
		expect(FORM_STATUS_NOTES.draft).toContain(FORM_STATUS_LABELS.live);
	});
});
