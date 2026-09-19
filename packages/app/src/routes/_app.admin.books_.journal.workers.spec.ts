import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FORM_CURRENCY } from '$lib/forms/amounts';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { postableId } from '$lib/server/db/accounts';
import { createDb, type Db } from '$lib/server/db/client';
import { post, postingStatements } from '$lib/server/ledger/posting';
import { uuidv7 } from 'uuidv7';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as journal from './_app.admin.books_.journal';

// the accountant's download, driven through the chain the deployment serves it under.
//
// a workers spec because every case is about a range read out of a real D1: what the read includes
// at each end of it, and what the shaping refuses once it has the rows. the shaping itself is
// `$lib/server/ledger/journal-file.spec.ts`'s — what is here is the route's own half, which is the
// three values off the query string, the read they name, and the answer each outcome gets.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

/** the address the file is asked for at. */
const ROUTE = '/admin/books/journal';

let db: Db;
let request: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/books/journal', module: journal }
	]);
	session = await signIn();
});

beforeEach(async () => {
	// the lines first: `ledger_entry.entry_group_id` is a foreign key, so the other order is a
	// constraint violation rather than an empty table.
	await env.DB.prepare('delete from ledger_entry').run();
	await env.DB.prepare('delete from entry_group').run();
});

/** a real session, as the `Cookie` header a browser would send back. */
async function signIn(): Promise<string> {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);

	const auth = createAuth(
		db,
		{ ADMIN_PASSWORD: PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);
	const { headers } = await auth.api.signInStaff({
		body: { password: PASSWORD },
		headers: new Headers({ origin: ORIGIN }),
		returnHeaders: true
	});

	const cookies = headers.getSetCookie().map((value) => value.split(';', 1)[0]);
	expect(cookies.length).toBeGreaterThan(0);
	return cookies.join('; ');
}

/**
 * one balanced entry in the books, dated at `occurredAt`.
 *
 * written through `post()` and `postingStatements()` — the ledger's own writer — rather than by
 * raw insert, so what the download reads is a row the settlement path could have produced. the
 * currency is a parameter because one case is about a range holding two of them.
 */
function entry(occurredAt: Date, over: { currency?: string; amountMinor?: number } = {}) {
	const amountMinor = over.amountMinor ?? 475;
	return post({
		sourceType: 'adjustment',
		sourceId: uuidv7(),
		currency: over.currency ?? FORM_CURRENCY,
		occurredAt,
		memo: 'Stripe fee that never posted.',
		lines: [
			{ accountId: postableId('processorFees'), amountMinor },
			{ accountId: postableId('undepositedFunds'), amountMinor: -amountMinor }
		]
	});
}

/** puts `postings` in the books, in one batch, so a case seeding many costs one round trip. */
async function seed(...postings: ReturnType<typeof entry>[]): Promise<void> {
	const statements = postings.flatMap((posting) => postingStatements(db, posting));
	const [first, ...rest] = statements;
	if (first === undefined) return;
	await db.batch([first, ...rest]);
}

/** asks for the file over the query string, as the screen's own link does. */
async function download(query: Record<string, string>) {
	const url = new URL(ROUTE, ORIGIN);
	for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
	const response = await request(new Request(url, { headers: { cookie: session } }));
	return { response, body: await response.text() };
}

/** the rows of a file, header first. */
function rows(body: string): string[] {
	return body.split('\r\n');
}

/** the range every case that is not about the range itself asks for. */
const MARCH = { from: '2026-03-01', to: '2026-03-31' };

describe('a range the two importers can take', () => {
	it('answers with the file its target is shaped for, named for the target and the range', async () => {
		await seed(entry(new Date(Date.UTC(2026, 2, 15))));

		const { response, body } = await download({ ...MARCH, target: 'quickbooks' });

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/csv');
		expect(response.headers.get('content-disposition')).toBe(
			'attachment; filename="quickbooks-journal-2026-03-01-to-2026-03-31.csv"'
		);
		// the header QuickBooks' importer is mapped against, and the two lines of the one entry
		// under it. the columns themselves are `journal-file.spec.ts`'s; what this asserts is that
		// the target off the query string reached the shaping.
		expect(rows(body)[0]).toBe(
			'Journal No.,Journal Date,Account Name,Journal/Description,Debits,Credits'
		);
		expect(rows(body)).toHaveLength(3);
		expect(rows(body)[1]).toContain('03/15/2026');
	});
});

describe('a request the three values cannot be read from', () => {
	it('refuses a range end that is not a day, naming which end', async () => {
		await seed(entry(new Date(Date.UTC(2026, 2, 15))));

		const { response, body } = await download({ from: 'last March', to: MARCH.to, target: 'xero' });

		expect(response.status).toBe(400);
		// the value and the predicate of it, which is what a 4xx body is read for (CLAUDE.md).
		expect(body).toBe('from must be a date');
		expect(response.headers.get('content-disposition')).toBeNull();
	});

	it('refuses a range with an end missing', async () => {
		const { response, body } = await download({ from: MARCH.from, target: 'xero' });

		expect(response.status).toBe(400);
		expect(body).toBe('to must be a date');
	});

	it('refuses a range written backwards, rather than sending an empty file', async () => {
		await seed(entry(new Date(Date.UTC(2026, 2, 15))));

		const { response, body } = await download({
			from: '2026-03-31',
			to: '2026-03-01',
			target: 'quickbooks'
		});

		expect(response.status).toBe(400);
		expect(body).toBe('to must not be before the first day of the range');
		// a header row with nothing under it is the answer to an empty range, and it would read
		// here as a period this organisation took nothing in.
		expect(response.headers.get('content-disposition')).toBeNull();
	});

	it('refuses a target no importer here is shaped for, naming the two that are', async () => {
		const { response, body } = await download({ ...MARCH, target: 'sage' });

		expect(response.status).toBe(400);
		expect(body).toContain('quickbooks');
		expect(body).toContain('xero');
	});
});

describe('a range no file can be made of', () => {
	it('refuses more lines than the target takes in one file, and sends no file', async () => {
		// Xero takes 300 data rows in one manual journal, and every entry here is two lines — so
		// 151 of them is the first count over it. the cap itself is `journal-file.ts`'s.
		const many = Array.from({ length: 151 }, (_, day) =>
			entry(new Date(Date.UTC(2026, 2, 1 + (day % 31))))
		);
		await seed(...many);

		const { response, body } = await download({ ...MARCH, target: 'xero' });

		expect(response.status).toBe(422);
		expect(body).toContain('302');
		expect(response.headers.get('content-type')).not.toContain('text/csv');
	});

	it('refuses a range holding two currencies, naming both', async () => {
		await seed(
			entry(new Date(Date.UTC(2026, 2, 10))),
			entry(new Date(Date.UTC(2026, 2, 11)), { currency: 'EUR' })
		);

		const { response, body } = await download({ ...MARCH, target: 'quickbooks' });

		expect(response.status).toBe(422);
		expect(body).toContain('EUR');
		expect(body).toContain('USD');
	});
});

describe('a range the books hold nothing in', () => {
	it('answers with the file, holding its header row and nothing under it', async () => {
		await seed(entry(new Date(Date.UTC(2026, 3, 2))));

		const { response, body } = await download({ ...MARCH, target: 'xero' });

		expect(response.status).toBe(200);
		expect(rows(body)).toEqual(['Narration,Date,Description,AccountCode,TaxRate,Amount']);
	});
});

describe('the two ends of the range', () => {
	it('takes the whole of both days, wherever in them an entry was dated', async () => {
		await seed(
			// the last instant before the range opens, and the first after it closes.
			entry(new Date(Date.UTC(2026, 1, 28, 23, 59, 59, 999))),
			entry(new Date(Date.UTC(2026, 2, 1))),
			// a settled gift carries the processor's own time of day, which is the reading a bound
			// at midnight would drop.
			entry(new Date(Date.UTC(2026, 2, 31, 23, 59, 59, 999))),
			entry(new Date(Date.UTC(2026, 3, 1)))
		);

		const { body } = await download({ ...MARCH, target: 'xero' });

		// the header, and one row per line of the two entries inside the range.
		expect(rows(body)).toHaveLength(5);
		expect(rows(body)[1]).toContain('03/01/2026');
		expect(rows(body)[3]).toContain('03/31/2026');
	});
});
