import { describe, expect, it } from 'vitest';
import {
	createTickerSearch,
	stocksGroup,
	TICKER_DEBOUNCE_MS,
	type TickerSearch
} from './ticker-search';
import type { TickerMatch } from './v1';

// node pool: the panel's ticker search with its timers and its request handed in, so a debounce and
// an out-of-order answer are arithmetic rather than waits.

const AAPL: TickerMatch = { symbol: 'AAPL', name: 'Apple Inc.' };
const AAL: TickerMatch = { symbol: 'AAL', name: 'American Airlines Group Inc.' };

/** a search over timers the spec fires by hand, and a request per query it answers by hand. */
function controller() {
	const timers = new Map<number, () => void>();
	let next = 0;
	const asked: {
		query: string;
		signal: AbortSignal;
		answer: (m: TickerMatch[]) => void;
		fail: () => void;
	}[] = [];
	const seen: TickerSearch[] = [];
	const search = createTickerSearch({
		search: (query, signal) =>
			new Promise((answer, fail) =>
				asked.push({ query, signal, answer, fail: () => fail(new Error('x')) })
			),
		setTimeout: (fn, ms) => {
			expect(ms).toBe(TICKER_DEBOUNCE_MS);
			timers.set(++next, fn);
			return next;
		},
		clearTimeout: (id) => timers.delete(id as number),
		onChange: (state) => seen.push(state)
	});
	const fire = () => {
		for (const [id, fn] of [...timers]) {
			timers.delete(id);
			fn();
		}
	};
	return { search, asked, seen, fire };
}

const landed = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the ticker search', () => {
	it('asks once the donor stops typing, and draws nothing for the query until it answers', async () => {
		const { search, asked, fire } = controller();
		search.search('a');
		search.search('aa');
		expect(search.state).toEqual({ status: 'loading', query: 'aa' });
		expect(stocksGroup(search.state)).toBeNull();

		fire();
		expect(asked.map((entry) => entry.query)).toEqual(['aa']);
		asked[0]?.answer([AAPL, AAL]);
		await landed();
		expect(search.state).toEqual({ status: 'results', query: 'aa', matches: [AAPL, AAL] });
		expect(stocksGroup(search.state)).toEqual({ rows: [AAPL, AAL] });
	});

	it('keeps the newest query’s answer, and never shows a stale or aborted one', async () => {
		const { search, asked, seen, fire } = controller();
		search.search('aa');
		fire();
		search.search('aap');
		fire();
		expect(asked[0]?.signal.aborted).toBe(true);

		asked[1]?.answer([AAPL]);
		asked[0]?.answer([AAL]);
		await landed();
		expect(search.state).toEqual({ status: 'results', query: 'aap', matches: [AAPL] });
		expect(seen.some((state) => state.status === 'results' && state.query === 'aa')).toBe(false);
	});

	it('says no match, or that the search failed, in the Stocks group', async () => {
		const { search, asked, fire } = controller();
		search.search(' zzq ');
		fire();
		asked[0]?.answer([]);
		await landed();
		expect(stocksGroup(search.state)).toEqual({
			sentence: 'No match for “zzq”. Try a name or a ticker.'
		});

		search.search('aa');
		fire();
		asked[1]?.fail();
		await landed();
		expect(stocksGroup(search.state)).toEqual({
			sentence: 'Couldn’t search stocks. Try again in a moment.'
		});
	});

	it('draws no Stocks group for an empty search, and asks nothing for it', () => {
		const { search, asked, fire } = controller();
		search.search('aa');
		search.search('  ');
		fire();
		expect(search.state).toEqual({ status: 'idle' });
		expect(stocksGroup(search.state)).toBeNull();
		expect(asked).toEqual([]);
	});

	it('stops asking and aborts what is in flight once disposed', () => {
		const { search, asked, fire } = controller();
		search.search('aa');
		fire();
		search.dispose();
		expect(asked[0]?.signal.aborted).toBe(true);
		search.search('aap');
		fire();
		expect(asked).toHaveLength(1);
	});
});
