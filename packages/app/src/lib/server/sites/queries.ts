import { asc, notInArray, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../db/client';
import { site } from '../db/schema';
import { readForms } from '../forms/queries';
import type { ParsedSites } from './site-input';

// every read and write of `site`, so the `site` table object never leaves this module — the same
// boundary `../org/queries.ts`, `../forms/queries.ts` and `../ledger/posting.ts` draw, and it is
// what makes "all the writes are here" true rather than aspirational.
//
// ---------------------------------------------------------------------------
// execute, or return statements — the rule for every write added below.
//
// a single-row write that must land on its own may execute itself. a write that must land
// atomically with a row in another table may not: it would split into a row-building half and a
// statement-building half and splice the statement into the one `batch()` that owns the whole
// write, as `../contacts/queries.ts` does. `Db` has no `transaction` (D1 has none — see
// ../db/client.ts), so a single `batch()` is the only atomic unit there is.
//
// there is no statement half here and that is a statement about the table, not an omission: this
// list is saved on its own from a settings form and there is nothing it could need to be atomic
// with. `replaceSites` owns its own `batch()` because it is many rows rather than many tables.
//
// ---------------------------------------------------------------------------
// this module reads `form` through `../forms/queries.ts` and never touches the table itself.
//
// `readSitesInUse` is a question about forms — which of them still list a site somebody is about
// to remove — and the answer has to come from `readForms`, which is the module that owns that
// table. it is not a join and cannot become one: `form.allowed_origins` holds the site values
// rather than references into this table, deliberately and permanently (see the header on `site`
// in ../db/schema.ts), so the membership test is over a decoded JSON column and is done here in
// TypeScript over a list a deployment holds in the low tens.
// ---------------------------------------------------------------------------

/** what `db.batch()` takes: non-empty, because a batch of nothing is not a write. */
type Writes = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];

/**
 * how many sites one INSERT may carry, and it is arithmetic rather than taste.
 *
 * a multi-row INSERT at all, unlike `postingStatements` in ../ledger/posting.ts which is one
 * statement per row: D1 caps a Worker invocation at 50 queries on the free tier, and a fork on
 * the free plan saving `MAX_ALLOWED_ORIGINS` sites one statement each would spend the whole
 * invocation on this one save and take the request down with it — auth's own reads included.
 * chunking is what keeps a full list inside a handful of statements.
 *
 * the number comes off the other cap. D1 documents 100 bound parameters per query and refuses at
 * exactly 100 — `too many SQL variables`, verified against the pool at 20 rows — so 99 is the
 * usable ceiling. drizzle binds five columns per row here: `origin` and `position`, plus `id` and
 * the two timestamps, which are supplied by the column's own `$defaultFn` and are bound all the
 * same. 16 rows is 80, which leaves room for a sixth column to be appended to this table before
 * the arithmetic has to change at all.
 *
 * `queries.workers.spec.ts` saves a list at `MAX_ALLOWED_ORIGINS` so both caps are asserted
 * rather than trusted.
 */
const SITES_PER_STATEMENT = 16;

/**
 * every site this deployment has listed, in the operator's own order.
 *
 * a list and never a lookup: the screen that types them renders all of them, and every form
 * screen renders all of them as tick boxes with the form's own set ticked. nothing anywhere asks
 * this table about one site by id.
 *
 * `position` and then `id`, and the tiebreak is not decoration: positions are what the last save
 * wrote and nothing in the database makes them unique (see the note on the column in
 * ../db/schema.ts), so two rows sharing one would otherwise reshuffle between loads. ordering on
 * anything the operator did not choose — the address, the write time — is a list that comes back
 * re-sorted, which reads as the screen having eaten an edit.
 *
 * the strings and not the rows. every consumer renders the address: as a box on the screen that
 * types it, as a tick box on a form screen, as the value stored in `form.allowed_origins`. an id
 * would be a handle onto a row nothing points at and nothing removes by.
 */
export async function readSites(db: Db): Promise<string[]> {
	const rows = await db
		.select({ origin: site.origin })
		.from(site)
		.orderBy(asc(site.position), asc(site.id));
	return rows.map((row) => row.origin);
}

/**
 * stores the whole list, exactly as it was parsed, and removes every site not in it.
 *
 * the whole list rather than one row at a time, because a list is what this table holds. the
 * screen edits it one site at a time and each press is its own write, so what an action hands in
 * is the stored list read back with one entry appended or one gone — and the delete rides in the
 * same write as the inserts rather than being a second act that could half-happen.
 *
 * one `batch()`, which is the only atomic unit D1 has — `Db` omits `transaction`. a delete that
 * landed without its inserts would empty a deployment's list and stop every form loading
 * anywhere, so the two halves are not separable.
 *
 * an upsert on `site_origin_idx` rather than a delete of everything followed by an insert of
 * everything. a site that survives a save keeps its row, so `created_at` goes on meaning when
 * this deployment first listed it rather than when somebody last pressed Save on a screen the
 * site was merely sitting on. `position` is the only column a re-save moves; `updated_at` moves
 * with it, because it carries `$onUpdateFn` and drizzle adds it to every `set`.
 *
 * an empty list is a real submission and is stored: it is what the operator gets after removing
 * the last site, and it is an ordinary deployment rather than a broken one — its forms are given on
 * the donation page it serves on its own address.
 * the delete is unqualified in that case, because `not in ()` is not a predicate.
 *
 * nothing here checks whether a form still lists a site being removed. that is `readSitesInUse`
 * below, asked by the action in front of this write, and it stays a separate question because the
 * refusal it powers has to name every form — a rule two write points keep rather than one the
 * database enforces.
 */
export async function replaceSites(db: Db, input: ParsedSites): Promise<void> {
	const sites = input.sites;

	const removals =
		sites.length === 0
			? db.delete(site)
			: db.delete(site).where(notInArray(site.origin, [...sites]));

	const rows = sites.map((origin, position) => ({ origin, position }));
	const upserts = chunked(rows, SITES_PER_STATEMENT).map((chunk) =>
		db
			.insert(site)
			.values(chunk)
			.onConflictDoUpdate({
				target: site.origin,
				// `excluded` is the row this statement tried to insert, which is where the new
				// position is. naming `position` alone is deliberate: it is the one column a re-save
				// may move, and a `set` that also wrote `created_at` would erase when the site was
				// first listed.
				set: { position: sql`excluded.position` }
			})
	);

	// non-empty by construction rather than by assertion: the delete is always there, whatever the
	// submitted list holds.
	const writes: Writes = [removals, ...upserts];
	await db.batch(writes);
}

/** a form still listing a site somebody is about to remove. */
export type BlockingForm = {
	readonly id: string;
	readonly name: string;
};

/** one site that cannot be removed yet, and every form standing in the way of it. */
export type SiteInUse = {
	readonly site: string;
	readonly forms: readonly BlockingForm[];
};

/**
 * which of the sites about to be removed are still listed on a form, and which forms those are.
 *
 * asked in front of `replaceSites` by the action that saves the list, so a removal that would
 * leave a form pointing at a site this deployment no longer has is refused with a sentence
 * naming what to go and untick. a site nothing lists is absent from the answer entirely — an
 * empty result is "nothing is in the way" and is what the caller acts on.
 *
 * the id and the name together, because the refusal needs both: the name is what the sentence
 * says, and the id is what the link beside it goes to. a count would tell an operator nothing
 * about which screen to open.
 *
 * **archived forms are never named.** an archived form serves nothing — `published-config.ts`
 * refuses it as `form_retired` — and cannot be edited, because every group write in
 * ../forms/queries.ts refuses an archived row at its `where`. so a removal blocked by one would
 * be blocked forever, with no screen able to clear it. `readForms` already excludes them, which
 * is why this asks that question rather than the table.
 *
 * the order is the caller's for the sites and `readForms`' for the forms, and both are stable:
 * the sentence and the list of destinations beside it are one set in one order, and two sources
 * for that fact is how they drift.
 */
export async function readSitesInUse(db: Db, sites: readonly string[]): Promise<SiteInUse[]> {
	if (sites.length === 0) return [];

	const forms = await readForms(db);
	const inUse: SiteInUse[] = [];
	for (const candidate of sites) {
		const blocking = forms
			.filter((form) => form.allowedOrigins.includes(candidate))
			.map((form) => ({ id: form.id, name: form.name }));
		if (blocking.length > 0) inUse.push({ site: candidate, forms: blocking });
	}
	return inUse;
}

/** `items` in runs of at most `size`, in order. */
function chunked<T>(items: readonly T[], size: number): T[][] {
	const runs: T[][] = [];
	for (let i = 0; i < items.length; i += size) runs.push(items.slice(i, i + size));
	return runs;
}
