import { describe, expect, it } from 'vitest';
import { FORM_FIELD_LABELS, FORM_INPUT_FIELDS, FORM_LIST_FIELDS, FORM_TEXT_FIELDS } from './fields';

// node pool, no database: this module is a vocabulary and imports nothing.

describe('the form field vocabulary', () => {
	it('gives every field a word, and gives no word to a field that is gone', () => {
		// totality is the claim, and it is what makes the read-only record on
		// `src/routes/_app.admin.forms.$id.tsx` unable to drop a field quietly: the map
		// is keyed by `FormInputField`, so a new box is a type error until it has a label, and this
		// catches the other direction — a field removed from the arrays and left in the map.
		expect(Object.keys(FORM_FIELD_LABELS).sort()).toEqual([...FORM_INPUT_FIELDS].sort());
	});

	it('says the same thing about a field wherever it is rendered', () => {
		// the drift this closes: one column worded two ways, "Sites allowed to use this form" on the
		// editable screen and "Sites allowed to use it" on the record beside it.
		for (const field of FORM_INPUT_FIELDS) {
			expect(FORM_FIELD_LABELS[field], `${field} has no label`).toBeTypeOf('string');
			expect(FORM_FIELD_LABELS[field].length, `${field}'s label is blank`).toBeGreaterThan(0);
		}
	});

	it('keeps the two halves disjoint, because they are read out of a body differently', () => {
		// which reading a name gets is decided by its type in `FORM_INPUT_FORM` in
		// ./input-schema.ts: a list-typed key keeps every value a body submitted under it, and a
		// single-valued key keeps one. a name in both halves would be one key there, so one of the
		// two readings would have to be the wrong one and a group's checked boxes would silently
		// collapse to one of them.
		const text: readonly string[] = FORM_TEXT_FIELDS;
		expect(FORM_LIST_FIELDS.filter((field) => text.includes(field))).toEqual([]);
	});
});
