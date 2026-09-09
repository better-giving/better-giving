import { describe, expect, it } from 'vitest';
import { secretEquals } from './secret-compare';

// the compare both credentialled surfaces run: the staff sign-in and the console check.
//
// it lives beside the function rather than beside either caller, which is the point of the
// module — a second copy of these cases would be a second copy of the compare waiting to happen.

const GOOD_PASSWORD = 'correct-horse-battery';

describe('secretEquals', () => {
	it('matches identical strings', () => {
		expect(secretEquals(GOOD_PASSWORD, GOOD_PASSWORD)).toBe(true);
	});

	it('rejects a different string of the same length', () => {
		expect(secretEquals('aaaaaaaaaaaa', 'aaaaaaaaaaab')).toBe(false);
	});

	// `timingSafeEqual` throws on unequal-length buffers. hashing both sides first is
	// what removes that branch — without it this test would throw rather than return.
	it('handles unequal lengths without throwing and without an early return', () => {
		expect(secretEquals('short', 'a-considerably-longer-secret')).toBe(false);
		expect(secretEquals('', GOOD_PASSWORD)).toBe(false);
		expect(secretEquals(GOOD_PASSWORD, '')).toBe(false);
	});

	it('matches empty against empty (the caller is what refuses empties)', () => {
		expect(secretEquals('', '')).toBe(true);
	});

	it('is byte-exact, not unicode-normalizing', () => {
		// escapes, not literals: precomposed vs decomposed é looks identical in an editor,
		// so writing them as characters means any tool that normalises the file silently
		// turns this into a comparison of one string with itself.
		expect(secretEquals('\u00e9', 'e\u0301')).toBe(false);
	});
});
