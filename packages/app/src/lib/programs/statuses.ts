// the `program.status` vocabulary, in the one place both a component and the schema may import
// from.
//
// not under `$lib/server/**`, for the reason `$lib/forms/statuses.ts` is not: the array is the
// source of the `program_status_check` constraint in `$lib/server/db/schema.ts` *and* the source
// of the words a screen renders, and a component cannot import from `$lib/server/**` at all.
//
// the dependency runs server -> shared and never back: `$lib/server/db/schema.ts` imports this,
// this imports nothing.

/**
 * `archived` is the terminal state and there is no third: a cause is retired, never deleted. every
 * gift already recorded against one still names it, so the row has to stay for the pointer to
 * resolve — and a total an organisation has already reported is not a thing a delete may rewrite.
 * `$lib/server/db/schema.ts`'s `program` table argues the rest.
 */
export const PROGRAM_STATUSES = ['active', 'archived'] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

/**
 * what a status is called on a screen.
 *
 * keyed by `ProgramStatus` rather than `string`, so a third status is a type error here rather
 * than a raw `archived` rendered somewhere by a `?? value` fallback — the same discipline
 * `FORM_STATUS_LABELS` in `$lib/forms/statuses.ts` is under.
 */
export const PROGRAM_STATUS_LABELS: Record<ProgramStatus, string> = {
	active: 'Active',
	archived: 'Archived'
};
