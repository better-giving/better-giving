import { env } from 'cloudflare:test';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseContact, type ParsedContact } from '../contacts/contact-input';
import { createDb, type Db } from '../db/client';
import { createContact } from '../contacts/queries';
import { contact, donation, payment } from '../db/schema';
import { createDestination } from '../webhooks/destinations';
import { type CommitDonorResult, commitDonor } from './donor';

// the donor half of a gift, against a real D1.
//
// `resolveDonor` itself is asserted through the two callers rather than here — ./record.workers.spec.ts
// holds what it does inside a gift's one batch, and ./quote.workers.spec.ts holds what a repeating
// gift's commitment is told. what this file is for is the half that has no other home: committing
// the donor on their own, which is the write a commitment's `contact_id` has to be able to resolve
// against before the commitment exists.

let db: Db;

beforeEach(async () => {
	db = createDb(env.DB);
	await env.DB.prepare('delete from contact').run();
});

const donor = (over: { email?: string | null } = {}): ParsedContact => {
	const parsed = parseContact({
		kind: 'individual',
		first_name: 'Ada',
		last_name: 'Okafor',
		...(over.email === null ? {} : { primary_email: over.email ?? 'ada@example.org' })
	});
	if (!parsed.ok) throw new Error('the fixture donor does not parse');
	return parsed.value;
};

describe('commitDonor() — a donor this deployment has not seen', () => {
	it('writes the contact on its own and hands back the id it wrote under', async () => {
		const committed = await commitDonor(db, donor(), null);

		expect(committed.ok).toBe(true);
		// committed rather than staged: the id is the pointer a commitment carries, and a commitment
		// naming a row that is not there is a webhook that can never settle.
		const rows = await db.select().from(contact);
		expect(rows).toHaveLength(1);
		expect(committed.ok && committed.value.contactId).toBe(rows[0]?.id);
		expect(committed.ok && committed.value.created).toBe(true);
	});

	it('starts a donor nobody asked with no consent answer at all', async () => {
		await commitDonor(db, donor(), null);

		// `null` is the state the column starts in, and starting there is exactly what "nobody asked
		// this person" means (../db/schema.ts).
		const [row] = await db.select().from(contact);
		expect(row?.consentedToContact).toBeNull();
	});
});

describe('commitDonor() — a donor this deployment already has', () => {
	it('files them under the row they already have rather than minting a second', async () => {
		const first = await commitDonor(db, donor(), null);

		const second = await commitDonor(db, donor(), null);

		expect(second.ok && second.value.contactId).toBe(first.ok && first.value.contactId);
		expect(second.ok && second.value.created).toBe(false);
		const [rows] = await db.select({ n: sql<number>`count(*)` }).from(contact);
		expect(rows?.n).toBe(1);
	});

	it('overwrites the consent answer, because it is the most recent thing they said', async () => {
		await commitDonor(db, donor(), true);

		await commitDonor(db, donor(), false);

		const [row] = await db.select().from(contact);
		expect(row?.consentedToContact).toBe(false);
	});

	it('leaves the answer they gave alone when this form never asked', async () => {
		await commitDonor(db, donor(), true);

		const committed = await commitDonor(db, donor(), null);

		// no statement at all for this case, so the write is skipped rather than made empty — and a
		// donor who answered is not un-answered by a form that stopped asking.
		expect(committed.ok).toBe(true);
		const [row] = await db.select().from(contact);
		expect(row?.consentedToContact).toBe(true);
	});

	it('mints a second row for a donor who gave no address, because nothing may match on a name', async () => {
		await commitDonor(db, donor({ email: null }), null);

		await commitDonor(db, donor({ email: null }), null);

		// matching on a name would file two different people under one record, which is the failure
		// that cannot be undone by merging.
		const [rows] = await db.select({ n: sql<number>`count(*)` }).from(contact);
		expect(rows?.n).toBe(2);
	});
});

describe('commitDonor() — what a changed donor owes a listening destination', () => {
	const CHANGED_AT = new Date('2026-09-28T12:00:00.000Z');

	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(CHANGED_AT);
		await createDestination(db, { url: 'https://crm.example.org/a', events: ['donor.updated'] });
		await createDestination(db, { url: 'https://crm.example.org/b', events: ['donor.updated'] });
		await createDestination(db, { url: 'https://crm.example.org/c', events: ['donor.added'] });
	});

	afterEach(async () => {
		vi.useRealTimers();
		for (const table of [
			'webhook_delivery',
			'webhook_destination_event',
			'webhook_destination',
			'payment',
			'donation'
		]) {
			await env.DB.prepare(`delete from ${table}`).run();
		}
	});

	async function owed() {
		const { results } = await env.DB.prepare(
			`select d.url, w.event, w.subject_id from webhook_delivery w
			 join webhook_destination d on d.id = w.destination_id order by d.url`
		).all();
		return results;
	}

	/** the donor `committed` names, with one $50 gift of theirs settled. */
	async function withSettledGift(committed: CommitDonorResult): Promise<string> {
		if (!committed.ok) throw new Error(committed.detail);
		const { contactId } = committed.value;
		const donationId = uuidv7();
		await db.batch([
			db.insert(donation).values({
				id: donationId,
				contactId,
				totalMinor: 5_000,
				currency: 'USD',
				receivedAt: CHANGED_AT
			}),
			db.insert(payment).values({
				donationId,
				amountMinor: 5_000,
				currency: 'USD',
				direction: 'inbound',
				method: 'check',
				status: 'succeeded',
				provider: 'manual',
				occurredAt: CHANGED_AT
			})
		]);
		return contactId;
	}

	it('owes each destination taking donor.updated one row when a donor who has given changes their answer, keyed on the donor and the moment', async () => {
		const contactId = await withSettledGift(await commitDonor(db, donor(), true));

		await commitDonor(db, donor(), false);

		expect(await owed()).toEqual(
			['https://crm.example.org/a', 'https://crm.example.org/b'].map((url) => ({
				url,
				event: 'donor.updated',
				subject_id: `${contactId}:${CHANGED_AT.getTime()}`
			}))
		);
	});

	it('owes one when a donor who has given, and was never asked, answers for the first time', async () => {
		await withSettledGift(await commitDonor(db, donor(), null));

		await commitDonor(db, donor(), true);

		expect(await owed()).toHaveLength(2);
	});

	it('owes nothing for a donor typed in on the dashboard who answers before any gift of theirs settles, and changes the row all the same', async () => {
		const typed = await createContact(db, donor());

		await commitDonor(db, donor(), true);

		expect(await owed()).toEqual([]);
		const [row] = await db.select().from(contact).where(eq(contact.id, typed.id));
		expect(row?.consentedToContact).toBe(true);
	});

	it('owes one for that donor once a gift of theirs has settled', async () => {
		const typed = await createContact(db, donor());
		await withSettledGift({ ok: true, value: { contactId: typed.id, created: false } });

		await commitDonor(db, donor(), true);

		expect(await owed()).toHaveLength(2);
	});

	it('owes nothing when the returning donor gives the answer they gave before', async () => {
		await withSettledGift(await commitDonor(db, donor(), true));

		await commitDonor(db, donor(), true);

		expect(await owed()).toEqual([]);
	});

	it('owes nothing for a donor this deployment has not seen: their row is an insert', async () => {
		await commitDonor(db, donor(), true);

		expect(await owed()).toEqual([]);
	});
});
