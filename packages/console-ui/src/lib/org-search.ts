import type { NonprofitMatch, NonprofitSearch } from '../api/types';

// when the find dialog (./find-org-dialog.tsx) asks the IRS list for organisations by name or EIN,
// and what it shows while it does. the dialog hands this the box's text at every change and draws
// the state that comes back; nothing here touches a document, so ./org-search.spec.ts reads all of
// it against a clock it moves.
//
// **the list's limits are why a search waits.** the API is for set-up and is not generous, so a
// query is asked only once it holds three characters and the typing has paused, one request per
// query that settled, a request for a query typed past is given up, and an answer is remembered for
// the console's run — a query typed again, in this dialog or the next one, asks nothing. the
// binary remembers its own answers as well (`packages/console/internal/nonprofits`).
//
// **a list that does not answer is remembered by nobody**, so the same query asks again the next
// time it settles, and set-up goes on by hand meanwhile.
//
// **a query is measured in characters as the binary measures it**, in code points and not utf-16
// units (`packages/console/internal/server/nonprofits.go` counts runes), so a query this sends is
// never one the binary refuses for its length: the floor is counted here and the cap is the box's
// own `maxLength`, which cannot hold more code points than units.

/** the fewest characters a query is sent with; the binary refuses fewer. */
export const SEARCH_FLOOR = 3;

/** the most characters a query may hold; the binary refuses more. */
export const SEARCH_MOST = 200;

/** how long the typing has to pause before a query is sent. */
export const SEARCH_PAUSE_MS = 400;

/** what the dialog shows under the box. */
export type SearchState =
	| { readonly kind: 'idle' }
	| { readonly kind: 'searching' }
	| { readonly kind: 'matches'; readonly matches: readonly NonprofitMatch[] }
	| { readonly kind: 'none' }
	| { readonly kind: 'unavailable' };

/** the answers kept for the run, keyed by the query as it is compared. */
export type SearchMemory = Map<string, readonly NonprofitMatch[]>;

const RUN: SearchMemory = new Map();

const IDLE: SearchState = { kind: 'idle' };
const UNAVAILABLE: SearchState = { kind: 'unavailable' };

const shown = (matches: readonly NonprofitMatch[]): SearchState =>
	matches.length === 0 ? { kind: 'none' } : { kind: 'matches', matches };

/** a query as two queries are compared: `Riverside  food ` asks what `riverside food` asked. */
const keyOf = (query: string): string => query.trim().replace(/\s+/g, ' ').toLowerCase();

export type SearchWatchOptions = {
	readonly search: (query: string, signal: AbortSignal) => Promise<NonprofitSearch>;
	readonly onState: (state: SearchState) => void;
	/** where answers are kept, which is the run's own unless a caller states one. */
	readonly memory?: SearchMemory;
};

export type SearchWatch = {
	/** the box now holds `query`. */
	readonly typed: (query: string) => void;
	/** gives up the pause and any search in flight, for a dialog taken off the page. */
	readonly stop: () => void;
};

export function watchSearch({ search, onState, memory = RUN }: SearchWatchOptions): SearchWatch {
	let pause: ReturnType<typeof setTimeout> | undefined;
	let asking: { readonly key: string; readonly control: AbortController } | null = null;

	const ask = (key: string, query: string) => {
		const control = new AbortController();
		asking = { key, control };
		onState({ kind: 'searching' });
		search(query, control.signal)
			.then(
				(answer) => {
					if (answer.state !== 'ok') return UNAVAILABLE;
					memory.set(key, answer.matches);
					return shown(answer.matches);
				},
				() => UNAVAILABLE
			)
			.then((state) => {
				if (control.signal.aborted) return;
				asking = null;
				onState(state);
			});
	};

	const typed = (query: string) => {
		clearTimeout(pause);
		const key = keyOf(query);
		if (asking !== null && asking.key !== key) {
			asking.control.abort();
			asking = null;
		}
		if ([...key].length < SEARCH_FLOOR) {
			onState(IDLE);
			return;
		}
		const remembered = memory.get(key);
		if (remembered !== undefined) {
			onState(shown(remembered));
			return;
		}
		if (asking !== null) return;
		pause = setTimeout(() => ask(key, query.trim()), SEARCH_PAUSE_MS);
	};

	return {
		typed,
		stop: () => {
			clearTimeout(pause);
			asking?.control.abort();
			asking = null;
		}
	};
}
