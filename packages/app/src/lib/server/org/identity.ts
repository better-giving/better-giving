import { present } from './receipt-fields';
import type { OrgProfile } from '../db/schema';

// the identity a donation form is refused without, and the one place that question is answered
// for a screen.
//
// a leaf, the same way ./receipt-fields.ts is one: it reads a value, returns words, and knows
// nothing about who asked. the two are deliberately separate lists — a receipt prints what the
// gift was recorded against afterwards, and this is what the screen soliciting the gift has to
// state while asking.
//
// it lives here rather than inside its one caller because the question is about the organisation
// rather than about a form: ../forms/readiness.ts reads it for the block the screens that make and
// publish a form carry, and the same fields are what `publishedConfig` (../forms/published-config.ts)
// refuses a config without. spelled twice it would be two sentences drifting on which fields they
// name.

/**
 * the organisation's identity as `publishedConfig` (../forms/published-config.ts) demands it: two
 * fields in one `if`, and a config missing either of them is refused.
 *
 * the words are the ones the console puts on those boxes, because this list's whole job is sending
 * an operator to them — a sentence naming "Tax ID" against a box labelled "EIN" is a scavenger
 * hunt. the schema's own names (`legal_name`, `tax_id`) never reach a screen; the refusal in
 * ../forms/published-config.ts names the columns instead, because what reads that one is an agent
 * holding a 4xx body rather than an operator looking for an input.
 *
 * both boxes are the Organisation fold's (`packages/console-ui/src/lib/org-fold.tsx`), which is the
 * one screen an operator fills either of them in on.
 *
 * `ein` is `tax_id` here: the column keeps its jurisdiction-neutral name and the screens do not,
 * because this product is for US 501(c)(3) organisations.
 */
const IDENTITY_FIELDS: readonly { label: string; of: (p: OrgProfile) => string | null }[] = [
	{ label: 'Registered name', of: (p) => p.legalName },
	{ label: 'EIN', of: (p) => p.taxId }
];

/**
 * which of those two are blank, in the order the console asks for them.
 *
 * whitespace counts as blank, which is `present`'s standard and also `text()`'s in
 * packages/form/src/config.ts — the function deciding the same question at request time, and the two must
 * never disagree about one row. the columns carry not-blank checks of their own, so this is parity
 * rather than a second guard: what it is really answering is `null`, and what it is protecting
 * against is the two files drifting on what "filled in" means.
 */
export function identityMissing(profile: OrgProfile | null): string[] {
	if (profile === null) return IDENTITY_FIELDS.map((field) => field.label);
	return IDENTITY_FIELDS.filter((field) => !present(field.of(profile))).map((field) => field.label);
}
