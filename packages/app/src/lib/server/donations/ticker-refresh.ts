import { z } from 'zod';
import type { Db } from '../db/client';
import { alert } from '../email/alert';
import type { EmailProvider } from '../email/provider';
import { readOrgProfile } from '../org/queries';
import { replaceTickers, type TickerRow, tickersReplacedAt } from './tickers';

// the stock step's ticker list, fetched from the SEC's two public files once a day and handed whole
// to `replaceTickers` (./tickers.ts). ../../../cron-runs.ts fires it, and the Stocks Save on
// /admin/payments fires it once where no list is held yet (`refreshTickersIfNoneHeld`).
//
// sec.gov answers 403 to a request whose User-Agent names no contact
// (https://www.sec.gov/os/accessing-edgar-data), so the contact is the notification address saved
// in Settings, else `MAIL_FROM`; with neither the run still asks, and a 403 is a failure like any
// other. its fair-access limit is ten requests a second; this run makes two, one after the other.

export const EXCHANGE_FILE_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
export const FUND_FILE_URL = 'https://www.sec.gov/files/company_tickers_mf.json';

export type TickerRefreshDeps = {
	readonly db: Db;
	readonly fetch: typeof globalThis.fetch;
	readonly email: EmailProvider;
	/** `MAIL_FROM`, the contact sec.gov is given where no notification address is saved. */
	readonly mailFrom: string | null;
};

/**
 * a list younger than this is not fetched again. under a day by the hour a run may take to store its
 * list, which is stamped after the minute that fired it, so the next day's run is not itself skipped.
 */
const FRESH_FOR_MS = 23 * 60 * 60_000;

/** one of the two files: where it is, its shape, and the fewest rows a whole copy of it holds. */
type SecFile<Row> = {
	readonly url: string;
	readonly schema: z.ZodType<{ readonly data: readonly Row[] }>;
	readonly fewest: number;
};

// each `fewest` is about half what the file listed on 2026-11-21 (10,399 and 28,670 rows), so a
// truncated or emptied copy is refused before it can replace a whole list.

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
	}),
	fewest: 5_000
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
	}),
	fewest: 14_000
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

/**
 * fetches both files and replaces the list. never throws: a failure leaves the list a donor
 * searches as it was and alerts the operator.
 */
export async function refreshTickers(deps: TickerRefreshDeps, now: Date): Promise<void> {
	try {
		const replacedAt = await tickersReplacedAt(deps.db);
		if (replacedAt !== null && now.getTime() - replacedAt.getTime() < FRESH_FOR_MS) return;
		const profile = await readOrgProfile(deps.db);
		const contact = profile?.notificationEmail ?? deps.mailFrom;
		const userAgent = contact === null ? 'better-giving' : `better-giving ${contact}`;
		await replaceTickers(deps.db, await fetchTickers(deps, userAgent));
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
	// the exchange file first: `replaceTickers` keeps a symbol's first row, and only that file names
	// the company.
	const companies = await fetchFile(deps, EXCHANGE_FILE, userAgent);
	const funds = await fetchFile(deps, FUND_FILE, userAgent);
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
	userAgent: string
): Promise<readonly Row[]> {
	let body: unknown;
	try {
		const response = await deps.fetch(file.url, {
			headers: { 'user-agent': userAgent, accept: 'application/json' }
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
	if (rows.length < file.fewest) {
		throw new TickerFileError(
			file.url,
			`the file lists ${rows.length} rows, fewer than the ${file.fewest} a whole copy holds`
		);
	}
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
