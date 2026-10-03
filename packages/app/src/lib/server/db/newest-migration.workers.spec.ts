import { createHash } from 'node:crypto';
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { findKeyByPresented } from '../integrations/keys';
import { post, postingStatements } from '../ledger/posting';
import { HELD_UNTIL } from '../webhooks/events';
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
// `api_key` is one: `seedApiKeys` writes it in front of the file that rebuilds it, and
// `webhook_delivery` another, which `seedWebhookDeliveries` writes in front of 0019 and
// `seedPausedBacklog` in front of 0022.

const CONTACT_ID = '019fb300-0000-7000-8000-000000000001';
const FORM_ID = 'frm_migrationprobe';
const PLAN_ID = '019fb300-0000-7000-8000-000000000002';
const ONE_TIME_ID = '019fb300-0000-7000-8000-000000000003';
const CHARGE_ID = '019fb300-0000-7000-8000-000000000004';
const ZAPIER_KEY = `bgz_${'AZaz09-_'.repeat(5)}abc`;
const ZAPIER_KEY_MADE_AT = 1_790_000_000_000;
const OPEN_ZAP = '019fb300-0000-7000-8000-000000000005';
const ENDED_ZAP = '019fb300-0000-7000-8000-000000000006';

const REALM = '4620816365';

const FIRST_UNAPPLIED = '0010_gift_refunded_trigger_and_dispute.sql';
const STOP = env.TEST_MIGRATIONS.findIndex((m) => m.name === FIRST_UNAPPLIED);
const nowhereToStop = STOP < 1;

const API_KEY_REBUILT_BY = '0017_zapier_key_is_an_api_key.sql';
const API_KEY_REBUILD = env.TEST_MIGRATIONS.findIndex((m) => m.name === API_KEY_REBUILT_BY);

const ZAPIER_KEY_DROPPED_BY = '0018_zapier_key_dropped.sql';

const WEBHOOK_DELIVERY_REBUILT_BY = '0019_webhook_delivery_dropped_and_detail.sql';
const WEBHOOK_DELIVERY_REBUILD = env.TEST_MIGRATIONS.findIndex(
	(m) => m.name === WEBHOOK_DELIVERY_REBUILT_BY
);

const OWED_ROWS_PARKED_BY = '0022_webhook_delivery_owed_index.sql';
const OWED_ROWS_PARKING = env.TEST_MIGRATIONS.findIndex((m) => m.name === OWED_ROWS_PARKED_BY);

/**
 * tables a file from the stop on drops on purpose, each asserted gone in that file's own block
 * below, so the column-for-column comparison skips them.
 */
const DROPPED: readonly string[] = ['zapier_key'];

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

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
				 values ('zapier', ?, ?, ?, ?)`
			)
			.bind(sha256Hex(ZAPIER_KEY), ZAPIER_KEY, ZAPIER_KEY_MADE_AT, ZAPIER_KEY_MADE_AT),
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

/** a live key that has been used and a revoked, archived one, in the shape 0013 made them. */
async function seedApiKeys() {
	await db()
		.prepare(
			`insert into api_key
			   (id, name, kind, key_hash, prefix, last_four, created_at, last_used_at, revoked_at,
			    archived_at)
			 values ('key-live', 'CRM sync', 'api', ?, 'bgk_7Qm2', 'wxyz', 1, 2, null, null),
			        ('key-gone', 'warehouse', 'api', ?, 'bgk_Zz09', 'Ab12', 3, null, 4, 5)`
		)
		.bind('b'.repeat(64), 'c'.repeat(64))
		.run();
}

/** a destination and a row in each state 0015 allows, one of them held by a run. */
async function seedWebhookDeliveries() {
	const msg = (n: number) => `msg_00000000-0000-4000-8000-00000000000${n}`;
	await db().batch([
		db()
			.prepare(
				`insert into webhook_destination (id, url, signing_secret, failing_since, created_at, updated_at)
				 values ('dest-probe', 'https://crm.example.org/hooks', ?, 7, 1, 1)`
			)
			.bind(`whsec_${'A'.repeat(43)}=`),
		db()
			.prepare(
				`insert into webhook_delivery
				   (id, destination_id, event, subject_id, status, attempts, next_attempt_at, leased_until,
				    last_status, last_error, delivered_at, created_at, updated_at)
				 values (?, 'dest-probe', 'gift.made', 'p-card', 'pending', 2, 5, 6, 503, '503 Service Unavailable', null, 1, 2),
				        (?, 'dest-probe', 'gift.made', 'p-venmo', 'delivered', 1, 3, null, 200, null, 4, 1, 4),
				        (?, 'dest-probe', 'gift.refunded', 'p-refund', 'failed', 9, 8, null, null, 'TypeError: fetch failed', null, 1, 8)`
			)
			.bind(msg(1), msg(2), msg(3))
	]);
}

const PAUSED_DESTINATIONS = ['dest-paused', 'dest-paused-archived'] as const;

/**
 * a backlog queued, due, for a destination paused in front of 0022, beside one of the same shape
 * for a destination paused and then archived, and a row the paused one was already sent.
 */
async function seedPausedBacklog() {
	const msg = (n: number) => `msg_00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
	await db().batch([
		db()
			.prepare(
				`insert into webhook_destination
				   (id, url, signing_secret, paused_at, failing_since, archived_at, created_at, updated_at)
				 values ('dest-paused', 'https://crm.example.org/paused', ?, 30, 10, null, 1, 30),
				        ('dest-paused-archived', 'https://crm.example.org/gone', ?, 30, 10, 40, 1, 40)`
			)
			.bind(`whsec_${'B'.repeat(43)}=`, `whsec_${'C'.repeat(43)}=`),
		db()
			.prepare(
				`insert into webhook_delivery
				   (id, destination_id, event, subject_id, status, attempts, next_attempt_at, leased_until,
				    last_status, last_error, delivered_at, created_at, updated_at)
				 values (?, 'dest-paused', 'gift.made', 'p-card', 'pending', 0, 31, null, null, null, null, 31, 31),
				        (?, 'dest-paused', 'gift.refunded', 'p-refund', 'pending', 3, 32, 33, 503, '503 Service Unavailable', null, 20, 32),
				        (?, 'dest-paused', 'gift.made', 'p-venmo', 'delivered', 1, 5, null, 200, null, 6, 1, 6),
				        (?, 'dest-paused-archived', 'gift.made', 'p-card', 'pending', 0, 34, null, null, null, null, 34, 34)`
			)
			.bind(msg(1), msg(2), msg(3), msg(4))
	]);
}

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
	| Promise<{
			before: Map<string, Row[]>;
			apiKeysBefore: Row[];
			webhookDeliveriesBefore: Row[];
			pausedBacklogBefore: Row[];
			atApiKeyMove: Map<string, Row[]>;
			recopy: { error: string | null; zapierRows: Row[] };
			after: Map<string, Row[]>;
			overSeed: string[];
	  }>
	| undefined;

/**
 * 0017's copy run again, alone, over the `zapier_key` row it left holding no key: the one moment
 * that table and a keyless row both exist, since 0018 drops it. a copy that read the keyless row
 * would write a row with no prefix, or a second zapier row, and fail on either.
 */
async function recopyKeyless(): Promise<{ error: string | null; zapierRows: Row[] }> {
	const copy = env.TEST_MIGRATIONS[API_KEY_REBUILD]!.queries.filter((q) =>
		q.startsWith('INSERT INTO `api_key`')
	);
	let error: string | null = null;
	try {
		if (copy.length !== 1) throw new Error(`0017 holds ${copy.length} copies into api_key, not 1`);
		await db().batch(copy.map((q) => db().prepare(q)));
	} catch (e) {
		error = String((e as Error).message);
	}
	const { results } = await db()
		.prepare(`select * from api_key where kind = 'zapier' order by rowid`)
		.all<Row>();
	return { error, zapierRows: results };
}

/** the chain stopped in front of `FIRST_UNAPPLIED`, seeded, then finished — once, for every block here. */
function migrateOverSeed() {
	migrated ??= (async () => {
		const chain = env.TEST_MIGRATIONS;
		await applyD1Migrations(db(), chain.slice(0, STOP));
		const underSeed = await recorded();
		await seed();
		const before = await snapshot();
		await applyD1Migrations(db(), chain.slice(0, API_KEY_REBUILD));
		await seedApiKeys();
		await seedWebhookDeliveries();
		const webhookDeliveriesBefore = (
			await db().prepare('select * from webhook_delivery order by rowid').all<Row>()
		).results;
		const apiKeysBefore = (await db().prepare('select * from api_key order by rowid').all<Row>())
			.results;
		await applyD1Migrations(db(), chain.slice(0, API_KEY_REBUILD + 1));
		const atApiKeyMove = await snapshot();
		const recopy = await recopyKeyless();
		await applyD1Migrations(db(), chain.slice(0, OWED_ROWS_PARKING));
		await seedPausedBacklog();
		const pausedBacklogBefore = (
			await db()
				.prepare(`select * from webhook_delivery where destination_id in (?, ?) order by rowid`)
				.bind(...PAUSED_DESTINATIONS)
				.all<Row>()
		).results;
		await applyD1Migrations(db(), chain);
		const overSeed = (await recorded()).slice(underSeed.length);
		return {
			before,
			apiKeysBefore,
			webhookDeliveriesBefore,
			pausedBacklogBefore,
			atApiKeyMove,
			recopy,
			after: await snapshot(),
			overSeed
		};
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
				if (DROPPED.includes(table)) continue;
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
		'keeps a key already made admitting, and every Zap on it stays subscribed',
		async () => {
			expect(await findKeyByPresented(createDb(db()), ZAPIER_KEY, 'zapier')).toMatchObject({
				kind: 'zapier',
				revokedAt: null
			});
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

// what 0012 is for: every payment already written arrives with no reference, and the seeded
// chariot row takes its grant's tracking ID once the column is there.
describe('0012 gives a payment already written a place for its processor reference', () => {
	let references: Row[];

	beforeAll(async () => {
		if (nowhereToStop) return;
		const { after } = await migrateOverSeed();
		references = (after.get('payment') ?? []).map((r) => ({
			id: r.id,
			provider_reference: r.provider_reference
		}));
	});

	it.skipIf(nowhereToStop)('leaves every seeded payment holding none', () => {
		expect(references).toEqual(
			['p-card', 'p-refund', 'p-venmo', 'p-daf', 'p-cash', 'p-unknown'].map((id) => ({
				id,
				provider_reference: null
			}))
		);
	});

	it.skipIf(nowhereToStop)('stores a tracking ID on the seeded chariot row', async () => {
		await db()
			.prepare(`update payment set provider_reference = 'TRK-probe' where id = 'p-daf'`)
			.run();
		const row = await db()
			.prepare(`select provider_reference as r from payment where id = 'p-daf'`)
			.first();
		expect(row).toEqual({ r: 'TRK-probe' });
	});
});

// what 0017 is for: the Zapier key already made becomes Zapier's row of `api_key`, admitted by the
// same hash, and the plaintext `zapier_key` held is stored nowhere after it.
describe('0017 carries the Zapier key into api_key and keeps no plaintext', () => {
	let after: Map<string, Row[]>;
	let before: Map<string, Row[]>;
	let apiKeysBefore: Row[];

	beforeAll(async () => {
		if (nowhereToStop) return;
		({ atApiKeyMove: after, before, apiKeysBefore } = await migrateOverSeed());
	});

	it.skipIf(nowhereToStop)('writes one zapier row, admitted by the hash the key had', () => {
		const zapier = (after.get('api_key') ?? []).filter((r) => r.kind === 'zapier');
		expect(zapier).toEqual([
			{
				id: expect.stringMatching(
					/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
				),
				name: 'Zapier',
				kind: 'zapier',
				key_hash: sha256Hex(ZAPIER_KEY),
				prefix: ZAPIER_KEY.slice(0, 8),
				last_four: ZAPIER_KEY.slice(-4),
				created_at: ZAPIER_KEY_MADE_AT,
				last_used_at: null,
				revoked_at: null,
				archived_at: null
			}
		]);
	});

	it.skipIf(nowhereToStop)('mints the row a uuidv7 of when the key was made', () => {
		const [zapier] = (after.get('api_key') ?? []).filter((r) => r.kind === 'zapier');
		const millis = parseInt(String(zapier?.id).replace('-', '').slice(0, 12), 16);
		expect(millis).toBe(ZAPIER_KEY_MADE_AT);
	});

	it.skipIf(nowhereToStop)('leaves the key itself in no column of any table', () => {
		const secret = ZAPIER_KEY.slice(4);
		for (const [table, rows] of after) {
			for (const row of rows) {
				for (const [column, value] of Object.entries(row)) {
					expect(String(value), `${table}.${column}`).not.toContain(secret);
				}
			}
		}
		expect(after.get('zapier_key')?.map((r) => r.key)).toEqual([null]);
	});

	it.skipIf(nowhereToStop)('keeps the rest of the zapier_key row as it was', () => {
		const kept = (r: Row) => project(r, ['id', 'key_hash', 'created_at']);
		expect(after.get('zapier_key')?.map(kept)).toEqual(before.get('zapier_key')?.map(kept));
	});

	it.skipIf(nowhereToStop)('keeps every key already in api_key, column for column', () => {
		expect((after.get('api_key') ?? []).filter((r) => r.kind === 'api')).toEqual(apiKeysBefore);
	});
});

// a `zapier_key` row with no stored key has nothing to cut a prefix from. 0008 deleted the one
// such row a deployment could hold, but the copy still reads only rows holding a key:
// `recopyKeyless` runs it again over the row 0017 left keyless.
describe('0017 copies nothing from a zapier_key row holding no key', () => {
	let recopy: { error: string | null; zapierRows: Row[] };
	let atApiKeyMove: Map<string, Row[]>;

	beforeAll(async () => {
		if (nowhereToStop) return;
		({ recopy, atApiKeyMove } = await migrateOverSeed());
	});

	it.skipIf(nowhereToStop)('writes no second zapier row', () => {
		expect(recopy.error).toBeNull();
		expect(recopy.zapierRows).toEqual(
			(atApiKeyMove.get('api_key') ?? []).filter((r) => r.kind === 'zapier')
		);
	});
});

// what 0018 is for: nothing reads `zapier_key` once 0017 has carried its key across, so the table
// goes. the key it held still admitting is the first block's.
describe('0018 drops zapier_key', () => {
	let after: Map<string, Row[]>;

	beforeAll(async () => {
		if (nowhereToStop) return;
		({ after } = await migrateOverSeed());
	});

	it('is the file after 0017', () => {
		expect(env.TEST_MIGRATIONS[API_KEY_REBUILD + 1]?.name).toBe(ZAPIER_KEY_DROPPED_BY);
	});

	it.skipIf(nowhereToStop)('leaves no zapier_key table', () => {
		expect([...after.keys()]).not.toContain('zapier_key');
	});
});

// what 0019 is for: `webhook_delivery`'s status CHECK takes `dropped`, and the table gains `detail`.
// the change is a rebuild, so the rows 0015's shape held — one held by a run — must come through it
// column for column, with no `detail` the copy made up.
describe('0019 lets a webhook delivery be dropped and keep a detail, keeping every delivery queued', () => {
	let webhookDeliveriesBefore: Row[];
	let after: Map<string, Row[]>;

	beforeAll(async () => {
		if (nowhereToStop) return;
		({ webhookDeliveriesBefore, after } = await migrateOverSeed());
	});

	it('rebuilds the table after the seed is written', () => {
		expect(WEBHOOK_DELIVERY_REBUILD).toBeGreaterThan(API_KEY_REBUILD);
	});

	it.skipIf(nowhereToStop)('keeps every row, column for column, with no detail', () => {
		expect(webhookDeliveriesBefore).toHaveLength(3);
		expect(after.get('webhook_delivery')?.filter((r) => r.destination_id === 'dest-probe')).toEqual(
			webhookDeliveriesBefore.map((row) => ({ ...row, detail: null }))
		);
	});

	it.skipIf(nowhereToStop)(
		'takes a detail that is a JSON object, and refuses any other',
		async () => {
			const setDetail = (detail: string) =>
				db()
					.prepare(`update webhook_delivery set detail = ? where subject_id = 'p-venmo'`)
					.bind(detail)
					.run();

			await setDetail('{"attempt":2}');
			for (const refused of ['not json', '[1]', '3', 'null']) {
				await expect(setDetail(refused), refused).rejects.toThrow(/CHECK constraint failed/);
			}
		}
	);

	it.skipIf(nowhereToStop)('takes a dropped row', async () => {
		await db()
			.prepare(
				`update webhook_delivery set status = 'dropped', leased_until = null
				 where subject_id = 'p-card'`
			)
			.run();
		const row = await db()
			.prepare(`select status from webhook_delivery where subject_id = 'p-card'`)
			.first<{ status: string }>();
		expect(row?.status).toBe('dropped');
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

// what 0022's data step is for: a destination paused before its owed rows were held out of the due
// set still holds a backlog due at the time it was queued, which the claim would post to it. every
// row it is still owed is parked at `HELD_UNTIL`, as a pause parks them; nothing else moves.
describe('0022 holds the backlog of a destination already paused out of the due set', () => {
	let pausedBacklogBefore: Row[];
	let deliveries: Row[];
	const byId = (rows: Row[], id: unknown) => rows.find((r) => r.id === id);

	beforeAll(async () => {
		if (nowhereToStop) return;
		let after: Map<string, Row[]>;
		({ pausedBacklogBefore, after } = await migrateOverSeed());
		deliveries = after.get('webhook_delivery') ?? [];
	});

	it('runs after 0019 rebuilds the table', () => {
		expect(OWED_ROWS_PARKING).toBeGreaterThan(WEBHOOK_DELIVERY_REBUILD);
	});

	it.skipIf(nowhereToStop)(
		'parks every row still owed to the paused destination, a held one too, and nothing else about it',
		() => {
			const owed = pausedBacklogBefore.filter(
				(r) => r.destination_id === 'dest-paused' && r.status === 'pending'
			);
			expect(owed).toHaveLength(2);
			for (const row of owed) {
				expect(byId(deliveries, row.id)).toEqual({ ...row, next_attempt_at: HELD_UNTIL.getTime() });
			}
		}
	);

	it.skipIf(nowhereToStop)(
		'leaves a row already sent, an archived destination and one not paused as they were',
		() => {
			const untouched = pausedBacklogBefore.filter(
				(r) => r.destination_id === 'dest-paused-archived' || r.status !== 'pending'
			);
			expect(untouched).toHaveLength(2);
			for (const row of untouched) expect(byId(deliveries, row.id)).toEqual(row);
			expect(
				deliveries.filter((r) => r.destination_id === 'dest-probe').map((r) => r.next_attempt_at)
			).toEqual([5, 3, 8]);
		}
	);
});

// what 0023's `chat_turn_note_check` is for, on the database it migrated: a page made on the
// seeded form takes an assistant turn the reply went wrong on, and refuses a note on an operator's.
describe('0023 notes an assistant turn and never an operator one', () => {
	const PAGE_ID = '019fb300-0000-7000-8000-000000000101';
	const turn = (id: string, seq: number, author: string, model: string | null, note: string) =>
		db()
			.prepare(
				`insert into chat_turn (id, page_id, seq, author, text, model, image_ids, created_at, note)
				 values (?, ?, ?, ?, 'coats for 300 kids', ?, '[]', 0, ?)`
			)
			.bind(id, PAGE_ID, seq, author, model, note)
			.run();

	beforeAll(async () => {
		if (nowhereToStop) return;
		await migrateOverSeed();
		await db()
			.prepare(
				`insert into page (id, type, name, slug, state, form_id, draft, created_at, updated_at)
				 values (?, 'campaign', 'Winter coat drive', 'winter-coats', 'never_published', ?,
				         '{"blocks":[]}', 0, 0)`
			)
			.bind(PAGE_ID, FORM_ID)
			.run();
	});

	it.skipIf(nowhereToStop)('takes a note on an assistant turn', async () => {
		await turn(
			'019fb300-0000-7000-8000-000000000102',
			1,
			'assistant',
			'@cf/probe-model',
			'refused'
		);
		const row = await db()
			.prepare(`select note from chat_turn where page_id = ?`)
			.bind(PAGE_ID)
			.first();
		expect(row).toEqual({ note: 'refused' });
	});

	it.skipIf(nowhereToStop)("refuses a note on an operator's turn", async () => {
		await expect(
			turn('019fb300-0000-7000-8000-000000000103', 2, 'operator', null, 'refused')
		).rejects.toThrow(/chat_turn_note_check/);
	});
});
