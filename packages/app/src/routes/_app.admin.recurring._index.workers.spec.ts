import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RecurringPlanStatus } from '$lib/recurring/statuses';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb, type Db } from '$lib/server/db/client';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as recurring from './_app.admin.recurring._index';

// a workers spec rather than a node one because every case here reads a row, and CLAUDE.md splits
// the pools by what a spec needs. the page has no action: stopping a gift is the screen next door,
// where the gift being stopped is the thing on the page.
//
// what is asserted here is the projection — what crosses to the browser and in what form — and not
// the read, which is `$lib/server/recurring/queries.workers.spec.ts`.
//
// the chain is mounted rather than the loader called, which is ../route-request.testing.ts's
// pattern: the session gate is a `middleware` on ./_app.tsx and the handle is on the request
// context, so a loader called on its own is a loader with the gate above it never run.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://donations.example.workers.dev';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

const FORM_ID = 'frm_recurringlist1';
const DONOR_ID = '019fb600-0000-7000-8000-000000000001';

let db: Db;
let request: RouteRequester;
let cookie: string;
let revenueAccountId: string;

beforeAll(async () => {
	db = createDb(env.DB);
	// the pathless layout carries no path of its own, which is what makes the gate cover a screen
	// without adding a segment to its address.
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/recurring', module: recurring }
	]);
	cookie = await signIn();

	const row = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	if (!row)
		throw new Error(
			'no 4110 account — has the chart of accounts in migrations/0000_initial_schema.sql moved?'
		);
	revenueAccountId = row.id;
});

beforeEach(async () => {
	for (const table of ['recurring_plan', 'donation', 'contact', 'form']) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins, created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
	)
		.bind(FORM_ID, revenueAccountId)
		.run();
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
		 values (?, 'individual', 'Ada Okafor', 'ada@example.org', 0, 0)`
	)
		.bind(DONOR_ID)
		.run();
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

let minted = 0;

/** one standing commitment, written past drizzle: what this page reads is columns. */
async function plan(
	over: {
		status?: RecurringPlanStatus;
		amountMinor?: number;
		interval?: 'monthly' | 'yearly';
		nextChargeAt?: number | null;
		contactId?: string;
	} = {}
): Promise<string> {
	minted += 1;
	const id = `019fb600-0000-7000-8000-${String(minted).padStart(12, '0')}`;
	const {
		status = 'active',
		amountMinor = 12345,
		interval = 'monthly',
		nextChargeAt = Date.UTC(2026, 8, 4, 23, 30),
		contactId = DONOR_ID
	} = over;
	await env.DB.prepare(
		`insert into recurring_plan (id, contact_id, form_id, amount_minor, currency, interval,
		                             status, provider, provider_subscription_id,
		                             provider_customer_id, started_at, next_charge_at, ended_at,
		                             created_at, updated_at)
		 values (?, ?, ?, ?, 'USD', ?, ?, 'stripe', ?, ?, ?, ?, ?, 0, 0)`
	)
		.bind(
			id,
			contactId,
			FORM_ID,
			amountMinor,
			interval,
			status,
			`sub_${id}`,
			`cus_${id}`,
			Date.UTC(2026, 5, 1),
			nextChargeAt,
			status === 'active' ? null : Date.UTC(2026, 6, 1)
		)
		.run();
	return id;
}

/**
 * what the screen is handed, off one request through the chain the deployment serves it under.
 *
 * the loader returns a plain object, so ../route-request.testing.ts answers with it as json — the
 * same serialization a browser receives, which is what makes the key sweep below a claim about
 * what crosses rather than about what was constructed.
 */
async function runLoad() {
	const response = await request(new Request(`${ORIGIN}/admin/recurring`, { headers: { cookie } }));
	expect(response.status).toBe(200);
	return (await response.json()) as {
		plans: {
			id: string;
			donorName: string;
			donorEmail: string | null;
			amount: string;
			interval: string;
			status: string;
			nextChargeOn: string | null;
		}[];
		limit: number;
		hasMore: boolean;
	};
}

describe('/admin/recurring load', () => {
	it('formats the amount from the minor units the column holds', async () => {
		await plan();
		expect((await runLoad()).plans[0]?.amount).toBe('$123.45');
	});

	it('formats the next charge server-side, to the day', async () => {
		// an `Intl.DateTimeFormat` in the page would run once on the Worker and again in the
		// browser, in two different locales and time zones — a hydration mismatch as well as a lie
		// about whose "today" it is.
		await plan();
		expect((await runLoad()).plans[0]?.nextChargeOn).toBe('2026-09-04');
	});

	it('keeps a next charge nobody expects as null, for the page to put a word to', async () => {
		// null covers two different situations — an ended commitment and one the rail has not
		// spoken about — so the page renders it three ways against the status. a date stood in for
		// here would collapse all three.
		await plan({ nextChargeAt: null });
		expect((await runLoad()).plans[0]?.nextChargeOn).toBeNull();
	});

	it('hands the state and the cadence over as values, for the page to put words to', async () => {
		// the words are `RECURRING_STATUS_LABELS` in `$lib/recurring/statuses.ts` and
		// `FREQUENCY_LABELS` in `packages/form/src/v1.ts`, both of which a component may import — so a
		// state or a cadence with no label there is a type error rather than a blank on a screen.
		await plan({ status: 'lapsed', interval: 'yearly' });
		const [row] = (await runLoad()).plans;
		expect(row?.status).toBe('lapsed');
		expect(row?.interval).toBe('yearly');
	});

	it('publishes nothing the page does not render', async () => {
		// a column reaches a browser by being selected. the projection is what stops the next one
		// added to `recurring_plan` — a processor customer id, say — from doing so by default.
		await plan();
		const [row] = (await runLoad()).plans;
		expect(Object.keys(row ?? {}).sort()).toEqual([
			'amount',
			'donorEmail',
			'donorName',
			'id',
			'interval',
			'nextChargeOn',
			'status'
		]);
	});

	it('reports the cap so the page can say the list is one', async () => {
		await plan();
		const { limit, hasMore } = await runLoad();
		expect(limit).toBeGreaterThan(0);
		expect(hasMore).toBe(false);
	});

	it('hands back an empty list on a deployment nobody has committed to', async () => {
		const { plans, hasMore } = await runLoad();
		expect(plans).toEqual([]);
		expect(hasMore).toBe(false);
	});

	it('carries a donor nobody holds an address for as null, for the page to draw the absence', async () => {
		// the row the screen opens on for a gift taken from somebody who gave no email: the column
		// is nullable, and a page handed an empty string would draw a blank cell rather than the
		// dash that says there is nothing to reach them at.
		const anonymous = '019fb600-0000-7000-8000-0000000000ff';
		await env.DB.prepare(
			`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
			 values (?, 'individual', 'Kofi Mensah', null, 0, 0)`
		)
			.bind(anonymous)
			.run();
		await plan({ contactId: anonymous });
		const [row] = (await runLoad()).plans;
		expect(row?.donorName).toBe('Kofi Mensah');
		expect(row?.donorEmail).toBeNull();
	});
});
