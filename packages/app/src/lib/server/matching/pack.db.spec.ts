import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '../db/client';
import { client, run, stmt } from '../db/database.testing';
import { giftMatch } from '../db/schema';
import { sendReceipt } from '../donations/receipt';
import type { EmailMessage, EmailProvider } from '../email/provider';
import { nameEmployer, voidMatch } from './match';
import { employerNamed, sendFailedPacks, sendOwedPack } from './pack';

// the pack, against a real database: sent once, only for a gift in the books, and a send that did
// not go is stamped as failed rather than thrown at the donor.

const CONTACT_ID = '019fb800-0000-7000-8000-000000000001';
const NO_EMAIL_CONTACT_ID = '019fb800-0000-7000-8000-000000000002';
const ORIGIN = 'https://give.example.org';
/** the origin `BETTER_AUTH_URL` pins, which the scheduled runs name too (`giftLinkOrigin`). */
const PINNED = { origin: ORIGIN, pinned: true };
const T0 = new Date('2026-11-12T12:00:00.000Z');

let db: Db;
let next = 0;
const fresh = () => `019fb800-0000-7000-8000-1000000000${String(++next).padStart(2, '0')}`;

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

/**
 * a mailer that holds the first pack it is handed until `release`, and says when it has one: the
 * claim that sent it is then in force while the test runs whatever else it means to race against it.
 */
function holdingMailer() {
	const sent: EmailMessage[] = [];
	let release: () => void = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let reach: () => void = () => {};
	const reached = new Promise<void>((resolve) => {
		reach = resolve;
	});
	const port: EmailProvider = {
		async send(message) {
			sent.push(message);
			if (sent.length === 1) {
				reach();
				await held;
			}
			return { ok: true };
		}
	};
	return { port, sent, release, reached };
}

const orgProfile = () =>
	run(
		stmt(`insert into org_profile (id, legal_name, tax_id, deductibility_statement, address_line1,
		                          city, country, created_at, updated_at)
		 values ('default', 'Greenfield Food Bank Inc.', '12-3456789', 'No goods or services.',
		         '1 Main St', 'Springfield', 'US', 0, 0)`)
	);

let donationId: string;

/** a gift with its match row, settled where `settled` says. */
async function gift(settled = true): Promise<string> {
	const id = fresh();
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
			 values (?, ?, 15000, 'USD', 'inbound', 'check', ?, ?, 0)`,
			fresh(),
			id,
			settled ? 'succeeded' : 'pending',
			T0.getTime()
		)
	);
	await db.insert(giftMatch).values({ donationId: id });
	return id;
}

const row = async (id = donationId) => {
	const [r] = await db.select().from(giftMatch).where(eq(giftMatch.donationId, id));
	if (r === undefined) throw new Error('no gift_match row');
	return r;
};

beforeAll(async () => {
	db = createDb(client);
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

beforeEach(async () => {
	await run(stmt('delete from org_profile'));
	await orgProfile();
	donationId = await gift();
	await nameEmployer(db, { donationId }, 'Northwind Logistics');
});

describe('the pack', () => {
	it('goes once to the donor, naming the employer and the gift page, and is stamped', async () => {
		const mail = mailer();
		expect(await sendOwedPack({ db, email: mail.port, giftOrigin: PINNED }, donationId, T0)).toBe(
			'sent'
		);
		expect(await sendOwedPack({ db, email: mail.port, giftOrigin: PINNED }, donationId, T0)).toBe(
			'not_owed'
		);

		expect(mail.sent).toHaveLength(1);
		const { token } = await row();
		expect(mail.sent[0]).toMatchObject({ to: 'maya@example.org' });
		expect(mail.sent[0]?.subject).toContain('Northwind Logistics');
		expect(mail.sent[0]?.text).toContain(`${ORIGIN}/gift/${token}`);
		expect(await row()).toMatchObject({ packSentAt: T0, packFailedAt: null });
	});

	it('states what is left of a gift partly refunded', async () => {
		await run(
			stmt(
				`insert into payment (id, donation_id, amount_minor, currency, direction, method, status, occurred_at, created_at)
				 values (?, ?, 5000, 'USD', 'refund', 'check', 'succeeded', ?, 0)`,
				fresh(),
				donationId,
				T0.getTime()
			)
		);
		const mail = mailer();

		await sendOwedPack({ db, email: mail.port, giftOrigin: PINNED }, donationId, T0);

		expect(mail.sent[0]?.text).toContain('100.00');
		expect(mail.sent[0]?.text).not.toContain('150.00');
	});

	it('is not sent for a gift that has not reached the books', async () => {
		const pending = await gift(false);
		await nameEmployer(db, { donationId: pending }, 'Northwind');
		const mail = mailer();

		expect(await sendOwedPack({ db, email: mail.port, giftOrigin: PINNED }, pending, T0)).toBe(
			'not_owed'
		);
		expect(mail.sent).toHaveLength(0);
		expect(await row(pending)).toMatchObject({ packSentAt: null, packFailedAt: null });
	});

	it('is not sent for a voided gift, nor where no origin names the page', async () => {
		const mail = mailer();
		expect(await sendOwedPack({ db, email: mail.port, giftOrigin: null }, donationId, T0)).toBe(
			'not_owed'
		);
		await voidMatch(db, { donationId }, 'staff', 'Duplicate gift', T0);
		expect(await sendOwedPack({ db, email: mail.port, giftOrigin: PINNED }, donationId, T0)).toBe(
			'not_owed'
		);
		expect(mail.sent).toHaveLength(0);
	});

	it('stamps a send that failed, and hands the claim back', async () => {
		expect(
			await sendOwedPack({ db, email: mailer(false).port, giftOrigin: PINNED }, donationId, T0)
		).toBe('failed');
		expect(await row()).toMatchObject({ packSentAt: null, packFailedAt: T0 });
	});

	it('stamps a donor with no email address as failed, arms no reminder and sends nothing', async () => {
		await run(
			stmt('update donation set contact_id = ? where id = ?', NO_EMAIL_CONTACT_ID, donationId)
		);
		const mail = mailer();

		expect(await sendOwedPack({ db, email: mail.port, giftOrigin: PINNED }, donationId, T0)).toBe(
			'failed'
		);

		expect(mail.sent).toHaveLength(0);
		expect(await row()).toMatchObject({ packSentAt: null, packFailedAt: T0, reminderDueAt: null });
	});

	// the first call holds its claim inside the send while the second runs to its end, so the second
	// reaches a row whose `pack_sent_at` is already set and only the claim's guard refuses it.
	it('sends one pack when two calls race for it', async () => {
		const held = holdingMailer();
		const first = sendOwedPack({ db, email: held.port, giftOrigin: PINNED }, donationId, T0);
		await held.reached;

		const second = await sendOwedPack({ db, email: held.port, giftOrigin: PINNED }, donationId, T0);
		held.release();

		expect(second).toBe('not_owed');
		expect(await first).toBe('sent');
		expect(held.sent).toHaveLength(1);
		expect(await row()).toMatchObject({ packSentAt: T0, packFailedAt: null });
	});

	it('sends one pack when the receipt step asks while a call holds the claim', async () => {
		const held = holdingMailer();
		const first = sendOwedPack({ db, email: held.port, giftOrigin: PINNED }, donationId, T0);
		await held.reached;

		await sendReceipt(
			{ db, email: held.port, giftOrigin: PINNED },
			{
				donationId,
				donorName: 'Maya Reyes',
				donorEmail: 'maya@example.org',
				contribution: {
					totalMinor: 15_000,
					nonDeductibleMinor: 0,
					coveredFeeMinor: 0,
					currency: 'USD',
					receivedAt: T0
				},
				tribute: null,
				program: null,
				crypto: null
			}
		);
		held.release();
		await first;

		const packs = held.sent.filter((m) => m.subject.includes('Northwind Logistics'));
		expect(packs).toHaveLength(1);
		expect(held.sent).toHaveLength(2);
	});

	it('stamps a refusal to render the same way, and throws nothing', async () => {
		await run(stmt('delete from org_profile'));
		const mail = mailer();
		expect(await sendOwedPack({ db, email: mail.port, giftOrigin: PINNED }, donationId, T0)).toBe(
			'failed'
		);
		expect(mail.sent).toHaveLength(0);
		expect(await row()).toMatchObject({ packSentAt: null, packFailedAt: T0 });
	});

	it('arms the one reminder three days after it goes, not when the employer was named', async () => {
		const pending = await gift(false);
		await nameEmployer(db, { donationId: pending }, 'Northwind');
		expect((await row(pending)).reminderDueAt).toBeNull();

		const settledAt = new Date(T0.getTime() + 5 * 24 * 60 * 60_000);
		await run(stmt("update payment set status = 'succeeded' where donation_id = ?", pending));
		await sendOwedPack({ db, email: mailer().port, giftOrigin: PINNED }, pending, settledAt);

		expect(await row(pending)).toMatchObject({
			packSentAt: settledAt,
			reminderDueAt: new Date(settledAt.getTime() + 3 * 24 * 60 * 60_000)
		});
	});

	// no scheduled run can name the page on a request's host, so the sweep could never send one.
	it('promises and arms no reminder where the origin is a request’s and not the pin', async () => {
		const mail = mailer();

		expect(
			await sendOwedPack(
				{ db, email: mail.port, giftOrigin: { origin: ORIGIN, pinned: false } },
				donationId,
				T0
			)
		).toBe('sent');

		expect(mail.sent[0]?.text).toContain(`${ORIGIN}/gift/`);
		expect(mail.sent[0]?.text).not.toMatch(/remind/i);
		expect(await row()).toMatchObject({ packSentAt: T0, reminderDueAt: null });
	});

	it('promises the reminder it arms where the origin is pinned', async () => {
		const mail = mailer();
		await sendOwedPack({ db, email: mail.port, giftOrigin: PINNED }, donationId, T0);
		expect(mail.sent[0]?.text).toContain('We will remind you once, in three days');
		expect((await row()).reminderDueAt).toEqual(new Date(T0.getTime() + 3 * 24 * 60 * 60_000));
	});

	it('arms no reminder where the send failed', async () => {
		await sendOwedPack({ db, email: mailer(false).port, giftOrigin: PINNED }, donationId, T0);
		expect(await row()).toMatchObject({ packSentAt: null, reminderDueAt: null });
	});

	it('clears an earlier failure when a later send goes', async () => {
		await sendOwedPack({ db, email: mailer(false).port, giftOrigin: PINNED }, donationId, T0);
		const later = new Date(T0.getTime() + 60_000);
		await sendOwedPack({ db, email: mailer().port, giftOrigin: PINNED }, donationId, later);
		expect(await row()).toMatchObject({ packSentAt: later, packFailedAt: null });
	});
});

const HOUR = 60 * 60_000;
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('the retry of a pack that failed', () => {
	// the sweep reads every failed row in the file, so each case starts from its own gift alone.
	beforeEach(async () => {
		await run(stmt('delete from gift_match where donation_id <> ?', donationId));
		await sendOwedPack({ db, email: mailer(false).port, giftOrigin: PINNED }, donationId, T0);
	});

	it('sends it once an hour has passed since it failed, and once', async () => {
		const mail = mailer();

		await sendFailedPacks({ db, email: mail.port, giftOrigin: PINNED }, at(HOUR - 1));
		expect(mail.sent).toHaveLength(0);
		await sendFailedPacks({ db, email: mail.port, giftOrigin: PINNED }, at(HOUR));
		await sendFailedPacks({ db, email: mail.port, giftOrigin: PINNED }, at(3 * HOUR));

		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0]).toMatchObject({ to: 'maya@example.org' });
		expect(await row()).toMatchObject({
			packSentAt: at(HOUR),
			packFailedAt: null,
			reminderDueAt: at(HOUR + 3 * 24 * HOUR)
		});
	});

	it('tries one that fails again at most once an hour, however often the sweep runs', async () => {
		const failing = mailer(false);

		for (const minutes of [60, 70, 80, 110, 119]) {
			await sendFailedPacks({ db, email: failing.port, giftOrigin: PINNED }, at(minutes * 60_000));
		}
		expect(failing.sent).toHaveLength(1);
		await sendFailedPacks({ db, email: failing.port, giftOrigin: PINNED }, at(2 * HOUR));

		expect(failing.sent).toHaveLength(2);
		expect(await row()).toMatchObject({ packSentAt: null, packFailedAt: at(2 * HOUR) });
	});

	// the first sweep lists both rows and is held inside the first's send; the second sweep lists the
	// other and fails it; the first, released, reaches a failure stamped a moment ago and leaves it.
	it('tries each once when two sweeps list the same rows and overlap', async () => {
		const other = await gift();
		await nameEmployer(db, { donationId: other }, 'Contoso');
		await sendOwedPack({ db, email: mailer(false).port, giftOrigin: PINNED }, other, T0);
		const tried: string[] = [];
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const failing = (hold: boolean): EmailProvider => ({
			async send(message) {
				tried.push(message.subject);
				if (hold && tried.length === 1) await held;
				return { ok: false, reason: 'connect_failed', detail: 'timed out', indeterminate: false };
			}
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const first = sendFailedPacks({ db, email: failing(true), giftOrigin: PINNED }, at(HOUR));
		await vi.waitFor(() => expect(tried).toHaveLength(1));
		await sendFailedPacks({ db, email: failing(false), giftOrigin: PINNED }, at(HOUR));
		release();
		await first;

		expect(tried).toHaveLength(2);
		expect(new Set(tried).size).toBe(2);
		vi.restoreAllMocks();
	});

	it('never mails a pack that went since it failed', async () => {
		const deferred: Promise<unknown>[] = [];
		const mail = mailer();
		await employerNamed(
			{
				db,
				email: mail.port,
				giftOrigin: PINNED,
				defer: (work: Promise<unknown>) => void deferred.push(work)
			},
			{ donationId },
			'Northwind Logistics',
			at(10 * 60_000)
		);
		await Promise.all(deferred);

		await sendFailedPacks({ db, email: mail.port, giftOrigin: PINNED }, at(2 * HOUR));

		expect(mail.sent).toHaveLength(1);
	});

	// the sweep's claim holds the row inside the send while the donor's save runs to its end.
	it('sends one pack when a donor saves while the sweep holds the claim', async () => {
		const held = holdingMailer();
		const sweep = sendFailedPacks({ db, email: held.port, giftOrigin: PINNED }, at(HOUR));
		await held.reached;

		const deferred: Promise<unknown>[] = [];
		await employerNamed(
			{
				db,
				email: held.port,
				giftOrigin: PINNED,
				defer: (work: Promise<unknown>) => void deferred.push(work)
			},
			{ donationId },
			'Northwind Logistics',
			at(HOUR)
		);
		await Promise.all(deferred);
		held.release();
		await sweep;

		expect(held.sent).toHaveLength(1);
	});

	it('sends nothing and logs nothing while the filing details are unsaved, then sends', async () => {
		await run(stmt('delete from org_profile'));
		const mail = mailer();
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		await sendFailedPacks({ db, email: mail.port, giftOrigin: PINNED }, at(HOUR));
		expect(mail.sent).toHaveLength(0);
		expect(logged).not.toHaveBeenCalled();
		await orgProfile();
		await sendFailedPacks({ db, email: mail.port, giftOrigin: PINNED }, at(HOUR + 10 * 60_000));

		expect(mail.sent).toHaveLength(1);
		logged.mockRestore();
	});

	it('leaves a donor with no email address failed, unclaimed and unlogged', async () => {
		await run(
			stmt('update donation set contact_id = ? where id = ?', NO_EMAIL_CONTACT_ID, donationId)
		);
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		await sendFailedPacks({ db, email: mailer().port, giftOrigin: PINNED }, at(2 * HOUR));

		expect(logged).not.toHaveBeenCalled();
		expect(await row()).toMatchObject({ packSentAt: null, packFailedAt: T0 });
		logged.mockRestore();
	});

	it('sends nothing where no pinned origin names the page', async () => {
		const mail = mailer();
		await sendFailedPacks({ db, email: mail.port, giftOrigin: null }, at(2 * HOUR));
		expect(mail.sent).toHaveLength(0);
	});
});

describe('naming the employer, with the pack behind it', () => {
	it('sends the pack after the answer on the first naming, and none on a change', async () => {
		const other = await gift();
		const mail = mailer();
		const deferred: Promise<unknown>[] = [];
		const deps = {
			db,
			email: mail.port,
			giftOrigin: PINNED,
			defer: (work: Promise<unknown>) => void deferred.push(work)
		};

		expect(await employerNamed(deps, { donationId: other }, 'Northwind', T0)).toMatchObject({
			ok: true,
			changed: true
		});
		await Promise.all(deferred);
		await employerNamed(deps, { donationId: other }, 'Contoso', T0);
		await Promise.all(deferred);

		expect(mail.sent).toHaveLength(1);
	});

	it('sends the pack on a save of the same employer where the first never went', async () => {
		const other = await gift();
		const deferred: Promise<unknown>[] = [];
		const deps = (email: EmailProvider) => ({
			db,
			email,
			giftOrigin: PINNED,
			defer: (work: Promise<unknown>) => void deferred.push(work)
		});
		await employerNamed(deps(mailer(false).port), { donationId: other }, 'Northwind', T0);
		await Promise.all(deferred);
		const mail = mailer();

		expect(
			await employerNamed(deps(mail.port), { donationId: other }, 'Northwind', T0)
		).toMatchObject({ ok: true, changed: false });
		await Promise.all(deferred);
		await employerNamed(deps(mail.port), { donationId: other }, 'Northwind', T0);
		await Promise.all(deferred);

		expect(mail.sent.map((m) => m.subject)).toEqual([expect.stringContaining('Northwind')]);
	});

	it('sends the pack on a change where the first never went', async () => {
		const other = await gift();
		const deferred: Promise<unknown>[] = [];
		const deps = (email: EmailProvider) => ({
			db,
			email,
			giftOrigin: PINNED,
			defer: (work: Promise<unknown>) => void deferred.push(work)
		});
		await employerNamed(deps(mailer(false).port), { donationId: other }, 'Northwind', T0);
		await Promise.all(deferred);
		const mail = mailer();

		await employerNamed(deps(mail.port), { donationId: other }, 'Contoso', T0);
		await Promise.all(deferred);

		expect(mail.sent.map((m) => m.subject)).toEqual([expect.stringContaining('Contoso')]);
	});
});
