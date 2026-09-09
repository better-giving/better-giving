import { MAX_SUGGESTED_AMOUNTS } from '../../forms/amounts';

// ---------------------------------------------------------------------------
// the JSON column seam, and it is defined here rather than at either end of it.
//
// `form.allowed_origins` is plain text holding JSON — no drizzle `mode: 'json'`, no
// `$type<>` — so it surfaces to TypeScript as a `string`, and the only structural promise
// anything makes about it is the db check `form_allowed_origins_array_check`, which asserts
// `json_valid` and `json_type = 'array'` and nothing about the elements. the same holds for
// `suggested_amounts`, so each of the two array columns read here gets a pair below and each
// decode fails closed the same way.
//
// there is no third pair, because there is no third array column. how often a gift may repeat is
// decided by what this deployment's processor account can collect (`offeredCadences` in
// ./offered-cadences.ts) rather than by a row.
//
// so the conversion is the caller's job. it lives beside ./form-input.ts rather than in
// ./queries.ts because the rules about what may be in one of these columns are the rules
// that file already owns — which means the invariant worth having is cheap to state: a raw
// JSON string never reaches a route or a component.
//
// its own file rather than the bottom of ./form-input.ts, because the callers are disjoint:
// ./queries.ts is the only module that encodes or decodes, and a route imports the parse.
// four `encode*`/`decode*` names on the module a route reaches for are four ways to write
// a conversion the query layer has already done.
//
// `copy` is the third JSON column and has no pair, deliberately. it is an object rather than
// an array, nothing reads it and nothing writes it, and its shape belongs to whatever first
// renders a form's headline — inventing one here would fix an encoding against no consumer.
// ---------------------------------------------------------------------------

/** the origin list as the column stores it. */
export function encodeAllowedOrigins(origins: readonly string[]): string {
	return JSON.stringify(origins);
}

/**
 * the column as an origin list.
 *
 * total, and it fails closed. the check makes invalid JSON and a non-array unreachable
 * through SQL, but it says nothing about what is in the array, and a hand-run
 * `wrangler d1 execute` predates any of this code. none of those is worth a 500 on a staff
 * page — and an entry that is not a usable origin read as "no site may embed" is the
 * direction a CORS allowlist has to fail in.
 *
 * repeats are dropped, first-seen order kept. an origin listed twice says nothing a CORS allowlist
 * can act on, because the comparison is a membership test — and it is dropped here rather than at a
 * consumer so every reader of the column gets the same list:
 * `src/routes/_app.admin.forms._index.tsx` keys its site list by the origin, where a repeat is a
 * duplicate key react reuses one element across rather than rendering the second — silently
 * dropping a site from the list instead of loudly failing. `readOriginList` in
 * `@better-giving/operator/origins` drops them on the way in for the same reason; this is the same
 * rule on the way out, where a hand-run `wrangler d1 execute` is what the parse never saw.
 */
export function decodeAllowedOrigins(stored: string): string[] {
	const origins = storedArray(stored).filter((entry): entry is string => typeof entry === 'string');
	return [...new Set(origins)];
}

/** the suggested amounts as the column stores them. */
export function encodeSuggestedAmounts(amounts: readonly number[]): string {
	return JSON.stringify(amounts);
}

/**
 * the column as an amount list.
 *
 * fails closed element by element, like `decodeAllowedOrigins` and for a sharper reason:
 * `form_suggested_amounts_array_check` asks for an array and nothing about what is in it, so
 * a float, a negative or a numeric string is reachable through a hand-run `d1 execute`. a
 * float in a money column is what `STRICT` refuses one layer down (CLAUDE.md fixes money as
 * integer minor units), and a tile a donor clicks must not be the place it surfaces.
 *
 * zero is kept: it is a legal amount for the column, and whether it is legal for a form is
 * decided against that form's own bounds by `parseFormInput`.
 *
 * `Number.isSafeInteger` rather than `Number.isInteger`, which is the floor `readAmount` puts
 * under a submitted box: every float past 2^53 is a whole number and none of them is the number
 * anybody typed, so `1e21` would otherwise decode into a tile.
 *
 * `MAX_SUGGESTED_AMOUNTS` is applied here as well as at the parse, for the reason the cap
 * exists: each entry is a button on a card 375px wide, and the write that puts ten thousand of
 * them in the column is the same hand-run `d1 execute` the element-by-element checks are for.
 */
export function decodeSuggestedAmounts(stored: string): number[] {
	return storedArray(stored)
		.filter(
			(entry): entry is number =>
				typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0
		)
		.slice(0, MAX_SUGGESTED_AMOUNTS);
}

/** the stored text as whatever array it holds, or none — the shared fail-closed half. */
function storedArray(stored: string): unknown[] {
	let decoded: unknown;
	try {
		decoded = JSON.parse(stored);
	} catch {
		return [];
	}
	return Array.isArray(decoded) ? decoded : [];
}
