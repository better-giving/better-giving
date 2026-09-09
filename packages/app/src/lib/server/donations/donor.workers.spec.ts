import { env } from 'cloudflare:test';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseContact, type ParsedContact } from '../contacts/contact-input';
import { createDb, type Db } from '../db/client';
import { contact } from '../db/schema';
import { commitDonor } from './donor';

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
