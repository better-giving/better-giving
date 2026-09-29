import { env } from 'cloudflare:test';
import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { zapierSubscription } from '../db/schema';
import { defineFailing } from './failing';

// the failing policy against a real D1, over `zapier_subscription` rows written here by hand. the
// table stands in for any receiver: nothing asserted below is about Zapier, and no Zapier module
// runs.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const failing = defineFailing({
	table: zapierSubscription,
	open: isNull(zapierSubscription.endedAt),
	stopAfterMs: 72 * HOUR
});

let db: Db;
let receiverId: string;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from zapier_delivery').run();
	await env.DB.prepare('delete from zapier_subscription').run();
	receiverId = uuidv7();
	await env.DB.prepare(
		`insert into zapier_subscription (id, trigger, hook_url, created_at, updated_at)
		 values (?, 'new_gift', ?, 0, 0)`
	)
		.bind(receiverId, `https://hooks.zapier.com/hooks/standard/1/${receiverId}/`)
		.run();
});

/** the receiver's mark as the table holds it. */
async function markNow(): Promise<number | null> {
	const row = await env.DB.prepare('select failing_since from zapier_subscription where id = ?')
		.bind(receiverId)
		.first<{ failing_since: number | null }>();
	return row?.failing_since ?? null;
}

async function setMark(at: number | null, endedAt: number | null = null): Promise<void> {
	await env.DB.prepare(
		'update zapier_subscription set failing_since = ?, ended_at = ?, ended_reason = ? where id = ?'
	)
		.bind(at, endedAt, endedAt === null ? null : 'gone', receiverId)
		.run();
}

describe('failed()', () => {
	it("marks a receiver's first failure, and keeps that mark through the failures after it", async () => {
		const start = Date.UTC(2026, 8, 10, 12);
		const queued = new Date(start);

		await db.batch([failing.failed(db, receiverId, { createdAt: queued }, new Date(start))]);
		await db.batch([failing.failed(db, receiverId, { createdAt: queued }, new Date(start + HOUR))]);

		expect(await markNow()).toBe(start);
	});

	it('starts afresh where the mark is older than the window before the failing row was queued', async () => {
		const queued = Date.UTC(2026, 8, 10, 12);
		await setMark(queued - 30 * DAY);

		await db.batch([
			failing.failed(db, receiverId, { createdAt: new Date(queued) }, new Date(queued + MINUTE))
		]);

		expect(await markNow()).toBe(queued + MINUTE);
	});

	it('keeps a mark the failing row could have been failing alongside', async () => {
		const queued = Date.UTC(2026, 8, 10, 12);
		await setMark(queued - 72 * HOUR);

		await db.batch([
			failing.failed(db, receiverId, { createdAt: new Date(queued) }, new Date(queued + MINUTE))
		]);

		expect(await markNow()).toBe(queued - 72 * HOUR);
	});

	it('marks no receiver that is no longer open', async () => {
		const at = Date.UTC(2026, 8, 10, 12);
		await setMark(null, at);

		await db.batch([failing.failed(db, receiverId, { createdAt: new Date(at) }, new Date(at))]);

		expect(await markNow()).toBeNull();
	});
});

describe('taken()', () => {
	it("ends the receiver's run of failures", async () => {
		const at = Date.UTC(2026, 8, 10, 12);
		await setMark(at);

		await db.batch([failing.taken(db, receiverId)]);

		expect(await markNow()).toBeNull();
	});
});

describe('stopGuard()', () => {
	/** the receiver ended at `now` under `guard`, answering whether it took. */
	async function stopUnder(guard: ReturnType<typeof failing.stopGuard>, now: number) {
		if (guard === null) return false;
		const [ended] = await db.batch([
			db
				.update(zapierSubscription)
				.set({ endedAt: new Date(now), endedReason: 'gone' })
				.where(and(eq(zapierSubscription.id, receiverId), guard))
				.returning({ id: zapierSubscription.id })
		]);
		return ended.length > 0;
	}

	it("never stops a receiver on a row's first failure", () => {
		expect(failing.stopGuard({ attempts: 0 }, new Date())).toBeNull();
	});

	it('stops a receiver on a retry once its mark is the whole window behind, and not before', async () => {
		const mark = Date.UTC(2026, 8, 10, 12);
		await setMark(mark);

		expect(
			await stopUnder(
				failing.stopGuard({ attempts: 3 }, new Date(mark + 72 * HOUR - 1)),
				mark + 72 * HOUR - 1
			)
		).toBe(false);
		expect(
			await stopUnder(
				failing.stopGuard({ attempts: 3 }, new Date(mark + 72 * HOUR)),
				mark + 72 * HOUR
			)
		).toBe(true);
	});

	it('does not stop a receiver on two quick failures after a quiet spell left an old mark', async () => {
		const queued = Date.UTC(2026, 8, 10, 12);
		await setMark(queued - 30 * DAY);
		const row = { createdAt: new Date(queued) };

		for (const [attempts, at] of [
			[0, queued],
			[1, queued + MINUTE]
		] as const) {
			const now = new Date(at);
			const guard = failing.stopGuard({ attempts }, now);
			await db.batch([failing.failed(db, receiverId, row, now)]);
			expect(await stopUnder(guard, at)).toBe(false);
		}

		expect(await markNow()).toBe(queued);
	});
});
