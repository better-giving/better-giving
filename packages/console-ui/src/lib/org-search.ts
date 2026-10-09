import { einAsPrinted } from '@better-giving/operator/console/org-rules';
import type { NonprofitMatch, NonprofitSearch } from '../api/types';

// what the finder (./org-finder.tsx) asks the IRS list when it is pressed, and what it shows while
// it does. the finder hands this the box's text at a press and a match at a pick, and draws the
// view that comes back; nothing here touches a document, so ./org-search.spec.ts reads all of it.
//
// **the list's limits are why nothing is asked but at a press.** the API is keyless for set-up: a
// request a minute and five a day, and the binary waits out a per-minute limit itself, so a press
// can take a minute to answer. so typing asks nothing at all; Search or Enter asks once, a second
// press while one is out asks nothing, and a search answer is remembered for the
// console's run — a query pressed again, in this finder or the next one, asks nothing. the binary
// remembers its own answers as well (`packages/console/internal/nonprofits`).
//
// **a whole EIN is looked up, never searched**, and so is a match picked off the list: the lookup
// is what carries the address, the mission and the revocation a search does not. the lookup is the
// fold's to make (`lockIn`), because what it answers is the number the screen locks in. a press is a
// whole EIN when it is nine digits once its dashes and spaces are dropped, and anything else is a
// name, typed digits and all: `211 LA County` is a search.
//
// **a list that does not answer is remembered by nobody**, so the same query asks again at the
// next press.
//
// **a query is measured in characters as the binary measures it**, in code points and not utf-16
// units (`packages/console/internal/server/nonprofits.go` counts runes), so a query this sends is
// never one the binary refuses for its length: the floor is counted here and the cap is the box's
// own `maxLength`, which cannot hold more code points than units.

/** the fewest characters a query is sent with; the binary refuses fewer. */
export const SEARCH_FLOOR = 3;

/** the most characters a query may hold; the binary refuses more. */
export const SEARCH_MOST = 200;

/** what the finder shows under its box. */
export type SearchState =
	| { readonly kind: 'idle' }
	| { readonly kind: 'matches'; readonly matches: readonly NonprofitMatch[] }
	| { readonly kind: 'none' }
	| { readonly kind: 'unavailable' };

/** the finder as drawn: whether a press is out, and what the last search showed. */
export type FinderView = { readonly out: boolean; readonly found: SearchState };

export const IDLE_VIEW: FinderView = { out: false, found: { kind: 'idle' } };

/** what a press asks for: a lookup, a search, or nothing at all. */
export type FinderAsk =
	| { readonly kind: 'lookup'; readonly ein: string }
	| { readonly kind: 'search'; readonly query: string; readonly key: string }
	| null;

/** a query as two queries are compared: `Riverside  food ` asks what `riverside food` asked. */
const keyOf = (query: string): string => query.trim().replace(/\s+/g, ' ').toLowerCase();

/** nine digits, once a press's dashes and spaces are dropped. */
const WHOLE_EIN = /^\d{9}$/;

/**
 * what a press on `text` asks. a whole EIN is a lookup in its stored spelling; anything else of at
 * least {@link SEARCH_FLOOR} characters is a search, on a console able to ask the list.
 */
export function finderAsk(text: string, lookups: boolean): FinderAsk {
	const query = text.trim();
	const digits = query.replace(/[\s-]/g, '');
	if (WHOLE_EIN.test(digits)) return { kind: 'lookup', ein: einAsPrinted(digits) };
	const key = keyOf(query);
	if (!lookups || [...key].length < SEARCH_FLOOR) return null;
	return { kind: 'search', query, key };
}

/** the answers kept for the run, keyed by the query as it is compared. */
export type SearchMemory = Map<string, readonly NonprofitMatch[]>;

const RUN: SearchMemory = new Map();

const UNAVAILABLE: SearchState = { kind: 'unavailable' };

const shown = (matches: readonly NonprofitMatch[]): SearchState =>
	matches.length === 0 ? { kind: 'none' } : { kind: 'matches', matches };

export type FinderWatchOptions = {
	readonly search: (query: string, signal: AbortSignal) => Promise<NonprofitSearch>;
	/**
	 * a whole EIN to look up and lock in, with the match it was picked as, or `null` for one typed;
	 * settles once it has, or once `signal` gives it up.
	 */
	readonly lockIn: (
		ein: string,
		signal: AbortSignal,
		match: NonprofitMatch | null
	) => Promise<void>;
	/** whether this console can ask the list at all; where it cannot, a name asks nothing. */
	readonly lookups: boolean;
	readonly onView: (view: FinderView) => void;
	/** where answers are kept, which is the run's own unless a caller states one. */
	readonly memory?: SearchMemory;
};

export type FinderWatch = {
	/** Search or Enter, over what the box holds. */
	readonly press: (text: string) => void;
	/** a match taken off the list. */
	readonly pick: (match: NonprofitMatch) => void;
	/** gives up a press in flight, for a finder taken off the page. */
	readonly stop: () => void;
};

export function watchFinder({
	search,
	lockIn,
	lookups,
	onView,
	memory = RUN
}: FinderWatchOptions): FinderWatch {
	let out: AbortController | null = null;
	let found: SearchState = IDLE_VIEW.found;

	/** one request out, with the view busy until it settles; `null` leaves the list as it was. */
	const run = (work: (signal: AbortSignal) => Promise<SearchState | null>) => {
		const control = new AbortController();
		out = control;
		onView({ out: true, found });
		work(control.signal).then((next) => {
			if (control.signal.aborted) return;
			out = null;
			if (next !== null) found = next;
			onView({ out: false, found });
		});
	};

	const lookUp = (ein: string, match: NonprofitMatch | null) =>
		run((signal) =>
			lockIn(ein, signal, match).then(
				() => null,
				() => null
			)
		);

	const press = (text: string) => {
		if (out !== null) return;
		const ask = finderAsk(text, lookups);
		if (ask === null) return;
		if (ask.kind === 'lookup') {
			lookUp(ask.ein, null);
			return;
		}
		const remembered = memory.get(ask.key);
		if (remembered !== undefined) {
			found = shown(remembered);
			onView({ out: false, found });
			return;
		}
		run((signal) =>
			search(ask.query, signal).then(
				(answer) => {
					if (answer.state !== 'ok') return UNAVAILABLE;
					memory.set(ask.key, answer.matches);
					return shown(answer.matches);
				},
				() => UNAVAILABLE
			)
		);
	};

	return {
		press,
		pick: (match) => {
			if (out === null) lookUp(einAsPrinted(match.ein), match);
		},
		stop: () => {
			out?.abort();
			out = null;
		}
	};
}
