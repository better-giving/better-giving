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
const ZAPIER_KEY = `bgz_${'AZaz09-_'.repeat(5)}abc`;
const OPEN_ZAP = '019fb300-0000-7000-8000-000000000005';
const ENDED_ZAP = '019fb300-0000-7000-8000-000000000006';

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
		db()
			.prepare(
				`insert into zapier_key (id, key_hash, key, created_at, updated_at)
				 values ('zapier', '${'a'.repeat(64)}', ?, 0, 0)`
			)
			.bind(ZAPIER_KEY),
		db()
			.prepare(
				`insert into zapier_subscription
				   (id, "trigger", hook_url, ended_at, ended_reason, created_at, updated_at)
				 values (?, 'new_gift', 'https://hooks.zapier.com/hooks/standard/1/open/', null, null, 0, 0),
				        (?, 'new_donor', 'https://hooks.zapier.com/hooks/standard/1/ended/', 5, 'unsubscribed', 0, 5)`
			)
			.bind(OPEN_ZAP, ENDED_ZAP),
		db().prepare(
			`insert into quickbooks_connection
			   (id, realm_id, company_name, access_token, access_token_expires_at, refresh_token,
			    refresh_token_expires_at, income_account_id, income_account_name, fee_account_id,
			    fee_account_name, stripe_balance_account_id, stripe_balance_account_name, start_at,
			    created_at, updated_at)
			 values ('quickbooks', '4620816365', 'Riverside Shelter', 'acc', 3600000, 'ref', 7,
			         '79', 'Donations', '80', 'Merchant fees', '36', 'Stripe balance', 6, 0, 0)`
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
	// after the payments, which they point at. a pending and a sent row on the open Zap and a sent
	// row on the ended one, so a rebuild of `zapier_subscription` has children under both kinds of
	// parent to lose.
	await db()
		.prepare(
			`insert into zapier_delivery
			   (subscription_id, event_id, payment_id, status, attempts, next_attempt_at, leased_until,
			    created_at, updated_at)
			 values (?, 'evt-probe', 'p-card', 'pending', 1, 3, 4, 0, 0),
			        (?, 'evt-sent', 'p-card', 'sent', 1, 3, null, 0, 1),
			        (?, 'evt-ended', 'p-cash', 'sent', 2, 3, null, 0, 2)`
		)
		.bind(OPEN_ZAP, OPEN_ZAP, ENDED_ZAP)
		.run();
}

let migrated: Promise<{ before: Map<string, Row[]>; after: Map<string, Row[]> }> | undefined;

/** the chain stopped one short, seeded, then finished — once, for every block in this file. */
function migrateOverSeed() {
	migrated ??= (async () => {
		const chain = env.TEST_MIGRATIONS;
		await applyD1Migrations(db(), chain.slice(0, -1));
		await seed();
		const before = await snapshot();
		await applyD1Migrations(db(), chain);
		return { before, after: await snapshot() };
	})();
	return migrated;
}

describe('the newest migration keeps every row the database already held', () => {
	const chain = env.TEST_MIGRATIONS;
	const squashed = chain.length < 2;
	let before: Map<string, Row[]>;
	let after: Map<string, Row[]>;

	beforeAll(async () => {
		if (squashed) return;
		({ before, after } = await migrateOverSeed());
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
				).toEqual(rows.map((r) => project(r, columns)));
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
			expect(after.get('zapier_subscription')?.map((r) => r.id)).toEqual([OPEN_ZAP, ENDED_ZAP]);
			expect(after.get('zapier_delivery')?.map((r) => r.event_id)).toEqual([
				'evt-probe',
				'evt-sent',
				'evt-ended'
			]);
			expect(after.get('quickbooks_connection')?.map((r) => r.realm_id)).toEqual(['4620816365']);
		}
	);

	it.skipIf(squashed)('keeps a key already stored, and every Zap on it stays subscribed', () => {
		expect(after.get('zapier_key')?.map((r) => r.key)).toEqual([ZAPIER_KEY]);
		expect(after.get('zapier_subscription')?.find((r) => r.id === OPEN_ZAP)).toMatchObject({
			ended_at: null,
			ended_reason: null
		});
		expect(after.get('zapier_delivery')?.map((r) => [r.status, r.leased_until])).toEqual([
			['pending', 4],
			['sent', null],
			['sent', null]
		]);
	});

	it.skipIf(squashed)('leaves no foreign key pointing at nothing', async () => {
		const { results } = await db().prepare('select * from pragma_foreign_key_check').all();
		expect(results).toEqual([]);
	});
});

// what 0010 is for, on the database it migrated rather than the empty one every other spec reads:
// the rebuilt subscription table takes the new trigger and its seeded rows' deliveries still
// resolve to it, and a dispute can be written against the refund row the seed holds.
describe('0010 takes a gift_refunded Zap and a dispute on a database already taking gifts', () => {
	const squashed = env.TEST_MIGRATIONS.length < 2;

	beforeAll(async () => {
		if (squashed) return;
		await migrateOverSeed();
	});

	it.skipIf(squashed)(
		'subscribes a Zap to gift_refunded, and a delivery row resolves to it',
		async () => {
			await db().batch([
				db().prepare(
					`insert into zapier_subscription (id, "trigger", hook_url, created_at, updated_at)
				 values ('zap-refunded', 'gift_refunded', 'https://hooks.zapier.com/hooks/standard/1/refunded/', 0, 0)`
				),
				db().prepare(
					`insert into zapier_delivery
				   (subscription_id, event_id, payment_id, next_attempt_at, created_at, updated_at)
				 values ('zap-refunded', 'p-refund', 'p-refund', 0, 0, 0)`
				)
			]);
			const { results } = await db()
				.prepare(
					`select subscription_id, event_id from zapier_delivery where event_id = 'p-refund'`
				)
				.all();
			expect(results).toEqual([{ subscription_id: 'zap-refunded', event_id: 'p-refund' }]);
		}
	);

	it.skipIf(squashed)('records a dispute against the seeded refund row', async () => {
		await db()
			.prepare(
				`insert into dispute (payment_id, reason, created_at, updated_at)
				 values ('p-refund', 'fraudulent', 0, 0)`
			)
			.run();
		const row = await db().prepare(`select outcome, closed_at from dispute`).first();
		expect(row).toEqual({ outcome: null, closed_at: null });
	});
});

// a key minted before 0007 stored it has nothing for the console to show, so 0008 drops its row and
// ends every Zap on it the way a replace ends them. the seed above holds a stored key, so this
// clears it and runs 0008 again, one batch, the way wrangler applies a file.
describe('0008 drops a key that was never stored, and ends every Zap on it', () => {
	const squashed = env.TEST_MIGRATIONS.length < 2;
	let zapierKeys: Row[];
	let subscriptions: Row[];
	let deliveries: Row[];

	beforeAll(async () => {
		if (squashed) return;
		await migrateOverSeed();
		await db().prepare(`update zapier_key set key = null`).run();
		const dropped = env.TEST_MIGRATIONS.find(
			(m) => m.name === '0008_zapier_keyless_row_dropped.sql'
		);
		await db().batch(dropped!.queries.map((q) => db().prepare(q)));
		zapierKeys = (await db().prepare(`select * from zapier_key`).all<Row>()).results;
		subscriptions = (
			await db().prepare(`select * from zapier_subscription order by rowid`).all<Row>()
		).results;
		deliveries = (await db().prepare(`select * from zapier_delivery`).all<Row>()).results;
	});

	it.skipIf(squashed)('leaves no key row', () => {
		expect(zapierKeys).toEqual([]);
	});

	it.skipIf(squashed)('ends the open subscription as key_replaced, now', () => {
		const open = subscriptions.find((r) => r.id === OPEN_ZAP)!;
		expect(open.ended_reason).toBe('key_replaced');
		expect(open.ended_at).toBeGreaterThan(Date.now() - 60_000);
		expect(open.updated_at).toBe(open.ended_at);
	});

	it.skipIf(squashed)('leaves a subscription that had already ended as it ended', () => {
		expect(subscriptions.find((r) => r.id === ENDED_ZAP)).toMatchObject({
			ended_at: 5,
			ended_reason: 'unsubscribed',
			updated_at: 5
		});
	});

	it.skipIf(squashed)('drops what the ended subscription was still owed', () => {
		const owed = deliveries.find((r) => r.event_id === 'evt-probe')!;
		expect(owed).toMatchObject({ status: 'dropped', leased_until: null });
		expect(owed.updated_at).toBeGreaterThan(Date.now() - 60_000);
	});

	it.skipIf(squashed)('leaves a delivery already sent as it was sent', () => {
		expect(deliveries.find((r) => r.event_id === 'evt-sent')).toMatchObject({
			status: 'sent',
			updated_at: 1
		});
	});
});
