import { beforeAll, expect, it } from 'vitest';
import { createDb } from '../db/client';
import { all, client, first, stmt } from '../db/database.testing';
import { statementsOf } from '../integrations/statements.testing';
import { replaceTickers, searchTickers, type TickerRow } from './tickers';

// the ticker list at the size the SEC's two files make together: 39,069 symbols as fetched on
// 2026-11-21, about a quarter of them companies. a donor's every keystroke runs the search, so
// what it must not do is scan `ticker`; and the whole list goes in one `batch()`, which is where
// libSQL's limits bite.

const COMPANIES = 10_000;
const FUNDS = 30_000;

const WORDS = ['global', 'capital', 'energy', 'health', 'apple', 'river', 'north', 'trust', 'bank'];

/** `n` as letters, A, B, … Z, AA, AB, …: a distinct symbol for every `n`. */
function lettersOf(n: number): string {
	let out = '';
	for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) {
		out = String.fromCharCode(65 + ((i - 1) % 26)) + out;
	}
	return out;
}

const list: TickerRow[] = [
	...Array.from(
		{ length: COMPANIES },
		(_, i): TickerRow => ({
			symbol: lettersOf(i),
			name: `${WORDS[i % WORDS.length]} ${WORDS[(i * 7) % WORDS.length]} holdings ${i} inc`,
			exchange: i % 2 === 0 ? 'NYSE' : 'Nasdaq',
			kind: 'company'
		})
	),
	...Array.from(
		{ length: FUNDS },
		(_, i): TickerRow => ({
			symbol: `${lettersOf(i % 26)}${String(i).padStart(5, '0')}X`, // digits, so never a company's
			name: null,
			exchange: null,
			kind: 'fund'
		})
	)
];

beforeAll(async () => {
	await replaceTickers(createDb(client), list);
});

it('holds the whole list a replace was handed', async () => {
	const count = async (table: string) =>
		(await first<{ n: number }>(stmt(`select count(*) as n from ${table}`)))?.n;
	expect(await count('ticker')).toBe(COMPANIES + FUNDS);
	expect(await count('ticker_name')).toBe(COMPANIES);
});

it('reads a symbol prefix through the primary key, never a scan of ticker', async () => {
	const [search] = await statementsOf((db) => searchTickers(db, 'ap', 10));
	const plan = (
		await all<{ detail: string }>(
			stmt(`explain query plan ${search?.sql}`, ...(search?.params ?? []))
		)
	).map((step) => step.detail);
	expect(plan).toContainEqual(
		expect.stringMatching(
			/^SEARCH ticker USING (COVERING )?INDEX sqlite_autoindex_ticker_1 \(symbol>\? AND symbol<\?\)/
		)
	);
	expect(plan).not.toContainEqual(expect.stringMatching(/^SCAN (ticker|t)\b(?!_)/));
});
