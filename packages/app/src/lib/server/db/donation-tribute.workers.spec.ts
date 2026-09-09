import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

// the five tribute columns on `donation`, read off the applied migrations rather than off
// schema.ts.
//
// they constrain nothing, which is a claim rather than an omission: the vocabulary, the pairings
// and the bounds are the app's own two parse boundaries — `parseTribute` in
// ../donations/quote-input.ts and `tributeOf` in ../donations/collect.ts — and a test asserting the
// database refuses none of it is what stops the next reader assuming otherwise. nothing can be
// added to them cheaply either: `donation` has children (`line_item`, `payment`), so a CHECK on any
// of the five is a rebuild whose `DROP TABLE donation` D1 refuses.
//
// column order is the other half. rule 1 in ./schema.ts is about where a column is appended, and a
// column inserted anywhere but the end is the silent rebuild — so the position is read here rather
// than trusted to have stayed put.

const CONTACT_ID = '019fb200-0000-7000-8000-000000000001';
const PLAIN_ID = '019fb200-0000-7000-8000-000000000002';
const TRIBUTE_ID = '019fb200-0000-7000-8000-000000000003';

const insertDonation = (id: string, columns = '', values = '') =>
	env.DB.prepare(
		`insert into donation (id, contact_id, total_minor, currency, received_at, created_at${columns})
		 values (?, ?, 10000, 'USD', 0, 0${values})`
	).bind(id, CONTACT_ID);

beforeAll(async () => {
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, created_at, updated_at)
		 values (?, 'individual', 'Tribute Donor', 0, 0)`
	)
		.bind(CONTACT_ID)
		.run();
});

/** every column on `donation`, in the order sqlite holds them. */
async function donationColumns() {
	const columns = await env.DB.prepare(
		"select name, type, `notnull` as required, dflt_value as fallback from pragma_table_info('donation')"
	).all<{ name: string; type: string; required: number; fallback: string | null }>();
	return columns.results;
}

const TRIBUTE_COLUMNS = [
	'tribute_kind',
	'tribute_honoree',
	'tribute_notify_name',
	'tribute_notify_email',
	'tribute_notified_at'
] as const;

describe('the tribute columns on `donation`', () => {
	it('appends all five after `recurring_id`, contiguously and in order', async () => {
		// read from where `recurring_id` sits rather than from the end of the table: `program_id`
		// sits after them and every later column lands there too — rule 1 in ./schema.ts admits no
		// other position.
		const names = (await donationColumns()).map((c) => c.name);
		const start = names.indexOf('recurring_id');

		expect(names.slice(start, start + 6)).toEqual(['recurring_id', ...TRIBUTE_COLUMNS]);
	});

	it('leaves every one of them nullable and without a default', async () => {
		// what says "no tribute" about a gift that carries none, and what keeps every writer of this
		// table from having to name any of the five.
		const columns = await donationColumns();
		for (const name of TRIBUTE_COLUMNS) {
			const column = columns.find((c) => c.name === name);
			expect(column, name).toMatchObject({ required: 0, fallback: null });
		}
	});

	it('types the four strings TEXT and the stamp INTEGER', async () => {
		// `tribute_notified_at` is unix milliseconds like every other `_at` column, and STRICT is
		// what turns that INTEGER from an affinity into a constraint (./strict.workers.spec.ts).
		// sqlite reports a STRICT column's type uppercased, whatever the migration typed.
		const columns = await donationColumns();
		const typeOf = (name: string) => columns.find((c) => c.name === name)?.type;

		expect(TRIBUTE_COLUMNS.slice(0, 4).map(typeOf)).toEqual(['TEXT', 'TEXT', 'TEXT', 'TEXT']);
		expect(typeOf('tribute_notified_at')).toBe('INTEGER');
	});

	it('writes null into all five for a gift that carries no tribute', async () => {
		await insertDonation(PLAIN_ID).run();

		const row = await env.DB.prepare(
			`select ${TRIBUTE_COLUMNS.join(', ')} from donation where id = ?`
		)
			.bind(PLAIN_ID)
			.first();
		expect(Object.values(row ?? {})).toEqual([null, null, null, null, null]);
	});

	it('accepts a `tribute_kind` that is not one of the two, so the parse boundary is the guard', async () => {
		// the departure from the `enums ->` rule at the top of ./schema.ts, asserted rather than
		// described: a CHECK here would be a rebuild of a table with children, so the two parse
		// boundaries named in the header are the only thing between a request and this column. a future
		// change that adds the constraint after all turns this red, which is the point — it is a
		// rebuild, and rebuilds are read before they ship (CONTRIBUTING.md -> Migrations).
		await insertDonation(
			TRIBUTE_ID,
			', tribute_kind, tribute_honoree, tribute_notify_email',
			", 'in loving memory of', '', 'not an address'"
		).run();

		const row = await env.DB.prepare('select tribute_kind as k from donation where id = ?')
			.bind(TRIBUTE_ID)
			.first<{ k: string }>();
		expect(row?.k).toBe('in loving memory of');
	});
});
