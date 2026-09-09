import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb, type Db } from '$lib/server/db/client';
import { consentState } from '$lib/contacts/consent';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as donors from './_app.admin.donors._index';

// a workers spec rather than a node one because every case here reads a row. the create next door
// has its own coverage against the parser and the write; what is asserted here is the projection —
// what crosses to the browser, and in what form.
//
// the chain is mounted rather than the loader called, which is ../route-request.testing.ts's
// pattern: the session gate is a `middleware` on ./_app.tsx and the handle is on the request
// context, so a loader called on its own is a loader with the gate above it never run.
//
// there is no cookie jar between the halves any more. the flash cookie is written at `/` and its
// destination rides in the value, so a case states the request and reads the response header — the
// same shape `$lib/server/flash.spec.ts` states the transport in.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

/** the address this screen answers on, which is also the address a marker is written for. */
const LIST = '/admin/donors';

let db: Db;
let request: RouteRequester;
let session: string;

/** the revenue account every fixture form posts to — the chart of accounts' own `4110`. */
let revenueAccountId: string;

beforeAll(async () => {
	db = createDb(env.DB);
	const account = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	if (!account) {
		throw new Error(
			'no 4110 account — has the chart of accounts in migrations/0000_initial_schema.sql moved?'
		);
	}
	revenueAccountId = account.id;
	// the pathless layout carries no path of its own, which is what makes the gate cover a screen
	// without adding a segment to its address.
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/donors', module: donors }
	]);
	session = await signIn();
});

beforeEach(async () => {
	// the auth tables are left alone: the session above is signed in once and every case here is
	// about donors rather than about who is reading them.
	await env.DB.prepare('delete from payment').run();
	await env.DB.prepare('delete from donation').run();
	await env.DB.prepare('delete from recurring_plan').run();
	await env.DB.prepare('delete from contact').run();
	await env.DB.prepare('delete from form').run();
});

/** a real session, as the `Cookie` header a browser would send back. */
async function signIn(): Promise<string> {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);

	const auth = createAuth(
		db,
		{ ADMIN_PASSWORD: PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);
	const { headers } = await auth.api.signInStaff({
		body: { password: PASSWORD },
		headers: new Headers({ origin: ORIGIN }),
		returnHeaders: true
	});

	const cookies = headers.getSetCookie().map((value) => value.split(';', 1)[0]);
	expect(cookies.length).toBeGreaterThan(0);
	return cookies.join('; ');
}

/** a donor with the consent answer a case is about. `null` is the unasked state. */
async function donor(id: string, displayName: string, consented: boolean | null) {
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, consented_to_contact, attributes, created_at, updated_at)
		 values (?, 'individual', ?, ?, '{}', 0, 0)`
	)
		.bind(id, displayName, consented === null ? null : Number(consented))
		.run();
}

/** what the loader hands the screen. */
type Loaded = {
	contacts: {
		id: string;
		displayName: string;
		consentedToContact: boolean | null;
		gifts: number;
		given: string;
	}[];
	summary: {
		total: number;
		thisMonth: number;
		points: number[];
		first: string;
		last: string;
	};
	total: number;
	page: number;
	pages: number;
	sort: string;
	dir: string;
	view: string;
	views: { all: number; recurring: number };
	viewLinks: { all: string; recurring: string };
	sorts: Record<string, string>;
	previous: string | null;
	next: string | null;
};

/** the loader's answer, off one request through the chain the deployment serves it under. */
async function runLoad(search = ''): Promise<Loaded> {
	const response = await request(
		new Request(`${ORIGIN}${LIST}${search}`, { headers: { cookie: session } })
	);
	expect(response.status).toBe(200);
	return (await response.json()) as Loaded;
}

let sequence = 0;

/** an id in the shape the app mints, ordered by the counter so a case can rely on it. */
function nextId(): string {
	sequence += 1;
	return `019fb500-0000-7000-8000-${String(sequence).padStart(12, '0')}`;
}

/**
 * a standing commitment for this donor, at the status a case is about.
 *
 * `ended_at` travels with the status because `recurring_plan_ended_at_check` in
 * $lib/server/db/schema.ts makes the two one fact — D1 refuses the row otherwise. the form is here
 * because `recurring_plan.form_id` is NOT NULL.
 */
async function commitment(contactId: string, status: 'active' | 'cancelled' | 'lapsed') {
	const formId = nextId();
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins, created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
	)
		.bind(formId, revenueAccountId)
		.run();

	const id = nextId();
	await env.DB.prepare(
		`insert into recurring_plan (id, contact_id, form_id, amount_minor, currency, interval,
		                             status, provider, provider_subscription_id,
		                             provider_customer_id, started_at, next_charge_at, ended_at,
		                             created_at, updated_at)
		 values (?, ?, ?, 2500, 'USD', 'monthly', ?, 'stripe', ?, ?, 0, null, ?, 0, 0)`
	)
		.bind(id, contactId, formId, status, `sub_${id}`, `cus_${id}`, status === 'active' ? null : 0)
		.run();
}

/** one gift from this donor, with no settlement attempt on it yet. */
async function gift(contactId: string): Promise<string> {
	const id = nextId();
	await env.DB.prepare(
		`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
		 values (?, ?, 10000, 'USD', 0, 0)`
	)
		.bind(id, contactId)
		.run();
	return id;
}

/**
 * one settlement attempt against a gift.
 *
 * `occurredAt` is business time and it defaults to the epoch, which is what the cases about the
 * figures on a row want. the summary buckets by that column, so a case about it states a real
 * instant — and it is `Date.now()` rather than a fixed one, because the loader reads the run
 * against the clock the deployment is running on. which month a gift falls in is pinned to the
 * millisecond one layer down, in $lib/server/contacts/queries.workers.spec.ts.
 */
async function settled(
	donationId: string,
	direction: 'inbound' | 'refund',
	status: 'pending' | 'succeeded',
	amountMinor: number,
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

describe('/admin/donors load — the consent answer', () => {
	it('keeps a donor nobody asked apart from one who declined', async () => {
		// the null is the point of the column. rendering it as "No" tells an organisation it has
		// been refused by everyone its own create form entered, which is a decision it never made
		// and cannot undo without asking again.
		await donor('019fb400-0000-7000-8000-000000000001', 'Agreed', true);
		await donor('019fb400-0000-7000-8000-000000000002', 'Declined', false);
		await donor('019fb400-0000-7000-8000-000000000003', 'Unasked', null);

		const byName = new Map(
			(await runLoad()).contacts.map((c) => [c.displayName, c.consentedToContact])
		);
		expect(byName.get('Agreed')).toBe(true);
		expect(byName.get('Declined')).toBe(false);
		expect(byName.get('Unasked')).toBe(null);

		// and the three reach the page as three different words rather than three values it has
		// two answers for.
		const words = [...byName.values()].map(consentState);
		expect(new Set(words).size).toBe(3);
	});
});

describe('/admin/donors load — what each donor has given', () => {
	it('states the count as a number and the figure as the string a screen shows', async () => {
		// the division into major units is the last step before a screen and its result is never
		// read back as a number ($lib/donations/money.ts), so it is taken here rather than in the
		// component — a figure formatted in the browser is formatted in the reader's own locale,
		// which is a hydration mismatch as well as a lie about whose thousands separator it is.
		const id = '019fb400-0000-7000-8000-000000000010';
		await donor(id, 'Ada Okafor', null);
		await settled(await gift(id), 'inbound', 'succeeded', 10_000);
		await settled(await gift(id), 'inbound', 'succeeded', 5_000);

		const [row] = (await runLoad()).contacts;
		expect(row).toMatchObject({ displayName: 'Ada Okafor', gifts: 2, given: '$150.00' });
	});

	it('states zeroes for a donor whose only gift has not settled', async () => {
		const id = '019fb400-0000-7000-8000-000000000011';
		await donor(id, 'Ada Okafor', null);
		await settled(await gift(id), 'inbound', 'pending', 10_000);

		const [row] = (await runLoad()).contacts;
		expect(row).toMatchObject({ gifts: 0, given: '$0.00' });
	});
});

describe('/admin/donors load — the summary over the list', () => {
	it('counts a donor whose gift has settled, and hands the run over as twelve months', async () => {
		const id = '019fb400-0000-7000-8000-000000000030';
		await donor(id, 'Ada Okafor', null);
		await settled(await gift(id), 'inbound', 'succeeded', 10_000, Date.now());

		const { summary } = await runLoad();
		expect(summary).toMatchObject({ total: 1, thisMonth: 1 });
		expect(summary.points).toHaveLength(12);
		// the newest bucket is the month the deployment is in, which is the month this gift
		// settled in.
		expect(summary.points.at(-1)).toBe(1);
		// the two ends of the run are words rather than instants. a `Date` crosses to the browser
		// as an ISO string, and a screen that formatted one would format it in the reader's own
		// locale and zone — a hydration mismatch as well as a lie about whose month it is.
		expect(summary.first).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
		expect(summary.last).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
	});

	it('counts no donor for a contact whose only gift is pending, and still lists them', async () => {
		// the two figures answer different questions and are meant to disagree: the list is every
		// contact this deployment holds, and the summary is the ones whose money has moved.
		const id = '019fb400-0000-7000-8000-000000000031';
		await donor(id, 'Ada Okafor', null);
		await settled(await gift(id), 'inbound', 'pending', 10_000, Date.now());

		const loaded = await runLoad();
		expect(loaded.contacts).toHaveLength(1);
		expect(loaded.summary).toMatchObject({ total: 0, thisMonth: 0 });
		expect(loaded.summary.points).toEqual(Array(12).fill(0));
	});
});

describe('/admin/donors load — the two views of the file', () => {
	it('lists only donors giving on a schedule in the recurring view', async () => {
		const giving = '019fb400-0000-7000-8000-000000000040';
		const stopped = '019fb400-0000-7000-8000-000000000041';
		await donor(giving, 'Giving', null);
		await donor(stopped, 'Stopped', null);
		await commitment(giving, 'active');
		await commitment(stopped, 'cancelled');

		const view = await runLoad('?view=recurring');
		expect(view.contacts.map((c) => c.displayName)).toEqual(['Giving']);
		expect(view).toMatchObject({ view: 'recurring', total: 1 });
	});

	it('states both counts on both views, and each is the size of the view it names', async () => {
		// the nav says what each press leads to rather than only where it goes, so both figures
		// stand whichever view is open — and they are the file's, so they do not move as an
		// operator sorts or pages inside one.
		const giving = '019fb400-0000-7000-8000-000000000042';
		await donor(giving, 'Giving', null);
		await commitment(giving, 'active');
		await donor('019fb400-0000-7000-8000-000000000043', 'One off', null);
		await donor('019fb400-0000-7000-8000-000000000044', 'Never gave', null);

		const all = await runLoad();
		const recurring = await runLoad('?view=recurring');
		expect(all.views).toEqual({ all: 3, recurring: 1 });
		expect(recurring.views).toEqual(all.views);

		// each count is the size of the list its view draws, which is the only thing that makes
		// the two figures checkable against the rows in front of the operator.
		expect(all.total).toBe(all.views.all);
		expect(all.contacts).toHaveLength(all.views.all);
		expect(recurring.total).toBe(all.views.recurring);
		expect(recurring.contacts).toHaveLength(all.views.recurring);
	});

	it('addresses each view bare, so the file itself carries no view at all', async () => {
		expect((await runLoad()).viewLinks).toEqual({
			all: LIST,
			recurring: `${LIST}?view=recurring`
		});
	});

	it('carries the view across every sort and paging press inside it', async () => {
		// a sort or a page is a move inside the view rather than out of it. one href that dropped
		// it would put an operator back in the whole file mid-read, with no press that said so.
		await seedDonors(101);
		for (let i = 0; i < 101; i += 1) {
			await commitment(`019fb400-0000-7000-8000-${String(i).padStart(12, '0')}`, 'active');
		}

		const first = await runLoad('?sort=name&dir=asc&view=recurring');
		expect(first.sorts).toEqual({
			name: `${LIST}?sort=name&dir=desc&view=recurring`,
			gifts: `${LIST}?sort=gifts&dir=desc&view=recurring`,
			given: `${LIST}?sort=given&dir=desc&view=recurring`
		});
		expect(first).toMatchObject({
			pages: 2,
			previous: null,
			next: `${LIST}?sort=name&dir=asc&view=recurring&page=2`
		});
	});

	it('carries no view at all on the presses inside the whole file', async () => {
		// `?view=all` would be a second address for one screen — two history entries for the same
		// rows, and two links a reader has to recognise as the same place.
		const loaded = await runLoad('?sort=name&dir=asc');
		expect(Object.values(loaded.sorts).some((href) => href.includes('view='))).toBe(false);
	});

	it.each([
		['a view that is not one', '?view=lapsed'],
		['the whole file named out loud', '?view=all'],
		['nothing at all', '?view=']
	])('reads the whole file for %s', async (_label, search) => {
		// the same fallback the order is under: an operator's own screen has a donor file behind
		// every address, and there is nothing here for a 4xx to protect.
		expect(await runLoad(search)).toMatchObject({ view: 'all' });
	});
});

describe('/admin/donors load — the order and the page', () => {
	it('reads the biggest donors first when the address says nothing', async () => {
		expect(await runLoad()).toMatchObject({ sort: 'given', dir: 'desc', page: 1 });
	});

	it('reads the order the address states', async () => {
		expect(await runLoad('?sort=name&dir=asc')).toMatchObject({ sort: 'name', dir: 'asc' });
	});

	it.each([
		['a column nobody sorts by', '?sort=email'],
		['a direction that is not one', '?sort=given&dir=sideways'],
		['nothing at all', '?sort=&dir=']
	])('falls back to the biggest first for %s', async (_label, search) => {
		// it is an operator's own screen and not the public API, so a value nobody can have typed
		// by accident still draws the file rather than a 4xx — there is nothing on this screen for
		// an error to protect.
		expect(await runLoad(search)).toMatchObject({ sort: 'given', dir: 'desc' });
	});

	it.each([
		['zero', '?page=0'],
		['a word', '?page=abc'],
		['a fraction', '?page=1.5'],
		['negative', '?page=-2']
	])('falls back to page one for a page that is %s', async (_label, search) => {
		expect((await runLoad(search)).page).toBe(1);
	});

	it('addresses every sortable head from the order it is in', async () => {
		// pressing the sorted column turns it over; pressing another sorts it the way that column
		// is worth reading, and neither carries the page — a new order is a new first page.
		const loaded = await runLoad('?sort=given&dir=desc&page=2');
		expect(loaded.sorts).toEqual({
			name: `${LIST}?sort=name&dir=asc`,
			gifts: `${LIST}?sort=gifts&dir=desc`,
			given: `${LIST}?sort=given&dir=asc`
		});
	});

	it('has no page either way when the file is one page', async () => {
		await donor('019fb400-0000-7000-8000-000000000020', 'Ada Okafor', null);
		expect(await runLoad()).toMatchObject({ pages: 1, previous: null, next: null });
	});

	it('carries the order across both paging presses', async () => {
		// the whole reason the pair states the order: a move to the next page that dropped it
		// would re-sort the file under the operator mid-read.
		await seedDonors(101);

		const first = await runLoad('?sort=name&dir=asc');
		expect(first).toMatchObject({
			page: 1,
			pages: 2,
			previous: null,
			next: `${LIST}?sort=name&dir=asc&page=2`
		});

		const second = await runLoad('?sort=name&dir=asc&page=2');
		expect(second).toMatchObject({
			page: 2,
			pages: 2,
			previous: `${LIST}?sort=name&dir=asc&page=1`,
			next: null
		});
		expect(second.contacts).toHaveLength(1);
	});
});

/** `n` donors, named so the name sort has something to order them by. */
async function seedDonors(n: number): Promise<void> {
	for (let i = 0; i < n; i += 1) {
		await donor(
			`019fb400-0000-7000-8000-${String(i).padStart(12, '0')}`,
			`Donor ${String(i).padStart(3, '0')}`,
			null
		);
	}
}
