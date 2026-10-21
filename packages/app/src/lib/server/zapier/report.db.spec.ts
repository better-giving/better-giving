import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { contact, donation, payment } from '../db/schema';
import { zapierStatements } from './events';
import { readZapierDeliveries } from './report';
import { subscribe } from './subscriptions';
import { client, run, stmt } from '$lib/server/db/database.testing';

// the queue as the dashboard's Zapier page reads it, against a real database. rows are queued by
// `zapierStatements`, the statement the money path splices in, and put into the state a case needs
// by a plain update.

const KEY_HASH = 'a'.repeat(64);
const DAY = 24 * 60 * 60_000;
const NOW = new Date('2026-09-22T12:00:00.000Z');

let db: Db;

beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	await run(stmt('delete from zapier_delivery'));
	await run(stmt('delete from zapier_subscription'));
	await run(stmt('delete from api_key'));
	await run(
		stmt(
			`insert into api_key (id, name, kind, key_hash, prefix, last_four, created_at)
		 values ('0192f0c4-7d2a-7000-8000-000000000000', 'Zapier', 'zapier', ?, 'bgz_AAAA', 'AAAA', 0)`,
			KEY_HASH
		)
	);
});

/** one gift queued to `hooks` new-gift subscriptions, which is that many delivery rows. */
async function queue(hooks: number): Promise<void> {
	for (let n = 0; n < hooks; n += 1) {
		const hookUrl = `https://hooks.zapier.com/hooks/standard/1/${uuidv7()}/`;
		if ((await subscribe(db, { trigger: 'new_gift', hookUrl }, KEY_HASH)) === null)
			throw new Error('the subscribe was refused under the current key');
	}
	const contactId = uuidv7();
	const donationId = uuidv7();
	const paymentId = uuidv7();
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
		}),
		...zapierStatements(db, { paymentId, contactId })
	]);
}

/** gives up on one row still pending, as of `at`. */
async function failOne(at: Date): Promise<void> {
	await run(
		stmt(
			`update zapier_delivery set status = 'failed', updated_at = ?
		 where rowid = (select rowid from zapier_delivery where status = 'pending' limit 1)`,
			at.getTime()
		)
	);
}

describe('readZapierDeliveries', () => {
	it('counts only the events given up on in the last seven days, so the line clears on its own', async () => {
		await queue(4);
		await failOne(new Date(NOW.getTime() - 8 * DAY));
		await failOne(new Date(NOW.getTime() - 7 * DAY - 1));
		await failOne(new Date(NOW.getTime() - 6 * DAY));

		expect(await readZapierDeliveries(db, NOW)).toMatchObject({ waiting: 1, failed: 1 });
	});
});
