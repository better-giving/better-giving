// the unit panel's ticker search: what the Stocks group draws for the text the donor types.
//
// pure, with the request and the timers handed in, so the element's panel and the deployment's own
// donation page search the same way and a spec can fire a debounce by hand. a query is asked once it
// has stood for `TICKER_DEBOUNCE_MS`; a newer query aborts the request before it, and an answer for
// any query but the newest is never shown.
//
// `../package.json` exports this module as `./ticker-search` for the deployment's own donation page.

import { noStockMatch, STOCK_SEARCH_FAILED } from './unit';
import type { TickerMatch } from './v1';

/** how long typed text stands before it is searched. */
export const TICKER_DEBOUNCE_MS = 200;

/**
 * where the search for the text typed now stands. `idle` is an empty search, which draws no Stocks
 * group; `loading` a query with no answer yet, which draws nothing in it.
 */
export type TickerSearch =
	| { readonly status: 'idle' }
	| { readonly status: 'loading'; readonly query: string }
	| { readonly status: 'results'; readonly query: string; readonly matches: readonly TickerMatch[] }
	| { readonly status: 'none'; readonly query: string }
	| { readonly status: 'failed'; readonly query: string };

export type TickerSearchPorts = {
	/** `GET /api/v1/forms/:id/tickers?q=` (`createTickerRead` in ./embed/api.ts). */
	search(query: string, signal: AbortSignal): Promise<readonly TickerMatch[]>;
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(id: unknown): void;
	/** called with each new state, the newest query's only. */
	onChange(state: TickerSearch): void;
};

export type TickerSearchController = {
	/** the text in the search box, on every keystroke. */
	search(query: string): void;
	readonly state: TickerSearch;
	/** stops the wait and aborts the request in flight; nothing is asked or shown after it. */
	dispose(): void;
};

export function createTickerSearch(ports: TickerSearchPorts): TickerSearchController {
	let state: TickerSearch = { status: 'idle' };
	let timer: unknown = null;
	let inFlight: AbortController | null = null;
	let disposed = false;

	const show = (next: TickerSearch) => {
		state = next;
		ports.onChange(next);
	};
	const stop = () => {
		if (timer !== null) ports.clearTimeout(timer);
		timer = null;
		inFlight?.abort();
		inFlight = null;
	};
	const ask = (query: string) => {
		timer = null;
		const controller = new AbortController();
		inFlight = controller;
		const answered = (next: TickerSearch) => {
			if (!controller.signal.aborted) show(next);
		};
		ports.search(query, controller.signal).then(
			(matches) =>
				answered(
					matches.length === 0 ? { status: 'none', query } : { status: 'results', query, matches }
				),
			() => answered({ status: 'failed', query })
		);
	};

	return {
		search(text) {
			if (disposed) return;
			stop();
			const query = text.trim();
			if (query === '') return show({ status: 'idle' });
			show({ status: 'loading', query });
			timer = ports.setTimeout(() => ask(query), TICKER_DEBOUNCE_MS);
		},
		get state() {
			return state;
		},
		dispose() {
			disposed = true;
			stop();
		}
	};
}

/**
 * what the Stocks group draws for a search: nothing while idle or loading, the rows of its answer, or
 * its in-group sentence.
 */
export function stocksGroup(
	search: TickerSearch
): null | { readonly rows: readonly TickerMatch[] } | { readonly sentence: string } {
	switch (search.status) {
		case 'idle':
		case 'loading':
			return null;
		case 'results':
			return { rows: search.matches };
		case 'none':
			return { sentence: noStockMatch(search.query) };
		case 'failed':
			return { sentence: STOCK_SEARCH_FAILED };
	}
}
