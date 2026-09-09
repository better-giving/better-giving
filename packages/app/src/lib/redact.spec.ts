import { describe, expect, it } from 'vitest';
import { ECHO_MAX, PUBLIC_ID_ECHO_MAX, redact, redactPublicId } from './redact';

// node pool, no database: the whole policy is decidable from a string.

describe('redact — what a message may echo of a rejected value', () => {
	it('passes a short value through whole, so a typo is recognisable', () => {
		expect(redact('sk_live_x')).toBe('sk_live_x');
	});

	it('cuts a long one at the cap and marks that it did', () => {
		// the failure this guards: these values are set back to back, and a value pasted into the
		// wrong one is a live key quoted back in the sentence that rejects it. the ellipsis is what
		// stops a cut value from reading as the whole one.
		const cut = redact('a'.repeat(ECHO_MAX + 40));
		expect(cut).toBe(`${'a'.repeat(ECHO_MAX)}…`);
	});
});

describe('redactPublicId — the one value outside that policy', () => {
	it('echoes a form id whole, which `redact` would cut in half', () => {
		// a form id is `frm_` and 16 random characters (see `formId` in ./server/db/schema.ts), so
		// `ECHO_MAX` of 12 leaves the prefix and eight characters an operator cannot tell apart
		// from the id they meant to type. it is public by construction — it sits in the org's own
		// HTML and is quoted back by unauthenticated `/api/v1` requests — so nothing is withheld
		// from anyone by cutting it.
		const id = 'frm_abcdefghijklmnop';
		expect(id).toHaveLength(20);
		expect(redact(id)).not.toBe(id);
		expect(redactPublicId(id)).toBe(id);
	});

	it('still caps what arrives in a path segment, which is text of any length', () => {
		// the carve-out is about which policy applies, not about there being none: what reaches
		// this is a URL an operator's browser sent, and a message is not a place to print it.
		const cut = redactPublicId(`frm_${'z'.repeat(4000)}`);
		expect(cut).toBe(`frm_${'z'.repeat(PUBLIC_ID_ECHO_MAX - 4)}…`);
	});
});
