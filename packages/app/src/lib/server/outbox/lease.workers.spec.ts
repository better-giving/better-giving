import { env } from 'cloudflare:test';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { contact, donation, payment, zapierDelivery, zapierSubscription } from '../db/schema';
import { defineOutbox, type LeaseTerms } from './lease';

// the lease module against a real D1, over `zapier_delivery` rows written here by hand. the table
// stands in for any outbox: nothing asserted below is about Zapier, and no Zapier module runs.

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const TERMS: LeaseTerms = {
	leaseMs: 2 * MINUTE,
	attemptMs: 10 * SECOND,
	lanes: 3
};

/** rows a claim below takes, unless it says otherwise. */
const CLAIMS = 5;

const outboxOf = (terms: Partial<LeaseTerms> = {}, receiver?: SQLiteColumn) =>
	defineOutbox({
		table: zapierDelivery,
		key: { subscriptionId: zapierDelivery.subscriptionId, eventId: zapierDelivery.eventId },
		...TERMS,
		...terms,
		...(receiver === undefined ? {} : { receiver })
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
	readonly subscriptionId?: string;
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
				row.subscriptionId ?? subscriptionId,
				row.eventId,
				paymentId,
				row.status ?? 'pending',
				row.nextAttemptAt,
				row.leasedUntil ?? null
			)
		)
	);
}

/** a second open subscription, beside the one every row is owed to by default. */
async function secondSubscription(): Promise<string> {
	const id = uuidv7();
	await env.DB.prepare(
		`insert into zapier_subscription (id, trigger, hook_url, created_at, updated_at)
		 values (?, 'new_gift', ?, 0, 0)`
	)
		.bind(id, `https://hooks.zapier.com/hooks/standard/1/${id}/`)
		.run();
	return id;
}

/** `count` rows due at once, `e0` waiting longest. */
const backlog = (count: number, dueAt: number): Owed[] =>
	Array.from({ length: count }, (_, i) => ({ eventId: `e${i}`, nextAttemptAt: dueAt - count + i }));

const returning = { attempts: zapierDelivery.attempts };

/**
 * `d1` with the rows D1 reports reading for every `batch()` made through it summed: the figure the
 * Free plan's five million rows read a day is counted in.
 */
function rowsRead(d1: D1Database) {
	let total = 0;
	const counting = new Proxy(d1, {
		get(target, key) {
			const value: unknown = Reflect.get(target, key, target);
			if (typeof value !== 'function') return value;
			if (key !== 'batch') return value.bind(target);
			return async (statements: D1PreparedStatement[]) => {
				const results = (await value.call(target, statements)) as D1Result[];
				for (const result of results) total += result.meta.rows_read;
				return results;
			};
		}
	});
	return { db: createDb(counting), total: () => total };
}

/** each row as the table holds it, by event id. */
async function rowsNow() {
	const { results } = await env.DB.prepare(
		`select event_id, status, attempts, next_attempt_at, leased_until
		 from zapier_delivery order by event_id`
	).all<{
		event_id: string;
		status: string;
		attempts: number;
		next_attempt_at: number;
		leased_until: number | null;
	}>();
	return results;
}

describe('claim()', () => {
	it('takes at most the per-run bound, the longest-waiting first, and leases each', async () => {
		const now = Date.now();
		await owe(backlog(7, now));

		const claim = await outboxOf().claim(db, new Date(now), { claims: CLAIMS, returning });

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
			outbox.claim(db, new Date(now), { claims: CLAIMS, returning }),
			outbox.claim(db, new Date(now), { claims: CLAIMS, returning })
		]);

		const taken = [...first.rows, ...second.rows].map((r) => r.eventId).sort();
		expect(taken).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7']);
	});

	it('takes a leased row back only once its lease has run out', async () => {
		const now = Date.now();
		await owe(backlog(2, now));
		const outbox = outboxOf();
		const claimAt = (at: number) =>
			outbox
				.claim(db, new Date(at), { claims: CLAIMS, returning })
				.then((c) => c.rows.map((r) => r.eventId));

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

		const claim = await outboxOf().claim(db, new Date(now), { claims: CLAIMS, returning });

		expect(claim.rows.map((r) => r.eventId)).toEqual(['due']);
	});

	it("takes only what the caller's own condition admits", async () => {
		const now = Date.now();
		await owe(backlog(3, now));

		const claim = await outboxOf().claim(db, new Date(now), {
			claims: CLAIMS,
			returning,
			where: sql`${zapierDelivery.eventId} <> 'e1'`
		});

		expect(claim.rows.map((r) => r.eventId)).toEqual(['e0', 'e2']);
	});

	it("takes each receiver's longest-waiting row before any receiver's next", async () => {
		const now = Date.now();
		const other = await secondSubscription();
		await owe([
			...backlog(4, now - 10),
			{ eventId: 'b0', subscriptionId: other, nextAttemptAt: now - 2 },
			{ eventId: 'b1', subscriptionId: other, nextAttemptAt: now - 1 }
		]);

		const fair = outboxOf({}, zapierDelivery.subscriptionId);
		const claim = await fair.claim(db, new Date(now), { claims: 3, returning });

		expect(claim.rows.map((r) => r.eventId).sort()).toEqual(['b0', 'e0', 'e1']);
	});

	it('reads as many rows to take a fair claim from a long backlog as from a short one', async () => {
		const now = Date.now();
		const other = await secondSubscription();
		const fair = outboxOf({}, zapierDelivery.subscriptionId);

		/** the rows D1 read to take one fair claim from `size` due rows. */
		async function readToClaim(size: number): Promise<number> {
			await env.DB.prepare('delete from zapier_delivery').run();
			const rows = backlog(size, now - 10);
			for (let cut = 0; cut < rows.length; cut += 50) await owe(rows.slice(cut, cut + 50));
			await owe([{ eventId: 'b0', subscriptionId: other, nextAttemptAt: now - 5 }]);
			const read = rowsRead(env.DB);
			await fair.claim(read.db, new Date(now), { claims: CLAIMS, returning });
			return read.total();
		}

		const short = await readToClaim(100);
		const long = await readToClaim(600);

		expect(long).toBe(short);
	});

	it('takes the oldest first, whoever they are owed to, where no receiver is named', async () => {
		const now = Date.now();
		const other = await secondSubscription();
		await owe([
			...backlog(4, now - 10),
			{ eventId: 'b0', subscriptionId: other, nextAttemptAt: now - 2 }
		]);

		const claim = await outboxOf().claim(db, new Date(now), { claims: 3, returning });

		expect(claim.rows.map((r) => r.eventId).sort()).toEqual(['e0', 'e1', 'e2']);
	});

	it("writes the feed's own columns as it claims, and of its own only the lease", async () => {
		const now = Date.now();
		await owe(backlog(1, now));

		const claim = await outboxOf().claim(db, new Date(now), {
			claims: CLAIMS,
			returning,
			set: {
				attempts: sql`${zapierDelivery.attempts} + 1`,
				updatedAt: sql`${zapierDelivery.updatedAt}`
			}
		});

		expect(claim.rows.map((r) => r.attempts)).toEqual([1]);
		const { results } = await env.DB.prepare(
			'select attempts, leased_until, updated_at from zapier_delivery'
		).all();
		expect(results).toEqual([{ attempts: 1, leased_until: now + 2 * MINUTE, updated_at: 0 }]);
	});
});

describe('land()', () => {
	it("writes the caller's outcome and gives the lease back", async () => {
		const now = Date.now();
		await owe(backlog(2, now));
		const claim = await outboxOf().claim(db, new Date(now), { claims: CLAIMS, returning });
		const [sent, waiting] = claim.rows;
		if (sent === undefined || waiting === undefined) throw new Error('two rows were owed');

		expect(await claim.land(sent, { status: 'sent', attempts: sent.attempts + 1 })).toBe(true);
		expect(
			await claim.land(waiting, {
				attempts: waiting.attempts + 1,
				nextAttemptAt: new Date(now + 5 * MINUTE)
			})
		).toBe(true);

		expect(await rowsNow()).toEqual([
			{
				event_id: 'e0',
				status: 'sent',
				attempts: 1,
				next_attempt_at: now - 2,
				leased_until: null
			},
			{
				event_id: 'e1',
				status: 'pending',
				attempts: 1,
				next_attempt_at: now + 5 * MINUTE,
				leased_until: null
			}
		]);
	});

	it("lands as a statement in the feed's own batch, answering with the key it landed on", async () => {
		const now = Date.now();
		await owe(backlog(1, now));
		const claim = await outboxOf().claim(db, new Date(now), { claims: CLAIMS, returning });
		const [row] = claim.rows;
		if (row === undefined) throw new Error('one row was owed');

		const [landed, ended] = await db.batch([
			claim.landing(row, { status: 'sent', attempts: 1 }),
			db
				.update(zapierSubscription)
				.set({ endedAt: new Date(now), endedReason: 'unsubscribed' })
				.where(eq(zapierSubscription.id, subscriptionId))
				.returning({ id: zapierSubscription.id })
		]);

		expect(landed).toEqual([{ subscriptionId, eventId: 'e0' }]);
		expect(ended).toEqual([{ id: subscriptionId }]);
		expect(await rowsNow()).toEqual([
			expect.objectContaining({ status: 'sent', leased_until: null })
		]);
	});

	it('writes nothing to a row a later run has taken over', async () => {
		const now = Date.now();
		await owe(backlog(1, now));
		const outbox = outboxOf();
		const overrun = await outbox.claim(db, new Date(now), { claims: CLAIMS, returning });
		await outbox.claim(db, new Date(now + 2 * MINUTE), { claims: CLAIMS, returning });
		const takenOver = await rowsNow();
		const [row] = overrun.rows;
		if (row === undefined) throw new Error('one row was owed');

		expect(await overrun.land(row, { status: 'sent', attempts: 1 })).toBe(false);
		expect(await db.batch([overrun.landing(row, { status: 'sent', attempts: 1 })])).toEqual([[]]);

		expect(await rowsNow()).toEqual(takenOver);
	});

	it('writes nothing to a row no longer owed', async () => {
		const now = Date.now();
		await owe(backlog(1, now));
		const claim = await outboxOf().claim(db, new Date(now), { claims: CLAIMS, returning });
		await env.DB.prepare(`update zapier_delivery set status = 'dropped'`).run();
		const dropped = await rowsNow();
		const [row] = claim.rows;
		if (row === undefined) throw new Error('one row was owed');

		expect(await claim.land(row, { status: 'sent', attempts: 1 })).toBe(false);

		expect(await rowsNow()).toEqual(dropped);
	});
});

describe('sweep()', () => {
	it("writes the feed's outcome on every owed row nobody holds that its condition admits", async () => {
		const now = Date.now();
		await owe([
			{ eventId: 'stale', nextAttemptAt: now + HOUR },
			{ eventId: 'lapsed', nextAttemptAt: now - HOUR, leasedUntil: now },
			{ eventId: 'held', nextAttemptAt: now - HOUR, leasedUntil: now + 1 },
			{ eventId: 'sent', nextAttemptAt: now - HOUR, status: 'sent' },
			{ eventId: 'spared', nextAttemptAt: now - HOUR }
		]);

		await db.batch([
			outboxOf().sweep(db, new Date(now), {
				where: sql`${zapierDelivery.eventId} <> 'spared'`,
				outcome: { status: 'failed' }
			})
		]);

		expect((await rowsNow()).map((r) => [r.event_id, r.status, r.leased_until])).toEqual([
			['held', 'pending', now + 1],
			['lapsed', 'failed', null],
			['sent', 'sent', null],
			['spared', 'pending', null],
			['stale', 'failed', null]
		]);
	});
	it('spares a held row, and a later claim sweeps it before it can be taken again', async () => {
		const now = Date.now();
		await owe(backlog(1, now));
		const outbox = outboxOf();
		const doomed = () =>
			outbox.sweep(db, new Date(Date.now()), {
				where: sql`${zapierDelivery.eventId} = 'e0'`,
				outcome: { status: 'dropped' }
			});
		const holding = await outbox.claim(db, new Date(now), { claims: CLAIMS, returning });
		const [row] = holding.rows;
		if (row === undefined) throw new Error('one row was owed');

		const [swept] = await db.batch([doomed()]);
		expect(swept).toEqual([]);
		expect(await holding.land(row, { attempts: 1, nextAttemptAt: new Date(now) })).toBe(true);

		const next = await outbox.claim(db, new Date(now), {
			claims: CLAIMS,
			returning,
			before: [doomed()]
		});

		expect(next.rows).toEqual([]);
		expect((await rowsNow()).map((r) => [r.event_id, r.status, r.leased_until])).toEqual([
			['e0', 'dropped', null]
		]);
	});
});

describe("a run's last start", () => {
	it('claims nothing once too little of the lease is left for an attempt and the work after it', async () => {
		const scheduled = Date.now() - 100 * SECOND;
		await owe(backlog(2, scheduled));

		const claim = await outboxOf().claim(db, new Date(scheduled), { claims: CLAIMS, returning });

		expect(claim.rows).toEqual([]);
		expect((await rowsNow()).map((r) => r.leased_until)).toEqual([null, null]);
	});

	it('leaves the work after an answer room to land before the lease runs out', async () => {
		const scheduled = Date.now() - 2 * MINUTE + 15 * SECOND;
		await owe(backlog(2, scheduled));

		const claim = await outboxOf().claim(db, new Date(scheduled), { claims: CLAIMS, returning });

		expect(claim.rows).toEqual([]);
	});

	it('claims a run that is late but still inside it', async () => {
		const scheduled = Date.now() - 80 * SECOND;
		await owe(backlog(2, scheduled));

		const claim = await outboxOf().claim(db, new Date(scheduled), { claims: CLAIMS, returning });

		expect(claim.rows.map((r) => r.eventId)).toEqual(['e0', 'e1']);
	});

	it('starts no row once the run is past its last start, and finishes the one under way', async () => {
		const scheduled = Date.now();
		await owe(backlog(3, scheduled));
		// a last start two seconds after the scheduled time: the lease less the attempt and the
		// ten seconds after an answer.
		const claim = await outboxOf({ lanes: 1, leaseMs: 22 * SECOND }).claim(
			db,
			new Date(scheduled),
			{ claims: CLAIMS, returning }
		);
		const started: string[] = [];
		const finished: string[] = [];

		await claim.each(async (row) => {
			started.push(row.eventId);
			await until(scheduled + 2 * SECOND);
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
		const claim = await outboxOf().claim(db, new Date(now), { claims: CLAIMS, returning });
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

describe('takeBack()', () => {
	it('gives back a live lease, so the run holding the row holds it no longer and lands nothing', async () => {
		const now = Date.now();
		await owe(backlog(1, now));
		const outbox = outboxOf();
		const claim = await outbox.claim(db, new Date(now), { claims: CLAIMS, returning });
		const [row] = claim.rows;
		if (row === undefined) throw new Error('nothing was claimed');
		const held = () =>
			db
				.select({ held: sql<number>`${claim.holds(row)}` })
				.from(zapierSubscription)
				.where(eq(zapierSubscription.id, subscriptionId));
		expect(await held()).toEqual([{ held: 1 }]);

		const [taken] = await db.batch([
			outbox.takeBack(db, {
				where: eq(zapierDelivery.eventId, row.eventId),
				outcome: { attempts: 0, nextAttemptAt: new Date(now + HOUR) }
			})
		]);

		expect(taken).toEqual([{ subscriptionId, eventId: row.eventId }]);
		expect(await held()).toEqual([{ held: 0 }]);
		expect(await claim.land(row, { status: 'sent', attempts: 1 })).toBe(false);
		expect(await rowsNow()).toEqual([
			expect.objectContaining({
				event_id: row.eventId,
				status: 'pending',
				attempts: 0,
				next_attempt_at: now + HOUR,
				leased_until: null
			})
		]);
	});
});
