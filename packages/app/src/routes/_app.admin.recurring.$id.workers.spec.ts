import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RecurringPlanStatus } from '$lib/recurring/statuses';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb, type Db } from '$lib/server/db/client';
import { redirectWithFlash, SAVED_FLASH } from '$lib/server/flash';
import { readRecurringPlan } from '$lib/server/recurring/queries';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as detail from './_app.admin.recurring.$id';

// a workers spec because every case here reads or writes a row. what the act itself decides — the
// order of the two writes, and which non-write is a success — is
// `$lib/server/recurring/stop.workers.spec.ts`, where the port is an argument; this file is the
// route, so what it asserts is the projection, the refusals it can reach, and the outcome
// surviving its own redirect.
//
// the arm this file cannot reach is a cancel that succeeds: the action builds its provider from
// the platform env per request (CLAUDE.md), so with no `STRIPE_SECRET_KEY` every call is refused
// before a socket is opened. that is the honest seam — the module behind it is where the success
// is covered.
//
// the chain is mounted rather than the loader and the action called, which is
// ../route-request.testing.ts's pattern: the session gate is a `middleware` on ./_app.tsx and the
// handle is on the request context, so a handler called on its own is one with the gate above it
// never run.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://donations.example.workers.dev';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

const FORM_ID = 'frm_recurringdetail1';
const DONOR_ID = '019fb700-0000-7000-8000-000000000001';
const PLAN_ID = '019fb700-0000-7000-8000-000000000002';
const SUBSCRIPTION_ID = 'sub_detailtest1';

/** the address this screen answers on, which is also where its own redirect leaves a marker. */
const SCREEN_PATH = `/admin/recurring/${PLAN_ID}`;

let db: Db;
let request: RouteRequester;
let session: string;
let revenueAccountId: string;

beforeAll(async () => {
	db = createDb(env.DB);
	// the pathless layout carries no path of its own, which is what makes the gate cover a screen
	// without adding a segment to its address.
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/recurring/:id', module: detail }
	]);
	session = await signIn();

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
		 values (?, 'Spring appeal', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
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

/** the commitment these cases read, written past drizzle: what this screen reads is columns. */
async function plan(status: RecurringPlanStatus = 'active', contactId = DONOR_ID): Promise<void> {
	await env.DB.prepare(
		`insert into recurring_plan (id, contact_id, form_id, amount_minor, currency, interval,
		                             status, provider, provider_subscription_id,
		                             provider_customer_id, started_at, next_charge_at, ended_at,
		                             created_at, updated_at)
		 values (?, ?, ?, 12345, 'USD', 'monthly', ?, 'stripe', ?, 'cus_detailtest1', ?, ?, ?, 0, 0)`
	)
		.bind(
			PLAN_ID,
			contactId,
			FORM_ID,
			status,
			SUBSCRIPTION_ID,
			Date.UTC(2026, 5, 1, 8, 0),
			status === 'active' ? Date.UTC(2026, 8, 4, 23, 30) : null,
			status === 'active' ? null : Date.UTC(2026, 6, 1, 10, 0)
		)
		.run();
}

type Loaded = {
	id: string;
	donorName: string;
	donorEmail: string | null;
	amount: string;
	interval: string;
	status: RecurringPlanStatus;
	startedOn: string;
	nextChargeOn: string | null;
	endedOn: string | null;
	formId: string;
	formName: string;
	subscriptionId: string;
	stopLanded: 'stopped' | 'nothing-to-stop' | null;
	confirmStop: boolean;
};

/** one visit to this screen, carrying the session and whatever the browser holds beside it. */
function visit(options: { id?: string; query?: string; flash?: string } = {}): Promise<Response> {
	const { id = PLAN_ID, query = '', flash = '' } = options;
	const cookie = [session, flash].filter((value) => value !== '').join('; ');
	return request(new Request(`${ORIGIN}/admin/recurring/${id}${query}`, { headers: { cookie } }));
}

async function runLoad(options: Parameters<typeof visit>[0] = {}): Promise<Loaded> {
	const response = await visit(options);
	expect(response.status).toBe(200);
	return (await response.json()) as Loaded;
}

/** the response a visit that could not be drawn answered with, or a failure saying it was drawn. */
async function loadFailure(id: string): Promise<{ status: number; sentence: string }> {
	const response = await visit({ id });
	if (response.ok) throw new Error('the load did not refuse');
	return { status: response.status, sentence: (await response.json()) as string };
}

/**
 * a marker left for this address, as the pair a browser sends back.
 *
 * built by writing a real redirect rather than by spelling a cookie here: what has to reach this
 * loader is whatever `redirectWithFlash` produced, and a hand-written value would go on passing
 * after the transport changed shape.
 */
async function markerFor(destination: string, marker: string): Promise<string> {
	const sent = await redirectWithFlash(
		new Request(`${ORIGIN}${SCREEN_PATH}`),
		SAVED_FLASH,
		destination,
		marker
	);
	const header = sent.headers.get('Set-Cookie');
	if (header === null) throw new Error('the redirect wrote no cookie');
	return header.split(';')[0] ?? '';
}

/** what a refused stop hands back, on its own channel and keyed to no box. */
type StopFailure = { stopWord: string; stopError: string };

/**
 * presses the stop, with no Stripe credentials on the platform.
 *
 * the pool binds D1 and nothing else, so every request here arrives at a deployment with no
 * `STRIPE_SECRET_KEY` — which is the fresh-fork state, and the reason the successful cancel is
 * covered one module down rather than here. a spec that handed the action a ready-made provider
 * would assert nothing about how the deployment builds one (CLAUDE.md).
 */
async function pressStop(id = PLAN_ID): Promise<{
	status: number;
	location?: string | null;
	cookie?: string | null;
	failure?: StopFailure;
	sentence?: string;
}> {
	const response = await request(
		new Request(`${ORIGIN}/admin/recurring/${id}`, {
			method: 'POST',
			headers: { cookie: session },
			body: new FormData()
		})
	);

	if (response.status === 303) {
		return {
			status: response.status,
			location: response.headers.get('Location'),
			cookie: response.headers.get('Set-Cookie')
		};
	}

	const body: unknown = await response.json();
	return typeof body === 'string'
		? { status: response.status, sentence: body }
		: { status: response.status, failure: body as StopFailure };
}

describe('/admin/recurring/[id] load', () => {
	it('renders the commitment as a record, formatted server-side', async () => {
		await plan();
		const loaded = await runLoad();
		expect(loaded).toMatchObject({
			id: PLAN_ID,
			donorName: 'Ada Okafor',
			donorEmail: 'ada@example.org',
			amount: '$123.45',
			interval: 'monthly',
			status: 'active',
			startedOn: '2026-06-01',
			nextChargeOn: '2026-09-04',
			endedOn: null,
			formId: FORM_ID,
			formName: 'Spring appeal',
			subscriptionId: SUBSCRIPTION_ID
		});
	});

	it('opens with nothing to report and no question asked', async () => {
		// the state the screen is actually drawn in: a plain visit, no marker in the jar and no
		// parameter in the address. a banner over a record nobody just wrote to and a destructive
		// question nobody asked for are both defects a case about a landing would never catch.
		await plan();
		const loaded = await runLoad();
		expect(loaded.stopLanded).toBeNull();
		expect(loaded.confirmStop).toBe(false);
	});

	it('draws a donor nobody holds an address for as an absence', async () => {
		// the record with nothing optional filled in: `primary_email` is nullable, and a page
		// handed an empty string would draw a blank row rather than the dash that says there is
		// nothing to reach them at.
		const anonymous = '019fb700-0000-7000-8000-0000000000ff';
		await env.DB.prepare(
			`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
			 values (?, 'individual', 'Kofi Mensah', null, 0, 0)`
		)
			.bind(anonymous)
			.run();
		await plan('active', anonymous);
		const loaded = await runLoad();
		expect(loaded.donorName).toBe('Kofi Mensah');
		expect(loaded.donorEmail).toBeNull();
	});

	it('says when a stopped commitment stopped, and expects nothing further', async () => {
		await plan('cancelled');
		const loaded = await runLoad();
		expect(loaded.status).toBe('cancelled');
		expect(loaded.endedOn).toBe('2026-07-01');
		expect(loaded.nextChargeOn).toBeNull();
	});

	it('names the donation form rather than the fund it posts to', async () => {
		// the fund is read off the form at the moment each charge settles, so a fund stated on a
		// commitment would be today's answer over a series whose earlier charges posted somewhere
		// else — a value that reads clean and is wrong. the form is the fact the row holds, and it
		// reaches the fund in one click on the screen that states it.
		await plan();
		const loaded = await runLoad();
		expect(loaded.formName).toBe('Spring appeal');
		expect(Object.keys(loaded)).not.toContain('fund');
	});

	it('publishes nothing the page does not render', async () => {
		// a column reaches a browser by being selected. the processor's customer id is the one on
		// this row that nothing on the screen needs, and this is what keeps it off the page.
		await plan();
		expect(Object.keys(await runLoad()).sort()).toEqual([
			'amount',
			'confirmStop',
			'donorEmail',
			'donorName',
			'endedOn',
			'formId',
			'formName',
			'id',
			'interval',
			'nextChargeOn',
			'startedOn',
			'status',
			'stopLanded',
			'subscriptionId'
		]);
	});

	it('refuses an id no commitment carries, and says where to go instead', async () => {
		await plan();
		const refusal = await loadFailure(crypto.randomUUID());
		expect(refusal.status).toBe(404);
		expect(refusal.sentence).toContain('Recurring gifts');
	});

	it('offers the confirmation only when the address asks for it', async () => {
		await plan();
		expect((await runLoad()).confirmStop).toBe(false);
		expect((await runLoad({ query: '?confirm=stop' })).confirmStop).toBe(true);
	});

	it('does not offer to confirm a stop of a commitment that is already stopped', async () => {
		// the action would refuse it, so a panel asking about it is a question with one wrong
		// answer.
		await plan('cancelled');
		expect((await runLoad({ query: '?confirm=stop' })).confirmStop).toBe(false);
	});

	it('reports a stop that just landed here, exactly once', async () => {
		// the marker is the constant the action writes rather than a literal spelled again here: a
		// marker renamed in one of the two places is what this import makes a failure.
		await plan('cancelled');
		const flash = await markerFor(SCREEN_PATH, detail.STOPPED);
		const landing = await visit({ flash });
		expect(((await landing.json()) as Loaded).stopLanded).toBe('stopped');
		// taking it is what clears it: the header rides on the response that publishes the marker,
		// so a reload of the page that landed reports nothing.
		expect(landing.headers.get('Set-Cookie')).toMatch(/max-age=0\b/i);
		expect((await runLoad()).stopLanded).toBeNull();
	});

	it('tells a stop that found nothing at Stripe apart from one that cancelled a subscription', async () => {
		// two landings and two sentences: one gift was collecting until this act, the other was not
		// collecting at all because the processor holds no subscription for it. one marker over both
		// would leave the screen unable to say which.
		await plan('cancelled');
		const flash = await markerFor(SCREEN_PATH, detail.NOTHING_TO_STOP);
		expect((await runLoad({ flash })).stopLanded).toBe('nothing-to-stop');
		expect(detail.NOTHING_TO_STOP).not.toBe(detail.STOPPED);
	});

	it('reports nothing for a marker this screen does not answer to', async () => {
		await plan();
		for (const marker of ['', 'name', 'archived']) {
			const flash = await markerFor(SCREEN_PATH, marker);
			expect((await runLoad({ flash })).stopLanded).toBeNull();
		}
	});
});

describe('/admin/recurring/[id] stop', () => {
	it('refuses a commitment that is already stopped, and changes nothing', async () => {
		await plan('cancelled');
		const before = await readRecurringPlan(db, PLAN_ID);
		const pressed = await pressStop();
		expect(pressed.status).toBe(400);
		expect(pressed.failure?.stopError).toContain('already stopped');
		// and says nothing about the gift being gone: an id no row answers to is a 404 before this
		// arm is reached, so the only thing this sentence can mean is a row that is stopped.
		expect(pressed.failure?.stopError).not.toContain('no longer here');
		expect(await readRecurringPlan(db, PLAN_ID)).toEqual(before);
	});

	it('refuses an id no commitment carries', async () => {
		await plan();
		expect((await pressStop(crypto.randomUUID())).status).toBe(404);
	});

	it('writes nothing when this deployment cannot reach Stripe, and says to try again', async () => {
		// the fresh-fork state: no `STRIPE_SECRET_KEY`, so the port refuses before a socket is
		// opened. the reason is retryable — a redelivery window outlives an operator setting a
		// variable — so the sentence may say to try again.
		await plan();
		const pressed = await pressStop();
		expect(pressed.status).toBe(500);
		expect(pressed.failure?.stopError).toContain('try again');
		expect((await readRecurringPlan(db, PLAN_ID))?.status).toBe('active');
	});

	it('claims no state Stripe did not establish, on a retry the port calls indeterminate', async () => {
		// the failure that makes this matter: a lapsed gift, Stripe cancels the subscription, and the
		// answer never comes back. `unreachable`'s own detail says whether the call took effect is
		// unknown, so a sentence in front of it saying the gift is still collecting is one banner
		// making two opposite claims — over a row the `customer.subscription.deleted` that follows
		// will not repair, because `recordStanding` writes only over `status = 'active'`
		// ($lib/server/donations/collect.ts).
		await plan('lapsed');
		const pressed = await pressStop();
		expect(pressed.failure?.stopError).not.toContain('still collecting');
		expect(pressed.failure?.stopError).not.toContain('nothing was changed');
		expect(pressed.failure?.stopError).toContain('unknown');
	});

	it('answers a refused stop on its own channel, never through a form’s', async () => {
		// there is no input on this screen for a message to sit under, and routing it through one
		// would render a refused stop as a complaint about a box a fundraiser filled in correctly.
		// the word travels with the sentence because this screen has three failures and they are
		// not interchangeable.
		await plan();
		expect(Object.keys((await pressStop()).failure ?? {}).sort()).toEqual([
			'stopError',
			'stopWord'
		]);
	});

	it('gives a refusal and an already-stopped different words, because they are different claims', async () => {
		// `Not stopped` says the donor is still being charged; `Nothing was stopped` says there was
		// nothing to charge. one word over both would leave an operator unable to tell which.
		await plan();
		const refused = (await pressStop()).failure?.stopWord;
		await env.DB.prepare(
			"update recurring_plan set status = 'cancelled', ended_at = 1 where id = ?"
		)
			.bind(PLAN_ID)
			.run();
		const already = (await pressStop()).failure?.stopWord;
		expect(refused).toBe('Not stopped');
		expect(already).toBe('Nothing was stopped');
	});

	it('leaves the one insert into the commitment table to the collection path', async () => {
		// CLAUDE.md: `collect.ts` is the only module that may `INSERT` into `recurring_plan`. this
		// screen reads one and updates one; a press against an id no row answers to must be a 404
		// rather than a row minted here, which is the shape a "write it if it is missing" arm would
		// take.
		const stray = crypto.randomUUID();
		expect((await pressStop(stray)).status).toBe(404);
		const after = await env.DB.prepare('select count(*) as n from recurring_plan').first<{
			n: number;
		}>();
		expect(after?.n).toBe(0);
	});
});
