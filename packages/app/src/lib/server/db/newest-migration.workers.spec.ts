import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { post, postingStatements } from '../ledger/posting';
import { donationRevenueAccount, POSTING_ACCOUNTS, postableId } from './accounts';
import { createDb } from './client';

// every migration the test deployment has not applied, over a database that already holds gifts.
//
// every other workers spec runs against an empty schema the whole chain built at once, so a
// rebuild that drops rows, or a `DROP TABLE` whose deferral is missing, passes all of them: an
// empty table copies clean. the deployment that matters is the one already taking gifts, and its
// remote apply is a one-way door (CONTRIBUTING.md -> Migrations). so this file stops the chain on
// `UNMIGRATED_DB` in front of `FIRST_UNAPPLIED`, seeds a row of every shape the payment,
// recurring, Zapier and QuickBooks tables hold, applies each file from there as one batch with its
// `d1_migrations` row — one file, one transaction, as both remote apply paths run it
// (packages/console/internal/migrate/migrate.go) — and reads every table back.
//
// `FIRST_UNAPPLIED` is the oldest file the test deployment's `d1_migrations` does not list. move it
// forward once that deployment has applied it, never back: every file behind it has crossed the
// door, and every file from it on runs over the seed. the seed is written against the schema in
// front of it. a later migration that renames or drops a seeded column turns this red at its seed,
// which is the point to re-seed, and a table the stop moves past starts empty until a row is added
// for it; a squash into one file leaves nothing to stop short of, and the first assertion says so.

const CONTACT_ID = '019fb300-0000-7000-8000-000000000001';
const FORM_ID = 'frm_migrationprobe';
const PLAN_ID = '019fb300-0000-7000-8000-000000000002';
const ONE_TIME_ID = '019fb300-0000-7000-8000-000000000003';
const CHARGE_ID = '019fb300-0000-7000-8000-000000000004';
const ZAPIER_KEY = `bgz_${'AZaz09-_'.repeat(5)}abc`;
const OPEN_ZAP = '019fb300-0000-7000-8000-000000000005';
const ENDED_ZAP = '019fb300-0000-7000-8000-000000000006';

const REALM = '4620816365';

const FIRST_UNAPPLIED = '0010_gift_refunded_trigger_and_dispute.sql';
const STOP = env.TEST_MIGRATIONS.findIndex((m) => m.name === FIRST_UNAPPLIED);
const nowhereToStop = STOP < 1;

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
		db()
			.prepare(
				`insert into quickbooks_connection
			   (id, realm_id, company_name, access_token, access_token_expires_at, refresh_token,
			    refresh_token_expires_at, income_account_id, income_account_name, fee_account_id,
			    fee_account_name, stripe_balance_account_id, stripe_balance_account_name, start_at,
			    created_at, updated_at)
			 values ('quickbooks', ?, 'Riverside Shelter', 'acc', 3600000, 'ref', 7,
			         '79', 'Donations', '80', 'Merchant fees', '36', 'Stripe balance', 6, 0, 0)`
			)
			.bind(REALM)
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
	// a QuickBooks delivery row in each state a run can leave one: sent, taken by a run and not
	// sent (a send whose answer never came keeps its attempt), and never taken.
	for (const shape of ['sent', 'tried', 'untaken'] as const) {
		SYNC[shape] = await postEntryGroup(`don_qb_${shape}`);
	}
	await db()
		.prepare(
			`insert into quickbooks_sync
			   (entry_group_id, status, attempts, remote_id, created_at, updated_at)
			 values (?, 'sent', 1, '1043', 0, 1),
			        (?, 'pending', 2, null, 0, 1),
			        (?, 'pending', 0, null, 0, 0)`
		)
		.bind(SYNC.sent, SYNC.tried, SYNC.untaken)
		.run();
}

const SYNC = { sent: '', tried: '', untaken: '' };

/**
 * a journal entry for a delivery row to hang off, posted through `post()`: ../ledger/sole-writer.spec.ts
 * refuses a direct write to the ledger tables anywhere outside the ledger module.
 */
async function postEntryGroup(sourceId: string): Promise<string> {
	const unmigrated = createDb(db());
	const posting = post({
		sourceType: 'donation',
		sourceId,
		currency: 'USD',
		occurredAt: new Date(0),
		lines: [
			{ accountId: postableId('bankCash'), amountMinor: 10_000 },
			{ accountId: donationRevenueAccount(true), amountMinor: -10_000 }
		]
	});
	await unmigrated.batch(postingStatements(unmigrated, posting));
	return posting.group.id!;
}

async function recorded(): Promise<string[]> {
	const { results } = await db()
		.prepare('select name from d1_migrations order by id')
		.all<{ name: string }>();
	return results.map((r) => r.name);
}

let migrated:
	| Promise<{ before: Map<string, Row[]>; after: Map<string, Row[]>; overSeed: string[] }>
	| undefined;

/** the chain stopped in front of `FIRST_UNAPPLIED`, seeded, then finished — once, for every block here. */
function migrateOverSeed() {
	migrated ??= (async () => {
		const chain = env.TEST_MIGRATIONS;
		await applyD1Migrations(db(), chain.slice(0, STOP));
		const underSeed = await recorded();
		await seed();
		const before = await snapshot();
		await applyD1Migrations(db(), chain);
		const overSeed = (await recorded()).slice(underSeed.length);
		return { before, after: await snapshot(), overSeed };
	})();
	return migrated;
}

describe('the migrations not yet applied keep every row the database already held', () => {
	const chain = env.TEST_MIGRATIONS;
	let before: Map<string, Row[]>;
	let after: Map<string, Row[]>;
	let overSeed: string[];

	beforeAll(async () => {
		if (nowhereToStop) return;
		({ before, after, overSeed } = await migrateOverSeed());
	});

	it.skipIf(nowhereToStop)('applies every file the test deployment has not, over the seed', () => {
		expect(overSeed[0]).toBe(FIRST_UNAPPLIED);
		expect(overSeed.at(-1)).toBe(chain.at(-1)!.name);
	});

	it('has an earlier migration to stop short of', () => {
		expect(
			STOP,
			`${FIRST_UNAPPLIED} is not in migrations/ with a file in front of it: after a squash there is no populated database to migrate, so delete this spec until the next migration lands; otherwise name the oldest file the test deployment has not applied`
		).toBeGreaterThan(0);
	});

	it.skipIf(nowhereToStop)(
		'leaves every table holding the rows it held, column for column',
		async () => {
			expect([...before.keys()].length).toBeGreaterThan(5);
			for (const [table, rows] of before) {
				const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
				expect(
					(after.get(table) ?? []).map((r) => project(r, columns)),
					`${table} lost or changed rows across the migrations from ${FIRST_UNAPPLIED}`
				).toEqual(rows.map((r) => project(r, columns)));
			}
		}
	);

	it.skipIf(nowhereToStop)(
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
			expect(after.get('quickbooks_connection')?.map((r) => r.realm_id)).toEqual([REALM]);
			expect(after.get('quickbooks_sync')?.map((r) => r.entry_group_id)).toEqual([
				SYNC.sent,
				SYNC.tried,
				SYNC.untaken
			]);
		}
	);

	it.skipIf(nowhereToStop)(
		'keeps a key already stored, and every Zap on it stays subscribed',
		() => {
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
		}
	);

	it.skipIf(nowhereToStop)('leaves no foreign key pointing at nothing', async () => {
		const { results } = await db().prepare('select * from pragma_foreign_key_check').all();
		expect(results).toEqual([]);
	});
});

// what 0010 is for, on the database it migrated rather than the empty one every other spec reads:
// the rebuilt subscription table takes the new trigger and its seeded rows' deliveries still
// resolve to it, and a dispute can be written against the refund row the seed holds.
describe('0010 takes a gift_refunded Zap and a dispute on a database already taking gifts', () => {
	beforeAll(async () => {
		if (nowhereToStop) return;
		await migrateOverSeed();
	});

	it.skipIf(nowhereToStop)(
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

	it.skipIf(nowhereToStop)('records a dispute against the seeded refund row', async () => {
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

// what 0011 is for: a delivery row already sent or taken names the company connected when the
// column arrived, and one never taken names none.
describe('0011 records the company a row already sent went to', () => {
	let realmOf: (entryGroupId: string) => unknown;

	beforeAll(async () => {
		if (nowhereToStop) return;
		const { after } = await migrateOverSeed();
		const rows = after.get('quickbooks_sync') ?? [];
		realmOf = (id) => rows.find((r) => r.entry_group_id === id)?.realm_id;
	});

	it.skipIf(nowhereToStop)('names the connected company on a row it sent', () => {
		expect(realmOf(SYNC.sent)).toBe(REALM);
	});

	it.skipIf(nowhereToStop)(
		'names it on a row a run took and has not sent, which may have reached it',
		() => {
			expect(realmOf(SYNC.tried)).toBe(REALM);
		}
	);

	it.skipIf(nowhereToStop)('names none on a row no run has taken', () => {
		expect(realmOf(SYNC.untaken)).toBeNull();
	});
});

// a key minted before 0007 stored it has nothing for the console to show, so 0008 drops its row and
// ends every Zap on it the way a replace ends them. the seed above holds a stored key, so this
// clears it and runs 0008 again, one batch, the way wrangler applies a file.
describe('0008 drops a key that was never stored, and ends every Zap on it', () => {
	let zapierKeys: Row[];
	let subscriptions: Row[];
	let deliveries: Row[];

	beforeAll(async () => {
		if (nowhereToStop) return;
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

	it.skipIf(nowhereToStop)('leaves no key row', () => {
		expect(zapierKeys).toEqual([]);
	});

	it.skipIf(nowhereToStop)('ends the open subscription as key_replaced, now', () => {
		const open = subscriptions.find((r) => r.id === OPEN_ZAP)!;
		expect(open.ended_reason).toBe('key_replaced');
		expect(open.ended_at).toBeGreaterThan(Date.now() - 60_000);
		expect(open.updated_at).toBe(open.ended_at);
	});

	it.skipIf(nowhereToStop)('leaves a subscription that had already ended as it ended', () => {
		expect(subscriptions.find((r) => r.id === ENDED_ZAP)).toMatchObject({
			ended_at: 5,
			ended_reason: 'unsubscribed',
			updated_at: 5
		});
	});

	it.skipIf(nowhereToStop)('drops what the ended subscription was still owed', () => {
		const owed = deliveries.find((r) => r.event_id === 'evt-probe')!;
		expect(owed).toMatchObject({ status: 'dropped', leased_until: null });
		expect(owed.updated_at).toBeGreaterThan(Date.now() - 60_000);
	});

	it.skipIf(nowhereToStop)('leaves a delivery already sent as it was sent', () => {
		expect(deliveries.find((r) => r.event_id === 'evt-sent')).toMatchObject({
			status: 'sent',
			updated_at: 1
		});
	});
});

// a connection moved to another company whose accounts nobody has picked has been sent nothing, so
// the rows already sent went to the company it left. this marks the seeded connection moved and
// runs 0011's backfill again, alone — its `ADD COLUMN` has already run and cannot run twice.
describe('0011 names no company on a sent row while the connection is moved', () => {
	let realms: unknown[];

	beforeAll(async () => {
		if (nowhereToStop) return;
		await migrateOverSeed();
		const backfill = env.TEST_MIGRATIONS.find(
			(m) => m.name === '0011_quickbooks_sync_realm.sql'
		)!.queries.filter((q) => q.startsWith('UPDATE'));
		expect(backfill).toHaveLength(1);
		await db().batch([
			db().prepare(`update quickbooks_connection set moved_at = 6`),
			db().prepare(`update quickbooks_sync set realm_id = null`),
			...backfill.map((q) => db().prepare(q))
		]);
		const { results } = await db()
			.prepare(`select realm_id from quickbooks_sync order by rowid`)
			.all<Row>();
		realms = results.map((r) => r.realm_id);
	});

	it.skipIf(nowhereToStop)('leaves every row naming none', () => {
		expect(realms).toEqual([null, null, null]);
	});
});
