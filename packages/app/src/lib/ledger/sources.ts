import type { EntrySourceType } from '../server/db/schema';

// the words a screen draws over an `entry_group.source_type`, in the one place a component may
// import them from.
//
// not under `$lib/server/**`, for the reason `$lib/forms/statuses.ts` is not: `/admin/books` renders
// these over the entries it lists, and a component cannot import a value from `$lib/server/**` at
// all. the vocabulary itself stays in `$lib/server/db/schema.ts`, whose `enums` rule keeps it there
// while no module that file imports needs it; what crosses is its type, which leaves no runtime edge.

/**
 * what a source is called on a screen.
 *
 * keyed by `EntrySourceType` rather than `string`, so a sixth source is a type error here rather
 * than a raw `adjustment` rendered by a `?? value` fallback — the same discipline
 * `FORM_STATUS_LABELS` in `$lib/forms/statuses.ts` is under.
 *
 * the words are a fundraiser's and never the column's (CLAUDE.md → Product surface), and they say
 * what caused the entry rather than what it did: the entry itself is the two lines beside the word,
 * so a label repeating "money moved" would be a second name for what the reader is already looking
 * at. the pair worth keeping apart is `donation` and `payment` — a gift is recorded when the donor
 * authorises it and the money is claimed when the processor settles it, and an operator reconciling
 * against a bank statement is reading for the second.
 */
export const ENTRY_SOURCE_LABELS: Record<EntrySourceType, string> = {
	donation: 'Gift recorded',
	payment: 'Gift settled',
	refund: 'Refund',
	fee: 'Processor fee',
	adjustment: 'Correction'
};
