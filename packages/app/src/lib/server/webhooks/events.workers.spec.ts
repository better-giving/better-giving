import { env } from 'cloudflare:test';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import { contact, donation, payment } from '../db/schema';
import type { WebhookEvent } from '../../webhooks/catalog';
import { createDestination } from './destinations';
import { changedRecordOf, changeSubject, webhookStatements } from './events';

// the delivery rows a settled gift owes the destinations listening, against a real D1.
//
// a workers spec because every claim is the database's: the fan-out is one INSERT…SELECT whose
// `where` decides who is owed, and "once" is a unique key refusing a second row.

let db: Db;
beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	for (const table of [
		'webhook_delivery',
		'webhook_destination_event',
		'webhook_destination',
		'payment',
		'donation',
		'contact'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
});

let made = 0;

async function destination(events: readonly WebhookEvent[]): Promise<string> {
	made += 1;
	const created = await createDestination(db, {
		url: `https://crm.example.org/hooks/${made}`,
		events
	});
	if (!created.ok) throw new Error(created.box);
	return created.destination.id;
}

/** one $50 gift from a new donor, committed with what it owes in one batch, the payment first. */
async function settle(): Promise<{ paymentId: string; contactId: string }> {
	const contactId = uuidv7();
	const donationId = uuidv7();
	const paymentId = uuidv7();
	const at = new Date('2026-09-10T12:00:00.000Z');
	await db.batch([
		db.insert(contact).values({ id: contactId, kind: 'individual', displayName: 'Ada Okafor' }),
		db
			.insert(donation)
			.values({ id: donationId, contactId, totalMinor: 5_000, currency: 'USD', receivedAt: at }),
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
		...webhookStatements(db, { paymentId, contactId })
	]);
	return { paymentId, contactId };
}

async function deliveries() {
	const { results } = await env.DB.prepare(
		`select id, destination_id, event, subject_id, status, attempts, leased_until, last_status,
		        delivered_at, next_attempt_at = created_at as due_at_once
		 from webhook_delivery order by destination_id`
	).all<Record<string, unknown>>();
	return results;
}

describe('webhookStatements() — who is owed a gift made', () => {
	it('owes each destination taking gift.made one pending row about the payment, due at once', async () => {
		const destinations = [
			await destination(['gift.made']),
			await destination(['gift.made', 'gift.refunded'])
		].sort();

		const { paymentId } = await settle();

		expect(await deliveries()).toEqual(
			destinations.map((destination_id) => ({
				id: expect.stringMatching(
					/^msg_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
				),
				destination_id,
				event: 'gift.made',
				subject_id: paymentId,
				status: 'pending',
				attempts: 0,
				leased_until: null,
				last_status: null,
				delivered_at: null,
				due_at_once: 1
			}))
		);
	});

	it('gives each destination its own webhook-id', async () => {
		await destination(['gift.made']);
		await destination(['gift.made']);

		await settle();

		const ids = (await deliveries()).map((row) => row.id);
		expect(new Set(ids).size).toBe(2);
	});

	it('owes nothing to a destination that does not take gift.made, or to an archived one', async () => {
		const listening = await destination(['gift.made']);
		await destination(['gift.refunded', 'donor.updated']);
		const archived = await destination(['gift.made']);
		await env.DB.prepare('update webhook_destination set archived_at = 1 where id = ?')
			.bind(archived)
			.run();

		await settle();

		expect((await deliveries()).map((row) => row.destination_id)).toEqual([listening]);
	});

	it('owes a paused destination its row, which waits there', async () => {
		const paused = await destination(['gift.made']);
		await env.DB.prepare('update webhook_destination set paused_at = 1 where id = ?')
			.bind(paused)
			.run();

		await settle();

		expect((await deliveries()).map((row) => row.destination_id)).toEqual([paused]);
	});

	it('owes nothing where no destination is made, and the gift still commits', async () => {
		const { paymentId } = await settle();

		expect(await deliveries()).toEqual([]);
		const stored = await env.DB.prepare('select status from payment where id = ?')
			.bind(paymentId)
			.first<{ status: string }>();
		expect(stored?.status).toBe('succeeded');
	});
});

describe('webhookStatements() — once', () => {
	it('writes nothing when the batch it rides in fails', async () => {
		await destination(['gift.made', 'donor.added']);
		const contactId = uuidv7();
		await db
			.insert(contact)
			.values({ id: contactId, kind: 'individual', displayName: 'Ada Okafor' });
		const paymentId = uuidv7();

		const refused = await db
			.batch([
				...webhookStatements(db, { paymentId, contactId }),
				// a payment naming no donation: the foreign key refuses the whole batch.
				db.insert(payment).values({
					id: paymentId,
					donationId: uuidv7(),
					amountMinor: 5_000,
					currency: 'USD',
					direction: 'inbound',
					method: 'check',
					status: 'succeeded',
					provider: 'manual',
					occurredAt: new Date()
				})
			])
			.then(
				() => 'committed',
				(error: unknown) => sqliteResultCode(error)
			);

		expect(refused).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
		expect(await deliveries()).toEqual([]);
	});

	it('meets its own key on a second commit for the same gift: the rows owed stand, and the batch commits', async () => {
		await destination(['gift.made', 'donor.added']);
		const gift = await settle();
		const owed = await deliveries();

		await db.batch(webhookStatements(db, gift));

		expect(owed.map((row) => row.event).sort()).toEqual(['donor.added', 'gift.made']);
		expect(await deliveries()).toEqual(owed);
	});
});

describe('changeSubject() and changedRecordOf()', () => {
	it('names a record and the moment it changed, and gives the record back', () => {
		const subject = changeSubject(
			'01a0e7e2-de00-7c82-9455-17f50f3e681b',
			new Date(1_790_000_000_000)
		);

		expect(subject).toBe('01a0e7e2-de00-7c82-9455-17f50f3e681b:1790000000000');
		expect(changedRecordOf(subject)).toBe('01a0e7e2-de00-7c82-9455-17f50f3e681b');
	});

	it('gives back no record for a subject that names no change', () => {
		expect(changedRecordOf('01a0e7e2-de00-7c82-9455-17f50f3e681b')).toBeNull();
		expect(changedRecordOf(':1790000000000')).toBeNull();
	});
});
