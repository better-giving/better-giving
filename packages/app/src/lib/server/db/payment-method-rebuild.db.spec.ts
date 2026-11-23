import { beforeAll, describe, expect, it } from 'vitest';
import { post, postingStatements } from '../ledger/posting';
import { donationRevenueAccount, postableId } from './accounts';
import { createDb } from './client';
import { MIGRATIONS, openUnmigrated, rawSql, stmt } from './database.testing';
import { applyMigrations } from './migrate';
import { rejectionCode } from './rejection.testing';

// 0042 rebuilds `payment`, create-copy-drop-rename, to add 'stock' and 'ira_qcd' to
// `payment_method_check`. an empty table copies clean, so this file stops the chain in front of
// 0042 on a database of its own, writes a payment on every method the old check names, between
// them holding a value in every column the table has, hangs a refund, a dispute, two Zapier
// deliveries and a ledger entry off them, applies 0042 alone, and reads every row back whole.

const REBUILT_BY = '0042_stock_and_ira_qcd_pledges.sql';
const REBUILD = MIGRATIONS.findIndex((m) => m.name === REBUILT_BY);

const CONTACT_ID = '019fb600-0000-7000-8000-000000000001';
const DONATION_ID = '019fb600-0000-7000-8000-000000000002';
const REFUNDED_DONATION_ID = '019fb600-0000-7000-8000-000000000003';
const ZAP_ID = '019fb600-0000-7000-8000-000000000004';

type Row = Record<string, unknown>;

/** every column `payment` has in front of 0042, in table order. */
const PAYMENT_COLUMNS = [
	'id',
	'donation_id',
	'amount_minor',
	'currency',
	'direction',
	'method',
	'status',
	'provider',
	'provider_txn_id',
	'occurred_at',
	'created_at',
	'coin',
	'coin_network',
	'coin_amount',
	'valid_until',
	'parent_payment_id',
	'provider_reference',
	'notice_owed_since',
	'notice_maybe_sent_at'
] as const;

type Payment = Record<(typeof PAYMENT_COLUMNS)[number], string | number | null>;

const base = { currency: 'USD', direction: 'inbound', parent_payment_id: null } as const;
const noCoin = { coin: null, coin_network: null, coin_amount: null, valid_until: null } as const;

/** one row per method the old check names, and a refund: each column holds a value on one. */
const PAYMENTS: readonly Payment[] = [
	{
		...base,
		...noCoin,
		id: 'p-cash',
		donation_id: DONATION_ID,
		amount_minor: 1000,
		method: 'cash',
		status: 'succeeded',
		provider: 'manual',
		provider_txn_id: null,
		provider_reference: 'RCPT-0001',
		occurred_at: 11,
		created_at: 12,
		notice_owed_since: 13,
		notice_maybe_sent_at: 14
	},
	{
		...base,
		...noCoin,
		id: 'p-check',
		donation_id: DONATION_ID,
		amount_minor: 2000,
		method: 'check',
		status: 'succeeded',
		provider: null,
		provider_txn_id: null,
		provider_reference: null,
		occurred_at: 21,
		created_at: 22,
		notice_owed_since: 23,
		notice_maybe_sent_at: null
	},
	{
		...base,
		...noCoin,
		id: 'p-card',
		donation_id: REFUNDED_DONATION_ID,
		amount_minor: 3000,
		method: 'card',
		status: 'succeeded',
		provider: 'stripe',
		provider_txn_id: 'pi_rebuild',
		provider_reference: 'ch_rebuild',
		occurred_at: 31,
		created_at: 32,
		notice_owed_since: 33,
		notice_maybe_sent_at: 34
	},
	{
		...base,
		...noCoin,
		id: 'p-ach',
		donation_id: DONATION_ID,
		amount_minor: 4000,
		method: 'ach',
		status: 'pending',
		provider: 'stripe',
		provider_txn_id: 'pi_rebuild_ach',
		provider_reference: 'py_rebuild',
		occurred_at: 41,
		created_at: 42,
		notice_owed_since: 43,
		notice_maybe_sent_at: null
	},
	{
		...base,
		...noCoin,
		id: 'p-paypal',
		donation_id: DONATION_ID,
		amount_minor: 5000,
		method: 'paypal',
		status: 'succeeded',
		provider: 'paypal',
		provider_txn_id: 'pp_rebuild',
		provider_reference: 'ORDER-REBUILD',
		occurred_at: 51,
		created_at: 52,
		notice_owed_since: 53,
		notice_maybe_sent_at: 54
	},
	{
		...base,
		...noCoin,
		id: 'p-venmo',
		donation_id: DONATION_ID,
		amount_minor: 6000,
		method: 'venmo',
		status: 'pending',
		provider: 'paypal',
		provider_txn_id: 'venmo_rebuild',
		provider_reference: 'ORDER-VENMO',
		occurred_at: 61,
		created_at: 62,
		notice_owed_since: null,
		notice_maybe_sent_at: null
	},
	{
		...base,
		...noCoin,
		id: 'p-daf',
		donation_id: DONATION_ID,
		amount_minor: 7000,
		method: 'daf',
		status: 'failed',
		provider: 'chariot',
		provider_txn_id: 'grant_rebuild',
		provider_reference: 'TRK-REBUILD',
		occurred_at: 71,
		created_at: 72,
		notice_owed_since: 73,
		notice_maybe_sent_at: 74
	},
	{
		...base,
		id: 'p-crypto',
		donation_id: DONATION_ID,
		amount_minor: 8000,
		method: 'crypto',
		status: 'pending',
		provider: 'nowpayments',
		provider_txn_id: '5077125051',
		provider_reference: 'np_rebuild',
		occurred_at: 81,
		created_at: 82,
		coin: 'usdttrc20',
		coin_network: 'trx',
		coin_amount: '80.125',
		valid_until: 83,
		notice_owed_since: 84,
		notice_maybe_sent_at: 85
	},
	{
		...noCoin,
		id: 'p-refund',
		donation_id: REFUNDED_DONATION_ID,
		amount_minor: 1500,
		currency: 'USD',
		direction: 'refund',
		method: 'card',
		status: 'succeeded',
		provider: 'stripe',
		provider_txn_id: 're_rebuild',
		provider_reference: null,
		parent_payment_id: 'p-card',
		occurred_at: 91,
		created_at: 92,
		notice_owed_since: 93,
		notice_maybe_sent_at: 94
	}
];

/** the methods `payment_method_check` names in front of 0042, held to the old table's SQL below. */
const OLD_METHODS = ['cash', 'check', 'card', 'ach', 'paypal', 'venmo', 'daf', 'crypto'];

const bare = await openUnmigrated();
const { run, first, all } = rawSql(bare);

const insertPayment = (p: Payment) =>
	stmt(
		`insert into payment (${PAYMENT_COLUMNS.join(', ')})
		 values (${PAYMENT_COLUMNS.map(() => '?').join(', ')})`,
		...PAYMENT_COLUMNS.map((c) => p[c])
	);

/** a balanced entry naming one payment as its source, posted the way the app posts one. */
function postFor(payment: Payment) {
	const db = createDb(bare);
	const sign = payment.direction === 'refund' ? -1 : 1;
	const posting = post({
		sourceType: payment.direction === 'refund' ? 'refund' : 'payment',
		sourceId: String(payment.id),
		currency: 'USD',
		occurredAt: new Date(0),
		lines: [
			{ accountId: postableId('bankCash'), amountMinor: sign * Number(payment.amount_minor) },
			{ accountId: donationRevenueAccount(true), amountMinor: -sign * Number(payment.amount_minor) }
		]
	});
	return db.batch(postingStatements(db, posting));
}

async function seed() {
	await bare.batch([
		stmt(
			`insert into contact (id, kind, display_name, created_at, updated_at)
			 values (?, 'individual', 'Rebuild Donor', 0, 0)`,
			CONTACT_ID
		),
		stmt(
			`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
			 values (?, ?, 36000, 'USD', 0, 0), (?, ?, 3000, 'USD', 0, 0)`,
			DONATION_ID,
			CONTACT_ID,
			REFUNDED_DONATION_ID,
			CONTACT_ID
		),
		...PAYMENTS.map(insertPayment),
		stmt(
			`insert into dispute (payment_id, outcome, respond_by, reason, closed_at, created_at, updated_at)
			 values ('p-card', 'refunded', 100, 'fraudulent', 101, 102, 103)`
		),
		stmt(
			`insert into zapier_subscription
			   (id, "trigger", hook_url, ended_at, ended_reason, created_at, updated_at)
			 values (?, 'new_gift', 'https://hooks.zapier.com/hooks/standard/1/rebuild/', null, null, 0, 0)`,
			ZAP_ID
		),
		stmt(
			`insert into zapier_delivery
			   (subscription_id, event_id, payment_id, status, attempts, next_attempt_at, leased_until,
			    created_at, updated_at)
			 values (?, 'evt-crypto', 'p-crypto', 'pending', 1, 3, 4, 0, 0),
			        (?, 'evt-cash', 'p-cash', 'sent', 1, 3, null, 0, 1)`,
			ZAP_ID,
			ZAP_ID
		)
	]);
	for (const payment of PAYMENTS) {
		if (payment.status === 'succeeded') await postFor(payment);
	}
}

const rowsOf = (table: string) => all<Row>(stmt(`select * from "${table}" order by rowid`));

/** each index on `payment`, by what sqlite says it is rather than how its SQL is quoted. */
async function paymentIndexes() {
	const list = await all<Row>(
		stmt(
			`select l.name, l."unique", l.partial, group_concat(i.name, ',') as columns
			 from pragma_index_list('payment') l, pragma_index_info(l.name) i
			 group by l.name order by l.name`
		)
	);
	return list.map((r) => ({ ...r }));
}

/** the `CREATE` statement sqlite holds for `name`, or `undefined` when there is none. */
const schemaSql = async (name: string) =>
	(await first<{ sql: string }>(stmt(`select sql from sqlite_schema where name = ?`, name)))?.sql;

const partialWhere = async (index: string) => (await schemaSql(index))?.replace(/^.* WHERE /s, '');

const DEPENDENTS = ['dispute', 'zapier_delivery', 'entry_group', 'ledger_entry'] as const;

let before: {
	sql: string | undefined;
	payment: Row[];
	columns: Row[];
	indexes: Row[];
	dependents: Row[][];
};

beforeAll(async () => {
	expect(REBUILD, `${REBUILT_BY} is committed`).toBeGreaterThan(0);
	await applyMigrations(bare, MIGRATIONS.slice(0, REBUILD));
	await seed();
	before = {
		sql: await schemaSql('payment'),
		payment: await rowsOf('payment'),
		columns: await all<Row>(stmt(`select * from pragma_table_xinfo('payment')`)),
		indexes: await paymentIndexes(),
		dependents: await Promise.all(DEPENDENTS.map(rowsOf))
	};
	expect(await applyMigrations(bare, MIGRATIONS.slice(REBUILD, REBUILD + 1))).toEqual([REBUILT_BY]);
});

describe(`${REBUILT_BY} over a database holding payments`, () => {
	it('was seeded with a payment on every method the old check names', () => {
		expect(before.sql).toContain(
			`CHECK("method" in (${OLD_METHODS.map((m) => `'${m}'`).join(', ')}))`
		);
		expect(new Set(before.payment.map((r) => r.method))).toEqual(new Set(OLD_METHODS));
		expect(before.payment.map((r) => ({ ...r }))).toEqual(PAYMENTS);
	});

	it('brings every payment back unchanged, column for column', async () => {
		expect(await all<Row>(stmt(`select * from pragma_table_xinfo('payment')`))).toEqual(
			before.columns
		);
		expect(await rowsOf('payment')).toEqual(before.payment);
	});

	it('leaves the dispute, the Zapier deliveries and the ledger entries untouched', async () => {
		expect(await Promise.all(DEPENDENTS.map(rowsOf))).toEqual(before.dependents);
	});

	it('keeps every index on payment, the partial crypto index included', async () => {
		expect(await paymentIndexes()).toEqual(before.indexes);
		expect(await partialWhere('payment_pending_crypto_provider_created_at_idx')).toBe(
			`"payment"."method" = 'crypto' and "payment"."status" = 'pending'`
		);
		expect(
			await all(stmt(`select name from sqlite_schema where name like '\\_\\_new\\_%' escape '\\'`))
		).toEqual([]);
	});

	it('leaves every foreign key into payment resolving, and enforced', async () => {
		expect(await all(stmt('PRAGMA foreign_key_check'))).toEqual([]);
		expect(
			await all(
				stmt(
					`select r.id as refund, p.id as parent from payment r join payment p on p.id = r.parent_payment_id`
				)
			)
		).toEqual([{ refund: 'p-refund', parent: 'p-card' }]);
		expect(
			await all(stmt(`select d.payment_id from dispute d join payment p on p.id = d.payment_id`))
		).toEqual([{ payment_id: 'p-card' }]);
		expect(
			await all(
				stmt(
					`select z.payment_id from zapier_delivery z join payment p on p.id = z.payment_id order by z.payment_id`
				)
			)
		).toEqual([{ payment_id: 'p-cash' }, { payment_id: 'p-crypto' }]);
		expect(
			await all(
				stmt(
					`select g.source_id from entry_group g left join payment p on p.id = g.source_id
					 where p.id is null`
				)
			)
		).toEqual([]);
		expect(
			await rejectionCode(() => run(stmt(`delete from payment where id = 'p-crypto'`)))
		).toContain('SQLITE_CONSTRAINT_FOREIGNKEY');
	});

	it('takes a stock and an IRA (QCD) payment, and still refuses a method it does not name', async () => {
		const settled = (id: string, method: string) =>
			run(
				stmt(
					`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
					                      provider, occurred_at, created_at)
					 values (?, ?, 100, 'USD', 'inbound', ?, 'succeeded', 'manual', 0, 0)`,
					id,
					DONATION_ID,
					method
				)
			);
		expect((await settled('p-stock', 'stock')).rowsAffected).toBe(1);
		expect((await settled('p-ira', 'ira_qcd')).rowsAffected).toBe(1);
		const code = await rejectionCode(() => settled('p-wire', 'wire'));
		expect(code).toContain('SQLITE_CONSTRAINT_CHECK');
		expect(code).toContain('payment_method_check');
	});
});
