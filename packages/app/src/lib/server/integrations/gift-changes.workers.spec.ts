import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { contact, dispute, donation, entryGroup, payment } from '../db/schema';
import { post, postingStatements } from '../ledger/posting';
import { readGiftPage } from './gift';
import type { Keyset } from './paging';
import { rowsReadBy } from './statements.testing';

// the walk of changes merges one stream per kind of write a gift's `updated_at` is the latest of
// (`changedKeys` in ./gift.ts). what the merge must hold whatever stream a change arrives on: each
// gift once, at its latest change and at no earlier one, and gifts sharing an instant in id order
// — including the streams whose id is on another row than their time.

let db: Db;

beforeEach(async () => {
	db = createDb(env.DB);
	for (const table of ['ledger_entry', 'entry_group', 'dispute', 'payment', 'donation', 'contact'])
		await env.DB.prepare(`delete from ${table}`).run();
});

afterEach(() => {
	vi.useRealTimers();
});

const CONTACT_ID = '019fb300-0000-7000-8000-000000000001';
const giftId = (last: string) => `019fb300-0000-7000-8000-0000000000${last}`;
const day = (n: number) => new Date(Date.UTC(2026, 8, n, 12));

/** a settled $50 gift with id `id`, its row written at `createdAt`. */
async function seedGift(id: string, createdAt: Date): Promise<void> {
	await db.insert(donation).values({
		id: `don-${id}`,
		contactId: CONTACT_ID,
		totalMinor: 5_000,
		currency: 'USD',
		receivedAt: createdAt
	});
	await db.insert(payment).values({
		id,
		donationId: `don-${id}`,
		amountMinor: 5_000,
		currency: 'USD',
		direction: 'inbound',
		method: 'check',
		status: 'succeeded',
		provider: 'manual',
		occurredAt: createdAt,
		createdAt
	});
}

/** $10 of gift `id` sent back, its row written at `createdAt`; answers the row's id. */
async function seedRefund(id: string, createdAt: Date, suffix = 'r'): Promise<string> {
	const refundId = `${id}-${suffix}`;
	await db.insert(payment).values({
		id: refundId,
		donationId: `don-${id}`,
		amountMinor: 1_000,
		currency: 'USD',
		direction: 'refund',
		method: 'check',
		status: 'succeeded',
		provider: 'manual',
		occurredAt: createdAt,
		createdAt,
		parentPaymentId: id
	});
	return refundId;
}

async function walk(since: Date, limit: number): Promise<{ id: string; updated_at: string }[]> {
	const served: { id: string; updated_at: string }[] = [];
	let after: Keyset | null = null;
	for (;;) {
		const page = await readGiftPage(db, { order: 'changed', limit, after, since });
		served.push(...page.rows.map((gift) => ({ id: gift.id, updated_at: gift.updated_at })));
		if (page.next === null) return served;
		after = page.next;
	}
}

it.each([1, 50])(
	'serves each gift once at its latest change, in id order across every stream a change arrives on, %i to a page',
	async (limit) => {
		await db
			.insert(contact)
			.values({ id: CONTACT_ID, kind: 'individual', displayName: 'Ada Okafor' });

		// a posting keyed on a refund row: its time is the write's own, so it sets the instant.
		const postedOnRefund = giftId('0a');
		await seedGift(postedOnRefund, day(10));
		const reinstated = await seedRefund(postedOnRefund, day(11));
		await db.batch(
			postingStatements(
				db,
				post({
					sourceType: 'payment',
					sourceId: reinstated,
					currency: 'USD',
					occurredAt: day(12),
					lines: [
						{ accountId: postableId('undepositedFunds'), amountMinor: 1_000 },
						{ accountId: postableId('donationsDeductible'), amountMinor: -1_000 }
					]
				})
			)
		);
		const [posted] = await db
			.select({ at: entryGroup.createdAt })
			.from(entryGroup)
			.where(eq(entryGroup.sourceId, reinstated));
		const instant = posted?.at ?? new Date(Number.NaN);

		const disputeMoved = giftId('0b');
		await seedGift(disputeMoved, day(10));
		const withdrawal = await seedRefund(disputeMoved, day(11));
		await db
			.insert(dispute)
			.values({ paymentId: withdrawal, createdAt: day(11), updatedAt: instant });

		// its own row and a refund row, written at one instant: one position from two streams.
		const twice = giftId('0c');
		await seedGift(twice, instant);
		await seedRefund(twice, instant);

		const ownRow = giftId('0d');
		await seedGift(ownRow, instant);

		// written at the instant, and changed after it: served at the later change alone.
		const later = new Date(instant.getTime() + 5_000);
		const movedOn = giftId('09');
		await seedGift(movedOn, instant);
		await seedRefund(movedOn, later);

		const served = await walk(instant, limit);

		const at = instant.toISOString();
		expect(served).toEqual([
			{ id: postedOnRefund, updated_at: at },
			{ id: disputeMoved, updated_at: at },
			{ id: twice, updated_at: at },
			{ id: ownRow, updated_at: at },
			{ id: movedOn, updated_at: later.toISOString() }
		]);
	}
);

/** gift `id`'s $50 settled: its posting written at `writtenAt`, the money having moved at `movedAt`. */
async function seedSettlement(id: string, movedAt: Date, writtenAt: Date): Promise<void> {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(writtenAt);
	await db.batch(
		postingStatements(
			db,
			post({
				sourceType: 'payment',
				sourceId: id,
				currency: 'USD',
				occurredAt: movedAt,
				lines: [
					{ accountId: postableId('undepositedFunds'), amountMinor: 5_000 },
					{ accountId: postableId('donationsDeductible'), amountMinor: -5_000 }
				]
			})
		)
	);
	vi.useRealTimers();
}

// a run of authorizations before any of them settles: the first writes from where a page starts are
// none of them a gift's latest, so the page has to read past them to find its gifts.
it('serves every gift when the writes a page starts on are none of them a latest', async () => {
	await db
		.insert(contact)
		.values({ id: CONTACT_ID, kind: 'individual', displayName: 'Ada Okafor' });
	const gifts = ['01', '02', '03', '04', '05', '06'].map((last, n) => ({
		id: giftId(last),
		authorizedAt: new Date(day(1).getTime() + n * 1_000),
		settledAt: new Date(day(2).getTime() + n * 1_000)
	}));
	for (const { id, authorizedAt } of gifts) await seedGift(id, authorizedAt);
	for (const { id, authorizedAt, settledAt } of gifts)
		await seedSettlement(id, authorizedAt, settledAt);

	const served = await walk(new Date(0), 2);

	expect(served).toEqual(
		gifts.map(({ id, settledAt }) => ({ id, updated_at: settledAt.toISOString() }))
	);
});

// a gift's own row is rarely its latest write: a card settles after it authorizes. what a page reads
// is bounded by the writes up to its last gift, so what lies past them costs it nothing.
it('reads a page of changes at the same cost however many changes come after its last gift', async () => {
	await db
		.insert(contact)
		.values({ id: CONTACT_ID, kind: 'individual', displayName: 'Ada Okafor' });
	// each authorized on an even second and settled on the odd one after it.
	const seedCards = async (first: number, count: number) => {
		for (let n = first; n < first + count; n++) {
			const id = `019fb300-0000-7000-8000-${String(n).padStart(12, '0')}`;
			const authorizedAt = new Date(Date.UTC(2026, 8, 1) + n * 2_000);
			await seedGift(id, authorizedAt);
			await seedSettlement(id, authorizedAt, new Date(authorizedAt.getTime() + 1_000));
		}
	};
	const firstPage = (read: Db) =>
		readGiftPage(read, { order: 'changed', limit: 10, after: null, since: new Date(0) });

	await seedCards(0, 30);
	const before = await rowsReadBy(firstPage);
	await seedCards(30, 30);
	const after = await rowsReadBy(firstPage);

	expect(after).toBe(before);
});
