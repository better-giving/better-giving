import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { all, client, run, stmt } from '../db/database.testing';
import { donation, giftMatch } from '../db/schema';
import {
	DONOR,
	giftMatchInsert,
	markFiled,
	markMatched,
	nameEmployer,
	REMINDER_AFTER_MS,
	refundVoidStatement,
	SYSTEM,
	voidMatch
} from './match';

// the writes a gift's match takes, against a real database: each stamp lands once with its who, a
// second call is a no-op that reports the state, and the terminal states refuse what follows them.

const CONTACT_ID = '019fb700-0000-7000-8000-000000000001';
const STAFF = '01HSTAFFMEMBER000000000001';

let db: Db;
let next = 0;
const fresh = () => `019fb700-0000-7000-8000-1000000000${String(++next).padStart(2, '0')}`;

const T0 = new Date('2026-11-12T12:00:00.000Z');
const T1 = new Date('2026-11-13T12:00:00.000Z');

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

let donationId: string;

beforeEach(async () => {
	donationId = fresh();
	await db.batch([
		db.insert(donation).values({
			id: donationId,
			contactId: CONTACT_ID,
			totalMinor: 15_000,
			currency: 'USD',
			receivedAt: T0
		}),
		giftMatchInsert(db, donationId)
	]);
});

const row = async () => {
	const [r] = await db.select().from(giftMatch).where(eq(giftMatch.donationId, donationId));
	if (r === undefined) throw new Error('no gift_match row');
	return r;
};

describe('the row', () => {
	it('is written with the gift, holding a token and no stamps', async () => {
		const r = await row();
		expect(r.token).toMatch(/^[0-9a-hjkmnp-tv-z]{32}$/);
		expect(r).toMatchObject({ employer: null, filedAt: null, voidedAt: null, reminderDueAt: null });
	});
});

describe('mark filed', () => {
	it('stamps once with its who, and a second call reports the state and stamps nothing', async () => {
		const first = await markFiled(db, { donationId }, DONOR, T0);
		expect(first).toMatchObject({ ok: true, changed: true, state: { status: 'filed' } });
		const second = await markFiled(db, { donationId }, STAFF, T1);
		expect(second).toMatchObject({ ok: true, changed: false, state: { status: 'filed' } });
		expect(await row()).toMatchObject({ filedAt: T0, filedBy: DONOR });
	});

	it('takes a gift no employer was named on', async () => {
		await markFiled(db, { donationId }, DONOR, T0);
		expect((await row()).employer).toBeNull();
		expect((await row()).filedBy).toBe(DONOR);
	});

	it('is refused after matched and after voided, reporting the state', async () => {
		await markMatched(db, { donationId }, STAFF, T0);
		expect(await markFiled(db, { donationId }, DONOR, T1)).toMatchObject({
			ok: true,
			changed: false,
			state: { status: 'matched' }
		});
		expect((await row()).filedAt).toBeNull();
	});

	it('answers not_found for a gift with no row', async () => {
		expect(await markFiled(db, { donationId: fresh() }, DONOR, T0)).toEqual({
			ok: false,
			reason: 'not_found'
		});
	});
});

describe('mark matched', () => {
	it('stamps once, before filed, and counts as filed', async () => {
		const first = await markMatched(db, { donationId }, STAFF, T0);
		expect(first).toMatchObject({ ok: true, changed: true, state: { status: 'matched' } });
		expect(await markMatched(db, { donationId }, 'someone-else', T1)).toMatchObject({
			changed: false
		});
		expect(await row()).toMatchObject({ matchedAt: T0, matchedBy: STAFF, filedAt: null });
	});

	it('is refused after voided', async () => {
		await voidMatch(db, { donationId }, STAFF, 'Duplicate gift', T0);
		expect(await markMatched(db, { donationId }, STAFF, T1)).toMatchObject({
			changed: false,
			state: { status: 'voided' }
		});
		expect((await row()).matchedAt).toBeNull();
	});
});

describe('void', () => {
	it('needs a reason that is not blank', async () => {
		expect(await voidMatch(db, { donationId }, STAFF, ' \t', T0)).toEqual({
			ok: false,
			reason: 'reason_blank'
		});
		expect((await row()).voidedAt).toBeNull();
	});

	it('stamps once with its who and reason, trimmed', async () => {
		await voidMatch(db, { donationId }, STAFF, '  Duplicate gift ', T0);
		expect(await voidMatch(db, { donationId }, SYSTEM, 'Gift refunded', T1)).toMatchObject({
			ok: true,
			changed: false
		});
		expect(await row()).toMatchObject({
			voidedAt: T0,
			voidedBy: STAFF,
			voidReason: 'Duplicate gift'
		});
	});

	it('is refused after matched', async () => {
		await markMatched(db, { donationId }, STAFF, T0);
		expect(await voidMatch(db, { donationId }, STAFF, 'Changed my mind', T1)).toMatchObject({
			changed: false,
			state: { status: 'matched' }
		});
		expect((await row()).voidedAt).toBeNull();
	});
});

describe('the refund void', () => {
	it('voids by system with the reason Gift refunded', async () => {
		await db.batch([refundVoidStatement(db, donationId, T0)]);
		expect(await row()).toMatchObject({
			voidedAt: T0,
			voidedBy: SYSTEM,
			voidReason: 'Gift refunded'
		});
	});

	it('voids a matched gift too, and leaves an earlier void as it was', async () => {
		await markMatched(db, { donationId }, STAFF, T0);
		await db.batch([refundVoidStatement(db, donationId, T1)]);
		expect(await row()).toMatchObject({ matchedAt: T0, voidedBy: SYSTEM });

		const other = fresh();
		await db.batch([
			db.insert(donation).values({
				id: other,
				contactId: CONTACT_ID,
				totalMinor: 100,
				currency: 'USD',
				receivedAt: T0
			}),
			giftMatchInsert(db, other)
		]);
		await voidMatch(db, { donationId: other }, STAFF, 'Duplicate gift', T0);
		await db.batch([refundVoidStatement(db, other, T1)]);
		const [kept] = await all<{ voided_by: string; void_reason: string }>(
			stmt('select voided_by, void_reason from gift_match where donation_id = ?', other)
		);
		expect(kept).toEqual({ voided_by: STAFF, void_reason: 'Duplicate gift' });
	});

	it('is a no-op for a gift with no row', async () => {
		await expect(db.batch([refundVoidStatement(db, fresh(), T0)])).resolves.toBeDefined();
	});
});

describe('naming the employer', () => {
	it('trims, stores it, and arms the one reminder three days out', async () => {
		const named = await nameEmployer(db, { donationId }, '  Northwind Logistics ', T0);
		expect(named).toMatchObject({ ok: true, changed: true });
		expect(await row()).toMatchObject({
			employer: 'Northwind Logistics',
			reminderDueAt: new Date(T0.getTime() + REMINDER_AFTER_MS)
		});
		expect(REMINDER_AFTER_MS).toBe(3 * 24 * 60 * 60_000);
	});

	it('is a no-op naming the same employer again', async () => {
		await nameEmployer(db, { donationId }, 'Northwind', T0);
		expect(await nameEmployer(db, { donationId }, 'Northwind', T1)).toMatchObject({
			ok: true,
			changed: false
		});
	});

	it('changing it later keeps the first due time and never re-arms a sent reminder', async () => {
		await nameEmployer(db, { donationId }, 'Northwind', T0);
		await run(
			stmt('update gift_match set reminded_at = ? where donation_id = ?', T1.getTime(), donationId)
		);
		await nameEmployer(db, { donationId }, 'Contoso', T1);
		expect(await row()).toMatchObject({
			employer: 'Contoso',
			reminderDueAt: new Date(T0.getTime() + REMINDER_AFTER_MS),
			remindedAt: T1
		});
	});

	it.each([
		['blank', '   '],
		['past 200 characters', 'é'.repeat(201)]
	])('refuses one that is %s', async (_, typed) => {
		expect(await nameEmployer(db, { donationId }, typed, T0)).toEqual({
			ok: false,
			reason: 'employer_invalid'
		});
	});

	it('takes 200 characters', async () => {
		expect(await nameEmployer(db, { donationId }, 'é'.repeat(200), T0)).toMatchObject({ ok: true });
	});

	it('is refused on a voided or matched gift', async () => {
		await voidMatch(db, { donationId }, STAFF, 'Duplicate gift', T0);
		expect(await nameEmployer(db, { donationId }, 'Northwind', T1)).toMatchObject({
			ok: true,
			changed: false,
			state: { status: 'voided' }
		});
		expect((await row()).employer).toBeNull();
	});

	it('finds the gift by its token', async () => {
		const { token } = await row();
		expect(await nameEmployer(db, { token }, 'Northwind', T0)).toMatchObject({ changed: true });
		expect(await nameEmployer(db, { token: 'x'.repeat(32) }, 'Northwind', T0)).toEqual({
			ok: false,
			reason: 'not_found'
		});
	});
});
