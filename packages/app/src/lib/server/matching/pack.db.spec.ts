import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { client, run, stmt } from '../db/database.testing';
import { giftMatch } from '../db/schema';
import type { EmailMessage, EmailProvider } from '../email/provider';
import { nameEmployer, voidMatch } from './match';
import { employerNamed, sendOwedPack } from './pack';

// the pack, against a real database: sent once, only for a gift in the books, and a send that did
// not go is stamped as failed rather than thrown at the donor.

const CONTACT_ID = '019fb800-0000-7000-8000-000000000001';
const ORIGIN = 'https://give.example.org';
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
});

beforeEach(async () => {
	await run(stmt('delete from org_profile'));
	await orgProfile();
	donationId = await gift();
	await nameEmployer(db, { donationId }, 'Northwind Logistics', T0);
});

describe('the pack', () => {
	it('goes once to the donor, naming the employer and the gift page, and is stamped', async () => {
		const mail = mailer();
		expect(await sendOwedPack({ db, email: mail.port, giftOrigin: ORIGIN }, donationId, T0)).toBe(
			'sent'
		);
		expect(await sendOwedPack({ db, email: mail.port, giftOrigin: ORIGIN }, donationId, T0)).toBe(
			'not_owed'
		);

		expect(mail.sent).toHaveLength(1);
		const { token } = await row();
		expect(mail.sent[0]).toMatchObject({ to: 'maya@example.org' });
		expect(mail.sent[0]?.subject).toContain('Northwind Logistics');
		expect(mail.sent[0]?.text).toContain(`${ORIGIN}/gift/${token}`);
		expect(await row()).toMatchObject({ packSentAt: T0, packFailedAt: null });
	});

	it('is not sent for a gift that has not reached the books', async () => {
		const pending = await gift(false);
		await nameEmployer(db, { donationId: pending }, 'Northwind', T0);
		const mail = mailer();

		expect(await sendOwedPack({ db, email: mail.port, giftOrigin: ORIGIN }, pending, T0)).toBe(
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
		expect(await sendOwedPack({ db, email: mail.port, giftOrigin: ORIGIN }, donationId, T0)).toBe(
			'not_owed'
		);
		expect(mail.sent).toHaveLength(0);
	});

	it('stamps a send that failed, and hands the claim back', async () => {
		expect(
			await sendOwedPack({ db, email: mailer(false).port, giftOrigin: ORIGIN }, donationId, T0)
		).toBe('failed');
		expect(await row()).toMatchObject({ packSentAt: null, packFailedAt: T0 });
	});

	it('stamps a refusal to render the same way, and throws nothing', async () => {
		await run(stmt('delete from org_profile'));
		const mail = mailer();
		expect(await sendOwedPack({ db, email: mail.port, giftOrigin: ORIGIN }, donationId, T0)).toBe(
			'failed'
		);
		expect(mail.sent).toHaveLength(0);
		expect(await row()).toMatchObject({ packSentAt: null, packFailedAt: T0 });
	});

	it('clears an earlier failure when a later send goes', async () => {
		await sendOwedPack({ db, email: mailer(false).port, giftOrigin: ORIGIN }, donationId, T0);
		const later = new Date(T0.getTime() + 60_000);
		await sendOwedPack({ db, email: mailer().port, giftOrigin: ORIGIN }, donationId, later);
		expect(await row()).toMatchObject({ packSentAt: later, packFailedAt: null });
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
			giftOrigin: ORIGIN,
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

	it('sends the pack on a change where the first never went', async () => {
		const other = await gift();
		const deferred: Promise<unknown>[] = [];
		const deps = (email: EmailProvider) => ({
			db,
			email,
			giftOrigin: ORIGIN,
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
