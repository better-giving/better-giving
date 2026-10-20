import { einAsPrinted } from '@better-giving/operator/console/org-rules';
import type { NonprofitStanding } from '$lib/org/nonprofit-answers';

// what Settings' "Find your charity" box (./org-finder.tsx) asks when it is pressed, and the words
// it answers in. the answers are $lib/org/nonprofit-answers.ts's; nothing here touches a document,
// so ./nonprofit-finder.spec.ts reads all of it.
//
// **the service's keyless allowance is one call a minute, so one press is one call.** typing asks
// nothing; a press asks once. a whole EIN is looked up, never searched, and so is a match picked
// off the list: the lookup is what carries the address the details boxes take. a press is a whole
// EIN when it is nine digits once its dashes and spaces are dropped, and anything else is a name,
// typed digits and all: `211 LA County` is a search.

/** the fewest characters a name is searched with. */
export const SEARCH_FLOOR = 2;

export const FINDER_LABEL = 'Find your charity';
export const FINDER_HINT = 'Name or EIN';
export const SEARCH_LABEL = 'Search';
export const PICK_ANOTHER = 'Pick a different organisation';

export const SEARCHING = 'Searching…';
export const LOOKING_UP = 'Looking up…';
export const TOO_SHORT = `Type at least ${SEARCH_FLOOR} characters.`;
export const NO_MATCHES = 'No matches.';
export const SEARCH_UNAVAILABLE = "Couldn't search the IRS list. Search by EIN instead.";
export const NOT_LISTED = 'Not on the IRS list.';
export const LOOKUP_UNAVAILABLE = "Couldn't look this up. Fill in the details yourself.";
export const FILLED = 'Filled from the IRS list.';
export const NOT_DEDUCTIBLE = 'Not listed as tax-deductible';
export const DEDUCTIBILITY_UNKNOWN = 'Tax-deductible status not known';

/** what a press asks for: a lookup by EIN in its stored spelling, a name search, or nothing. */
export type FinderAsk =
	| { readonly kind: 'lookup'; readonly ein: string }
	| { readonly kind: 'search'; readonly query: string }
	| { readonly kind: 'short' };

const WHOLE_EIN = /^\d{9}$/;

/** what a press on `text` asks. */
export function finderAsk(text: string): FinderAsk {
	const query = text.trim().replace(/\s+/g, ' ');
	const digits = query.replace(/[\s-]/g, '');
	if (WHOLE_EIN.test(digits)) return { kind: 'lookup', ein: einAsPrinted(digits) };
	// counted in code points, so a name in a script outside the basic plane is not counted double.
	if ([...query].length < SEARCH_FLOOR) return { kind: 'short' };
	return { kind: 'search', query };
}

/** a minute is said in seconds; from two minutes on, the wait is said in whole minutes, rounded up. */
const MINUTES_FROM = 120;

/** what a call the service turned away for its rate limit says, `retryAfter` seconds from now. */
export function tooManyLookups(retryAfter: number): string {
	const wait =
		retryAfter >= MINUTES_FROM
			? `${Math.ceil(retryAfter / 60)} minutes`
			: retryAfter === 1
				? '1 second'
				: `${retryAfter} seconds`;
	return `Too many lookups for now. Try again in ${wait}.`;
}

/** a day the service hands over as `YYYY-MM-DD`, said in utc, where the day was written. */
const DAY_WORDS = new Intl.DateTimeFormat('en-US', {
	month: 'long',
	day: 'numeric',
	year: 'numeric',
	timeZone: 'UTC'
});

/** an organisation's standing, as one note and how loudly it is said; `null` where it needs none. */
export type StandingNote = { readonly words: string; readonly known: boolean };

/**
 * the one note a standing says. a revocation outranks deductibility, because it is why an
 * organisation drops off the deductible list and its date is the fact worth having; a listed
 * organisation says nothing.
 */
export function standingNote(standing: NonprofitStanding): StandingNote | null {
	if (standing.revoked === true) {
		const on = standing.revocationDate;
		return {
			words: `Tax-exempt status revoked${on === null ? '' : ` ${DAY_WORDS.format(new Date(on))}`}.`,
			known: true
		};
	}
	if (standing.deductible === false) return { words: NOT_DEDUCTIBLE, known: true };
	if (standing.deductible === null) return { words: DEDUCTIBILITY_UNKNOWN, known: false };
	return null;
}

/** what a name search that found matches says, counted for a reader the opening list tells nothing. */
export const matchCount = (count: number): string =>
	count === 0 ? NO_MATCHES : count === 1 ? '1 match.' : `${count} matches.`;
