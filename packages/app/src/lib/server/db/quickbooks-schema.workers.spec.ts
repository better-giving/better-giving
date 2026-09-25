import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { post, postingStatements } from '../ledger/posting';
import { donationRevenueAccount, postableId } from './accounts';
import { createDb } from './client';

// the constraints the two QuickBooks tables carry, which are one-way for the reason
// ./donation-schema.workers.spec.ts opens with: each is a rebuild of the table to change.
//
// what is deliberately not here, on that file's redundancy rule: `STRICT` on the two tables and
// `NO ACTION` on `quickbooks_sync.entry_group_id`, both read off sqlite's catalogue by
// ./strict.workers.spec.ts, and the `optionalNotBlank` bodies on the nullable text columns (the
// shared helper, pinned on `payment.provider_txn_id`). what `STRICT` buys on these columns in
// particular is the last describe.
//
// every query below is scoped to its own rows — the pool gives per-file storage, not per-test.

const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';
const SQLITE_CONSTRAINT_FOREIGNKEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';
const SQLITE_CONSTRAINT_PRIMARYKEY = 'SQLITE_CONSTRAINT_PRIMARYKEY';
const SQLITE_CONSTRAINT_DATATYPE = 'SQLITE_CONSTRAINT_DATATYPE';

/** runs `fn` and requires D1 to have rejected it; same helper as the sibling schema specs. */
async function rejection(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
	} catch (e) {
		return String((e as Error).message);
	}
	throw new Error('expected D1 to reject this statement, but it succeeded');
}

const insertConnection = (id: string) =>
	env.DB.prepare(
		`insert into quickbooks_connection
		   (id, realm_id, access_token, access_token_expires_at, refresh_token, start_at,
		    created_at, updated_at)
		 values (?, '4620816365', 'acc', 3600000, 'ref', 0, 0, 0)`
	)
		.bind(id)
		.run();

const insertSync = (entryGroupId: string) =>
	env.DB.prepare(
		`insert into quickbooks_sync (entry_group_id, created_at, updated_at) values (?, 0, 0)`
	)
		.bind(entryGroupId)
		.run();

/**
 * a real journal entry to hang a delivery row off, posted through `post()` rather than written
 * here: ../ledger/sole-writer.spec.ts scans the tree for a direct write to the ledger tables and
 * exempts only the ledger module, and a spec that reached around that rule would be the first
 * exception to it. it matches text, so the phrase it looks for is kept out of this prose too.
 */
async function postEntryGroup(sourceId: string): Promise<string> {
	const db = createDb(env.DB);
	const posting = post({
		sourceType: 'donation',
		sourceId,
		currency: 'USD',
		occurredAt: new Date('2026-03-31T12:00:00.000Z'),
		lines: [
			{ accountId: postableId('bankCash'), amountMinor: 10_000 },
			{ accountId: donationRevenueAccount(true), amountMinor: -10_000 }
		]
	});
	await db.batch(postingStatements(db, posting));
	// `post()` mints the id, so the caller reads it back rather than supplying one.
	return posting.group.id!;
}

let ENTRY_GROUP_ID: string;

// the singleton connection is seeded here rather than by the first test that needs it, so no case
// below depends on having run after another one.
beforeAll(async () => {
	await insertConnection('quickbooks');
	ENTRY_GROUP_ID = await postEntryGroup('don_quickbooks_probe');
});

describe('one quickbooks company per deployment', () => {
	it('refuses a second connection row under any other id', async () => {
		const message = await rejection(() => insertConnection('quickbooks-2'));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('quickbooks_connection_id_check');
	});

	it('refuses a second connection row under the same id', async () => {
		// the other half of "one row, ever": the check bounds which id a row may carry and the
		// primary key bounds how many rows may carry it. neither alone is the promise.
		const message = await rejection(() => insertConnection('quickbooks'));
		expect(message).toContain(SQLITE_CONSTRAINT_PRIMARYKEY);
	});
});

describe('an account choice is an id with its label beside it', () => {
	// an update rather than an insert for the reason the STRICT probe below gives: the table
	// holds one row and only one.
	const chooseAccounts = (columns: string) =>
		env.DB.prepare(`update quickbooks_connection set ${columns} where id = 'quickbooks'`).run();

	it.each([
		['income', "income_account_id = null, income_account_name = 'Donations'"],
		['fee', "fee_account_id = null, fee_account_name = 'Merchant fees'"],
		['stripe_balance', "stripe_balance_account_id = null, stripe_balance_account_name = 'Stripe'"],
		['paypal_balance', "paypal_balance_account_id = null, paypal_balance_account_name = 'PayPal'"],
		[
			'chariot_balance',
			"chariot_balance_account_id = null, chariot_balance_account_name = 'Chariot'"
		],
		[
			'nowpayments_balance',
			"nowpayments_balance_account_id = null, nowpayments_balance_account_name = 'NOWPayments'"
		],
		[
			'undeposited_funds',
			"undeposited_funds_account_id = null, undeposited_funds_account_name = 'Undeposited Funds'"
		]
	])('refuses a %s account name with no id under it', async (account, columns) => {
		const message = await rejection(() => chooseAccounts(columns));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain(`quickbooks_connection_${account}_account_name_needs_id_check`);
	});

	it('admits a connection with none chosen, which is how one arrives', async () => {
		const row = await env.DB.prepare(
			`select income_account_id as i, fee_account_id as f, stripe_balance_account_id as s,
			        undeposited_funds_account_id as u, moved_at as m
			 from quickbooks_connection where id = 'quickbooks'`
		).first();
		expect(row).toEqual({ i: null, f: null, s: null, u: null, m: null });
	});

	it('keeps no bank deposit account, which nothing posts to', async () => {
		const columns = await env.DB.prepare(
			`select name from pragma_table_info('quickbooks_connection') where name like 'deposit%'`
		).all();
		expect(columns.results).toEqual([]);
	});
});

describe('a delivery row belongs to a journal entry', () => {
	it('refuses an entry group id naming no entry group', async () => {
		const message = await rejection(() => insertSync('019fb500-0000-7000-8000-00000000dead'));
		expect(message).toContain(SQLITE_CONSTRAINT_FOREIGNKEY);
	});

	it('refuses a second delivery row for an entry group that already has one', async () => {
		// where the sync's idempotency lives. `entry_group_source_idx` already refuses a second
		// entry for one (source_type, source_id), so a redelivered webhook arrives back at this
		// same row rather than at a second send.
		await insertSync(ENTRY_GROUP_ID);
		const message = await rejection(() => insertSync(ENTRY_GROUP_ID));
		expect(message).toContain(SQLITE_CONSTRAINT_PRIMARYKEY);
	});
});

describe('a delivery row is in one of three states', () => {
	it.each(['pending', 'sent', 'failed'])('accepts %s', async (status) => {
		const entryGroupId = await postEntryGroup(`don_status_ok_${status}`);
		await env.DB.prepare(
			`insert into quickbooks_sync (entry_group_id, status, created_at, updated_at)
			 values (?, ?, 0, 0)`
		)
			.bind(entryGroupId, status)
			.run();
		const row = await env.DB.prepare(
			'select status as s from quickbooks_sync where entry_group_id = ?'
		)
			.bind(entryGroupId)
			.first();
		expect(row).toEqual({ s: status });
	});

	// 'queued' and 'succeeded' are the words a writer reaches for from the payment vocabulary one
	// table over; 'PENDING' is the right word in the wrong case, which a check on a list of
	// literals is the only thing that catches.
	it.each(['queued', 'succeeded', 'PENDING', ''])('refuses %j', async (status) => {
		const entryGroupId = await postEntryGroup(`don_status_bad_${status}`);
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into quickbooks_sync (entry_group_id, status, created_at, updated_at)
				 values (?, ?, 0, 0)`
			)
				.bind(entryGroupId, status)
				.run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('quickbooks_sync_status_check');
	});

	it('defaults a row that states neither status nor attempts', async () => {
		// drizzle binds its own schema-level default on every insert and never emits the SQL
		// `DEFAULT` keyword, so a raw insert like this one is what reads the migration's copy —
		// the two are a pair and this is the half nothing else exercises.
		const entryGroupId = await postEntryGroup('don_status_default');
		await insertSync(entryGroupId);
		const row = await env.DB.prepare(
			'select status as s, attempts as a from quickbooks_sync where entry_group_id = ?'
		)
			.bind(entryGroupId)
			.first();
		expect(row).toEqual({ s: 'pending', a: 0 });
	});
});

describe('a delivery row is claimed by one run at a time', () => {
	it('arrives claimed by nobody', async () => {
		// nothing writes `leased_until` at insert and the column carries no default, so a row is
		// owed and held by nobody from the moment it is queued — the rows a deployment already had
		// when the column arrived included.
		const entryGroupId = await postEntryGroup('don_unclaimed');
		await insertSync(entryGroupId);
		const row = await env.DB.prepare(
			'select leased_until as l from quickbooks_sync where entry_group_id = ?'
		)
			.bind(entryGroupId)
			.first();
		expect(row).toEqual({ l: null });
	});
});

describe('STRICT rejects a non-integer written to an integer column', () => {
	it('refuses a fractional start_at on the connection', async () => {
		// an update rather than an insert: the table holds one row and only one, so a second
		// insert is refused by the singleton check before the type is ever consulted. `start_at`
		// carries no check of its own, so the rejection here is STRICT's and only STRICT's.
		const message = await rejection(() =>
			env.DB.prepare(
				`update quickbooks_connection set start_at = 2.5 where id = 'quickbooks'`
			).run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_DATATYPE);
	});

	it('refuses a fractional attempts count on a delivery row', async () => {
		// `quickbooks_sync_attempts_check` is satisfied by 2.5 — it asks for `>= 0` — so what
		// refuses this is the type and nothing else.
		const entryGroupId = await postEntryGroup('don_attempts_float');
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into quickbooks_sync (entry_group_id, attempts, created_at, updated_at)
				 values (?, 2.5, 0, 0)`
			)
				.bind(entryGroupId)
				.run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_DATATYPE);
	});
});
