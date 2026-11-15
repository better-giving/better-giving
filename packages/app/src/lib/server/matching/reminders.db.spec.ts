import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Client } from '@libsql/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db, openDatabase } from '../db/client';
import { MIGRATIONS, rawSql, stmt } from '../db/database.testing';
import { applyMigrations } from '../db/migrate';
import type { EmailMessage, EmailProvider } from '../email/provider';
import {
	markFiled,
	markMatched,
	nameEmployer,
	REMINDER_AFTER_MS,
	refundVoidStatement,
	voidMatch
} from './match';
import { sendOwedPack } from './pack';
import {
	dueReminders,
	REMINDER_RETRY_AFTER_MS,
	REMINDERS_PER_RUN,
	sendDueReminders
} from './reminders';

// the one reminder, against a real database file the spec opens and reopens itself — a restart is
// fresh handles over the same file, which is all a restarted process has.

const ORIGIN = 'https://give.example.org';
/** the origin `BETTER_AUTH_URL` pins, which the scheduled runs name too (`giftLinkOrigin`). */
const PINNED = { origin: ORIGIN, pinned: true };
const CONTACT_ID = '019fb900-0000-7000-8000-000000000001';
const NO_EMAIL_CONTACT_ID = '019fb900-0000-7000-8000-000000000002';
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

/** a gift with its match row and an employer named, its pack sent at `T0` where it is in the books. */
async function namedGift(settled = true): Promise<string> {
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
			 values (?, ?, 15000, 'USD', 'inbound', 'card', ?, ?, 0)`,
			fresh(),
			id,
			settled ? 'succeeded' : 'pending',
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
	await nameEmployer(db, { donationId: id }, 'Northwind Logistics');
	await sendOwedPack({ db, email: mailer().port, giftOrigin: PINNED }, id, T0);
	return id;
}

/** `amountMinor` of the gift `id` sent back, succeeded. */
async function refunded(id: string, amountMinor: number): Promise<void> {
	await rawSql(client).run(
		stmt(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status, occurred_at, created_at)
			 values (?, ?, ?, 'USD', 'refund', 'card', 'succeeded', ?, 0)`,
			fresh(),
			id,
			amountMinor,
			T0.getTime()
		)
	);
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
		stmt(
			`insert into contact (id, kind, display_name, created_at, updated_at)
			 values (?, 'individual', 'Sam Okafor', 0, 0)`,
			NO_EMAIL_CONTACT_ID
		)
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
		stmt('delete from donation'),
		stmt(`insert or ignore into org_profile (id, legal_name, tax_id, deductibility_statement,
		                                    address_line1, city, country, created_at, updated_at)
		      values ('default', 'Greenfield Food Bank', '12-3456789', 'No goods or services.',
		              '1 Main St', 'Springfield', 'US', 0, 0)`)
	]);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const remindedAt = async (id: string) =>
	(
		await rawSql(client).first<{ reminded_at: number | null }>(
			stmt('select reminded_at from gift_match where donation_id = ?', id)
		)
	)?.reminded_at ?? null;

const dueAtOf = async (id: string) =>
	(
		await rawSql(client).first<{ reminder_due_at: number | null }>(
			stmt('select reminder_due_at from gift_match where donation_id = ?', id)
		)
	)?.reminder_due_at ?? null;

describe('the reminder sweep', () => {
	it('sends a due reminder once, to the donor, linking the gift page', async () => {
		const id = await namedGift();
		const mail = mailer();

		await sendDueReminders({ db, email: mail.port, giftOrigin: PINNED }, DUE);
		await sendDueReminders(
			{ db, email: mail.port, giftOrigin: PINNED },
			new Date(DUE.getTime() + 60_000)
		);

		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0]).toMatchObject({ to: 'maya@example.org' });
		expect(mail.sent[0]?.subject).toContain('Greenfield Food Bank');
		expect(mail.sent[0]?.text).toContain(`${ORIGIN}/gift/`);
		expect(await remindedAt(id)).toBe(DUE.getTime());
	});

	it('falls due three days after the pack, which waits for the gift to reach the books', async () => {
		const id = await namedGift(false);
		await nameEmployer(db, { donationId: id }, 'Contoso');
		const settledAt = new Date(T0.getTime() + 5 * 24 * 60 * 60_000);
		await rawSql(client).run(
			stmt("update payment set status = 'succeeded' where donation_id = ?", id)
		);
		await sendOwedPack({ db, email: mailer().port, giftOrigin: PINNED }, id, settledAt);
		const mail = mailer();
		const deps = { db, email: mail.port, giftOrigin: PINNED };

		await sendDueReminders(deps, new Date(settledAt.getTime() + 60_000));
		expect(mail.sent).toHaveLength(0);

		const due = new Date(settledAt.getTime() + 3 * 24 * 60 * 60_000);
		await sendDueReminders(deps, due);
		await sendDueReminders(deps, new Date(due.getTime() + REMINDER_RETRY_AFTER_MS));
		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0]?.text).toContain('Contoso');
	});

	// both sweeps list both rows before either claims: each issues its read before the first claim
	// can be issued, since a claim waits on its own sweep's read. the first sweep then holds its
	// claim on the first row inside a send that waits on `release`, so the second sweep reaches that
	// row with its listing stale, and only the claim's `reminded_at is null` refuses it.
	it('sends each reminder once when two sweeps list the same rows and overlap', async () => {
		const first = await namedGift();
		const second = await namedGift();
		const other = await open();
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const sent: EmailMessage[] = [];
		const gated: EmailProvider = {
			async send(message) {
				sent.push(message);
				if (sent.length === 1) await held;
				return { ok: true };
			}
		};
		const quick = mailer();

		const slow = sendDueReminders({ db, email: gated, giftOrigin: PINNED }, DUE);
		const racing = sendDueReminders({ db: other.db, email: quick.port, giftOrigin: PINNED }, DUE);
		await racing;
		release();
		await slow;

		expect(sent.length + quick.sent.length).toBe(2);
		expect(await remindedAt(first)).toBe(DUE.getTime());
		expect(await remindedAt(second)).toBe(DUE.getTime());
	});

	it('sends a due reminder after a restart, from fresh handles over the same file', async () => {
		const id = await namedGift();
		const restarted = await open();
		const mail = mailer();

		await sendDueReminders({ db: restarted.db, email: mail.port, giftOrigin: PINNED }, DUE);

		expect(mail.sent).toHaveLength(1);
		expect(await remindedAt(id)).toBe(DUE.getTime());
	});

	it('leaves a row that is not yet due untouched', async () => {
		const id = await namedGift();
		const mail = mailer();

		await sendDueReminders(
			{ db, email: mail.port, giftOrigin: PINNED },
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

		await sendDueReminders({ db, email: mail.port, giftOrigin: PINNED }, DUE);

		expect(mail.sent).toHaveLength(0);
		expect(await remindedAt(id)).toBeNull();
	});

	it('hands a failed send back, retries it once the wait is up, and sends once in total', async () => {
		const id = await namedGift();
		const failing = mailer(false);
		await sendDueReminders({ db, email: failing.port, giftOrigin: PINNED }, DUE);
		expect(await remindedAt(id)).toBeNull();

		const mail = mailer();
		await sendDueReminders({ db, email: mail.port, giftOrigin: PINNED }, DUE);
		expect(mail.sent).toHaveLength(0);

		const retry = new Date(DUE.getTime() + REMINDER_RETRY_AFTER_MS);
		await sendDueReminders({ db, email: mail.port, giftOrigin: PINNED }, retry);
		await sendDueReminders(
			{ db, email: mail.port, giftOrigin: PINNED },
			new Date(retry.getTime() + REMINDER_RETRY_AFTER_MS)
		);
		expect(mail.sent).toHaveLength(1);
		expect(await remindedAt(id)).toBe(retry.getTime());
	});

	it.each([
		[
			'the donor has no email address',
			(id: string) =>
				stmt('update donation set contact_id = ? where id = ?', NO_EMAIL_CONTACT_ID, id)
		],
		['the organisation has no profile to name it', () => stmt('delete from org_profile')]
	])('stops re-arming one that can never go — %s — and logs it once', async (_, unsendable) => {
		const id = await namedGift();
		await rawSql(client).run(unsendable(id));
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const mail = mailer();
		const deps = { db, email: mail.port, giftOrigin: PINNED };

		await sendDueReminders(deps, DUE);
		await sendDueReminders(deps, new Date(DUE.getTime() + REMINDER_RETRY_AFTER_MS));
		await sendDueReminders(deps, new Date(DUE.getTime() + 30 * REMINDER_RETRY_AFTER_MS));

		expect(mail.sent).toHaveLength(0);
		expect(logged).toHaveBeenCalledTimes(1);
		expect(await dueReminders(db, new Date(DUE.getTime() + 365 * 24 * 60 * 60_000))).toEqual([]);
		expect(await remindedAt(id)).toBeNull();
	});

	it('does not remind a gift that has left the books since its pack went', async () => {
		const id = await namedGift();
		await rawSql(client).run(
			stmt("update payment set status = 'pending' where donation_id = ?", id)
		);
		const mail = mailer();

		await sendDueReminders({ db, email: mail.port, giftOrigin: PINNED }, DUE);

		expect(mail.sent).toHaveLength(0);
		expect(await remindedAt(id)).toBeNull();
	});

	it('states what is left of a gift partly refunded', async () => {
		const id = await namedGift();
		await refunded(id, 5000);
		const mail = mailer();

		await sendDueReminders({ db, email: mail.port, giftOrigin: PINNED }, DUE);

		expect(mail.sent[0]?.text).toContain('100.00');
		expect(mail.sent[0]?.text).not.toContain('150.00');
	});

	it('does not remind a refunded gift', async () => {
		const id = await namedGift();
		await refunded(id, 15000);
		await db.batch([refundVoidStatement(db, id, T0)]);
		const mail = mailer();

		await sendDueReminders({ db, email: mail.port, giftOrigin: PINNED }, DUE);

		expect(mail.sent).toHaveLength(0);
		expect(await remindedAt(id)).toBeNull();
	});

	it('hands the claim back for the hour retry where the send throws', async () => {
		const id = await namedGift();
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const throwing: EmailProvider = {
			async send() {
				throw new Error('socket hung up');
			}
		};

		await sendDueReminders({ db, email: throwing, giftOrigin: PINNED }, DUE);

		expect(await remindedAt(id)).toBeNull();
		expect(await dueAtOf(id)).toBe(DUE.getTime() + REMINDER_RETRY_AFTER_MS);
		expect(logged).toHaveBeenCalledTimes(1);
		const mail = mailer();
		await sendDueReminders(
			{ db, email: mail.port, giftOrigin: PINNED },
			new Date(DUE.getTime() + REMINDER_RETRY_AFTER_MS)
		);
		expect(mail.sent).toHaveLength(1);
	});

	it('does not keep a good reminder behind one whose send throws', async () => {
		const bad = await namedGift();
		const good = await namedGift();
		await rawSql(client).run(
			stmt(
				'update gift_match set reminder_due_at = ? where donation_id = ?',
				DUE.getTime() - 1,
				bad
			)
		);
		const badToken = (
			await rawSql(client).first<{ token: string }>(
				stmt('select token from gift_match where donation_id = ?', bad)
			)
		)?.token;
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const sent: EmailMessage[] = [];
		const port: EmailProvider = {
			async send(message) {
				if (message.text.includes(`/gift/${badToken}`)) throw new Error('socket hung up');
				sent.push(message);
				return { ok: true };
			}
		};

		await sendDueReminders({ db, email: port, giftOrigin: PINNED }, DUE);

		expect(sent).toHaveLength(1);
		expect(await remindedAt(good)).toBe(DUE.getTime());
		expect(await remindedAt(bad)).toBeNull();
		expect(await dueAtOf(bad)).toBe(DUE.getTime() + REMINDER_RETRY_AFTER_MS);
		expect(logged).toHaveBeenCalledTimes(1);
	});

	it('claims at most REMINDERS_PER_RUN in one run and leaves the rest for the next', async () => {
		const ids: string[] = [];
		for (let i = 0; i < REMINDERS_PER_RUN + 2; i += 1) ids.push(await namedGift());
		const mail = mailer();
		const deps = { db, email: mail.port, giftOrigin: PINNED };

		await sendDueReminders(deps, DUE);
		expect(mail.sent).toHaveLength(REMINDERS_PER_RUN);

		await sendDueReminders(deps, DUE);
		expect(mail.sent).toHaveLength(REMINDERS_PER_RUN + 2);
		for (const id of ids) expect(await remindedAt(id)).toBe(DUE.getTime());
	}, 30_000);

	// a pack sent on a request's host arms none (./pack.ts), so a row armed here was armed under a pin
	// since removed: it waits, armed, for one to be set again, and the run is no log line each time.
	it('sends nothing, claims nothing and logs nothing where no origin names the gift page', async () => {
		const id = await namedGift();
		const mail = mailer();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await sendDueReminders({ db, email: mail.port, giftOrigin: null }, DUE);

		expect(mail.sent).toHaveLength(0);
		expect(await remindedAt(id)).toBeNull();
		expect(await dueAtOf(id)).toBe(DUE.getTime());
		expect(warn).not.toHaveBeenCalled();
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
