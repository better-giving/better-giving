import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { all, client, run, stmt } from '../db/database.testing';
import { donation, giftMatch } from '../db/schema';
import {
	DONOR,
	disputeLostVoidStatement,
	giftMatchInsert,
	markFiled,
	markMatched,
	nameEmployer,
	REMINDER_AFTER_MS,
	refundVoidStatement,
	reopenStatement,
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

/** `direction` money on `gift`, succeeded: what it collected, or a refund of it. answers its id. */
async function moved(
	gift: string,
	direction: 'inbound' | 'refund',
	amountMinor: number
): Promise<string> {
	const id = fresh();
	await run(
		stmt(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status, occurred_at, created_at)
			 values (?, ?, ?, 'USD', ?, 'card', 'succeeded', 0, 0)`,
			id,
			gift,
			amountMinor,
			direction
		)
	);
	return id;
}

describe('the refund void', () => {
	beforeEach(async () => {
		await moved(donationId, 'inbound', 15_000);
	});

	it('leaves the match open while anything of the gift is left', async () => {
		await moved(donationId, 'refund', 5_000);
		await db.batch([refundVoidStatement(db, donationId, T0)]);
		expect(await row()).toMatchObject({ voidedAt: null, voidedBy: null, voidReason: null });
	});

	it('voids by system with the reason Gift refunded', async () => {
		await moved(donationId, 'refund', 5_000);
		await moved(donationId, 'refund', 10_000);
		await db.batch([refundVoidStatement(db, donationId, T0)]);
		expect(await row()).toMatchObject({
			voidedAt: T0,
			voidedBy: SYSTEM,
			voidReason: 'Gift refunded'
		});
	});

	it('voids a matched gift too, and leaves an earlier void as it was', async () => {
		await markMatched(db, { donationId }, STAFF, T0);
		await moved(donationId, 'refund', 15_000);
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
		await db.batch([refundVoidStatement(db, fresh(), T0)]);
		expect(await row()).toMatchObject({ voidedAt: null, voidedBy: null, voidReason: null });
	});
});

describe('the reopen', () => {
	/** a full refund the system voided the match for; answers the refund row. */
	async function refundedInFull(): Promise<string> {
		await moved(donationId, 'inbound', 15_000);
		const refundId = await moved(donationId, 'refund', 15_000);
		await db.batch([refundVoidStatement(db, donationId, T1)]);
		return refundId;
	}

	const cancelled = (refundId: string) =>
		run(stmt(`update payment set status = 'cancelled' where id = ?`, refundId));

	it('clears a system void once the refund behind it no longer stands, and keeps matched', async () => {
		await markMatched(db, { donationId }, STAFF, T0);
		await cancelled(await refundedInFull());
		const [reopened] = await db.batch([reopenStatement(db, donationId)]);
		expect(reopened).toEqual([{ donationId }]);
		expect(await row()).toMatchObject({
			matchedAt: T0,
			matchedBy: STAFF,
			voidedAt: null,
			voidedBy: null,
			voidReason: null
		});
	});

	it('leaves the void while nothing of the gift is left', async () => {
		await refundedInFull();
		await db.batch([reopenStatement(db, donationId)]);
		expect(await row()).toMatchObject({ voidedBy: SYSTEM, voidReason: 'Gift refunded' });
	});

	it('leaves a void staff wrote', async () => {
		await moved(donationId, 'inbound', 15_000);
		await voidMatch(db, { donationId }, STAFF, 'Gift refunded', T0);
		await db.batch([reopenStatement(db, donationId)]);
		expect(await row()).toMatchObject({ voidedBy: STAFF, voidReason: 'Gift refunded' });
	});

	it('leaves the void while a lost dispute on the gift stands', async () => {
		const refundId = await refundedInFull();
		const withdrawal = await moved(donationId, 'refund', 1_000);
		await run(
			stmt(
				`insert into dispute (payment_id, outcome, closed_at, created_at, updated_at) values (?, 'lost', 0, 0, 0)`,
				withdrawal
			)
		);
		await cancelled(refundId);
		await db.batch([reopenStatement(db, donationId)]);
		expect(await row()).toMatchObject({ voidedBy: SYSTEM });
	});
});

describe('the lost dispute void', () => {
	/** a dispute withdrawing the whole gift, closed as `outcome` says; answers its withdrawal row. */
	async function disputed(outcome: 'lost' | 'won' | null): Promise<string> {
		await moved(donationId, 'inbound', 15_000);
		const withdrawal = await moved(donationId, 'refund', 15_000);
		await run(
			stmt(
				'insert into dispute (payment_id, outcome, closed_at, created_at, updated_at) values (?, ?, ?, 0, 0)',
				withdrawal,
				outcome,
				outcome === null ? null : 0
			)
		);
		return withdrawal;
	}

	it('voids by system with the reason Dispute lost', async () => {
		const withdrawal = await disputed('lost');
		await db.batch([disputeLostVoidStatement(db, donationId, withdrawal, T0)]);
		expect(await row()).toMatchObject({
			voidedAt: T0,
			voidedBy: SYSTEM,
			voidReason: 'Dispute lost'
		});
	});

	it('leaves the match open while the dispute is open or once it is won', async () => {
		for (const outcome of [null, 'won'] as const) {
			const withdrawal = await disputed(outcome);
			await db.batch([disputeLostVoidStatement(db, donationId, withdrawal, T0)]);
			expect(await row()).toMatchObject({ voidedAt: null, voidedBy: null, voidReason: null });
		}
	});
});

describe('naming the employer', () => {
	it('trims and stores it, and arms no reminder: the pack does', async () => {
		const named = await nameEmployer(db, { donationId }, '  Northwind Logistics ');
		expect(named).toMatchObject({ ok: true, changed: true });
		expect(await row()).toMatchObject({ employer: 'Northwind Logistics', reminderDueAt: null });
	});

	it('is a no-op naming the same employer again', async () => {
		await nameEmployer(db, { donationId }, 'Northwind');
		expect(await nameEmployer(db, { donationId }, 'Northwind')).toMatchObject({
			ok: true,
			changed: false
		});
	});

	it('changing it later keeps the due time and never re-arms a sent reminder', async () => {
		await nameEmployer(db, { donationId }, 'Northwind');
		const due = new Date(T0.getTime() + REMINDER_AFTER_MS);
		await run(
			stmt(
				'update gift_match set reminder_due_at = ?, reminded_at = ? where donation_id = ?',
				due.getTime(),
				T1.getTime(),
				donationId
			)
		);
		await nameEmployer(db, { donationId }, 'Contoso');
		expect(await row()).toMatchObject({ employer: 'Contoso', reminderDueAt: due, remindedAt: T1 });
	});

	it.each([
		['blank', '   '],
		['past 200 characters', 'é'.repeat(201)],
		['holding a NUL', 'North\u0000wind'],
		['holding a line break', 'North\nwind'],
		['holding a C1 control', 'North\u0085wind']
	])('refuses one that is %s', async (_, typed) => {
		expect(await nameEmployer(db, { donationId }, typed)).toEqual({
			ok: false,
			reason: 'employer_invalid'
		});
	});

	it('takes 200 characters', async () => {
		expect(await nameEmployer(db, { donationId }, 'é'.repeat(200))).toMatchObject({ ok: true });
	});

	it('is refused on a voided or matched gift', async () => {
		await voidMatch(db, { donationId }, STAFF, 'Duplicate gift', T0);
		expect(await nameEmployer(db, { donationId }, 'Northwind')).toMatchObject({
			ok: true,
			changed: false,
			state: { status: 'voided' }
		});
		expect((await row()).employer).toBeNull();
	});

	it('finds the gift by its token', async () => {
		const { token } = await row();
		expect(await nameEmployer(db, { token }, 'Northwind')).toMatchObject({ changed: true });
		expect(await nameEmployer(db, { token: 'x'.repeat(32) }, 'Northwind')).toEqual({
			ok: false,
			reason: 'not_found'
		});
	});
});
