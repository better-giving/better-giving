import { describe, expect, it } from 'vitest';
import { CONSENT_LABELS, consentState } from './consent';

// node pool, no database: this module is a vocabulary and imports nothing.

describe('the consent answer', () => {
	it('tells a donor who declined from one nobody asked', () => {
		// the whole reason `consented_to_contact` is nullable. an org deciding who to mail has to
		// know which of the two a blank is, and folding the second into the first destroys exactly
		// the distinction the column exists to make — /admin's own create form writes null,
		// because it does not ask.
		expect(consentState(true)).toBe('agreed');
		expect(consentState(false)).toBe('declined');
		expect(consentState(null)).toBe('unasked');
	});

	it('gives each of the three a word of its own', () => {
		// three states, three sentences: two that read the same would be a two-state screen with
		// an extra branch behind it.
		const words = Object.values(CONSENT_LABELS);
		expect(new Set(words).size).toBe(words.length);
	});
});
