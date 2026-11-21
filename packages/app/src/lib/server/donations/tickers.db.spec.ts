import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { client, MIGRATIONS, openUnmigrated } from '../db/database.testing';
import { applyMigrations } from '../db/migrate';
import { rejectionCode } from '../db/rejection.testing';
import { replaceTickers, searchTickers, tickersReplacedAt } from './tickers';

// the stock step's ticker list, against a real database: the whole-list swap the fetch job makes
// and the search a donor's typing runs.

let db: Db;

beforeAll(() => {
	db = createDb(client);
});

describe('searchTickers', () => {
	beforeAll(async () => {
		await replaceTickers(db, [
			{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'Nasdaq', kind: 'company' },
			{ symbol: 'AAL', name: 'American Airlines Group Inc.', exchange: 'Nasdaq', kind: 'company' },
			{ symbol: 'AA', name: 'Alcoa Corp', exchange: 'NYSE', kind: 'company' },
			{ symbol: 'BRK-B', name: 'BERKSHIRE HATHAWAY INC', exchange: 'NYSE', kind: 'company' },
			{ symbol: 'BRK-A', name: 'BERKSHIRE HATHAWAY INC', exchange: 'NYSE', kind: 'company' },
			{ symbol: 'APLE', name: 'Apple Hospitality REIT, Inc.', exchange: 'NYSE', kind: 'company' },
			{ symbol: 'PAPL', name: 'Pineapple Financial Inc.', exchange: 'NYSE', kind: 'company' },
			{ symbol: 'KO', name: 'COCA COLA CO', exchange: 'NYSE', kind: 'company' },
			{ symbol: 'VFIAX', name: null, exchange: null, kind: 'fund' }
		]);
	});

	const symbols = async (query: string, limit = 10) =>
		(await searchTickers(db, query, limit)).map((row) => row.symbol);

	it('finds a ticker by its exact symbol, whatever case the donor typed', async () => {
		expect(await searchTickers(db, 'aapl', 10)).toEqual([
			{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'Nasdaq', kind: 'company' }
		]);
	});

	it('ranks the exact symbol first, then symbols starting with the query, shortest first', async () => {
		expect(await symbols('AA')).toEqual(['AA', 'AAL', 'AAPL']);
	});

	it('finds a company by the start of any word of its name, never the middle of one', async () => {
		expect(await symbols('APPLE')).toEqual(['AAPL', 'APLE']);
		expect(await symbols('hath')).toEqual(['BRK-A', 'BRK-B']);
	});

	it('reads punctuation between words as the word break it is in a name', async () => {
		expect(await symbols('coca-cola')).toEqual(['KO']);
	});

	it('lists a name match after every symbol match, and a ticker once', async () => {
		expect(await symbols('ap')).toEqual(['APLE', 'AAPL']);
	});

	it('ignores the spaces around a query, and an empty one finds nothing', async () => {
		expect(await symbols('  aapl ')).toEqual(['AAPL']);
		expect(await symbols('   ')).toEqual([]);
	});

	it('finds a class share typed with a dot or a slash in the SEC dash form', async () => {
		expect(await symbols('brk.b')).toEqual(['BRK-B']);
		expect(await symbols('BRK/B')).toEqual(['BRK-B']);
	});

	it('returns at most `limit` rows', async () => {
		expect(await symbols('a', 2)).toEqual(['AA', 'AAL']);
	});

	it.each([0, -1, 2.5])('refuses a limit of %s, not a whole number above zero', async (limit) => {
		await expect(searchTickers(db, 'a', limit)).rejects.toThrow(RangeError);
	});

	it('finds no fund by name, since a fund has none', async () => {
		expect(await symbols('vfia')).toEqual(['VFIAX']);
		expect(await symbols('fund')).toEqual([]);
	});

	// each query names what it would find were its punctuation a LIKE wildcard or an FTS5 operator.
	// a name's punctuation is a word break, so `-` and `%` between letters split words, as they do in
	// the names themselves.
	it.each([
		['AA%', []], // as LIKE: AA, AAL, AAPL
		['A_PL', []], // as LIKE: AAPL
		['%apple', ['AAPL', 'APLE']], // as LIKE: PAPL too
		['*', []], // as a prefix query: every name
		['"', []],
		['^', []],
		['apple OR alcoa', []], // as OR: AA too
		['NEAR(apple hath)', []],
		['-apple', ['AAPL', 'APLE']] // as NOT: nothing
	])(
		'reads %j as the text it is, never as a pattern or a search operator',
		async (query, found) => {
			expect(await symbols(query)).toEqual(found);
		}
	);
});

describe('replaceTickers', () => {
	const apple = {
		symbol: 'AAPL',
		name: 'Apple Inc.',
		exchange: 'Nasdaq',
		kind: 'company'
	} as const;
	const alcoa = { symbol: 'AA', name: 'Alcoa Corp', exchange: 'NYSE', kind: 'company' } as const;

	it('swaps the whole list, so a ticker the new list lacks is found by neither symbol nor name', async () => {
		await replaceTickers(db, [apple]);
		await replaceTickers(db, [alcoa]);
		expect(await searchTickers(db, 'AAPL', 10)).toEqual([]);
		expect(await searchTickers(db, 'apple', 10)).toEqual([]);
		expect(await searchTickers(db, 'alcoa', 10)).toEqual([alcoa]);
	});

	// the shapes company_tickers_mf.json holds as fetched on 2026-11-21: lowercase symbols, one blank,
	// and two symbols company_tickers_exchange.json also lists.
	it('stores what the SEC files hold: uppercased, the blank symbol skipped, the first listing kept', async () => {
		await replaceTickers(db, [
			{ symbol: 'SPY', name: 'SPDR S&P 500 ETF TRUST', exchange: 'NYSE', kind: 'company' },
			{ symbol: ' spy', name: null, exchange: null, kind: 'fund' },
			{ symbol: 'elfnx', name: null, exchange: null, kind: 'fund' },
			{ symbol: '', name: null, exchange: null, kind: 'fund' },
			{ symbol: 'NOEX', name: ' Unlisted Corp ', exchange: ' ', kind: 'company' }
		]);
		expect(await searchTickers(db, 'noex', 10)).toEqual([
			{ symbol: 'NOEX', name: 'Unlisted Corp', exchange: null, kind: 'company' }
		]);
		expect(await searchTickers(db, 'spy', 10)).toEqual([
			{ symbol: 'SPY', name: 'SPDR S&P 500 ETF TRUST', exchange: 'NYSE', kind: 'company' }
		]);
		expect(await searchTickers(db, 'elfnx', 10)).toEqual([
			{ symbol: 'ELFNX', name: null, exchange: null, kind: 'fund' }
		]);
	});

	it('refuses a list with no symbol in it and keeps the one it has', async () => {
		await replaceTickers(db, [apple]);
		await expect(replaceTickers(db, [{ ...apple, symbol: ' ' }])).rejects.toThrow(RangeError);
		expect(await searchTickers(db, 'aapl', 10)).toEqual([apple]);
	});

	it('keeps the whole list it has when the table refuses a row of the new one', async () => {
		await replaceTickers(db, [apple]);
		const namedFund = {
			symbol: 'VFIAX',
			name: 'Vanguard 500',
			exchange: null,
			kind: 'fund'
		} as const;
		expect(await rejectionCode(() => replaceTickers(db, [alcoa, namedFund]))).toMatch(
			/SQLITE_CONSTRAINT_CHECK/
		);
		expect(await searchTickers(db, 'aapl', 10)).toEqual([apple]);
		expect(await searchTickers(db, 'apple', 10)).toEqual([apple]);
		expect(await searchTickers(db, 'aa', 10)).toEqual([apple]);
	});
});

describe('tickersReplacedAt', () => {
	it('is null on a database no list has reached', async () => {
		const fresh = await openUnmigrated();
		await applyMigrations(fresh, MIGRATIONS);
		expect(await tickersReplacedAt(createDb(fresh))).toBeNull();
	});

	it('is when the list the database holds replaced the one before', async () => {
		const before = Date.now();
		await replaceTickers(db, [
			{ symbol: 'AAPL', name: 'Apple Inc.', exchange: null, kind: 'company' }
		]);
		const replacedAt = await tickersReplacedAt(db);
		expect(replacedAt?.getTime()).toBeGreaterThanOrEqual(before);
		expect(replacedAt?.getTime()).toBeLessThanOrEqual(Date.now());
	});
});
