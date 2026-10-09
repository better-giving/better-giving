import { describe, expect, it, vi } from 'vitest';
import type { NonprofitMatch, NonprofitSearch } from '../api/types';
import { type FinderView, finderAsk, SEARCH_FLOOR, watchFinder } from './org-search';

// what the finder asks the IRS list at a press, and what it shows while it does. the watch is
// plain typescript handed the box's text at a press, so every case here is the finder's own
// reading with no dom (../../vite.config.ts pins `node`). what an answer fills once a number is
// locked in is ./ein-lookup.spec.ts's.

const MATCH: NonprofitMatch = {
	ein: '123456789',
	name: 'Riverside Community Food Bank',
	city: 'Riverside',
	state: 'CA',
	deductible: true,
	revokedOn: ''
};

/** a promise that never settles: a press the list has not answered yet. */
const never = <T>() => new Promise<T>(() => {});

/** lets every settled promise run its handlers. */
const settled = () => new Promise((done) => setTimeout(done, 0));

function watched(
	answer: () => Promise<NonprofitSearch>,
	{
		lookups = true,
		locking = async () => {}
	}: {
		lookups?: boolean;
		locking?: () => Promise<void>;
	} = {}
) {
	const search = vi.fn((_query: string, _signal: AbortSignal) => answer());
	const lockIn = vi.fn((_ein: string, _signal: AbortSignal, _match: NonprofitMatch | null) =>
		locking()
	);
	const views: FinderView[] = [];
	const watch = watchFinder({
		search,
		lockIn,
		lookups,
		onView: (view) => views.push(view),
		memory: new Map()
	});
	return { watch, search, lockIn, views, view: () => views.at(-1) };
}

const ok = async (): Promise<NonprofitSearch> => ({ state: 'ok', matches: [MATCH] });

describe('what a press asks', () => {
	it('looks a whole EIN up, in its stored spelling, typed with or without the dash', () => {
		expect(finderAsk('12-3456789', true)).toEqual({ kind: 'lookup', ein: '12-3456789' });
		expect(finderAsk(' 123456789 ', true)).toEqual({ kind: 'lookup', ein: '12-3456789' });
	});

	it('looks up nine digits however they are dashed or spaced', () => {
		expect(finderAsk('12 345 6789', true)).toEqual({ kind: 'lookup', ein: '12-3456789' });
	});

	it('searches anything else of three characters or more', () => {
		expect(finderAsk('riv', true)).toMatchObject({ kind: 'search', query: 'riv' });
		expect(finderAsk('12-345678', true)).toMatchObject({ kind: 'search', query: '12-345678' });
	});

	it('searches a name that opens with digits as it was typed', () => {
		for (const name of ['100 Black Men of America', '4-H Council', '211 LA County']) {
			expect(finderAsk(name, true)).toMatchObject({ kind: 'search', query: name });
		}
	});

	it('refuses fewer characters than the binary takes, and searches as many as it does', () => {
		const under = 'r'.repeat(SEARCH_FLOOR - 1);

		expect(finderAsk(under, true)).toEqual({ kind: 'refused', why: 'short' });
		expect(finderAsk(` ${under} `, true)).toEqual({ kind: 'refused', why: 'short' });
		expect(finderAsk(`${under}r`, true)).toMatchObject({ kind: 'search' });
	});

	it('counts characters as the binary does, so an emoji is one of them', () => {
		// one astral character is two utf-16 units and one rune, and the binary counts runes.
		const emoji = '😀';
		const under = `${'a'.repeat(SEARCH_FLOOR - 2)}${emoji}`;

		expect(finderAsk(under, true)).toEqual({ kind: 'refused', why: 'short' });
		expect(finderAsk(`a${under}`, true)).toMatchObject({ kind: 'search' });
	});

	it('still looks a whole EIN up where the console cannot ask the list, and refuses a name', () => {
		expect(finderAsk('12-3456789', false)).toEqual({ kind: 'lookup', ein: '12-3456789' });
		expect(finderAsk('riverside', false)).toEqual({ kind: 'refused', why: 'not-ein' });
	});
});

describe('a press', () => {
	it('is the only thing that asks: a watch made asks nothing', async () => {
		const { search, lockIn, view } = watched(ok);
		await settled();

		expect([search.mock.calls.length, lockIn.mock.calls.length, view()]).toEqual([0, 0, undefined]);
	});

	it('searches once for a name, and locks nothing in', async () => {
		const { watch, search, lockIn } = watched(ok);
		watch.press('riverside');
		await settled();

		expect(search).toHaveBeenCalledTimes(1);
		expect(search.mock.calls[0]?.[0]).toBe('riverside');
		expect(lockIn).not.toHaveBeenCalled();
	});

	it('locks a whole EIN in once, as typed and no match, and searches nothing', async () => {
		const { watch, search, lockIn } = watched(ok);
		watch.press('12-3456789');
		await settled();

		expect(lockIn).toHaveBeenCalledTimes(1);
		expect([lockIn.mock.calls[0]?.[0], lockIn.mock.calls[0]?.[2]]).toEqual(['12-3456789', null]);
		expect(search).not.toHaveBeenCalled();
	});

	it('asks nothing for a one-character name, and says it is too short', async () => {
		const { watch, search, lockIn, view } = watched(ok);
		watch.press('r');
		await settled();

		expect(search).not.toHaveBeenCalled();
		expect(lockIn).not.toHaveBeenCalled();
		expect(view()).toEqual({ out: null, found: { kind: 'idle' }, refused: 'short' });
	});

	it('asks nothing for a name where the console cannot ask the list, and says to type the EIN', async () => {
		const { watch, search, view } = watched(ok, { lookups: false });
		watch.press('riverside');
		await settled();

		expect(search).not.toHaveBeenCalled();
		expect(view()?.refused).toBe('not-ein');
	});

	it('empties the list and what it said while a search is out', async () => {
		const answers: (() => Promise<NonprofitSearch>)[] = [ok, never];
		const { watch, view } = watched(() => (answers.shift() ?? never)());
		watch.press('riverside');
		await settled();
		watch.press('riverside food');

		expect(view()).toEqual({ out: 'search', found: { kind: 'idle' }, refused: null });
	});

	it('keeps the list a match was picked from while its lookup is out', async () => {
		const { watch, view } = watched(ok, { locking: never });
		watch.press('riverside');
		await settled();
		watch.pick(MATCH);

		expect(view()).toEqual({
			out: 'lookup',
			found: { kind: 'matches', matches: [MATCH] },
			refused: null
		});
	});

	it('holds a second press while the first is out', async () => {
		const { watch, search, lockIn } = watched(never);
		watch.press('riverside');
		watch.press('riverside food');
		watch.press('12-3456789');
		watch.pick(MATCH);

		expect(search).toHaveBeenCalledTimes(1);
		expect(lockIn).not.toHaveBeenCalled();
	});

	it('takes a press again once the first has answered', async () => {
		const { watch, search } = watched(ok);
		watch.press('riverside');
		await settled();
		watch.press('lakeside');
		await settled();

		expect(search).toHaveBeenCalledTimes(2);
	});

	it('is busy until the number it locks in has landed', async () => {
		let land = () => {};
		const { watch, view } = watched(ok, {
			locking: () =>
				new Promise<void>((done) => {
					land = done;
				})
		});
		watch.press('12-3456789');

		expect(view()?.out).toBe('lookup');

		land();
		await settled();

		expect(view()?.out).toBeNull();
	});

	it('asks nothing for a query it already has the answer to, however it is spaced', async () => {
		const { watch, search, view } = watched(ok);
		watch.press('riverside food');
		await settled();
		watch.press('  Riverside   Food ');
		await settled();

		expect(search).toHaveBeenCalledTimes(1);
		expect(view()).toEqual({
			out: null,
			found: { kind: 'matches', matches: [MATCH] },
			refused: null
		});
	});

	it('empties what it said before a remembered answer, so the same count is new words', async () => {
		const { watch, views } = watched(ok);
		watch.press('riverside');
		await settled();
		const before = views.length;
		watch.press('riverside');

		expect(views.slice(before)).toEqual([
			{ out: 'search', found: { kind: 'idle' }, refused: null }
		]);

		await settled();

		expect(views.at(-1)?.found).toEqual({ kind: 'matches', matches: [MATCH] });
	});

	it('remembers an answer across two finders sharing one memory', async () => {
		const memory = new Map();
		const search = vi.fn(ok);
		const finder = () =>
			watchFinder({ search, lockIn: async () => {}, lookups: true, onView: () => {}, memory });
		finder().press('riverside');
		await settled();
		finder().press('riverside');
		await settled();

		expect(search).toHaveBeenCalledTimes(1);
	});

	it('gives up a press in flight when the finder is taken down', () => {
		const { watch, search } = watched(never);
		watch.press('riverside');
		watch.stop();

		expect(search.mock.calls[0]?.[1].aborted).toBe(true);
	});
});

describe('a pick', () => {
	it('locks in the EIN of the match taken, in its stored spelling, with the match', async () => {
		const { watch, lockIn, search } = watched(ok);
		watch.pick(MATCH);
		await settled();

		expect(lockIn).toHaveBeenCalledTimes(1);
		expect([lockIn.mock.calls[0]?.[0], lockIn.mock.calls[0]?.[2]]).toEqual(['12-3456789', MATCH]);
		expect(search).not.toHaveBeenCalled();
	});
});

describe('what a search shows', () => {
	it('shows the matches', async () => {
		const { watch, view } = watched(ok);
		watch.press('riverside');
		await settled();

		expect(view()?.found).toEqual({ kind: 'matches', matches: [MATCH] });
	});

	it('says there are none', async () => {
		const { watch, view } = watched(async () => ({ state: 'ok', matches: [] }));
		watch.press('zzzz');
		await settled();

		expect(view()?.found).toEqual({ kind: 'none' });
	});

	it('says the list could not be searched, and asks again at the next press', async () => {
		const { watch, search, view } = watched(async () => ({ state: 'unavailable', matches: [] }));
		watch.press('riverside');
		await settled();

		expect(view()?.found).toEqual({ kind: 'unavailable' });

		watch.press('riverside');
		await settled();

		expect(search).toHaveBeenCalledTimes(2);
	});

	it('reads a search that throws as the list being unavailable', async () => {
		const { watch, view } = watched(async () => {
			throw new Error('the binary is not answering');
		});
		watch.press('riverside');
		await settled();

		expect(view()?.found).toEqual({ kind: 'unavailable' });
	});
});
