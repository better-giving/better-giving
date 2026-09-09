import { env } from 'cloudflare:test';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import {
	contact,
	donation,
	entryGroup,
	form,
	ledgerEntry,
	lineItem,
	payment,
	program
} from '../db/schema';
import { parseContact, type ParsedContact } from '../contacts/contact-input';
import { commitDonor } from './donor';
import {
	RECORD_FAILURE_REASONS,
	recordAuthorizedGift,
	recordDonation,
	type AuthorizedGiftInput,
	type RecordDonationInput,
	type RecordedDonation
} from './record';

// the quote-time write, against a real D1.
//
// four tables land in one `batch()` and the ledger does not, which is the claim this file is here
// to hold. the atomicity case is the one that matters most: a gift is a contact, a donation, its
// lines and its payment, and D1 has no interactive transaction — so if any of that were two
// commits, a donor could exist with no gift and nothing in the schema would detect it.
//
// the other half of the file is the refusals, and they are asserted by reason rather than by
// message. that is the point of the closed union: an endpoint answering a donor has to tell a
// retry that already succeeded from a gift it cannot write, and matching on prose to do it is what
// this module exists to stop.
//
// per-file storage rather than per-test (`@cloudflare/vitest-pool-workers`), so writes accumulate
// down the file. the two probes that count over a whole table are deliberately the first case in
// the file — see there.

const FUND = postableId('donationsDeductible');

let db: Db;
let formId: string;
/** a cause a gift may be credited to. no migration seeds one, so this file writes it. */
const PROGRAM_ID = '019fb500-0000-7000-8000-000000000001';

beforeAll(async () => {
	db = createDb(env.DB);
	const [row] = await db
		.insert(form)
		.values({ name: 'annual appeal', revenueAccountId: FUND, currency: 'USD' })
		.returning({ id: form.id });
	if (!row) throw new Error('inserting the fixture form returned no row');
	formId = row.id;
	await db.insert(program).values({ id: PROGRAM_ID, name: 'Clean water' });
});

/** a donor, through the parser rather than around it — `ParsedContact` is branded. */
function donor(email: string, firstName = 'Ada'): ParsedContact {
	const parsed = parseContact({
		kind: 'individual',
		first_name: firstName,
		last_name: 'Okafor',
		primary_email: email
	});
	if (!parsed.ok) throw new Error(`the fixture donor did not parse: ${JSON.stringify(parsed)}`);
	return parsed.value;
}

let sequence = 0;

/** one gift, with whatever this case needs replaced. */
function gift(over: Partial<RecordDonationInput> = {}): RecordDonationInput {
	sequence += 1;
	return {
		donationId: `019fb200-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
		donor: donor(`donor${sequence}@example.org`),
		formId,
		origin: 'https://example.org',
		currency: 'USD',
		totalMinor: 10_000,
		feeMinor: 320,
		lines: [{ label: 'Donation', revenueAccountId: FUND, amountMinor: 10_000 }],
		method: 'card',
		providerTxnId: `pi_${sequence}_${Date.now()}`,
		occurredAt: new Date('2026-08-03T12:00:00.000Z'),
		consentedToContact: false,
		note: undefined,
		tribute: null,
		programId: null,
		...over
	};
}

/** the write, required to have succeeded — for the cases that are about what it stored. */
async function recorded(input: RecordDonationInput): Promise<RecordedDonation> {
	const result = await recordDonation(db, input);
	if (!result.ok) throw new Error(`expected this gift to be recorded: ${result.detail}`);
	return result.value;
}

/** the write, required to have been refused — hands back the reason and the sentence. */
async function refusal(input: RecordDonationInput) {
	const result = await recordDonation(db, input);
	if (result.ok) throw new Error('expected recordDonation to refuse this gift, but it wrote it');
	return result;
}

// the two whole-table counts are the first case in this file, before any other has written a gift.
// scoping them to one `sourceId` or to one account would make them narrower than their own name —
// the claim is that this module writes nothing to either table, not that it writes nothing under
// one key.
describe('recordDonation() — the ledger is not written', () => {
	it('puts nothing in the books, because no money has moved yet', async () => {
		await recorded(gift());

		// posting here would put an entry group behind money Stripe has not collected, and every
		// balance in this app is a `SUM` at read time (CLAUDE.md).
		const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		const [entries] = await db.select({ n: sql<number>`count(*)` }).from(ledgerEntry);
		expect(groups?.n).toBe(0);
		expect(entries?.n).toBe(0);
	});
});

describe('recordDonation() — the rows one gift writes', () => {
	it('writes the contact, the donation, its lines and its payment', async () => {
		const input = gift();

		const value = await recorded(input);

		expect(value.donationId).toBe(input.donationId);
		expect(value.donorWasCreated).toBe(true);

		const [stored] = await db.select().from(donation).where(eq(donation.id, input.donationId));
		expect(stored).toMatchObject({
			contactId: value.contactId,
			formId,
			origin: 'https://example.org',
			currency: 'USD',
			totalMinor: 10_000,
			feeMinor: 320,
			receivedAt: input.occurredAt
		});

		const lines = await db.select().from(lineItem).where(eq(lineItem.donationId, input.donationId));
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({
			label: 'Donation',
			revenueAccountId: FUND,
			quantity: 1,
			unitPriceMinor: 10_000,
			lineTotalMinor: 10_000
		});

		const [paid] = await db.select().from(payment).where(eq(payment.id, value.paymentId));
		expect(paid).toMatchObject({
			donationId: input.donationId,
			amountMinor: 10_000,
			currency: 'USD',
			direction: 'inbound',
			status: 'pending',
			provider: 'stripe',
			providerTxnId: input.providerTxnId,
			occurredAt: input.occurredAt
		});
	});

	it('writes every line it was given', async () => {
		const input = gift({
			totalMinor: 15_000,
			lines: [
				{ label: 'Donation', revenueAccountId: FUND, amountMinor: 10_000 },
				{ label: 'Gala ticket', revenueAccountId: FUND, amountMinor: 5_000 }
			]
		});

		await recorded(input);

		const lines = await db.select().from(lineItem).where(eq(lineItem.donationId, input.donationId));
		expect(lines.map((l) => l.lineTotalMinor).sort((a, b) => a - b)).toEqual([5_000, 10_000]);
	});
});

describe('recordDonation() — the gift has to add up before anything is written', () => {
	it('refuses a gift with no lines at all', async () => {
		const result = await refusal(gift({ lines: [] }));

		expect(result.reason).toBe('malformed_gift');
		expect(result.detail).toMatch(/line/i);
	});

	it('refuses lines that do not sum to the total the donor is charged', async () => {
		const input = gift({
			totalMinor: 10_000,
			lines: [{ label: 'Donation', revenueAccountId: FUND, amountMinor: 9_000 }]
		});

		const result = await refusal(input);

		// checked here rather than at settlement, where `post()` would reject the same gift as
		// `unbalanced` — against money that has already cleared.
		expect(result.reason).toBe('malformed_gift');
		expect(result.detail).toContain('9000');
		expect(result.detail).toContain('10000');
	});

	it.each([
		['zero', 0],
		['negative', -100],
		['fractional', 100.5],
		['not a number at all', Number.NaN]
	] as const)('refuses a %s line amount', async (_label, amountMinor) => {
		const input = gift({
			lines: [
				{ label: 'Donation', revenueAccountId: FUND, amountMinor },
				{ label: 'Rest', revenueAccountId: FUND, amountMinor: 9_900 }
			]
		});

		const result = await refusal(input);

		expect(result.reason).toBe('malformed_gift');
	});

	it('refuses a total that is not a positive whole number of minor units', async () => {
		const input = gift({
			totalMinor: 100.5,
			lines: [{ label: 'Donation', revenueAccountId: FUND, amountMinor: 100.5 }]
		});

		const result = await refusal(input);

		expect(result.reason).toBe('malformed_gift');
	});

	it('writes nothing at all for a gift it refuses', async () => {
		const input = gift({ donor: donor('never.written@example.org'), lines: [] });

		await refusal(input);

		const rows = await db
			.select({ id: contact.id })
			.from(contact)
			.where(sql`lower(${contact.primaryEmail}) = 'never.written@example.org'`);
		expect(rows).toEqual([]);
	});
});

describe('recordDonation() — finding the donor', () => {
	it('reuses a contact whose primary email matches, whatever its case', async () => {
		const first = gift({ donor: donor('Repeat.Donor@example.org') });
		const second = gift({ donor: donor('repeat.donor@EXAMPLE.org', 'Ada M.') });

		const one = await recorded(first);
		const two = await recorded(second);

		expect(two.contactId).toBe(one.contactId);
		expect(two.donorWasCreated).toBe(false);

		// the claim is that one address produced one row, so the query is the one the dedupe
		// itself makes — a lookup by primary key could only ever return one row and would prove
		// nothing.
		const rows = await db
			.select({ id: contact.id })
			.from(contact)
			.where(sql`lower(${contact.primaryEmail}) = 'repeat.donor@example.org'`);
		expect(rows).toHaveLength(1);
	});

	it('keeps the name the matched contact already had', async () => {
		const first = gift({ donor: donor('stable.name@example.org', 'Ada') });
		const second = gift({ donor: donor('stable.name@example.org', 'Adaeze') });

		const one = await recorded(first);
		await recorded(second);

		const [row] = await db.select().from(contact).where(eq(contact.id, one.contactId));
		expect(row?.displayName).toBe('Ada Okafor');
	});

	it('creates a contact when no address matches', async () => {
		const input = gift({ donor: donor('brand.new@example.org') });

		const value = await recorded(input);

		const [row] = await db.select().from(contact).where(eq(contact.id, value.contactId));
		expect(row).toMatchObject({
			kind: 'individual',
			displayName: 'Ada Okafor',
			primaryEmail: 'brand.new@example.org'
		});
	});

	it('does not reuse an archived contact', async () => {
		const archived = gift({ donor: donor('archived.donor@example.org') });
		const returning = gift({ donor: donor('archived.donor@example.org') });

		const first = await recorded(archived);
		await db
			.update(contact)
			.set({ archivedAt: new Date('2026-08-01T00:00:00.000Z') })
			.where(eq(contact.id, first.contactId));
		const second = await recorded(returning);

		// a soft-deleted donor is one staff decided not to see, so a new gift mints a live row
		// rather than reviving one.
		expect(second.contactId).not.toBe(first.contactId);
	});
});

describe('recordDonation() — what the donor wrote', () => {
	it('stores the message with the gift it was written on', async () => {
		const input = gift({ note: 'in memory of Grace' });

		await recorded(input);

		const [stored] = await db.select().from(donation).where(eq(donation.id, input.donationId));
		expect(stored?.note).toBe('in memory of Grace');
	});

	it('stores no message where the donor wrote none', async () => {
		const input = gift();

		await recorded(input);

		// null and not `''`. the column has no check saying so, so the difference is made before
		// the write — see `parseQuoteRequest` in ./quote-input.ts.
		const [stored] = await db.select().from(donation).where(eq(donation.id, input.donationId));
		expect(stored?.note).toBeNull();
	});
});

describe('recordDonation() — the donor’s consent answer', () => {
	it.each([true, false] as const)(
		'files a new donor’s %s answer on their contact',
		async (consented) => {
			const value = await recorded(
				gift({ donor: donor(`consent.${consented}@example.org`), consentedToContact: consented })
			);

			const [row] = await db.select().from(contact).where(eq(contact.id, value.contactId));
			expect(row?.consentedToContact).toBe(consented);
		}
	);

	it('leaves a returning donor’s contact holding the answer they gave this time', async () => {
		const granted = gift({
			donor: donor('withdrawn.consent@example.org'),
			consentedToContact: true
		});
		const withdrawn = gift({
			donor: donor('withdrawn.consent@example.org'),
			consentedToContact: false
		});

		const first = await recorded(granted);
		const second = await recorded(withdrawn);

		// the same contact row, and it holds the withdrawal rather than the grant it was created
		// with. an answer written only on insert would discard every later one.
		expect(second.contactId).toBe(first.contactId);
		const [row] = await db.select().from(contact).where(eq(contact.id, first.contactId));
		expect(row?.consentedToContact).toBe(false);
	});

	it('files a new donor nobody asked with no answer at all', async () => {
		const value = await recorded(
			gift({ donor: donor('never.asked@example.org'), consentedToContact: null })
		);

		// SQL NULL and not `0`. the column is nullable so that a donor nobody asked stays
		// distinguishable from one who declined (../db/schema.ts), and this is the path that decides
		// which of the three a gift writes.
		const [row] = await db.select().from(contact).where(eq(contact.id, value.contactId));
		expect(row?.consentedToContact).toBeNull();
		const stored = await env.DB.prepare(
			'select consented_to_contact is null as unanswered from contact where id = ?'
		)
			.bind(value.contactId)
			.first<{ unanswered: number }>();
		expect(stored?.unanswered).toBe(1);
	});

	it('leaves a returning donor’s answer standing when this gift did not ask', async () => {
		const asked = gift({ donor: donor('asked.once@example.org'), consentedToContact: true });
		const unasked = gift({ donor: donor('asked.once@example.org'), consentedToContact: null });

		const first = await recorded(asked);
		// a value no clock produces, so the assertion below is about whether a statement ran at all
		// rather than about whether it happened to write the same answer back. `updated_at` carries
		// `$onUpdateFn` (../db/schema.ts), so any update to this row replaces it with system time.
		await env.DB.prepare('update contact set updated_at = 1 where id = ?')
			.bind(first.contactId)
			.run();
		const second = await recorded(unasked);

		// the same contact, still holding the grant. `null` says the question was not put, which is
		// no reason to discard what this donor said the last time it was — an integrator who stops
		// asking must not be able to un-answer everyone who already answered.
		expect(second.contactId).toBe(first.contactId);
		const [row] = await db.select().from(contact).where(eq(contact.id, first.contactId));
		expect(row?.consentedToContact).toBe(true);
		// and the row was not written at all: `resolveDonor` contributes no statement to the batch
		// on `null`, rather than an update that writes the answer back unchanged.
		const stamp = await env.DB.prepare('select updated_at from contact where id = ?')
			.bind(first.contactId)
			.first<{ updated_at: number }>();
		expect(stamp?.updated_at).toBe(1);
	});

	it('leaves a returning donor’s declining answer standing too', async () => {
		const declined = gift({ donor: donor('declined.once@example.org'), consentedToContact: false });
		const unasked = gift({ donor: donor('declined.once@example.org'), consentedToContact: null });

		const first = await recorded(declined);
		await recorded(unasked);

		// the direction that matters more: a `null` promoting a refusal back to "never asked" would
		// put a donor who said no back into the pool a fundraiser writes to.
		const [row] = await db.select().from(contact).where(eq(contact.id, first.contactId));
		expect(row?.consentedToContact).toBe(false);
	});

	it('records a grant from a donor who had declined before', async () => {
		const declined = gift({
			donor: donor('granted.consent@example.org'),
			consentedToContact: false
		});
		const granted = gift({ donor: donor('granted.consent@example.org'), consentedToContact: true });

		const first = await recorded(declined);
		await recorded(granted);

		const [row] = await db.select().from(contact).where(eq(contact.id, first.contactId));
		expect(row?.consentedToContact).toBe(true);
	});

	it('leaves the rest of the matched contact alone', async () => {
		const first = gift({
			donor: donor('consent.only@example.org', 'Ada'),
			consentedToContact: true
		});
		const second = gift({
			donor: donor('consent.only@example.org', 'Adaeze'),
			consentedToContact: false
		});

		const one = await recorded(first);
		await recorded(second);

		// the consent answer is the one thing a public form may overwrite on a curated donor
		// record. the name it also carried is still read for nothing.
		const [row] = await db.select().from(contact).where(eq(contact.id, one.contactId));
		expect(row?.displayName).toBe('Ada Okafor');
		expect(row?.consentedToContact).toBe(false);
	});

	it('writes no consent answer at all when the gift is refused', async () => {
		const input = gift({
			donor: donor('refused.consent@example.org'),
			consentedToContact: true,
			formId: 'frm_no_such_form_at_all'
		});

		await refusal(input);

		const rows = await db
			.select({ id: contact.id })
			.from(contact)
			.where(sql`lower(${contact.primaryEmail}) = 'refused.consent@example.org'`);
		expect(rows).toEqual([]);
	});
});

describe('recordDonation() — the rail the donor was quoted on', () => {
	it.each([
		['card', 'card'],
		['apple_pay', 'card'],
		['google_pay', 'card'],
		['ach', 'ach']
	] as const)('records a %s quote as method %s', async (quoted, stored) => {
		const value = await recorded(gift({ method: quoted }));

		const [paid] = await db.select().from(payment).where(eq(payment.id, value.paymentId));
		expect(paid?.method).toBe(stored);
	});
});

describe('recordDonation() — what the database refuses, in this module’s own words', () => {
	it('names a repeated intent as a duplicate rather than as a fault', async () => {
		const first = gift();
		await recorded(first);

		const result = await refusal(gift({ providerTxnId: first.providerTxnId }));

		// the retry `IntentRequest.idempotencyKey` is designed to produce: the same attempt made
		// twice resolves to the intent that already exists, so this arrives with a txn id already
		// in the table. an endpoint answering 500 to it would fail a donation that succeeded.
		expect(result.reason).toBe('duplicate_intent');
	});

	it('leaves nothing behind when the same intent is recorded twice', async () => {
		const first = gift();
		await recorded(first);
		const second = gift({ providerTxnId: first.providerTxnId });

		await refusal(second);

		const rows = await db
			.select({ id: donation.id })
			.from(donation)
			.where(eq(donation.id, second.donationId));
		expect(rows).toEqual([]);
	});

	it('names a form that is not there as a missing reference', async () => {
		const result = await refusal(gift({ formId: 'frm_no_such_form_at_all' }));

		expect(result.reason).toBe('missing_reference');
	});

	it('leaves no contact behind when a later statement in the batch fails', async () => {
		const input = gift({
			donor: donor('orphan.check@example.org'),
			formId: 'frm_no_such_form_at_all'
		});

		await refusal(input);

		// the whole point of the single `batch()`: the contact insert ran before the donation
		// insert that failed, and it is gone.
		const rows = await db
			.select({ id: contact.id })
			.from(contact)
			.where(sql`lower(${contact.primaryEmail}) = 'orphan.check@example.org'`);
		expect(rows).toEqual([]);
	});

	it('leaves the driver’s vocabulary behind the seam', async () => {
		const first = gift();
		await recorded(first);

		const result = await refusal(gift({ providerTxnId: first.providerTxnId }));

		// a caller switches on `reason`. the sqlite code is what this module read to get there and
		// is not what it hands over — a route matching on `SQLITE_` prose is what the closed union
		// exists to prevent.
		expect(result.detail).not.toContain('SQLITE_');
		expect(RECORD_FAILURE_REASONS).toContain(result.reason);
	});
});

describe('recordAuthorizedGift() — the gift a repeating commitment was authorized for', () => {
	/** the donor's row, committed the way `mintCommitment` in ./quote.ts commits it. */
	async function committed(email: string): Promise<string> {
		const donorRow = await commitDonor(db, donor(email), false);
		if (!donorRow.ok) throw new Error(`the fixture donor was not committed: ${donorRow.detail}`);
		return donorRow.value.contactId;
	}

	let authorizedSequence = 0;

	async function authorized(over: Partial<AuthorizedGiftInput> = {}): Promise<AuthorizedGiftInput> {
		authorizedSequence += 1;
		return {
			donationId: `019fb400-0000-7000-8000-${String(authorizedSequence).padStart(12, '0')}`,
			contactId: await committed(`repeating${authorizedSequence}@example.org`),
			formId,
			origin: 'https://example.org',
			currency: 'USD',
			totalMinor: 2500,
			feeMinor: 0,
			lines: [{ label: 'Donation', revenueAccountId: FUND, amountMinor: 2500 }],
			note: undefined,
			tribute: null,
			programId: null,
			occurredAt: new Date('2026-08-03T12:00:00.000Z'),
			...over
		};
	}

	it('writes the gift and its line, and no payment', async () => {
		const input = await authorized();

		const result = await recordAuthorizedGift(db, input);

		expect(result.ok).toBe(true);
		const [stored] = await db.select().from(donation).where(eq(donation.id, input.donationId));
		expect(stored).toMatchObject({
			contactId: input.contactId,
			formId,
			origin: 'https://example.org',
			currency: 'USD',
			totalMinor: 2500,
			receivedAt: input.occurredAt,
			recurringId: null
		});
		const lines = await db.select().from(lineItem).where(eq(lineItem.donationId, input.donationId));
		expect(lines).toHaveLength(1);
		// no attempt has been made from this side: the donor confirms the commitment's first
		// collection in their own browser, and the rail is what reports the charge afterwards. a row
		// here would be a settlement attempt this app never opened.
		const attempts = await db
			.select()
			.from(payment)
			.where(eq(payment.donationId, input.donationId));
		expect(attempts).toEqual([]);
	});

	it('reads as pending, because a gift with no attempt on it is one', async () => {
		const input = await authorized();

		await recordAuthorizedGift(db, input);

		const rows = await db
			.select({ status: payment.status })
			.from(payment)
			.where(eq(payment.donationId, input.donationId));
		// the projection `donation`'s header states: no `payment` row yet is `pending`, which is what
		// puts an unfinished repeating gift on the gifts list beside an unfinished single one.
		expect(rows).toEqual([]);
	});

	it('lands all four tribute columns, the person to tell included', async () => {
		const input = await authorized({
			tribute: {
				kind: 'memory',
				honoree: 'Grace Hopper',
				notify: { name: 'Mary Hopper', email: 'mary@example.org' }
			}
		});

		await recordAuthorizedGift(db, input);

		// the pair is on this row and on no other in the series, which is what makes a family told
		// once possible at all — nothing carries it to a later collection.
		const [stored] = await db.select().from(donation).where(eq(donation.id, input.donationId));
		expect(stored).toMatchObject({
			tributeKind: 'memory',
			tributeHonoree: 'Grace Hopper',
			tributeNotifyName: 'Mary Hopper',
			tributeNotifyEmail: 'mary@example.org',
			tributeNotifiedAt: null
		});
	});

	it('puts nothing in the books', async () => {
		const before = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);

		await recordAuthorizedGift(db, await authorized());

		const after = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		expect(after[0]?.n).toBe(before[0]?.n);
	});

	it('refuses a gift whose lines do not add up to what is charged', async () => {
		const input = await authorized({
			totalMinor: 2500,
			lines: [{ label: 'Donation', revenueAccountId: FUND, amountMinor: 2400 }]
		});

		const result = await recordAuthorizedGift(db, input);

		expect(result.ok || result.reason).toBe('malformed_gift');
	});

	it('names a form that is not there as a missing reference', async () => {
		const input = await authorized({ formId: 'frm_no_such_form_at_all' });

		const result = await recordAuthorizedGift(db, input);

		expect(result.ok || result.reason).toBe('missing_reference');
	});

	it('leaves no gift behind when the write is refused', async () => {
		const input = await authorized({ formId: 'frm_no_such_form_at_all' });

		await recordAuthorizedGift(db, input);

		const rows = await db.select().from(donation).where(eq(donation.id, input.donationId));
		expect(rows).toEqual([]);
	});

	it('writes the cause the commitment was authorized against', async () => {
		const input = await authorized({ programId: PROGRAM_ID });

		expect((await recordAuthorizedGift(db, input)).ok).toBe(true);
		const [stored] = await db.select().from(donation).where(eq(donation.id, input.donationId));
		expect(stored?.programId).toBe(PROGRAM_ID);
	});
});

describe('the cause a gift is credited to', () => {
	it('writes the pointer a single gift was quoted with', async () => {
		const input = gift({ programId: PROGRAM_ID });

		await recorded(input);

		const [stored] = await db.select().from(donation).where(eq(donation.id, input.donationId));
		expect(stored?.programId).toBe(PROGRAM_ID);
	});

	// null and not absent: a gift on a form that asks about no cause went to none, which is what
	// every staff-entered gift also says (`donation.program_id` in ../db/schema.ts).
	it('leaves the column null for a gift credited to no cause', async () => {
		const input = gift();

		await recorded(input);

		const [stored] = await db.select().from(donation).where(eq(donation.id, input.donationId));
		expect(stored?.programId).toBeNull();
	});

	/**
	 * a cause that is not in the database is the same refusal as a form that is not.
	 *
	 * `SQLITE_CONSTRAINT_FOREIGNKEY` is one code for every outward reference the gift carries, so
	 * the reason cannot say which — which is exactly why it is not called `unknown_form`.
	 */
	it('names a cause that is not there as a missing reference', async () => {
		const result = await recordDonation(
			db,
			gift({ programId: '019fb500-0000-7000-8000-0000000000ff' })
		);

		expect(result.ok || result.reason).toBe('missing_reference');
	});
});
