import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { rejectionCode } from '../db/rejection.testing';
import { contact, type Contact } from '../db/schema';
import type { RecurringPlanStatus } from '../../recurring/statuses';
import { parseContact, type ContactFormValues, type ParsedContact } from './contact-input';
import {
	CONTACT_LIST_LIMIT,
	createContact,
	findContactByEmail,
	findContactById,
	listContacts,
	readContactSummaries,
	readDonorSummary,
	readDonorViewCounts,
	type ContactOrder
} from './queries';

// real D1 inside workerd, over the committed migrations — so the check constraints, the
// functional `lower(primary_email)` index and `STRICT` are all the deployed ones.

let db: Db;

/** the revenue account every fixture form posts to — the chart of accounts' own `4110`. */
let revenueAccountId: string;

beforeAll(async () => {
	// the request-path constructor, not a fixture: what these tests exercise is what `requestDb`
	// builds for every request (src/request-context.ts).
	db = createDb(env.DB);
	const row = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	if (!row)
		throw new Error(
			'no 4110 account — has the chart of accounts in migrations/0000_initial_schema.sql moved?'
		);
	revenueAccountId = row.id;
});

// storage is isolated per test file, not per test, so rows written by one `it` are visible
// to the next. every list assertion below would otherwise depend on execution order.
beforeEach(async () => {
	// children first — every FK in this schema is `NO ACTION`.
	await env.DB.prepare('delete from payment').run();
	await env.DB.prepare('delete from donation').run();
	await env.DB.prepare('delete from recurring_plan').run();
	await env.DB.prepare('delete from contact').run();
	await env.DB.prepare('delete from form').run();
});

/** parses and inserts in one step — the path the form action takes. */
async function create(values: ContactFormValues) {
	const result = parseContact(values);
	if (!result.ok) throw new Error(`fixture did not parse: ${JSON.stringify(result.errors)}`);
	return createContact(db, result.value);
}

const individual = (over: ContactFormValues = {}): ContactFormValues => ({
	kind: 'individual',
	first_name: 'Ada',
	last_name: 'Okafor',
	...over
});

/**
 * the default order the screen loads under: the biggest donors first, page one.
 *
 * every case that is not about the ordering passes this, so a case that changes one field says
 * what it is about. the file's own tiebreak is `id desc`, which is what makes this "newest first"
 * for donors who have given nothing.
 */
const newest: ContactOrder = { sort: 'given', dir: 'desc', page: 1, view: 'all' };

/** the same order, read against the second view of the file. */
const newestRecurring: ContactOrder = { ...newest, view: 'recurring' };

let commitments = 0;

/**
 * a standing commitment for this donor, at the status a case is about.
 *
 * written past drizzle, like the gift fixtures below it: what the recurring view reads is columns,
 * and a fixture going through `$lib/server/recurring/queries.ts` would be reading them through the
 * module that owns them rather than as D1 holds them. it also keeps the fixture clear of
 * `collect.ts`, which is the only module allowed to insert one for real (CLAUDE.md → Bans).
 *
 * `ended_at` travels with the status because the table's own
 * `recurring_plan_ended_at_check` says the two are one fact — an `active` row with an end, or a
 * stopped row without one, is refused by D1 rather than stored.
 *
 * the form is here because `recurring_plan.form_id` is NOT NULL: a commitment with no form would
 * have nowhere to post anything after the browser that made it had gone.
 */
async function commitment(contactId: string, status: RecurringPlanStatus): Promise<string> {
	commitments += 1;
	const suffix = String(commitments).padStart(12, '0');
	const formId = `019fb300-0000-7000-8000-${suffix}`;
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins, created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
	)
		.bind(formId, revenueAccountId)
		.run();

	const id = `019fb301-0000-7000-8000-${suffix}`;
	await env.DB.prepare(
		`insert into recurring_plan (id, contact_id, form_id, amount_minor, currency, interval,
		                             status, provider, provider_subscription_id,
		                             provider_customer_id, started_at, next_charge_at, ended_at,
		                             created_at, updated_at)
		 values (?, ?, ?, 2500, 'USD', 'monthly', ?, 'stripe', ?, ?, 0, null, ?, 0, 0)`
	)
		.bind(id, contactId, formId, status, `sub_${id}`, `cus_${id}`, status === 'active' ? null : 0)
		.run();
	return id;
}

/** soft-deletes a contact, the state that hides a donor from the file without unmaking their gifts. */
async function archive(id: string): Promise<void> {
	await env.DB.prepare('update contact set archived_at = ? where id = ?')
		.bind(Date.now(), id)
		.run();
}

describe('createContact', () => {
	it('stores every column it was given and returns the row', async () => {
		const row = await create(
			individual({ primary_email: 'ada@example.org', primary_phone: '+250788000000' })
		);
		expect(row).toMatchObject({
			kind: 'individual',
			displayName: 'Ada Okafor',
			firstName: 'Ada',
			lastName: 'Okafor',
			legalName: null,
			primaryEmail: 'ada@example.org',
			primaryPhone: '+250788000000'
		});
	});

	it('fills id, created_at and updated_at from the column defaults', async () => {
		const before = Date.now();
		const row = await create(individual());
		// a uuidv7, which is what keeps creation order equal to index order.
		expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
		expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before);
		expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
	});

	it('defaults attributes to an empty JSON object', async () => {
		// the extension column: a JSON object plus a registry is what keeps an org from ever
		// adding a column, so its default has to be a valid object rather than null.
		const row = await create(individual());
		expect(row.attributes).toBe('{}');
		expect(JSON.parse(row.attributes)).toEqual({});
	});

	it('leaves archived_at null, so the row lists', async () => {
		expect((await create(individual())).archivedAt).toBeNull();
	});

	it('leaves the consent answer null, because this form never asked', async () => {
		// /admin's create screen has no consent field on it, so the row it writes has to say
		// "never asked" rather than "declined" — a `0` here would answer for a donor nobody put
		// the question to.
		expect((await create(individual())).consentedToContact).toBeNull();
	});

	it('accepts two contacts sharing one email address', async () => {
		// deliberate: a household shares an address and an organization's is often a staff
		// member's. there is no UNIQUE index, and this is the test that says so on purpose.
		await create(individual({ primary_email: 'shared@example.org' }));
		await create(individual({ first_name: 'Ben', primary_email: 'shared@example.org' }));
		expect((await listContacts(db, newest)).contacts).toHaveLength(2);
	});

	it('is rejected by the database when kind is not one of the three', async () => {
		// `parseContact` refuses this first; the check is the second line, and this asserts it
		// is really there rather than trusting the migration.
		const bypass = await bypassingParse({ kind: 'donor' });
		expect(await rejectionCode(() => createContact(db, bypass))).toContain(
			'SQLITE_CONSTRAINT_CHECK'
		);
	});

	// `display_name` is documented as denormalized and always populated, so a list view
	// never branches on kind. `notNull` does not say that — `''` satisfies it — and STRICT
	// does not either, since it constrains a value's type and a blank string is a
	// well-typed text. `parseContact` refuses a blank first; these assert the second line
	// is really in the migration.
	//
	// whitespace-only is the same failure, not a nicety: it renders as an empty cell, and
	// it is why the check uses the two-argument `trim(x, char(32, 9, 10, 13))` rather than
	// `trim(x)`, which strips U+0020 alone and would let a lone tab through.
	it.each([
		['empty', ''],
		['spaces', '   '],
		['a tab', '\t'],
		['a newline', '\n'],
		['a CRLF', '\r\n'],
		['mixed whitespace', ' \t\r\n ']
	])('is rejected by the database when display_name is %s', async (_label, displayName) => {
		const bypass = await bypassingParse({ displayName });
		const message = await rejectionCode(() => createContact(db, bypass));
		expect(message).toContain('SQLITE_CONSTRAINT_CHECK');
		// which check fired is the whole claim — the code alone says only "some check
		// failed", and this row also passes under `contact_kind_check`. the name is ours
		// (schema.ts mints it), not sqlite prose.
		expect(message).toContain('contact_display_name_not_blank_check');
	});

	it('accepts a display_name that is merely untrimmed', async () => {
		// the boundary of the constraint, pinned so nobody tightens it into
		// `trim(display_name) = display_name`: the check asserts a value is there, it does
		// not canonicalize one. trimming belongs to `parseContact`, and a check can only be
		// widened again by another table rebuild.
		const bypass = await bypassingParse({ displayName: '  Ada Okafor ' });
		expect((await createContact(db, bypass)).displayName).toBe('  Ada Okafor ');
	});
});

describe('listContacts', () => {
	it('returns an empty file as page one of one', async () => {
		expect(await listContacts(db, newest)).toEqual({
			contacts: [],
			total: 0,
			page: 1,
			pages: 1
		});
	});

	it('breaks a tie by id, newest first', async () => {
		// every donor here has given nothing, so every one of them ties on the default sort — and
		// a tie the sort does not settle is a page that comes back in a different order on the
		// next load, which with an `OFFSET` under it is a donor on two pages or on neither.
		const first = await create(individual({ first_name: 'First' }));
		const second = await create(individual({ first_name: 'Second' }));
		const third = await create(individual({ first_name: 'Third' }));

		const { contacts: rows } = await listContacts(db, newest);
		expect(rows.map((c) => c.firstName)).toEqual(['Third', 'Second', 'First']);
		// by id too, because that is the column the tiebreak is actually taken on.
		expect(rows.map((c) => c.id)).toEqual([third.id, second.id, first.id]);
	});

	it('breaks that tie by id even when every created_at is identical', async () => {
		// the tiebreak is total, and this is the test that says so.
		//
		// this is not a synthetic edge case made safe: `created_at` is ms-precision and
		// workerd freezes the clock between I/O, so back-to-back inserts share a timestamp
		// on their own, and ordering by it fails the assertion above on a coin flip.
		// collapsing every row onto one timestamp makes the tie
		// certain rather than likely, so a `desc(created_at)` tiebreak cannot pass here
		// even on a lucky run.
		const created: Contact[] = [];
		for (const name of ['First', 'Second', 'Third', 'Fourth', 'Fifth']) {
			created.push(await create(individual({ first_name: name })));
		}
		await env.DB.prepare('update contact set created_at = ?').bind(1_700_000_000_000).run();

		const { contacts: rows } = await listContacts(db, newest);
		// the tie is real: if the update above silently matched nothing, the rest proves
		// nothing.
		expect(new Set(rows.map((c) => c.createdAt.getTime())).size).toBe(1);
		expect(rows.map((c) => c.firstName)).toEqual(['Fifth', 'Fourth', 'Third', 'Second', 'First']);
		expect(rows.map((c) => c.id)).toEqual(created.map((c) => c.id).reverse());
	});

	it('excludes archived contacts', async () => {
		const archived = await create(individual({ first_name: 'Gone' }));
		await archive(archived.id);
		await create(individual({ first_name: 'Here' }));

		const { contacts: rows } = await listContacts(db, newest);
		expect(rows.map((c) => c.firstName)).toEqual(['Here']);
	});

	it('does not count an archived contact in the total either', async () => {
		// the count is under the same `where` as the page. counted but not listed is a file
		// whose last page is empty and whose caption names donors nobody can reach.
		const archived = await create(individual({ first_name: 'Gone' }));
		await archive(archived.id);
		await create(individual({ first_name: 'Here' }));

		const page = await listContacts(db, newest);
		expect(page.total).toBe(1);
		expect(page.pages).toBe(1);
	});

	it('reports one page at exactly CONTACT_LIST_LIMIT contacts', async () => {
		// the boundary. a full page with nothing behind it is not a file with a second page,
		// and a screen that drew paging for it would offer a press that goes nowhere.
		const seeded = await seedContacts(CONTACT_LIST_LIMIT);

		const page = await listContacts(db, newest);
		expect(page).toMatchObject({ total: CONTACT_LIST_LIMIT, page: 1, pages: 1 });
		expect(page.contacts).toHaveLength(CONTACT_LIST_LIMIT);
		expect(new Set(page.contacts.map((c) => c.id))).toEqual(new Set(seeded.map((c) => c.id)));
	});

	it('spills the oldest contact onto a second page at one more', async () => {
		const seeded = await seedContacts(CONTACT_LIST_LIMIT + 1);
		const [oldest, ...kept] = seeded;

		const first = await listContacts(db, newest);
		expect(first).toMatchObject({ total: CONTACT_LIST_LIMIT + 1, page: 1, pages: 2 });
		// which row was left off, not just how many. the tiebreak is newest first, so the one
		// pushed over is the oldest — an ascending order would pass a count-only assertion while
		// showing the operator the wrong hundred contacts.
		expect(first.contacts.map((c) => c.id)).toEqual(kept.map((c) => c.id).reverse());

		const second = await listContacts(db, { ...newest, page: 2 });
		expect(second.contacts.map((c) => c.id)).toEqual([oldest!.id]);
	});

	it('reads the last page for a page past the end of the file', async () => {
		// an address an operator can reach by editing one, or by keeping a bookmark while the
		// file shrank. an empty plane under a caption counting donors reads as the list having
		// broken, so the page is held inside the file that exists and says which one it read.
		await seedContacts(CONTACT_LIST_LIMIT + 1);

		const page = await listContacts(db, { ...newest, page: 9 });
		expect(page).toMatchObject({ page: 2, pages: 2 });
		expect(page.contacts).toHaveLength(1);
	});
});

describe('the recurring view of the donor file', () => {
	it('lists a donor with an active commitment and leaves out one whose only commitment stopped', async () => {
		const giving = await create(individual({ first_name: 'Giving' }));
		const stopped = await create(individual({ first_name: 'Stopped' }));
		await commitment(giving.id, 'active');
		await commitment(stopped.id, 'cancelled');

		const view = await listContacts(db, newestRecurring);
		expect(view.contacts.map((c) => c.firstName)).toEqual(['Giving']);
		// and the donor the view leaves out is still in the file, which is what makes this a
		// second view of one list rather than a second list.
		const all = await listContacts(db, newest);
		expect(all.contacts.map((c) => c.firstName).sort()).toEqual(['Giving', 'Stopped']);
	});

	it('leaves out a donor whose only commitment lapsed', async () => {
		// the rail gave up on the card. `revives` in ../donations/collect.ts can put the row back
		// to active on its own, and this view is what is true now rather than what may be.
		const lapsed = await create(individual({ first_name: 'Lapsed' }));
		await commitment(lapsed.id, 'lapsed');

		expect((await listContacts(db, newestRecurring)).contacts).toEqual([]);
	});

	it('lists a donor holding several active commitments once', async () => {
		const donor = await create(individual({ first_name: 'Twice' }));
		await commitment(donor.id, 'active');
		await commitment(donor.id, 'active');

		const view = await listContacts(db, newestRecurring);
		expect(view.contacts.map((c) => c.id)).toEqual([donor.id]);
		expect(view.total).toBe(1);
	});

	it('counts and pages the view rather than the file', async () => {
		// the count under the plane and the pages under it are the view's, or the caption states a
		// figure the rows cannot add up to and the paging offers a page with nothing on it.
		const giving = await create(individual({ first_name: 'Giving' }));
		await commitment(giving.id, 'active');
		await create(individual({ first_name: 'One off' }));
		await create(individual({ first_name: 'Never gave' }));

		expect(await listContacts(db, newestRecurring)).toMatchObject({ total: 1, pages: 1 });
		expect(await listContacts(db, newest)).toMatchObject({ total: 3, pages: 1 });
	});

	it('excludes an archived donor from the view even with a commitment still active', async () => {
		const archived = await create(individual({ first_name: 'Gone' }));
		await commitment(archived.id, 'active');
		await archive(archived.id);

		expect(await listContacts(db, newestRecurring)).toMatchObject({ total: 0 });
	});

	it('sorts inside the view the way it sorts the file', async () => {
		// the view is which donors are in the file, never a different question about them — so the
		// order the operator chose survives the press that changed views.
		const ada = await create(individual({ first_name: 'Ada' }));
		const zoe = await create(individual({ first_name: 'Zoe' }));
		await commitment(ada.id, 'active');
		await commitment(zoe.id, 'active');

		const up = await listContacts(db, { ...newestRecurring, sort: 'name', dir: 'asc' });
		expect(up.contacts.map((c) => c.firstName)).toEqual(['Ada', 'Zoe']);
		const down = await listContacts(db, { ...newestRecurring, sort: 'name', dir: 'desc' });
		expect(down.contacts.map((c) => c.firstName)).toEqual(['Zoe', 'Ada']);
	});
});

describe('the giving figures on a donor row', () => {
	it('counts settled gifts and adds what they collected', async () => {
		const ada = await create(individual());
		for (const amountMinor of [1_000, 2_500, 400]) {
			await settled(await gift(ada.id), 'inbound', 'succeeded', amountMinor);
		}

		const [row] = (await listContacts(db, newest)).contacts;
		expect(row).toMatchObject({ id: ada.id, gifts: 3, given: 3_900 });
	});

	it('counts nothing at all for a gift whose only attempt is pending', async () => {
		// an authorization is not a collection. a pending inbound attempt is money the org has
		// not received, and a donor credited with it is one the books disagree with — the same
		// line `projectStatus` in ../donations/queries.ts draws, which is why a gift in that
		// state reads `pending` on the gifts screen.
		const ada = await create(individual());
		await settled(await gift(ada.id), 'inbound', 'pending', 5_000);

		const [row] = (await listContacts(db, newest)).contacts;
		expect(row).toMatchObject({ gifts: 0, given: 0 });
	});

	it.each([
		['failed', 'failed'],
		['cancelled', 'cancelled']
	] as const)('counts nothing for a gift whose attempt %s', async (_label, status) => {
		// a card the rail refused moved no money, and a donor whose row counted the attempt would
		// be thanked for a gift that never arrived.
		const ada = await create(individual());
		await settled(await gift(ada.id), 'inbound', status, 5_000);

		const [row] = (await listContacts(db, newest)).contacts;
		expect(row).toMatchObject({ gifts: 0, given: 0 });
	});

	it('still counts a gift refunded in full, and adds nothing for it', async () => {
		// the two halves of the row answer different questions. the donor did give — the gift
		// happened, and a file that forgot it is one nobody can reconcile against a statement —
		// and the organisation kept none of it.
		const ada = await create(individual());
		const id = await gift(ada.id);
		await settled(id, 'inbound', 'succeeded', 5_000);
		await settled(id, 'refund', 'succeeded', 5_000);

		const [row] = (await listContacts(db, newest)).contacts;
		expect(row).toMatchObject({ gifts: 1, given: 0 });
	});

	it('takes a partial refund off what the gift collected', async () => {
		const ada = await create(individual());
		const id = await gift(ada.id);
		await settled(id, 'inbound', 'succeeded', 5_000);
		await settled(id, 'refund', 'succeeded', 1_500);

		const [row] = (await listContacts(db, newest)).contacts;
		expect(row).toMatchObject({ gifts: 1, given: 3_500 });
	});

	it('ignores a refund that has not settled', async () => {
		// money the org still holds. reading it as gone reports a refund on the strength of an
		// intention, which is the reason stated at `projectStatus`.
		const ada = await create(individual());
		const id = await gift(ada.id);
		await settled(id, 'inbound', 'succeeded', 5_000);
		await settled(id, 'refund', 'pending', 5_000);

		const [row] = (await listContacts(db, newest)).contacts;
		expect(row).toMatchObject({ gifts: 1, given: 5_000 });
	});

	it('states zeroes for a donor with no gift at all', async () => {
		// the join is outer and the sums are coalesced. a donor entered by hand on the create
		// screen has given nothing, and their row has to say so rather than come back blank.
		const ada = await create(individual());

		const [row] = (await listContacts(db, newest)).contacts;
		expect(row).toMatchObject({ id: ada.id, gifts: 0, given: 0 });
	});

	it('counts each donor only their own gifts', async () => {
		// the grouping, asserted from the side that catches a missing `group by`: one donor's
		// figures landing on every row is what a cross join reads like.
		const ada = await create(individual({ first_name: 'Ada' }));
		const ben = await create(individual({ first_name: 'Ben' }));
		await settled(await gift(ada.id), 'inbound', 'succeeded', 1_000);
		await settled(await gift(ben.id), 'inbound', 'succeeded', 2_000);
		await settled(await gift(ben.id), 'inbound', 'succeeded', 3_000);

		const byId = new Map((await listContacts(db, newest)).contacts.map((c) => [c.id, c]));
		expect(byId.get(ada.id)).toMatchObject({ gifts: 1, given: 1_000 });
		expect(byId.get(ben.id)).toMatchObject({ gifts: 2, given: 5_000 });
	});
});

describe('the order the donor file is read in', () => {
	it('sorts by given across the whole file rather than within a page', async () => {
		// the failure this is here for is a sort applied after the `LIMIT`: the biggest donor in
		// the file is the one an operator opened this screen to find, and a page-local sort leaves
		// them on page two with the largest figure on page one.
		const seeded = await seedContacts(CONTACT_LIST_LIMIT + 1);
		const oldest = seeded[0]!;

		// with nothing given, every row ties and the id tiebreak puts the oldest last — page two.
		const before = await listContacts(db, { ...newest, page: 2 });
		expect(before.contacts.map((c) => c.id)).toEqual([oldest.id]);

		await settled(await gift(oldest.id), 'inbound', 'succeeded', 100_000);

		const after = await listContacts(db, newest);
		expect(after.contacts[0]).toMatchObject({ id: oldest.id, given: 100_000 });
	});

	it('sorts by name without regard to case', async () => {
		// sqlite's default collation sorts every uppercase letter before every lowercase one, so
		// without `collate nocase` this is two alphabetical lists stacked rather than one.
		await create(individual({ first_name: 'zamora', last_name: 'Reyes' }));
		await create(individual({ first_name: 'Ada', last_name: 'Okafor' }));
		await create(individual({ first_name: 'ben', last_name: 'Mensah' }));

		const up = await listContacts(db, { ...newest, sort: 'name', dir: 'asc' });
		expect(up.contacts.map((c) => c.displayName)).toEqual([
			'Ada Okafor',
			'ben Mensah',
			'zamora Reyes'
		]);

		const down = await listContacts(db, { ...newest, sort: 'name', dir: 'desc' });
		expect(down.contacts.map((c) => c.displayName)).toEqual([
			'zamora Reyes',
			'ben Mensah',
			'Ada Okafor'
		]);
	});

	it('sorts by how many gifts, in either direction', async () => {
		const many = await create(individual({ first_name: 'Many' }));
		const one = await create(individual({ first_name: 'One' }));
		for (let i = 0; i < 3; i += 1) await settled(await gift(many.id), 'inbound', 'succeeded', 100);
		// the larger figure on the fewer gifts, so a sort by count cannot pass by reading the sum.
		await settled(await gift(one.id), 'inbound', 'succeeded', 90_000);

		const down = await listContacts(db, { ...newest, sort: 'gifts', dir: 'desc' });
		expect(down.contacts.map((c) => c.gifts)).toEqual([3, 1]);

		const up = await listContacts(db, { ...newest, sort: 'gifts', dir: 'asc' });
		expect(up.contacts.map((c) => c.gifts)).toEqual([1, 3]);
	});

	it('sorts by given in either direction', async () => {
		const big = await create(individual({ first_name: 'Big' }));
		const small = await create(individual({ first_name: 'Small' }));
		await settled(await gift(big.id), 'inbound', 'succeeded', 90_000);
		// two gifts against one, so a sort by sum cannot pass by reading the count.
		for (let i = 0; i < 2; i += 1) await settled(await gift(small.id), 'inbound', 'succeeded', 100);

		const down = await listContacts(db, { ...newest, sort: 'given', dir: 'desc' });
		expect(down.contacts.map((c) => c.id)).toEqual([big.id, small.id]);

		const up = await listContacts(db, { ...newest, sort: 'given', dir: 'asc' });
		expect(up.contacts.map((c) => c.id)).toEqual([small.id, big.id]);
	});
});

describe('readDonorSummary', () => {
	/**
	 * the instant every case here reads the summary at: mid-afternoon on the fourth of September.
	 *
	 * stated rather than taken from the clock, because every assertion below is about which month
	 * a count landed in — a suite that read `Date.now()` would pass in September and fail on the
	 * first of October, and the boundary cases would pass whichever side of one they were run on.
	 */
	const NOW = new Date(Date.UTC(2026, 8, 4, 12, 0, 0));

	/** rewrites when a donor's row was written, which is never what a bucket is taken from. */
	async function rowWritten(id: string, at: number): Promise<void> {
		await env.DB.prepare('update contact set created_at = ? where id = ?').bind(at, id).run();
	}

	it('states zeroes and a flat twelve months for a deployment with no gifts', async () => {
		// a fresh deployment draws the same card as a busy one, with nothing in it. the two months
		// are still the right two: the run is twelve buckets ending at the month `now` is in
		// whether or not anything ever landed in one.
		expect(await readDonorSummary(db, new Date(Date.UTC(2026, 8, 4, 12, 0, 0)))).toEqual({
			total: 0,
			thisMonth: 0,
			points: Array(12).fill(0),
			firstMonth: new Date(Date.UTC(2025, 9, 1)),
			lastMonth: new Date(Date.UTC(2026, 8, 1))
		});
	});

	it('counts a donor in the month their money moved, not the month their row was written', async () => {
		// the two are months apart on any deployment that imported its donors, and they are the
		// whole reason this reads `occurred_at`: a contact row written today for a gift that
		// settled in August is a donor who arrived in August.
		const ada = await create(individual());
		await rowWritten(ada.id, Date.UTC(2026, 8, 2));
		await settled(await gift(ada.id), 'inbound', 'succeeded', 5_000, Date.UTC(2026, 7, 20));

		const summary = await readDonorSummary(db, NOW);
		expect(summary.total).toBe(1);
		expect(summary.thisMonth).toBe(0);
		expect(summary.points).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
	});

	it('splits the two donors either side of the month boundary', async () => {
		// the boundary is the first instant of the month in UTC, and it is UTC because every time
		// column in this app is (../db/schema.ts). a boundary read in any other zone moves a
		// donor between two buckets depending on where the reader is, which is the one thing a
		// count of "this month" cannot afford.
		const opened = await create(individual({ first_name: 'Opened' }));
		const closed = await create(individual({ first_name: 'Closed' }));
		await settled(await gift(opened.id), 'inbound', 'succeeded', 5_000, Date.UTC(2026, 8, 1));
		await settled(await gift(closed.id), 'inbound', 'succeeded', 5_000, Date.UTC(2026, 8, 1) - 1);

		const summary = await readDonorSummary(db, NOW);
		expect(summary.total).toBe(2);
		expect(summary.thisMonth).toBe(1);
		expect(summary.points).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
	});

	it('counts a donor once, in the month of their first settled gift', async () => {
		// a donor who gives every month is a donor who arrived once. counting the gifts instead
		// would make a loyal donor look like twelve new ones, which is the figure this card is
		// most likely to be read as.
		const ada = await create(individual());
		await settled(await gift(ada.id), 'inbound', 'succeeded', 5_000, Date.UTC(2026, 6, 10));
		await settled(await gift(ada.id), 'inbound', 'succeeded', 5_000, Date.UTC(2026, 8, 1));

		const summary = await readDonorSummary(db, NOW);
		expect(summary.total).toBe(1);
		expect(summary.thisMonth).toBe(0);
		expect(summary.points).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]);
	});

	it.each([
		[
			'has nothing but a pending attempt',
			async (id: string) => {
				await settled(await gift(id), 'inbound', 'pending', 5_000, Date.UTC(2026, 8, 2));
			}
		],
		[
			'has nothing but a refund against them',
			async (id: string) => {
				await settled(await gift(id), 'refund', 'succeeded', 5_000, Date.UTC(2026, 8, 2));
			}
		],
		[
			'has been archived',
			async (id: string) => {
				await settled(await gift(id), 'inbound', 'succeeded', 5_000, Date.UTC(2026, 8, 2));
				await archive(id);
			}
		]
	])('counts nobody for a contact who %s', async (_label, arrange) => {
		// an authorization is not a collection, an outbound movement is not somebody arriving, and
		// a donor staff have decided not to see is not one a figure above the list still counts.
		const ada = await create(individual());
		await arrange(ada.id);

		const summary = await readDonorSummary(db, NOW);
		expect(summary.total).toBe(0);
		expect(summary.thisMonth).toBe(0);
		expect(summary.points).toEqual(Array(12).fill(0));
	});

	it('holds a donor older than the run in the total and in no bucket', async () => {
		// the total is every donor there has ever been and the run is a year of them, so the two
		// are different questions about the same rows. summing the twelve to save a figure would
		// state a total that shrinks every time the year turns.
		const long = await create(individual({ first_name: 'Long' }));
		const recent = await create(individual({ first_name: 'Recent' }));
		// september 2025, one month older than the oldest bucket the run holds.
		await settled(await gift(long.id), 'inbound', 'succeeded', 5_000, Date.UTC(2025, 8, 15));
		await settled(await gift(recent.id), 'inbound', 'succeeded', 5_000, Date.UTC(2025, 9, 15));

		const summary = await readDonorSummary(db, NOW);
		expect(summary.total).toBe(2);
		expect(summary.points).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		expect(summary.firstMonth).toEqual(new Date(Date.UTC(2025, 9, 1)));
		expect(summary.lastMonth).toEqual(new Date(Date.UTC(2026, 8, 1)));
	});
});

describe('readDonorViewCounts', () => {
	it('counts a donor with an active commitment in both figures', async () => {
		const donor = await create(individual());
		await commitment(donor.id, 'active');

		expect(await readDonorViewCounts(db)).toEqual({ all: 1, recurring: 1 });
	});

	it.each(['cancelled', 'lapsed'] as const)(
		'leaves a donor whose only commitment is %s out of the recurring figure',
		async (status) => {
			// the view answers who is giving on a schedule now. a stopped commitment and one the
			// rail gave up on are both people who were, and a figure that held either is one an
			// operator reads as a list of donors to thank this month.
			const donor = await create(individual());
			await commitment(donor.id, status);

			expect(await readDonorViewCounts(db)).toEqual({ all: 1, recurring: 0 });
		}
	);

	it('counts a donor holding several active commitments once', async () => {
		// the reason the predicate is an `EXISTS` and not a join: a join multiplies, and a figure
		// over the nav that read 3 for one donor is one that can never match the rows beneath it.
		const donor = await create(individual());
		await commitment(donor.id, 'active');
		await commitment(donor.id, 'active');
		await commitment(donor.id, 'cancelled');

		expect(await readDonorViewCounts(db)).toEqual({ all: 1, recurring: 1 });
	});

	it('counts an archived donor in neither figure', async () => {
		// the same `where` the list is under. counted but not listed is a nav whose count an
		// operator checks against a table that does not hold it.
		const archived = await create(individual({ first_name: 'Gone' }));
		await commitment(archived.id, 'active');
		await archive(archived.id);

		expect(await readDonorViewCounts(db)).toEqual({ all: 0, recurring: 0 });
	});

	it('reads zeroes on a deployment holding no donors at all', async () => {
		// `sum` over no rows is null rather than zero, and a nav labelled `Recurring donors (null)`
		// is what an uncoalesced figure puts on a fresh deployment's first screen.
		expect(await readDonorViewCounts(db)).toEqual({ all: 0, recurring: 0 });
	});
});

describe('findContactByEmail', () => {
	it('matches regardless of case on either side', async () => {
		// the reason the query is `lower(primary_email) = lower(?)`: donors retype their
		// address in whatever case they please, and only the functional index exists.
		await create(individual({ primary_email: 'Ada.Okafor@Example.org' }));
		for (const probe of [
			'ada.okafor@example.org',
			'ADA.OKAFOR@EXAMPLE.ORG',
			'Ada.Okafor@Example.org'
		]) {
			expect((await findContactByEmail(db, probe))?.primaryEmail, probe).toBe(
				'Ada.Okafor@Example.org'
			);
		}
	});

	it('trims the probe', async () => {
		await create(individual({ primary_email: 'ada@example.org' }));
		expect(await findContactByEmail(db, '  ada@example.org  ')).not.toBeNull();
	});

	it('returns null when nothing matches', async () => {
		await create(individual({ primary_email: 'ada@example.org' }));
		expect(await findContactByEmail(db, 'ben@example.org')).toBeNull();
	});

	it('returns null for a blank probe without matching a null column', async () => {
		// a contact with no email must never be found by searching for none. without the
		// early return, `lower(null) = lower('')` is null rather than true — but the guard is
		// what makes that independent of SQL's three-valued logic.
		await create(individual());
		expect(await findContactByEmail(db, '   ')).toBeNull();
	});

	it('ignores archived contacts', async () => {
		const archived = await create(individual({ primary_email: 'ada@example.org' }));
		await env.DB.prepare('update contact set archived_at = ? where id = ?')
			.bind(Date.now(), archived.id)
			.run();
		expect(await findContactByEmail(db, 'ada@example.org')).toBeNull();
	});
});

describe('findContactById', () => {
	it('returns the contact', async () => {
		const created = await create(individual());
		expect((await findContactById(db, created.id))?.id).toBe(created.id);
	});

	it('returns null for an unknown id rather than throwing', async () => {
		expect(await findContactById(db, crypto.randomUUID())).toBeNull();
	});

	it('still returns an archived contact', async () => {
		// the donor-profile lookup: a donor with financial history is soft-deleted, and their
		// past gifts must stay reachable.
		const created = await create(individual());
		await env.DB.prepare('update contact set archived_at = ? where id = ?')
			.bind(Date.now(), created.id)
			.run();
		expect(await findContactById(db, created.id)).not.toBeNull();
	});
});

describe('readContactSummaries', () => {
	it('answers with the name and the email address, keyed by id', async () => {
		const created = await create(individual({ primary_email: 'ada@example.org' }));
		const summaries = await readContactSummaries(db, [created.id]);
		expect(summaries.get(created.id)).toEqual({
			displayName: created.displayName,
			primaryEmail: 'ada@example.org'
		});
	});

	it('carries a donor with no email address as `null` rather than dropping the row', async () => {
		// `primary_email` is nullable, and a screen that lost the whole donor over a missing
		// address would show a gift with nobody's name against it.
		const created = await create(individual());
		expect(await readContactSummaries(db, [created.id])).toEqual(
			new Map([[created.id, { displayName: created.displayName, primaryEmail: null }]])
		);
	});

	it('has no entry for an id no contact carries', async () => {
		expect((await readContactSummaries(db, [crypto.randomUUID()])).size).toBe(0);
	});

	it('asks nothing at all for an empty list of ids', async () => {
		// `in ()` is not the neutral condition it looks like, and a read of every contact in the
		// file is the wrong way to find that out.
		expect(await readContactSummaries(db, [])).toEqual(new Map());
	});

	it('includes an archived donor, like the names read beside it', async () => {
		// a soft delete hides a donor from the donor file; it does not unmake the commitment they
		// made, and a row on /admin/recurring whose donor column read `—` would be one nobody can
		// act on — which is the whole job of that screen.
		const created = await create(individual());
		await env.DB.prepare('update contact set archived_at = ? where id = ?')
			.bind(Date.now(), created.id)
			.run();
		expect((await readContactSummaries(db, [created.id])).has(created.id)).toBe(true);
	});
});

/**
 * `n` contacts, returned oldest first — i.e. in creation order, the reverse of what
 * `listContacts` returns. that is what lets the boundary tests name the row the cap drops
 * rather than only counting the ones it kept.
 *
 * one statement per row, and the order is the statement order rather than a read-back:
 * `id` is a uuidv7 minted per statement as it is built, so the first row built is the
 * lowest id and the oldest. asserting against a `select ... order by id` instead would be
 * asserting the ordering with the ordering.
 *
 * not a multi-row `INSERT` — D1 caps a query at 100 bound parameters and a contact binds
 * ten of them, so one query could hold ten rows at most. chunked at `SEED_CHUNK` for the
 * other D1 limit: 50 queries per invocation on the free tier, and a `batch()` of 101 is
 * 101 queries in one invocation. `batch()` is used for the speed, not for atomicity —
 * these are fixtures, and a torn seed would fail the assertion that follows it anyway.
 */
async function seedContacts(n: number): Promise<Contact[]> {
	const donor = (i: number) =>
		db
			.insert(contact)
			.values({ kind: 'individual', displayName: `Donor ${i}` })
			.returning();

	const rows: Contact[] = [];
	for (let from = 0; from < n; from += SEED_CHUNK) {
		const size = Math.min(SEED_CHUNK, n - from);
		// the head is split out so the argument is a non-empty tuple by construction —
		// `batch()` does not accept a plain array, and a cast would erase the row type that
		// makes `flat()` below `Contact[]`.
		const inserted = await db.batch([
			donor(from),
			...Array.from({ length: size - 1 }, (_, i) => donor(from + 1 + i))
		]);
		// one `returning()` per statement, so this is one single-row array per row, in
		// statement order.
		rows.push(...inserted.flat());
	}
	return rows;
}

const SEED_CHUNK = 50;

let sequence = 0;

/** an id in the shape the app mints, ordered by the counter so a case can rely on it. */
function nextId(): string {
	sequence += 1;
	return `019fb300-0000-7000-8000-${String(sequence).padStart(12, '0')}`;
}

/**
 * one gift from this donor, with no settlement attempt on it yet — so it collects nothing until
 * `settled` below is called for it.
 *
 * written past drizzle, the shape ../donations/queries.workers.spec.ts states: what the figures
 * below read is columns, and a fixture going through the module that reads them would be testing
 * itself.
 */
async function gift(contactId: string, totalMinor = 10_000): Promise<string> {
	const id = nextId();
	await env.DB.prepare(
		`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
		 values (?, ?, ?, 'USD', 0, 0)`
	)
		.bind(id, contactId, totalMinor)
		.run();
	return id;
}

/**
 * one settlement attempt against a gift.
 *
 * `occurredAt` is business time — when the money moved — and it defaults to the epoch, which is
 * what every case about the figures on a row wants: those read amounts and never the clock. a case
 * about which month a donor arrived in states it, because that column is the whole of what
 * `readDonorSummary` buckets by.
 */
async function settled(
	donationId: string,
	direction: 'inbound' | 'refund',
	status: 'pending' | 'succeeded' | 'failed' | 'cancelled',
	amountMinor = 10_000,
	occurredAt = 0
): Promise<void> {
	await env.DB.prepare(
		`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
		                      occurred_at, created_at)
		 values (?, ?, ?, 'USD', ?, 'card', ?, ?, 0)`
	)
		.bind(nextId(), donationId, amountMinor, direction, status, occurredAt)
		.run();
}

/** a valid parsed individual, for the tests that then corrupt one field of it. */
async function parsedIndividual(): Promise<ParsedContact> {
	const result = parseContact(individual());
	if (!result.ok) throw new Error('the individual fixture stopped parsing');
	return result.value;
}

/** the writable columns of a `ParsedContact`, without the brand `parseContact` mints. */
type ContactColumns = Omit<ParsedContact, '__parsed'>;

/**
 * that same individual with one column overwritten by a value `parseContact` refuses.
 *
 * the unsound cast is spent here, once, and only these tests may use it. `ParsedContact` is
 * branded so that `parseContact` is the only thing that can build one — a test that reached
 * past the brand inline, at each call site, is one line away from being how a *caller* gets
 * written. what these tests assert is the second line of defence: the check constraints on
 * the column, which hold against a hand-written `wrangler d1 execute` that never went near
 * TypeScript. the only way to reach them from here is to be the thing the brand excludes.
 *
 * `over` is keyed to the real column names but valued `unknown`, so `kind: 'donor'` is
 * expressible — that is the point — while a misspelled column is still a compile error.
 */
async function bypassingParse(
	over: Partial<Record<keyof ContactColumns, unknown>>
): Promise<ParsedContact> {
	return { ...(await parsedIndividual()), ...over } as unknown as ParsedContact;
}
