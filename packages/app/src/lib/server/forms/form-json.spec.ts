import { describe, expect, it } from 'vitest';
import { MAX_SUGGESTED_AMOUNTS } from '../../forms/amounts';
import {
	decodeAllowedOrigins,
	decodeSuggestedAmounts,
	encodeAllowedOrigins,
	encodeSuggestedAmounts
} from './form-json';

// node pool, no database — the columns these read and write are plain text holding JSON, so
// what is under test is decidable from a string alone. that the text a `CHECK` accepts is the
// text these produce is ./queries.workers.spec.ts's claim, against a real D1.

describe('the JSON column seam', () => {
	it('round-trips a parsed list through the column encoding', () => {
		// `allowed_origins` is plain text holding JSON — no drizzle `mode: 'json'` — so this
		// pair is the whole conversion, and it lives here so no raw JSON string ever reaches a
		// route or a component.
		const stored = encodeAllowedOrigins(['https://acme.org', 'http://localhost:5173']);
		expect(decodeAllowedOrigins(stored)).toEqual(['https://acme.org', 'http://localhost:5173']);
	});

	it('encodes an empty list as the column default', () => {
		// so a form an operator emptied is indistinguishable from one nobody has touched, which
		// is the state a new form is born in and what `form_allowed_origins_array_check`
		// expects.
		expect(encodeAllowedOrigins([])).toBe('[]');
	});

	it('decodes anything the column should not hold as an empty list', () => {
		// `form_allowed_origins_array_check` makes the first two unreachable through SQL and the
		// third reachable — the check asks for an array, not an array of strings. none of them is
		// worth a 500 on a staff page: an unusable entry read as "no site may embed" fails
		// closed, which is the direction a CORS allowlist must fail in.
		expect(decodeAllowedOrigins('not json')).toEqual([]);
		expect(decodeAllowedOrigins('{"a":1}')).toEqual([]);
		expect(decodeAllowedOrigins('["https://acme.org", 7, null]')).toEqual(['https://acme.org']);
	});

	it('drops a repeated origin, keeping the first of them', () => {
		// a repeat says nothing a CORS allowlist can act on — the check is membership — and the
		// column's own `CHECK` asks for an array and nothing about what is in it, so a hand-run
		// `wrangler d1 execute` is the way one gets in. dropped here rather than at either
		// consumer: `src/routes/_app.admin.forms._index.tsx` keys its site list by the origin,
		// and react reuses one element across both records on a duplicate key rather than
		// rendering the second — silently dropping a site from the list instead of loudly failing.
		expect(decodeAllowedOrigins('["https://a.org", "https://b.org", "https://a.org"]')).toEqual([
			'https://a.org',
			'https://b.org'
		]);
	});

	it('keeps first-seen order while doing it', () => {
		// the order is the operator's — `readOriginList` in `@better-giving/operator/origins` keeps
		// it for the same reason — and a list that comes back re-sorted reads as the form having
		// eaten an edit.
		expect(decodeAllowedOrigins('["https://c.org", "https://a.org", "https://c.org"]')).toEqual([
			'https://c.org',
			'https://a.org'
		]);
	});

	it('round-trips the amounts column through its own pair', () => {
		expect(decodeSuggestedAmounts(encodeSuggestedAmounts([2500, 5000, 10000]))).toEqual([
			2500, 5000, 10000
		]);
	});

	it('encodes each empty list as the column default', () => {
		expect(encodeSuggestedAmounts([])).toBe('[]');
		expect(encodeAllowedOrigins([])).toBe('[]');
	});

	it('decodes a stored amount list that is not one as empty, and drops what is not money', () => {
		// the same fail-closed posture as `decodeAllowedOrigins`, and the elements matter more
		// here: `form_suggested_amounts_array_check` asks for an array and says nothing about
		// what is in it, so a float, a negative or a string reaching this column is reachable
		// through a hand-run `wrangler d1 execute`. a float in a money column is the failure
		// `STRICT` exists to stop one layer down, and it must not reach a tile a donor clicks.
		expect(decodeSuggestedAmounts('not json')).toEqual([]);
		expect(decodeSuggestedAmounts('{"a":1}')).toEqual([]);
		expect(decodeSuggestedAmounts('[2500, 25.5, -100, "5000", null]')).toEqual([2500]);
		expect(decodeSuggestedAmounts('[0]')).toEqual([0]);
	});

	it('drops a stored amount past the last integer a number can hold', () => {
		// `Number.isInteger(1e21)` is true — every float that large is a whole number, and none of
		// them is the number anybody typed. the same floor `readAmount` puts under a submitted
		// box belongs on the way back out, because the write that stores one of these is a
		// hand-run `wrangler d1 execute` rather than a save.
		expect(decodeSuggestedAmounts('[1e21]')).toEqual([]);
		expect(decodeSuggestedAmounts(`[${Number.MAX_SAFE_INTEGER + 2}]`)).toEqual([]);
		expect(decodeSuggestedAmounts(`[${Number.MAX_SAFE_INTEGER}]`)).toEqual([
			Number.MAX_SAFE_INTEGER
		]);
	});

	it('reads back no more amounts than a form may be saved with', () => {
		// the cap is parse-only until here, so a hand-edited column of ten thousand entries
		// decodes in full into an edit page and a donor's card — which is the form the cap's own
		// reason argues cannot render.
		const stored = JSON.stringify(
			Array.from({ length: MAX_SUGGESTED_AMOUNTS + 5 }, (_, i) => 1000 + i)
		);
		expect(decodeSuggestedAmounts(stored)).toHaveLength(MAX_SUGGESTED_AMOUNTS);
	});
});
