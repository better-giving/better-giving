import { readOriginList } from '@better-giving/operator/origins';

// parsing what this deployment's list of sites may be, with no database in sight.
//
// split from ./queries.ts for the same reason `../org/org-input.ts` and `../forms/form-input.ts`
// are: every rule about what a site may be is decidable from the submitted text alone, so
// keeping it here means it is testable with no D1 and no browser, and the action that saves the
// list stays a translation layer rather than the place the rules live.
//
// the rules themselves are not here and must not be copied here. `readOriginList` in
// `@better-giving/operator/origins` is the whole of them — the trim, the blank-row skip, the
// dedupe, the count cap, the repair each row is put through and the three refusals left over — and
// the reason they
// live in that leaf package is stated in its own header: a component hands the same rules to
// `zod4Client` and may not import from `$lib/server/**` at all, and the console applies them in
// front of the person typing, over a list this endpoint would otherwise be the first to refuse.
//
// this is the same arrangement `parseFormOrigins` is under, and deliberately: a form's sites and
// the deployment's list are one grammar read at two scales, so a second statement of it here is
// how the screen that types an address and the screen that ticks one stop agreeing about what an
// address is.

/**
 * the mark a value carries once it has been past every check in `readOriginList`.
 *
 * it is what makes the parse hard to skip — the same discipline `ParsedOrgProfile` in
 * ../org/org-input.ts and `ParsedForm` in ../forms/form-input.ts are under. without it a
 * hand-built array of the same shape reaches `replaceSites`, and "every stored site is one a
 * browser could send" is kept only by callers who happened to read this file.
 *
 * a `unique symbol` intersection, minted by a double assertion past every check. zod's
 * `.brand()` is not what enforces it and must not be: that is a compile-time no-op which
 * returns its input untouched, so it marks a value as checked wherever it is written, including
 * in front of nothing.
 */
declare const PARSED: unique symbol;
type Parsed<T> = T & { readonly [PARSED]: true };

/** the list as it is stored: every entry the origin a browser will send, in the typed order. */
export type SiteListValues = {
	readonly sites: readonly string[];
};

export type ParsedSites = Parsed<SiteListValues>;

/**
 * the answer, with one message for the whole group rather than one per row.
 *
 * one string and not a field-error map, because the boxes are one repeating row editor and its
 * message is about the group: `readOriginList` says each thing that is wrong with the list once,
 * naming no row, for the reason its header gives — the box a sentence is drawn under is already
 * showing the operator what they typed.
 */
export type SiteParseResult =
	| { readonly ok: true; readonly value: ParsedSites }
	| { readonly ok: false; readonly problem: string };

/**
 * validates the whole list of sites, which is what the screen that types them submits.
 *
 * takes the rows rather than a form-values object, because the whole group is one field and the
 * name of that field belongs to the form that renders it rather than to the rule.
 *
 * the order the rows arrive in is the order they are stored in — `readOriginList` keeps
 * first-seen order through its dedupe, and `site.position` in ../db/schema.ts is what carries
 * that across the round trip.
 */
export function parseSites(rows: readonly string[]): SiteParseResult {
	const { origins, problem } = readOriginList(rows);
	if (problem !== null) return { ok: false, problem };
	// the assertion is here rather than smuggled into the type, so the unsoundness is spent once,
	// past every check above.
	return { ok: true, value: { sites: origins } as unknown as ParsedSites };
}
