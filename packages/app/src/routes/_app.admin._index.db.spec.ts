import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { donationRevenueAccount, postableId } from '$lib/server/db/accounts';
import { createDb, type Db } from '$lib/server/db/client';
import { post, postingStatements, type PostingInput } from '$lib/server/ledger/posting';
import { SERIES_MONTHS } from '$lib/server/months';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { finishSetup } from '../webhook-routes.testing';
import * as layout from './_app';
import * as dashboard from './_app.admin._index';
import { client, first, run, stmt } from '$lib/server/db/database.testing';

// the dashboard, against a real database. it is a db spec because every figure on it is a `SUM` or
// a `COUNT` the database takes, and the composition is what this file asserts: four reads, one
// clock, and the two ways the screen can be short of a figure.
//
// which month a gift falls in is pinned to the millisecond one layer down, in
// $lib/server/ledger/queries.db.spec.ts and $lib/server/donations/queries.db.spec.ts —
// the loader reads the run against the clock the deployment is running on, so a case here states
// instants relative to that clock rather than fixed ones.
//
// the chain is mounted rather than the loader called, which is ../route-request.testing.ts's
// pattern: the session gate is a `middleware` on ./_app.tsx, so a loader called on its own is a
// loader with the gate above it never run.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

let db: Db;
let request: RouteRequester;
let bindings: Env;
let session: string;

/** the revenue account the fixture form posts to — the chart of accounts' own `4110`. */
let revenueAccountId: string;

beforeAll(async () => {
	db = createDb(client);
	const account = await first<{ id: string }>(
		stmt(`select id from account where is_postable = 1 and code = '4110'`)
	);
	if (!account) {
		throw new Error(
			'no 4110 account — has the chart of accounts in migrations/0000_initial_schema.sql moved?'
		);
	}
	revenueAccountId = account.id;
	bindings = await finishSetup(PASSWORD);
	const mounted = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin', module: dashboard }
	]);
	request = (incoming, options) => mounted(incoming, { env: bindings, ...options });
	session = await signIn();
});

beforeEach(async () => {
	// children first — every FK in this schema is `NO ACTION`. the auth tables are left alone: the
	// session is signed in once and every case here is about figures rather than about who reads
	// them.
	await run(stmt('delete from ledger_entry'));
	await run(stmt('delete from entry_group'));
	await run(stmt('delete from payment'));
	await run(stmt('delete from donation'));
	await run(stmt('delete from recurring_plan'));
	await run(stmt('delete from contact'));
	await run(stmt('delete from page'));
	await run(stmt('delete from form'));
});

/** a real session, as the `Cookie` header a browser would send back. */
async function signIn(): Promise<string> {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.cause);

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

/** what the loader hands the screen. */
type Loaded = {
	month: string;
	raisedMonth: string;
	raisedAll: string;
	giftsMonth: number;
	recurringActive: number | null;
	series: { points: number[]; first: string; last: string };
	donors: { total: number; thisMonth: number };
	hasForms: boolean;
};

/** the loader's answer, off one request through the chain the deployment serves it under. */
async function runLoad(): Promise<Loaded> {
	const response = await request(new Request(`${ORIGIN}/admin`, { headers: { cookie: session } }));
	expect(response.status).toBe(200);
	return (await response.json()) as Loaded;
}

let sequence = 0;

/** an id in the shape the app mints, ordered by the counter so a case can rely on it. */
function nextId(): string {
	sequence += 1;
	return `019fb600-0000-7000-8000-${String(sequence).padStart(12, '0')}`;
}

/** a gift of `amountMinor` credited to revenue, posted the way a call site posts one. */
async function raised(occurredAt: Date, amountMinor: number): Promise<void> {
	const input: PostingInput = {
		sourceType: 'donation',
		sourceId: uuidv7(),
		currency: 'USD',
		occurredAt,
		lines: [
			{ accountId: postableId('undepositedFunds'), amountMinor },
			{ accountId: donationRevenueAccount(true), amountMinor: -amountMinor }
		]
	};
	await db.batch(postingStatements(db, post(input)));
}

/** a donor, and one gift from them that settled at `occurredAt`. */
async function gift(occurredAt: Date, amountMinor = 10_000): Promise<void> {
	const contactId = nextId();
	await run(
		stmt(
			`insert into contact (id, kind, display_name, attributes, created_at, updated_at)
		 values (?, 'individual', 'Ada Okafor', '{}', 0, 0)`,
			contactId
		)
	);

	const donationId = nextId();
	await run(
		stmt(
			`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
		 values (?, ?, ?, 'USD', 0, 0)`,
			donationId,
			contactId,
			amountMinor
		)
	);

	await run(
		stmt(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
		                      occurred_at, created_at)
		 values (?, ?, ?, 'USD', 'inbound', 'card', 'succeeded', ?, 0)`,
			nextId(),
			donationId,
			amountMinor,
			occurredAt.getTime()
		)
	);
}

/** a standing commitment at the status a case is about, and the form it was made on. */
async function commitment(status: 'active' | 'cancelled' | 'lapsed'): Promise<void> {
	const contactId = nextId();
	await run(
		stmt(
			`insert into contact (id, kind, display_name, attributes, created_at, updated_at)
		 values (?, 'individual', 'Ada Okafor', '{}', 0, 0)`,
			contactId
		)
	);

	const formId = nextId();
	await run(
		stmt(
			`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins, created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`,
			formId,
			revenueAccountId
		)
	);

	const id = nextId();
	await run(
		stmt(
			`insert into recurring_plan (id, contact_id, form_id, amount_minor, currency, interval,
		                             status, provider, provider_subscription_id,
		                             provider_customer_id, started_at, next_charge_at, ended_at,
		                             created_at, updated_at)
		 values (?, ?, ?, 2500, 'USD', 'monthly', ?, 'stripe', ?, ?, 0, null, ?, 0, 0)`,
			id,
			contactId,
			formId,
			status,
			`sub_${id}`,
			`cus_${id}`,
			status === 'active' ? null : 0
		)
	);
}

/** a donation form, archived or not; its id. */
async function donationForm(archived = false): Promise<string> {
	const id = nextId();
	await run(
		stmt(
			`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins, created_at, updated_at, archived_at)
		 values (?, 'General Fund', ?, ?, 'USD', 500, 1000000, '[]', '[]', 0, 0, ?)`,
			id,
			archived ? 'archived' : 'draft',
			revenueAccountId,
			archived ? 0 : null
		)
	);
	return id;
}

/** the first instant of the month the deployment's clock is in, and of one `offset` from it. */
function monthAt(offset: number): Date {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

describe('/admin — the dashboard is the screen, not a forward', () => {
	it('answers with the figures rather than a redirect to a section', async () => {
		// the request is answered here rather than forwarded to a section, which is what makes this
		// a screen: the assertion is the status and a figure off the books rather than a `location`
		// header.
		await raised(monthAt(0), 12_480_00);
		await gift(monthAt(0));

		const loaded = await runLoad();
		expect(loaded.raisedMonth).toBe('$12,480.00');
		expect(loaded.giftsMonth).toBe(1);
	});
});

describe('/admin load — the figures a month is read for', () => {
	it('states the month by name and the money as the string a screen shows', async () => {
		// the division into major units is the last step before a screen and its result is never
		// read back as a number ($lib/donations/money.ts), so it is taken in the loader — a figure
		// formatted in the browser is formatted in the reader's own locale, which is a hydration
		// mismatch as well as a lie about whose thousands separator it is. the month is named for
		// the same reason and in the same zone the buckets are cut in.
		await raised(monthAt(0), 2_500_00);
		await raised(monthAt(-3), 1_000_00);

		const loaded = await runLoad();
		expect(loaded.month).toBe(
			new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date())
		);
		expect(loaded.raisedMonth).toBe('$2,500.00');
		expect(loaded.raisedAll).toBe('$3,500.00');
	});

	it('hands the run over as twelve months ending at the one now is in', async () => {
		await raised(monthAt(0), 300_00);
		await raised(monthAt(-11), 100_00);
		// a month past the far end of the run: in the all-time figure and in no bucket.
		await raised(monthAt(-13), 900_00);

		const loaded = await runLoad();
		expect(loaded.series.points).toHaveLength(SERIES_MONTHS);
		expect(loaded.series.points.at(0)).toBe(100_00);
		expect(loaded.series.points.at(-1)).toBe(300_00);
		expect(loaded.raisedAll).toBe('$1,300.00');
		expect(loaded.series.points.reduce((sum, n) => sum + n, 0)).toBe(400_00);
	});

	it('counts the standing commitments that are still collecting', async () => {
		await commitment('active');
		await commitment('cancelled');
		await commitment('lapsed');

		expect((await runLoad()).recurringActive).toBe(1);
	});

	it('reads a deployment that has taken nothing as noughts rather than blanks', async () => {
		// every figure is a real zero and the run is twelve empty months. a blank beside a label is
		// a read that did not land; nought is a figure, and it is what keeps the screen the same
		// screen with nothing in it yet.
		const loaded = await runLoad();

		expect(loaded.raisedMonth).toBe('$0.00');
		expect(loaded.raisedAll).toBe('$0.00');
		expect(loaded.giftsMonth).toBe(0);
		expect(loaded.recurringActive).toBe(0);
		expect(loaded.donors).toEqual({ total: 0, thisMonth: 0 });
		expect(loaded.series.points).toEqual(new Array(SERIES_MONTHS).fill(0));
	});
});

describe('/admin load — a read that fails on its own', () => {
	it('draws the rest of the screen and says the recurring figure could not be read', async () => {
		// the money figures, the gift count and the donor count fail as one and land the reader on
		// the error boundary. the commitments are a count over a table of their own, so that read
		// failing takes one figure off the screen and nothing else — and the slot says so rather
		// than rendering a nought, which is a figure and would read as "none".
		await raised(monthAt(0), 500_00);
		await run(stmt('alter table recurring_plan rename to recurring_plan_hidden'));
		try {
			const loaded = await runLoad();
			expect(loaded.recurringActive).toBeNull();
			expect(loaded.raisedMonth).toBe('$500.00');
		} finally {
			await run(stmt('alter table recurring_plan_hidden rename to recurring_plan'));
		}
	});
});

describe('/admin load — whether the deployment has a donation form', () => {
	it('says it has none on a deployment nobody has made one on', async () => {
		expect((await runLoad()).hasForms).toBe(false);
	});

	it('says it has one once a form is made', async () => {
		await donationForm();

		expect((await runLoad()).hasForms).toBe(true);
	});

	it('does not count a form that was archived', async () => {
		await donationForm(true);

		expect((await runLoad()).hasForms).toBe(false);
	});

	it('does not count a form a page owns, and counts one beside it that no page owns', async () => {
		// a campaign's donation settings are a form row the forms list leaves out, so a deployment
		// whose only form is one has none to show and the lead to make one stays.
		const owned = await donationForm();
		await run(
			stmt(
				`insert into page (id, type, state, form_id, draft, published, created_at, updated_at)
			 values (?, 'donation_page', 'live', ?, '{}', '{}', 0, 0)`,
				nextId(),
				owned
			)
		);

		expect((await runLoad()).hasForms).toBe(false);

		await donationForm();

		expect((await runLoad()).hasForms).toBe(true);
	});
});
