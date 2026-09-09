import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_ALLOWED_ORIGINS } from '@better-giving/operator/origins';
import { createDb, type Db } from '../db/client';
import { readSites, readSitesInUse, replaceSites } from './queries';
import { parseSites, type ParsedSites } from './site-input';

// real D1 inside workerd, over the committed migrations — so the unique index, the scheme
// check and `STRICT` are all the deployed ones.
//
// the `site` table object is deliberately not imported here: every read and write of it lives
// in ./queries.ts, and the probes below reach past drizzle on purpose — a check is a property
// of the database, so the statement that tests it should be the one a hand-written
// `wrangler d1 execute` would send.

/** raised by a check constraint, i.e. not by the type system. */
const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';

/**
 * runs `fn`, requires D1 to have rejected it, and hands back the message. fails loudly rather
 * than returning a sentinel if the statement succeeded.
 */
async function rejection(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
	} catch (e) {
		return String((e as Error).message);
	}
	throw new Error('expected D1 to reject this statement, but it succeeded');
}

/**
 * a postable revenue account, read out of the table rather than written down.
 *
 * `form` carries the composite postable foreign key, so a made-up id fails on the INSERT — and
 * the seeded account ids are reference data belonging to
 * `migrations/0000_initial_schema.sql`, so pinning one here would be a second copy of it.
 */
let revenueAccountId: string;

let db: Db;
beforeAll(async () => {
	// the request-path constructor, not a fixture: what these tests exercise is what `requestDb`
	// builds for every request (src/request-context.ts).
	db = createDb(env.DB);

	const row = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	if (!row)
		throw new Error(
			'no 4110 account — has the chart of accounts in migrations/0000_initial_schema.sql moved?'
		);
	revenueAccountId = row.id;
});

// storage is isolated per test file, not per test, so rows written by one `it` are visible to
// the next — and this table holds one deployment-wide list, so every case would otherwise
// depend on execution order.
beforeEach(async () => {
	await env.DB.prepare('delete from site').run();
	// the forms too: `readSitesInUse` reads them through ../forms/queries.ts, so a form one case
	// wrote would go on blocking a removal in the next.
	await env.DB.prepare('delete from form').run();
});

/**
 * one form holding a set of sites, past drizzle.
 *
 * raw SQL rather than a query from ../forms/queries.ts: there is no form-creation query to
 * reach for outside a parsed submission, and writing the row directly keeps the fixture off the
 * path of the thing under test. `allowed_origins` is written as the JSON the column holds, which
 * is what `readForms` decodes and what this module reads through it.
 */
async function insertForm(
	id: string,
	name: string,
	origins: readonly string[],
	options: { createdAt?: number; archived?: boolean } = {}
): Promise<void> {
	const createdAt = options.createdAt ?? 0;
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, allowed_origins,
		                   created_at, updated_at, archived_at)
		 values (?, ?, ?, ?, 'USD', ?, ?, ?, ?)`
	)
		.bind(
			id,
			name,
			options.archived ? 'archived' : 'draft',
			revenueAccountId,
			JSON.stringify(origins),
			createdAt,
			createdAt,
			options.archived ? createdAt : null
		)
		.run();
}

/** parses and stores in one step — the path the settings form action takes. */
async function store(rows: readonly string[]): Promise<void> {
	const result = parseSites(rows);
	if (!result.ok) throw new Error(`fixture did not parse: ${result.problem}`);
	await replaceSites(db, result.value satisfies ParsedSites);
}

describe('readSites', () => {
	it('reads an empty list on a deployment that has listed nothing', async () => {
		// no seeded row, and there must never be one: a fork's sites are its own, so a
		// deployment starts with none and the empty state on the screen says so.
		expect(await readSites(db)).toEqual([]);
	});
});

describe('replaceSites', () => {
	it('stores the list exactly as it was given, in the order it was typed', async () => {
		// the order is the operator's. a list that comes back sorted by address reads as the screen
		// having eaten an edit, which is the same rule `@better-giving/operator/origins` keeps
		// about first-seen order inside one parse — `site.position` is what carries it across the
		// write.
		const typed = [
			'https://zebra.example.org',
			'https://alpha.example.org',
			'http://localhost:5173'
		];
		await store(typed);
		expect(await readSites(db)).toEqual(typed);
	});

	it('keeps a port exactly as typed, on every spelling of a machine of your own', async () => {
		// the stored value is compared to a browser's `Origin` header literally
		// (`../api/cors.ts`), and which port `vite dev` picked is not this layer's to tidy. the
		// bracketed v6 literal is here because it is the one that looks like something to strip:
		// a dev server that binds v6-first sends exactly `http://[::1]:5173` as its `Origin`.
		const typed = ['http://localhost:5173', 'http://127.0.0.1:8788', 'http://[::1]:4173'];
		await store(typed);
		expect(await readSites(db)).toEqual(typed);
	});

	it('never folds a case, because the parse hands one down already folded', async () => {
		// there is no lower-casing anywhere on this path and there must not be: what is stored is
		// what the parse made of the row, and a write that tidied it further would be storing a
		// value nothing on this deployment decided. the folding is the parse's and it is the
		// browser's own — a host typed with capitals is sent lower-cased in the `Origin` header,
		// so `url.origin` is what a comparison against that header can be made with.
		await store(['https://Give.example.org']);
		expect(await readSites(db)).toEqual(['https://give.example.org']);
	});

	it('removes a site the new list leaves out', async () => {
		// the save is one act over the whole group: `Remove` beside a row writes nothing, so a
		// site absent from what was submitted is one the operator took off.
		await store(['https://give.example.org', 'https://shop.example.org']);
		await store(['https://shop.example.org']);
		expect(await readSites(db)).toEqual(['https://shop.example.org']);
	});

	it('stores an empty list, which is what removing the last site leaves', async () => {
		// a real submission rather than a no-op. `not in ()` is not a predicate, so the delete is
		// unqualified in this case, and a save that quietly kept the old list would leave a
		// deployment serving sites its operator had removed.
		await store(['https://give.example.org']);
		await store([]);
		expect(await readSites(db)).toEqual([]);
	});

	it('keeps created_at on a site that survives a save, and moves it up the list', async () => {
		// a save is an upsert on `site_origin_idx` rather than a delete of everything followed by
		// an insert of everything, so `created_at` goes on meaning when this deployment first
		// listed the site rather than when somebody last pressed Save on a screen it was sitting
		// on. seeded at 0 rather than raced against workerd's frozen clock across two saves.
		await store(['https://give.example.org', 'https://shop.example.org']);
		await env.DB.prepare('update site set created_at = 0, updated_at = 0').run();

		await store(['https://shop.example.org', 'https://give.example.org']);

		expect(await readSites(db)).toEqual(['https://shop.example.org', 'https://give.example.org']);
		const row = await env.DB.prepare('select created_at, updated_at from site where origin = ?')
			.bind('https://give.example.org')
			.first<{ created_at: number; updated_at: number }>();
		expect(row?.created_at).toBe(0);
		// `$onUpdateFn` reaches the conflict path too — drizzle's `buildUpdateSet` adds every
		// column carrying one, whether or not this module named it.
		expect(row?.updated_at).toBeGreaterThan(0);
	});

	it('saves a list at the cap in a handful of statements', async () => {
		// the two D1 caps this write is shaped around, asserted rather than trusted: 100 bound
		// parameters per query and — the one that bites a fork on the free plan — 50 queries per
		// Worker invocation. one statement per site would spend a whole invocation on the biggest
		// list `MAX_ALLOWED_ORIGINS` allows, so the inserts are chunked, and this is what fails if
		// the arithmetic behind `SITES_PER_STATEMENT` stops holding.
		const full = Array.from(
			{ length: MAX_ALLOWED_ORIGINS },
			(_, i) => `https://site-${i}.example.org`
		);
		await store(full);
		expect(await readSites(db)).toEqual(full);
	});
});

describe('readSitesInUse', () => {
	it('names the form still listing a site, with its id and its name together', async () => {
		// the refusal in front of a removal needs both: the name is what the sentence says, and
		// the id is what the link beside it goes to. a count would tell an operator nothing about
		// which screen to open.
		await insertForm('frm_springappealtest', 'Spring appeal', ['https://give.example.org']);
		expect(await readSitesInUse(db, ['https://give.example.org'])).toEqual([
			{
				site: 'https://give.example.org',
				forms: [{ id: 'frm_springappealtest', name: 'Spring appeal' }]
			}
		]);
	});

	it('never names an archived form', async () => {
		// an archived form serves nothing — ../forms/published-config.ts refuses it as
		// `form_retired` — and cannot be edited, because every group write in ../forms/queries.ts
		// refuses an archived row at its `where`. so a removal blocked by one would be blocked
		// forever, with no screen able to clear it.
		await insertForm('frm_retiredformtest', 'Gala 2024', ['https://give.example.org'], {
			archived: true
		});
		expect(await readSitesInUse(db, ['https://give.example.org'])).toEqual([]);
	});

	it('leaves out a site no live form lists', async () => {
		// absent means nothing is in the way, which is what the caller acts on: a site listed and
		// never ticked is an ordinary state, not a fault, and removing it is refused by nothing.
		await insertForm('frm_springappealtest', 'Spring appeal', ['https://give.example.org']);
		expect(await readSitesInUse(db, ['https://shop.example.org'])).toEqual([]);
	});

	it('groups every blocking form under its site, sites in the order asked', async () => {
		// the sentence names each site and every form still ticking it, and the destinations
		// rendered beside it are the same set in the same order — two sources for one fact is how
		// they drift. the forms come back oldest first, which is `readForms`' order.
		await insertForm('frm_secondformtest0', 'Monthly giving', ['https://shop.example.org'], {
			createdAt: 0
		});
		await insertForm(
			'frm_firstformtestid',
			'Spring appeal',
			['https://give.example.org', 'https://shop.example.org'],
			{ createdAt: 1 }
		);

		expect(
			await readSitesInUse(db, ['https://shop.example.org', 'https://give.example.org'])
		).toEqual([
			{
				site: 'https://shop.example.org',
				forms: [
					{ id: 'frm_secondformtest0', name: 'Monthly giving' },
					{ id: 'frm_firstformtestid', name: 'Spring appeal' }
				]
			},
			{
				site: 'https://give.example.org',
				forms: [{ id: 'frm_firstformtestid', name: 'Spring appeal' }]
			}
		]);
	});

	it('asks nothing when there is nothing to remove', async () => {
		// a save that removed no site has no question to put to the forms, and a settings screen
		// saving an unchanged list is the ordinary case rather than the rare one.
		await insertForm('frm_springappealtest', 'Spring appeal', ['https://give.example.org']);
		expect(await readSitesInUse(db, [])).toEqual([]);
	});
});

describe('the constraints under the list', () => {
	it('refuses a second row for a site already listed', async () => {
		// the list is a set: a repeat renders as two identical boxes with no way to tell which one
		// a `Remove` was aimed at, and says nothing an allowlist could act on. the parse drops a
		// repeat silently; this is the floor under a hand-run `wrangler d1 execute`.
		await store(['https://give.example.org']);
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into site (id, origin, position, created_at, updated_at)
				 values ('duplicate', 'https://give.example.org', 9, 0, 0)`
			).run()
		);
		expect(message).toContain('SQLITE_CONSTRAINT_UNIQUE');
	});

	it('refuses a site stored without its scheme', async () => {
		// the failure this check exists for is silent everywhere else: `../api/cors.ts` compares a
		// browser's `Origin` header to this list literally, so a bare host name is an entry that
		// matches nothing on earth — the form renders, the donor fills in their card, and the gift
		// is refused with no message attached.
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into site (id, origin, position, created_at, updated_at)
				 values ('bare', 'give.example.org', 0, 0, 0)`
			).run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('site_origin_scheme_check');
	});
});
