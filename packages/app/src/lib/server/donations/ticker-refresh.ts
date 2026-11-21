import { z } from 'zod';
import type { Db } from '../db/client';
import { alert } from '../email/alert';
import type { EmailProvider } from '../email/provider';
import { readOrgProfile } from '../org/queries';
import {
	listedOnce,
	replaceTickers,
	type TickerRow,
	tickersHeld,
	tickersReplacedAt
} from './tickers';

// the stock step's ticker list, fetched from the SEC's two public files once a day whether or not
// the stock rail is on, and handed whole to `replaceTickers` (./tickers.ts). ../../../cron-runs.ts
// fires it, and the Stocks Save on /admin/payments fires it once where no list is held yet
// (`refreshTickersIfNoneHeld`).
//
// sec.gov answers 403 to a request whose User-Agent names no contact
// (https://www.sec.gov/os/accessing-edgar-data), so the contact is the notification address saved
// in Settings; with none the run still asks, and a 403 is a failure like any other, logged by
// `alert` (../email/alert.ts) and mailed to nobody. its fair-access limit is ten requests a second;
// this run makes two, one after the other.

export const EXCHANGE_FILE_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
export const FUND_FILE_URL = 'https://www.sec.gov/files/company_tickers_mf.json';

export type TickerRefreshDeps = {
	readonly db: Db;
	readonly fetch: typeof globalThis.fetch;
	readonly email: EmailProvider;
};

/**
 * a list younger than this is not fetched again, so a redeploy around 04:20 does not fetch twice.
 * half a day, not just under one: a Stocks Save's first fill (`refreshTickersIfNoneHeld`) lands at
 * any hour, and a list stored at 05:30 must not make the next 04:20 run skip and leave it two days
 * old.
 */
const FRESH_FOR_MS = 12 * 60 * 60_000;

/**
 * how long both files together, bodies included, are given before the run is treated as an answer
 * that never came. shutdown waits for the Stocks Save's refresh (../runtime/deferred.ts) and is
 * killed at the `stop_grace_period` in compose.yaml, so a stalled sec.gov must finish under it.
 */
export const TICKER_REFRESH_TIMEOUT_MS = 20_000;

/** one of the two files: where it is and its shape. */
type SecFile<Row> = {
	readonly url: string;
	readonly schema: z.ZodType<{ readonly data: readonly Row[] }>;
};

/** `{ fields, data }`, each row a tuple in `fields`' order; a company's exchange may be null. */
const EXCHANGE_FILE: SecFile<[number, string, string, string | null]> = {
	url: EXCHANGE_FILE_URL,
	schema: z.object({
		fields: z.tuple([
			z.literal('cik'),
			z.literal('name'),
			z.literal('ticker'),
			z.literal('exchange')
		]),
		data: z.array(z.tuple([z.number(), z.string(), z.string(), z.string().nullable()]))
	})
};

const FUND_FILE: SecFile<[number, string, string, string]> = {
	url: FUND_FILE_URL,
	schema: z.object({
		fields: z.tuple([
			z.literal('cik'),
			z.literal('seriesId'),
			z.literal('classId'),
			z.literal('symbol')
		]),
		data: z.array(z.tuple([z.number(), z.string(), z.string(), z.string()]))
	})
};

/** the most parse issues an alert lists: a changed column fails every row the same way. */
const ISSUES_SHOWN = 3;

/** a file that could not be read, and why, in words for the alert. */
class TickerFileError extends Error {
	readonly url: string;
	readonly reason: string;

	constructor(url: string, reason: string) {
		super(`${url}: ${reason}`);
		this.url = url;
		this.reason = reason;
	}
}

/** a list refused for holding too few tickers beside the one held, in words for the alert. */
class ShrunkListError extends Error {
	constructor(fetched: number, held: number) {
		super(
			`the files list ${fetched} tickers, under half the ${held} the list already holds, so ` +
				'that list was kept'
		);
	}
}

/**
 * the daily run, whether or not the stock rail is on: fetches both files and replaces the list.
 * never throws: a failure leaves the list a donor searches as it was and alerts the operator.
 */
export async function refreshTickers(deps: TickerRefreshDeps, now: Date): Promise<void> {
	try {
		const replacedAt = await tickersReplacedAt(deps.db);
		if (replacedAt !== null && now.getTime() - replacedAt.getTime() < FRESH_FOR_MS) return;
		const profile = await readOrgProfile(deps.db);
		const contact = profile?.notificationEmail ?? null;
		const userAgent = contact === null ? 'better-giving' : `better-giving ${contact}`;
		const fetched = listedOnce(await fetchTickers(deps, userAgent));
		// a truncated copy parses as well as a whole one: a list under half the one held is refused,
		// and a first fill, beside nothing, takes whatever the files list.
		const held = await tickersHeld(deps.db);
		if (fetched.length * 2 < held) throw new ShrunkListError(fetched.length, held);
		await replaceTickers(deps.db, fetched);
	} catch (error) {
		await tellOperator(deps, error);
	}
}

/**
 * `refreshTickers`, where no list has ever been stored: a stock pledge on a ticker the list does not
 * hold is refused (`mintPledge` in ./quote.ts), so the Stocks Save on /admin/payments starts one
 * rather than leave every stock gift refused until the next 04:20 run. a list already held, however
 * old, is that run's to replace. never throws.
 */
export async function refreshTickersIfNoneHeld(deps: TickerRefreshDeps, now: Date): Promise<void> {
	try {
		if ((await tickersReplacedAt(deps.db)) !== null) return;
	} catch (error) {
		await tellOperator(deps, error);
		return;
	}
	await refreshTickers(deps, now);
}

async function fetchTickers(deps: TickerRefreshDeps, userAgent: string): Promise<TickerRow[]> {
	const deadline = AbortSignal.timeout(TICKER_REFRESH_TIMEOUT_MS);
	// the exchange file first: `replaceTickers` keeps a symbol's first row, and only that file names
	// the company.
	const companies = await fetchFile(deps, EXCHANGE_FILE, userAgent, deadline);
	const funds = await fetchFile(deps, FUND_FILE, userAgent, deadline);
	return [
		...companies.map(([, name, symbol, exchange]) => ({
			symbol,
			name,
			exchange,
			kind: 'company' as const
		})),
		...funds.map(([, , , symbol]) => ({
			symbol,
			name: null,
			exchange: null,
			kind: 'fund' as const
		}))
	];
}

async function fetchFile<Row>(
	deps: TickerRefreshDeps,
	file: SecFile<Row>,
	userAgent: string,
	deadline: AbortSignal
): Promise<readonly Row[]> {
	let body: unknown;
	try {
		const response = await deps.fetch(file.url, {
			headers: { 'user-agent': userAgent, accept: 'application/json' },
			signal: deadline
		});
		if (!response.ok) throw new TickerFileError(file.url, `sec.gov answered ${response.status}`);
		body = await response.json();
	} catch (error) {
		if (error instanceof TickerFileError) throw error;
		throw new TickerFileError(file.url, error instanceof Error ? error.message : String(error));
	}
	const parsed = file.schema.safeParse(body);
	if (!parsed.success) {
		const { issues } = parsed.error;
		const shown = z.prettifyError(new z.ZodError(issues.slice(0, ISSUES_SHOWN)));
		const more = issues.length > ISSUES_SHOWN ? `\n(and ${issues.length - ISSUES_SHOWN} more)` : '';
		throw new TickerFileError(file.url, `the file changed shape:\n${shown}${more}`);
	}
	const rows = parsed.data.data;
	if (rows.length === 0) throw new TickerFileError(file.url, 'the file lists no rows');
	return rows;
}

async function tellOperator(deps: TickerRefreshDeps, error: unknown): Promise<void> {
	const facts =
		error instanceof TickerFileError
			? [
					{ label: 'File', value: error.url },
					{ label: 'Cause', value: error.reason }
				]
			: [{ label: 'Cause', value: error instanceof Error ? error.message : String(error) }];
	try {
		await alert(deps, {
			headline: 'The stock ticker list did not refresh',
			body:
				'Donors giving stock search the list this site last fetched from the SEC, which stays ' +
				'as it was. The next try is tomorrow.',
			facts,
			action: 'If this repeats, send this email to whoever set up this site.'
		});
	} catch (thrown) {
		console.error('the alert that the ticker list did not refresh was not sent', thrown);
	}
}
