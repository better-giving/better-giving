import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NonprofitMatch, NonprofitSearch } from '../api/types';
import { SEARCH_PAUSE_MS, type SearchState, watchSearch } from './org-search';

// when the find dialog asks the IRS list, and what it shows while it does. the watch is plain
// typescript handed the box's text, so the pause and the memory are read here against a clock this
// file moves (../../vite.config.ts pins `node` and no dom).

const MATCH: NonprofitMatch = {
	ein: '123456789',
	name: 'Riverside Community Food Bank',
	city: 'Riverside',
	state: 'CA',
	deductible: true,
	revokedOn: ''
};

function watched(answer: () => Promise<NonprofitSearch>) {
	const search = vi.fn((_query: string, _signal: AbortSignal) => answer());
	const states: SearchState[] = [];
	const watch = watchSearch({ search, onState: (state) => states.push(state), memory: new Map() });
	return { watch, search, state: () => states.at(-1) };
}

const ok = async (): Promise<NonprofitSearch> => ({ state: 'ok', matches: [MATCH] });

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('when the list is searched', () => {
	it('asks nothing for fewer than three characters', async () => {
		const { watch, search, state } = watched(ok);
		watch.typed('ri');
		await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS * 2);

		expect(search).not.toHaveBeenCalled();
		expect(state()).toEqual({ kind: 'idle' });
	});

	it('waits for a pause in the typing, then asks once', async () => {
		const { watch, search } = watched(ok);
		watch.typed('riv');
		watch.typed('rive');
		watch.typed('river');
		await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS - 1);

		expect(search).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);

		expect(search).toHaveBeenCalledTimes(1);
		expect(search.mock.calls[0]?.[0]).toBe('river');
	});

	it('asks nothing for a query it already has the answer to', async () => {
		const { watch, search, state } = watched(ok);
		watch.typed('riverside');
		await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS);
		watch.typed('riversid');
		watch.typed('Riverside ');
		await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS);

		expect(search).toHaveBeenCalledTimes(1);
		expect(state()).toEqual({ kind: 'matches', matches: [MATCH] });
	});

	it('remembers an answer across two dialogs sharing one memory', async () => {
		const memory = new Map();
		const search = vi.fn(ok);
		watchSearch({ search, onState: () => {}, memory }).typed('riverside');
		await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS);
		watchSearch({ search, onState: () => {}, memory }).typed('riverside');
		await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS);

		expect(search).toHaveBeenCalledTimes(1);
	});

	it('gives up a search in flight once the query moves on', async () => {
		const { watch, search } = watched(() => new Promise(() => {}));
		watch.typed('riverside');
		await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS);
		watch.typed('riverside food');

		expect(search.mock.calls[0]?.[1].aborted).toBe(true);
	});

	it('says it is searching while the list is asked', async () => {
		const { watch, state } = watched(() => new Promise(() => {}));
		watch.typed('riverside');
		await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS);

		expect(state()).toEqual({ kind: 'searching' });
	});
});

describe('what a search shows', () => {
	it('shows the matches', async () => {
		const { watch, state } = watched(ok);
		watch.typed('riverside');
		await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS);

		expect(state()).toEqual({ kind: 'matches', matches: [MATCH] });
	});

	it('says there are none', async () => {
		const { watch, state } = watched(async () => ({ state: 'ok', matches: [] }));
		watch.typed('zzzz');
		await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS);

		expect(state()).toEqual({ kind: 'none' });
	});

	it('says the list could not be searched, and asks again for the same query later', async () => {
		const { watch, search, state } = watched(async () => ({ state: 'unavailable', matches: [] }));
		watch.typed('riverside');
		await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS);

		expect(state()).toEqual({ kind: 'unavailable' });

		watch.typed('riversid');
		watch.typed('riverside');
		await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS);

		expect(search).toHaveBeenCalledTimes(2);
	});

	it('reads a search that throws as the list being unavailable', async () => {
		const { watch, state } = watched(async () => {
			throw new Error('the binary is not answering');
		});
		watch.typed('riverside');
		await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS);

		expect(state()).toEqual({ kind: 'unavailable' });
	});

	it('goes back to waiting when the query is cut below three characters', async () => {
		const { watch, state } = watched(ok);
		watch.typed('riverside');
		await vi.advanceTimersByTimeAsync(SEARCH_PAUSE_MS);
		watch.typed('ri');

		expect(state()).toEqual({ kind: 'idle' });
	});
});
