import { eq, getTableColumns, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { type TickerKind, ticker } from '../db/schema';

// the stock step's ticker list: every symbol the SEC's two public files name, stored here so a
// donor's search never reaches sec.gov. the job that fetches the files hands the whole list to
// `replaceTickers`; a donor's typing runs `searchTickers`, and a stock pledge's ticker is checked by
// `tickerListed`. `ticker` in ../db/schema.ts argues the
// table, and migrations/0043_stock_tickers.sql the full-text table beside it.

export type TickerRow = {
	/** uppercase, class shares in the SEC's dash form: `BRK-B`. */
	readonly symbol: string;
	/** null on a fund: company_tickers_mf.json names none. */
	readonly name: string | null;
	readonly exchange: string | null;
	readonly kind: TickerKind;
};

/** the most bound values one statement takes: `MAX_VARIABLE_NUMBER` in `pragma_compile_options`. */
const SQLITE_MAX_VARIABLE_NUMBER = 32_766;
const ROWS_PER_INSERT = Math.floor(
	SQLITE_MAX_VARIABLE_NUMBER / Object.keys(getTableColumns(ticker)).length
);

const blankToNull = (text: string | null): string | null => text?.trim() || null;

/** each symbol once, trimmed and uppercased, its first listing kept; a blank symbol is dropped. */
function listedOnce(rows: readonly TickerRow[]): TickerRow[] {
	const bySymbol = new Map<string, TickerRow>();
	for (const row of rows) {
		const symbol = row.symbol.trim().toUpperCase();
		if (symbol === '' || bySymbol.has(symbol)) continue;
		bySymbol.set(symbol, {
			symbol,
			name: blankToNull(row.name),
			exchange: blankToNull(row.exchange),
			kind: row.kind
		});
	}
	return [...bySymbol.values()];
}

/**
 * replaces the whole list with `rows`, in one `batch()`: a search sees the old list or the new one,
 * never part of either, and a row the table refuses leaves the old list as it was.
 *
 * the rows may be the SEC's files as parsed. a symbol is trimmed and uppercased (the fund file
 * writes some in lowercase), a blank one is skipped, and a symbol listed twice keeps its first row,
 * so pass the exchange file's rows before the fund file's and a ticker on both keeps its name.
 * a list with no symbol left in it throws a `RangeError` and replaces nothing, so a fetch that
 * parsed to nothing cannot empty the stock step.
 *
 * each insert carries `ROWS_PER_INSERT` rows, the most `SQLITE_MAX_VARIABLE_NUMBER` admits at one
 * bound value per column; 40,000 rows are seven of them.
 */
export async function replaceTickers(db: Db, rows: readonly TickerRow[]): Promise<void> {
	const listed = listedOnce(rows);
	if (listed.length === 0)
		throw new RangeError('a ticker list with no symbol in it replaces nothing');
	const replacedAt = new Date();
	const inserts = [];
	for (let at = 0; at < listed.length; at += ROWS_PER_INSERT) {
		const chunk = listed.slice(at, at + ROWS_PER_INSERT);
		inserts.push(db.insert(ticker).values(chunk.map((row) => ({ ...row, replacedAt }))));
	}
	await db.batch([
		db.run(sql`delete from ticker_name`),
		db.delete(ticker),
		...inserts,
		db.run(
			sql`insert into ticker_name (name, symbol) select name, symbol from ticker where name is not null`
		)
	]);
}

/**
 * at most `limit` tickers for what a donor typed, case-insensitive, each once at its best rank:
 * the exact symbol, then symbols starting with the query (shortest first), then companies with a
 * word of their name starting with it (FTS5's bm25 order). a dot or slash in a symbol reads as the
 * SEC's dash, so `BRK.B` finds `BRK-B`.
 *
 * the query is text, never a pattern: no LIKE runs, and the name search quotes it whole as one FTS5
 * phrase, so `OR`, `NEAR`, `*` and `-` are words. punctuation inside the phrase is a word break, as
 * it is in the indexed names: `coca-cola` finds `Coca Cola`.
 *
 * `limit` is a whole number above zero; anything else throws a `RangeError`, since sqlite reads a
 * negative `LIMIT` as none at all.
 */
export async function searchTickers(db: Db, query: string, limit: number): Promise<TickerRow[]> {
	if (!Number.isInteger(limit) || limit < 1) {
		throw new RangeError(`a ticker search limit is a whole number above zero, not ${limit}`);
	}
	const typed = query.trim();
	if (typed === '') return [];
	const symbol = typed.toUpperCase().replace(/[./]/g, '-');
	const phrase = `"${typed.replaceAll('"', '""')}"*`;
	// the prefix is a range on the primary key, the shape the planner searches an index by. its upper
	// bound is the query followed by U+10FFFF, which sorts after every character a symbol can hold.
	return db.all<TickerRow>(sql`
		select t.symbol, t.name, t.exchange, t.kind
		from (
			select symbol, tier, pos, row_number() over (partition by symbol order by tier, pos) as nth
			from (
				select symbol, 0 as tier, 0 as pos from ticker where symbol = ${symbol}
				union all
				select symbol, 1, row_number() over (order by length(symbol), symbol) from (
					select symbol from ticker
					where symbol > ${symbol} and symbol < ${symbol} || char(1114111)
					order by length(symbol), symbol
					limit ${limit}
				)
				union all
				select symbol, 2, row_number() over (order by rank, symbol) from (
					select symbol, rank from ticker_name
					where ticker_name match ${phrase}
					order by rank, symbol
					limit ${limit}
				)
			)
		) as hit
		join ticker as t on t.symbol = hit.symbol
		where hit.nth = 1
		order by hit.tier, hit.pos
		limit ${limit}
	`);
}

/**
 * whether the list holds this symbol, spelled exactly as it is stored: uppercase, class shares
 * with the SEC's dash. a stock pledge is refused on a symbol it does not hold.
 */
export async function tickerListed(db: Db, symbol: string): Promise<boolean> {
	const [row] = await db
		.select({ symbol: ticker.symbol })
		.from(ticker)
		.where(eq(ticker.symbol, symbol))
		.limit(1);
	return row !== undefined;
}

/** when the list the database holds replaced the one before, or null before any list has. */
export async function tickersReplacedAt(db: Db): Promise<Date | null> {
	const [row] = await db.select({ replacedAt: ticker.replacedAt }).from(ticker).limit(1);
	return row?.replacedAt ?? null;
}
