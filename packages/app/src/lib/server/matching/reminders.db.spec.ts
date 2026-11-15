import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Client } from '@libsql/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db, openDatabase } from '../db/client';
import { MIGRATIONS, rawSql, stmt } from '../db/database.testing';
import { applyMigrations } from '../db/migrate';
import type { EmailMessage, EmailProvider } from '../email/provider';
import { markFiled, markMatched, nameEmployer, REMINDER_AFTER_MS, voidMatch } from './match';
import { dueReminders, REMINDER_RETRY_AFTER_MS, sendDueReminders } from './reminders';

// the one reminder, against a real database file the spec opens and reopens itself — a restart is
// fresh handles over the same file, which is all a restarted process has.

const ORIGIN = 'https://give.example.org';
const CONTACT_ID = '019fb900-0000-7000-8000-000000000001';
const T0 = new Date('2026-11-12T12:00:00.000Z');
const DUE = new Date(T0.getTime() + REMINDER_AFTER_MS);

const dir = mkdtempSync(join(tmpdir(), 'better-giving-reminders-'));
const url = pathToFileURL(join(dir, 'reminders.db')).href;
const opened: Client[] = [];

/** a handle over the spec's file, as a starting process opens one. */
async function open(): Promise<{ client: Client; db: Db }> {
	const client = await openDatabase(url);
	opened.push(client);
	return { client, db: createDb(client) };
}

let client: Client;
let db: Db;
let next = 0;
const fresh = () => `019fb900-0000-7000-8000-1000000000${String(++next).padStart(2, '0')}`;

function mailer(ok = true) {
	const sent: EmailMessage[] = [];
	const port: EmailProvider = {
		async send(message) {
			sent.push(message);
			return ok
				? { ok: true }
				: { ok: false, reason: 'connect_failed', detail: 'no route to host', indeterminate: false };
		}
	};
	return { port, sent };
}

/** a gift in the books with its match row and an employer named at `T0`. */
async function namedGift(): Promise<string> {
	const id = fresh();
	const { run } = rawSql(client);
	await run(
		stmt(
			`insert into donation (id, contact_id, total_minor, currency, fee_minor, received_at, created_at)
			 values (?, ?, 15000, 'USD', 0, ?, 0)`,
			id,
			CONTACT_ID,
			T0.getTime()
		)
	);
	await run(
		stmt(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status, occurred_at, created_at)
			 values (?, ?, 15000, 'USD', 'inbound', 'card', 'succeeded', ?, 0)`,
			fresh(),
			id,
			T0.getTime()
		)
	);
	await run(
		stmt(
			'insert into gift_match (id, donation_id, token, created_at) values (?, ?, ?, 0)',
			fresh(),
			id,
			`${String(next).padStart(4, '0')}abcdefghjkmnpqrstvwxyz012345`
		)
	);
	await nameEmployer(db, { donationId: id }, 'Northwind Logistics', T0);
	return id;
}

beforeAll(async () => {
	({ client, db } = await open());
	await applyMigrations(client, MIGRATIONS);
	const { run } = rawSql(client);
	await run(
		stmt(
			`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
			 values (?, 'individual', 'Maya Reyes', 'maya@example.org', 0, 0)`,
			CONTACT_ID
		)
	);
	await run(
		stmt(`insert into org_profile (id, legal_name, tax_id, deductibility_statement, address_line1,
		                          city, country, created_at, updated_at)
		 values ('default', 'Greenfield Food Bank', '12-3456789', 'No goods or services.',
		         '1 Main St', 'Springfield', 'US', 0, 0)`)
	);
});

afterAll(() => {
	for (const c of opened) c.close();
	rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
	await client.batch([
		stmt('delete from gift_match'),
		stmt('delete from payment'),
		stmt('delete from donation')
	]);
});

const remindedAt = async (id: string) =>
	(
		await rawSql(client).first<{ reminded_at: number | null }>(
			stmt('select reminded_at from gift_match where donation_id = ?', id)
		)
	)?.reminded_at ?? null;

describe('the reminder sweep', () => {
	it('sends a due reminder once, to the donor, linking the gift page', async () => {
		const id = await namedGift();
		const mail = mailer();

		await sendDueReminders({ db, email: mail.port, giftOrigin: ORIGIN }, DUE);
		await sendDueReminders(
			{ db, email: mail.port, giftOrigin: ORIGIN },
			new Date(DUE.getTime() + 60_000)
		);

		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0]).toMatchObject({ to: 'maya@example.org' });
		expect(mail.sent[0]?.subject).toContain('Greenfield Food Bank');
		expect(mail.sent[0]?.text).toContain(`${ORIGIN}/gift/`);
		expect(await remindedAt(id)).toBe(DUE.getTime());
	});

	it('sends exactly one mail when two sweeps overlap', async () => {
		await namedGift();
		const mail = mailer();
		const other = await open();

		await Promise.all([
			sendDueReminders({ db, email: mail.port, giftOrigin: ORIGIN }, DUE),
			sendDueReminders({ db: other.db, email: mail.port, giftOrigin: ORIGIN }, DUE)
		]);

		expect(mail.sent).toHaveLength(1);
	});

	it('sends a due reminder after a restart, from fresh handles over the same file', async () => {
		const id = await namedGift();
		const restarted = await open();
		const mail = mailer();

		await sendDueReminders({ db: restarted.db, email: mail.port, giftOrigin: ORIGIN }, DUE);

		expect(mail.sent).toHaveLength(1);
		expect(await remindedAt(id)).toBe(DUE.getTime());
	});

	it('leaves a row that is not yet due untouched', async () => {
		const id = await namedGift();
		const mail = mailer();

		await sendDueReminders(
			{ db, email: mail.port, giftOrigin: ORIGIN },
			new Date(DUE.getTime() - 1)
		);

		expect(mail.sent).toHaveLength(0);
		expect(await remindedAt(id)).toBeNull();
	});

	it.each([
		['filed', (id: string) => markFiled(db, { donationId: id }, 'donor', T0)],
		['matched', (id: string) => markMatched(db, { donationId: id }, 'staff', T0)],
		['voided', (id: string) => voidMatch(db, { donationId: id }, 'staff', 'Duplicate gift', T0)]
	])('never reminds a %s gift', async (_, close) => {
		const id = await namedGift();
		await close(id);
		const mail = mailer();

		await sendDueReminders({ db, email: mail.port, giftOrigin: ORIGIN }, DUE);

		expect(mail.sent).toHaveLength(0);
		expect(await remindedAt(id)).toBeNull();
	});

	it('hands a failed send back, retries it once the wait is up, and sends once in total', async () => {
		const id = await namedGift();
		const failing = mailer(false);
		await sendDueReminders({ db, email: failing.port, giftOrigin: ORIGIN }, DUE);
		expect(await remindedAt(id)).toBeNull();

		const mail = mailer();
		await sendDueReminders({ db, email: mail.port, giftOrigin: ORIGIN }, DUE);
		expect(mail.sent).toHaveLength(0);

		const retry = new Date(DUE.getTime() + REMINDER_RETRY_AFTER_MS);
		await sendDueReminders({ db, email: mail.port, giftOrigin: ORIGIN }, retry);
		await sendDueReminders(
			{ db, email: mail.port, giftOrigin: ORIGIN },
			new Date(retry.getTime() + REMINDER_RETRY_AFTER_MS)
		);
		expect(mail.sent).toHaveLength(1);
		expect(await remindedAt(id)).toBe(retry.getTime());
	});

	it('sends nothing and claims nothing where no origin names the gift page', async () => {
		const id = await namedGift();
		const mail = mailer();

		await sendDueReminders({ db, email: mail.port, giftOrigin: null }, DUE);

		expect(mail.sent).toHaveLength(0);
		expect(await remindedAt(id)).toBeNull();
	});

	it('reads the due rows through the partial index', async () => {
		const query = dueReminders(db, DUE).toSQL();
		const plan = await rawSql(client).all<{ detail: string }>(
			stmt(`explain query plan ${query.sql}`, ...(query.params as (string | number)[]))
		);
		expect(plan.map((p) => p.detail).join('\n')).toContain(
			'USING INDEX gift_match_reminder_due_idx'
		);
	});
});
