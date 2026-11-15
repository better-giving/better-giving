// the employer match vocabulary, in the one place both a component and the read that derives it may
// import from — not under `$lib/server/**`, for the reason `$lib/donations/statuses.ts` is not.
//
// a match has no status column: it is the set of stamps on its `gift_match` row
// ($lib/server/db/schema.ts), and the one word a screen shows is read off them here by priority.
// `$lib/server/matching/match.ts` filters on the same priority in SQL, and its spec holds the two
// to each other.

/** the word a gift's match shows, highest priority first. */
export const MATCH_STATUSES = [
	'voided',
	'matched',
	'filed',
	'send_failed',
	'reminded',
	'pack_sent'
] as const;

export type MatchStatus = (typeof MATCH_STATUSES)[number];

/**
 * what the gifts list filters on: every word, and the gifts that name no employer. `no_employer`
 * is a filter and never a word — a gift with nobody named shows none, or `filed` where the donor
 * marked it filed all the same.
 */
export const MATCH_FILTERS = ['no_employer', ...MATCH_STATUSES] as const;

export type MatchFilter = (typeof MATCH_FILTERS)[number];

/**
 * the word a screen draws for each status, in the vocabulary the gift's history speaks
 * (`EVENT_LABELS` in $lib/admin/donations/gift-detail.tsx): the pack is the details email.
 */
export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
	voided: 'Voided',
	matched: 'Matched',
	filed: 'Filed',
	send_failed: 'Details email failed',
	reminded: 'Reminded',
	pack_sent: 'Details emailed'
};

/** what each filter is called on the gifts list's Match select. */
export const MATCH_FILTER_LABELS: Record<MatchFilter, string> = {
	no_employer: 'No employer named',
	...MATCH_STATUS_LABELS
};

/** the stamps the word is read off, as the row holds them. */
export type MatchStamps = {
	readonly employer: string | null;
	readonly packSentAt: Date | null;
	readonly packFailedAt: Date | null;
	readonly remindedAt: Date | null;
	readonly filedAt: Date | null;
	readonly matchedAt: Date | null;
	readonly voidedAt: Date | null;
};

/** the one word by priority, or `null` where nothing has happened to the claim. */
export function matchStatus(stamps: MatchStamps): MatchStatus | null {
	if (stamps.voidedAt !== null) return 'voided';
	if (stamps.matchedAt !== null) return 'matched';
	if (stamps.filedAt !== null) return 'filed';
	if (stamps.packFailedAt !== null) return 'send_failed';
	if (stamps.remindedAt !== null) return 'reminded';
	if (stamps.packSentAt !== null) return 'pack_sent';
	return null;
}
