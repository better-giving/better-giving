import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { POSTING_ACCOUNTS } from './accounts';

// the newest migration, applied over a database that already holds gifts.
//
// every other workers spec runs against an empty schema the whole chain built at once, so a
// rebuild that drops rows, or a `DROP TABLE` whose deferral is missing, passes all of them: an
// empty table copies clean. the deployment that matters is the one already taking gifts, and its
// remote apply is a one-way door (CONTRIBUTING.md -> Migrations). so this file stops the chain one
// short on `UNMIGRATED_DB`, seeds a row of every shape the payment and recurring tables hold,
// applies the newest file the way wrangler does — one batch — and reads every table back.
//
// the seed is written against the schema before the newest migration. a later migration that
// renames or drops a seeded column turns this red at its seed, which is the point to re-seed; a
// squash into one file leaves nothing to stop short of, and the first assertion says so.

const CONTACT_ID = '019fb300-0000-7000-8000-000000000001';
const FORM_ID = 'frm_migrationprobe';
const PLAN_ID = '019fb300-0000-7000-8000-000000000002';
const ONE_TIME_ID = '019fb300-0000-7000-8000-000000000003';
const CHARGE_ID = '019fb300-0000-7000-8000-000000000004';

const db = () => env.UNMIGRATED_DB;

type Row = Record<string, unknown>;

/** every application table, from sqlite's own catalogue — the same filter strict.workers.spec.ts reads. */
async function tableNames(): Promise<string[]> {
	const { results } = await db()
		.prepare(
			`select name from pragma_table_list
			 where schema = 'main' and type = 'table'
			   and name not like 'sqlite_%' and name not like '\\_cf\\_%' escape '\\'
			   and name <> 'd1_migrations'
			 order by name`
		)
		.all<{ name: string }>();
	return results.map((r) => r.name);
}

async function snapshot(): Promise<Map<string, Row[]>> {
	const tables = new Map<string, Row[]>();
	for (const name of await tableNames()) {
		const { results } = await db().prepare(`select * from "${name}" order by rowid`).all<Row>();
		tables.set(name, results);
	}
	return tables;
}

/** a row cut down to the columns the earlier schema had, so a column the migration adds is not a difference. */
const project = (row: Row, columns: readonly string[]): Row =>
	Object.fromEntries(columns.map((c) => [c, row[c]]));

async function seed() {
	const statements = [
		db()
			.prepare(
				`insert into contact (id, kind, display_name, created_at, updated_at)
				 values (?, 'individual', 'Probe Donor', 0, 0)`
			)
			.bind(CONTACT_ID),
		db()
			.prepare(
				`insert into form (id, name, revenue_account_id, currency, created_at, updated_at)
				 values (?, 'probe', ?, 'USD', 0, 0)`
			)
			.bind(FORM_ID, POSTING_ACCOUNTS.donationsDeductible.id),
		db()
			.prepare(
				`insert into recurring_plan
				   (id, contact_id, form_id, amount_minor, currency, "interval", status, provider,
				    provider_subscription_id, provider_customer_id, started_at, created_at, updated_at)
				 values (?, ?, ?, 2500, 'USD', 'monthly', 'active', 'stripe', 'sub_probe', 'cus_probe', 0, 0, 0)`
			)
			.bind(PLAN_ID, CONTACT_ID, FORM_ID),
		db()
			.prepare(
				`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
				 values (?, ?, 10000, 'USD', 0, 0)`
			)
			.bind(ONE_TIME_ID, CONTACT_ID),
		db()
			.prepare(
				`insert into donation (id, contact_id, total_minor, currency, received_at, created_at,
				                       recurring_id)
				 values (?, ?, 2500, 'USD', 0, 0, ?)`
			)
			.bind(CHARGE_ID, CONTACT_ID, PLAN_ID),
		db().prepare(
			`insert into zapier_key (id, key_hash, created_at, updated_at)
			 values ('zapier', '${'a'.repeat(64)}', 0, 0)`
		)
	];
	// a row of each nullable shape `payment` holds — a processor with its id, staff entry with and
	// without a provider, a refund — so a rebuild's copy step has every combination to lose.
	const payments: [string, string, number, string, string, string, string | null, string | null][] =
		[
			['p-card', CHARGE_ID, 2500, 'inbound', 'card', 'succeeded', 'stripe', 'pi_probe'],
			['p-refund', CHARGE_ID, 500, 'refund', 'card', 'succeeded', 'stripe', 're_probe'],
			['p-venmo', ONE_TIME_ID, 10000, 'inbound', 'venmo', 'pending', 'paypal', 'pp_probe'],
			['p-daf', ONE_TIME_ID, 10000, 'inbound', 'daf', 'failed', 'chariot', 'grant_probe'],
			['p-cash', ONE_TIME_ID, 10000, 'inbound', 'cash', 'succeeded', 'manual', null],
			['p-unknown', ONE_TIME_ID, 10000, 'inbound', 'check', 'cancelled', null, null]
		];
	for (const [id, donationId, amount, direction, method, status, provider, txn] of payments) {
		statements.push(
			db()
				.prepare(
					`insert into payment (id, donation_id, amount_minor, currency, direction, method,
					                      status, provider, provider_txn_id, occurred_at, created_at)
					 values (?, ?, ?, 'USD', ?, ?, ?, ?, ?, 1, 2)`
				)
				.bind(id, donationId, amount, direction, method, status, provider, txn)
		);
	}
	await db().batch(statements);
}

describe('the newest migration keeps every row the database already held', () => {
	const chain = env.TEST_MIGRATIONS;
	const squashed = chain.length < 2;
	let before: Map<string, Row[]>;
	let after: Map<string, Row[]>;

	beforeAll(async () => {
		if (squashed) return;
		await applyD1Migrations(db(), chain.slice(0, -1));
		await seed();
		before = await snapshot();
		await applyD1Migrations(db(), chain);
		after = await snapshot();
	});

	it('has an earlier migration to stop short of', () => {
		expect(
			chain.length,
			'one migration file: the chain was squashed, so there is no populated database to migrate. delete this spec until the next migration lands.'
		).toBeGreaterThan(1);
	});

	it.skipIf(squashed)(
		'leaves every table holding the rows it held, column for column',
		async () => {
			expect([...before.keys()].length).toBeGreaterThan(5);
			for (const [table, rows] of before) {
				const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
				expect(
					(after.get(table) ?? []).map((r) => project(r, columns)),
					`${table} lost or changed rows across the newest migration`
				).toEqual(rows);
			}
		}
	);

	it.skipIf(squashed)(
		'keeps the seeded gifts, so the comparison above is over rows rather than empty tables',
		() => {
			expect(after.get('payment')?.map((r) => r.id)).toEqual([
				'p-card',
				'p-refund',
				'p-venmo',
				'p-daf',
				'p-cash',
				'p-unknown'
			]);
			expect(after.get('donation')?.find((r) => r.id === CHARGE_ID)?.recurring_id).toBe(PLAN_ID);
			expect(after.get('recurring_plan')?.map((r) => r.id)).toEqual([PLAN_ID]);
			expect(after.get('zapier_key')?.map((r) => r.id)).toEqual(['zapier']);
		}
	);

	it.skipIf(squashed)('leaves no foreign key pointing at nothing', async () => {
		const { results } = await db().prepare('select * from pragma_foreign_key_check').all();
		expect(results).toEqual([]);
	});
});
