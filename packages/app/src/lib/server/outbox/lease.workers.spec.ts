import { env } from 'cloudflare:test';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { contact, donation, payment, zapierDelivery } from '../db/schema';
import { defineOutbox, type LeaseTerms } from './lease';

// the lease module against a real D1, over `zapier_delivery` rows written here by hand. the table
// stands in for any outbox: nothing asserted below is about Zapier, and no Zapier module runs.

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

const TERMS: LeaseTerms = {
	leaseMs: 2 * MINUTE,
	deadlineMs: 90 * SECOND,
	attemptMs: 10 * SECOND,
	claimsPerRun: 5,
	lanes: 3
};

const outboxOf = (terms: Partial<LeaseTerms> = {}) =>
	defineOutbox({
		table: zapierDelivery,
		key: { subscriptionId: zapierDelivery.subscriptionId, eventId: zapierDelivery.eventId },
		...TERMS,
		...terms
	});

let db: Db;
let subscriptionId: string;
let paymentId: string;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from zapier_delivery').run();
	await env.DB.prepare('delete from zapier_subscription').run();
	subscriptionId = uuidv7();
	await env.DB.prepare(
		`insert into zapier_subscription (id, trigger, hook_url, created_at, updated_at)
		 values (?, 'new_gift', ?, 0, 0)`
	)
		.bind(subscriptionId, `https://hooks.zapier.com/hooks/standard/1/${subscriptionId}/`)
		.run();
	const contactId = uuidv7();
	const donationId = uuidv7();
	paymentId = uuidv7();
	const at = new Date('2026-09-10T12:00:00.000Z');
	await db.batch([
		db.insert(contact).values({ id: contactId, kind: 'individual', displayName: 'Ada Okafor' }),
		db.insert(donation).values({
			id: donationId,
			contactId,
			totalMinor: 5_000,
			currency: 'USD',
			receivedAt: at
		}),
		db.insert(payment).values({
			id: paymentId,
			donationId,
			amountMinor: 5_000,
			currency: 'USD',
			direction: 'inbound',
			method: 'check',
			status: 'succeeded',
			provider: 'manual',
			occurredAt: at
		})
	]);
});

type Owed = {
	readonly eventId: string;
	readonly nextAttemptAt: number;
	readonly status?: string;
	readonly leasedUntil?: number | null;
};

/** rows owed on the one subscription, each due at its own time. */
async function owe(rows: readonly Owed[]): Promise<void> {
	await env.DB.batch(
		rows.map((row) =>
			env.DB.prepare(
				`insert into zapier_delivery
				 (subscription_id, event_id, payment_id, status, attempts, next_attempt_at, leased_until, created_at, updated_at)
				 values (?, ?, ?, ?, 0, ?, ?, 0, 0)`
			).bind(
				subscriptionId,
				row.eventId,
				paymentId,
				row.status ?? 'pending',
				row.nextAttemptAt,
				row.leasedUntil ?? null
			)
		)
	);
}

/** `count` rows due at once, `e0` waiting longest. */
const backlog = (count: number, dueAt: number): Owed[] =>
	Array.from({ length: count }, (_, i) => ({ eventId: `e${i}`, nextAttemptAt: dueAt - count + i }));

const returning = { attempts: zapierDelivery.attempts };

/** each row as the table holds it, by event id. */
async function rowsNow() {
	const { results } = await env.DB.prepare(
		`select event_id, status, attempts, next_attempt_at, leased_until, updated_at
		 from zapier_delivery order by event_id`
	).all<{
		event_id: string;
		status: string;
		attempts: number;
		next_attempt_at: number;
		leased_until: number | null;
		updated_at: number;
	}>();
	return results;
}

describe('claim()', () => {
	it('takes at most the per-run bound, the longest-waiting first, and leases each', async () => {
		const now = Date.now();
		await owe(backlog(7, now));

		const claim = await outboxOf().claim(db, new Date(now), { returning });

		expect(claim.rows.map((r) => r.eventId)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
		expect(claim.lease).toEqual(new Date(now + 2 * MINUTE));
		expect((await rowsNow()).map((r) => r.leased_until)).toEqual([
			...Array(5).fill(now + 2 * MINUTE),
			null,
			null
		]);
	});

	it('hands two runs over one backlog disjoint rows', async () => {
		const now = Date.now();
		await owe(backlog(8, now));
		const outbox = outboxOf();

		const [first, second] = await Promise.all([
			outbox.claim(db, new Date(now), { returning }),
			outbox.claim(db, new Date(now), { returning })
		]);

		const taken = [...first.rows, ...second.rows].map((r) => r.eventId).sort();
		expect(taken).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7']);
	});

	it('takes a leased row back only once its lease has run out', async () => {
		const now = Date.now();
		await owe(backlog(2, now));
		const outbox = outboxOf();
		const claimAt = (at: number) =>
			outbox.claim(db, new Date(at), { returning }).then((c) => c.rows.map((r) => r.eventId));

		expect(await claimAt(now)).toEqual(['e0', 'e1']);
		expect(await claimAt(now + MINUTE)).toEqual([]);
		expect(await claimAt(now + 2 * MINUTE - 1)).toEqual([]);
		expect(await claimAt(now + 2 * MINUTE)).toEqual(['e0', 'e1']);
	});

	it('takes only rows still owed whose time has come', async () => {
		const now = Date.now();
		await owe([
			{ eventId: 'due', nextAttemptAt: now },
			{ eventId: 'later', nextAttemptAt: now + 1 },
			{ eventId: 'sent', nextAttemptAt: now - MINUTE, status: 'sent' },
			{ eventId: 'failed', nextAttemptAt: now - MINUTE, status: 'failed' }
		]);

		const claim = await outboxOf().claim(db, new Date(now), { returning });

		expect(claim.rows.map((r) => r.eventId)).toEqual(['due']);
	});

	it("takes only what the caller's own condition admits", async () => {
		const now = Date.now();
		await owe(backlog(3, now));

		const claim = await outboxOf().claim(db, new Date(now), {
			returning,
			where: sql`${zapierDelivery.eventId} <> 'e1'`
		});

		expect(claim.rows.map((r) => r.eventId)).toEqual(['e0', 'e2']);
	});
});

describe('land()', () => {
	it("writes the caller's outcome and gives the lease back", async () => {
		const now = Date.now();
		await owe(backlog(2, now));
		const claim = await outboxOf().claim(db, new Date(now), { returning });
		const [sent, waiting] = claim.rows;
		if (sent === undefined || waiting === undefined) throw new Error('two rows were owed');

		await claim.land(sent, { status: 'sent', attempts: sent.attempts + 1 });
		await claim.land(waiting, {
			attempts: waiting.attempts + 1,
			nextAttemptAt: new Date(now + 5 * MINUTE)
		});

		expect(await rowsNow()).toEqual([
			{
				event_id: 'e0',
				status: 'sent',
				attempts: 1,
				next_attempt_at: now - 2,
				leased_until: null,
				updated_at: now
			},
			{
				event_id: 'e1',
				status: 'pending',
				attempts: 1,
				next_attempt_at: now + 5 * MINUTE,
				leased_until: null,
				updated_at: now
			}
		]);
	});

	it('writes nothing to a row a later run has taken over', async () => {
		const now = Date.now();
		await owe(backlog(1, now));
		const outbox = outboxOf();
		const overrun = await outbox.claim(db, new Date(now), { returning });
		await outbox.claim(db, new Date(now + 2 * MINUTE), { returning });
		const takenOver = await rowsNow();
		const [row] = overrun.rows;
		if (row === undefined) throw new Error('one row was owed');

		await overrun.land(row, { status: 'sent', attempts: 1 });

		expect(await rowsNow()).toEqual(takenOver);
	});

	it('writes nothing to a row no longer owed', async () => {
		const now = Date.now();
		await owe(backlog(1, now));
		const claim = await outboxOf().claim(db, new Date(now), { returning });
		await env.DB.prepare(`update zapier_delivery set status = 'dropped'`).run();
		const dropped = await rowsNow();
		const [row] = claim.rows;
		if (row === undefined) throw new Error('one row was owed');

		await claim.land(row, { status: 'sent', attempts: 1 });

		expect(await rowsNow()).toEqual(dropped);
	});
});

describe("a run's last start", () => {
	it('claims nothing once the run is past its deadline', async () => {
		const scheduled = Date.now() - 90 * SECOND;
		await owe(backlog(2, scheduled));

		const claim = await outboxOf().claim(db, new Date(scheduled), { returning });

		expect(claim.rows).toEqual([]);
		expect((await rowsNow()).map((r) => r.leased_until)).toEqual([null, null]);
	});

	it('claims nothing when too little of the lease is left to finish an attempt in', async () => {
		const scheduled = Date.now() - 2 * MINUTE + 5 * SECOND;
		await owe(backlog(2, scheduled));

		const claim = await outboxOf({ deadlineMs: 2 * MINUTE }).claim(db, new Date(scheduled), {
			returning
		});

		expect(claim.rows).toEqual([]);
		expect((await rowsNow()).map((r) => r.leased_until)).toEqual([null, null]);
	});

	it('claims a run that is late but still inside both', async () => {
		const scheduled = Date.now() - 80 * SECOND;
		await owe(backlog(2, scheduled));

		const claim = await outboxOf().claim(db, new Date(scheduled), { returning });

		expect(claim.rows.map((r) => r.eventId)).toEqual(['e0', 'e1']);
	});

	it('starts no row once the run is past its last start, and finishes the one under way', async () => {
		const scheduled = Date.now() - 90 * SECOND + 300;
		await owe(backlog(3, scheduled));
		const claim = await outboxOf({ lanes: 1 }).claim(db, new Date(scheduled), { returning });
		const started: string[] = [];
		const finished: string[] = [];

		await claim.each(async (row) => {
			started.push(row.eventId);
			await until(scheduled + 90 * SECOND);
			finished.push(row.eventId);
		});

		expect(started).toEqual(['e0']);
		expect(finished).toEqual(['e0']);
	});
});

/** resolves once the wall clock reaches `at`. */
async function until(at: number): Promise<void> {
	while (Date.now() < at) await new Promise((resolve) => setTimeout(resolve, at - Date.now()));
}

describe('each()', () => {
	it('works every claimed row, never more than the lanes at once', async () => {
		const now = Date.now();
		await owe(backlog(5, now));
		const claim = await outboxOf().claim(db, new Date(now), { returning });
		let inFlight = 0;
		let most = 0;
		const worked: string[] = [];

		await claim.each(async (row) => {
			inFlight += 1;
			most = Math.max(most, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			worked.push(row.eventId);
			inFlight -= 1;
		});

		expect(most).toBe(3);
		expect(worked.sort()).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
	});
});
