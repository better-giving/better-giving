import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb, type Db } from '$lib/server/db/client';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as donations from './_app.admin.donations';

// a workers spec rather than a node one because every case here reads a row, and CLAUDE.md splits
// the pools by what a spec needs. the screen has no action: nothing on it writes.
//
// what is asserted here is the projection — what crosses to the browser and in what form — and not
// the read, which is `$lib/server/donations/queries.workers.spec.ts`, nor the states, which are
// that module's node spec.
//
// the chain is mounted rather than the loader called, which is ../route-request.testing.ts's
// pattern: the session gate is a `middleware` on ./_app.tsx and the handle is on the request
// context, so a loader called on its own is a loader with the gate above it never run.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

let db: Db;
let request: RouteRequester;
let cookie: string;
let donorId: string;
let revenueAccountId: string;

beforeAll(async () => {
	db = createDb(env.DB);
	// the pathless layout carries no path of its own, which is what makes the gate cover a screen
	// without adding a segment to its address.
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/donations', module: donations }
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
	// the auth tables are left alone: the session above is signed in once and every case here is
	// about gifts rather than about who is reading them.
	await env.DB.prepare('delete from payment').run();
	await env.DB.prepare('delete from donation').run();
	await env.DB.prepare('delete from recurring_plan').run();
	await env.DB.prepare('delete from contact').run();
	await env.DB.prepare('delete from form').run();
	await env.DB.prepare('delete from program').run();
	donorId = '019fb300-0000-7000-8000-000000000001';
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, attributes, created_at, updated_at)
		 values (?, 'individual', 'Ada Okafor', '{}', 0, 0)`
	)
		.bind(donorId)
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

/** one gift, written past drizzle: what this page reads is columns. */
async function gift(
	over: {
		id?: string;
		note?: string | null;
		receivedAt?: number;
		recurringId?: string | null;
		tributeKind?: string | null;
		tributeHonoree?: string | null;
		programId?: string | null;
	} = {}
) {
	const {
		id = '019fb300-0000-7000-8000-000000000002',
		note = null,
		receivedAt = Date.UTC(2026, 6, 4, 23, 30),
		recurringId = null,
		tributeKind = null,
		tributeHonoree = null,
		programId = null
	} = over;
	await env.DB.prepare(
		`insert into donation (id, contact_id, total_minor, currency, received_at, source, note,
		                       recurring_id, tribute_kind, tribute_honoree, program_id, created_at)
		 values (?, ?, 12345, 'USD', ?, 'Annual appeal', ?, ?, ?, ?, ?, 0)`
	)
		.bind(id, donorId, receivedAt, note, recurringId, tributeKind, tributeHonoree, programId)
		.run();
	return id;
}

/**
 * one settlement attempt against a gift, written past drizzle for the same reason `gift` is.
 *
 * `provider` is passed rather than defaulted, because the column being nullable is half of what
 * these cases are about: a gift no processor stands behind is a row with a rail and no provider.
 */
async function attempt(
	donationId: string,
	over: {
		id?: string;
		method?: string;
		provider?: string | null;
		status?: string;
	} = {}
) {
	const {
		id = '019fb300-0000-7000-8000-000000000009',
		method = 'card',
		provider = 'stripe',
		status = 'succeeded'
	} = over;
	await env.DB.prepare(
		`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
		                      provider, provider_txn_id, occurred_at, created_at)
		 values (?, ?, 12345, 'USD', 'inbound', ?, ?, ?, ?, 0, 0)`
	)
		.bind(id, donationId, method, status, provider, provider === null ? null : `txn_${id}`)
		.run();
}

/** the standing commitment a repeating charge is collected under, and the form it was made on. */
async function commitment() {
	const formId = 'frm_giftslistrepeat1';
	const id = '019fb300-0000-7000-8000-00000000000a';
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins, created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
	)
		.bind(formId, revenueAccountId)
		.run();
	await env.DB.prepare(
		`insert into recurring_plan (id, contact_id, form_id, amount_minor, currency, interval,
		                             status, provider, provider_subscription_id,
		                             provider_customer_id, started_at, next_charge_at, ended_at,
		                             created_at, updated_at)
		 values (?, ?, ?, 12345, 'USD', 'monthly', 'active', 'stripe', 'sub_giftslist1',
		         'cus_giftslist1', 0, null, null, 0, 0)`
	)
		.bind(id, donorId, formId)
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
	const response = await request(new Request(`${ORIGIN}/admin/donations`, { headers: { cookie } }));
	expect(response.status).toBe(200);
	return (await response.json()) as {
		donations: {
			id: string;
			donorName: string;
			amount: string;
			receivedOn: string;
			source: string | null;
			note: string | null;
			status: string;
			paidWith: string | null;
			repeating: boolean;
			tribute: { kind: string; honoree: string } | null;
			program: string | null;
		}[];
		limit: number;
		hasMore: boolean;
	};
}

describe('/admin/donations load', () => {
	it('formats the amount from the minor units the column holds', async () => {
		await gift();
		const { donations } = await runLoad();
		expect(donations[0]?.amount).toBe('$123.45');
	});

	it('formats the business date server-side, to the day', async () => {
		// an `Intl.DateTimeFormat` in the page would run once on the Worker and again in the
		// browser, in two different locales and time zones — a hydration mismatch as well as a lie
		// about whose "today" it is.
		await gift();
		const { donations } = await runLoad();
		expect(donations[0]?.receivedOn).toBe('2026-07-04');
	});

	it('hands the state over as a value, for the page to put a word to', async () => {
		// the word an operator reads is `DONATION_STATUS_LABELS` in `$lib/donations/statuses.ts`,
		// which a component may import — so the label is not built here. a state the page has no
		// word for is a type error rather than a blank on a screen.
		const id = await gift();
		const { donations } = await runLoad();
		expect(donations[0]?.status).toBe('pending');

		await env.DB.prepare(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status, occurred_at, created_at)
			 values ('019fb300-0000-7000-8000-000000000009', ?, 12345, 'USD', 'inbound', 'card', 'succeeded', 0, 0)`
		)
			.bind(id)
			.run();
		expect((await runLoad()).donations[0]?.status).toBe('completed');
	});

	it('carries the donor’s message through untouched', async () => {
		// stored and never shown is the defect this screen exists to close, and a truncated
		// message is the same defect with a nicer table.
		const message = 'In memory of my mother, who taught at the school for thirty years. '.repeat(4);
		await gift({ note: message });
		expect((await runLoad()).donations[0]?.note).toBe(message);
	});

	it('publishes nothing the page does not render', async () => {
		// a column reaches a browser by being selected. the projection is what stops the next one
		// added to `donation` from doing so by default.
		await gift();
		const [row] = (await runLoad()).donations;
		expect(Object.keys(row ?? {}).sort()).toEqual([
			'amount',
			'donorName',
			'id',
			'note',
			'paidWith',
			'program',
			'receivedOn',
			'repeating',
			'source',
			'status',
			'tribute'
		]);
	});

	it('hands the dedication over as a value, for the page to put the phrase to', async () => {
		// the kind and never the sentence. `TRIBUTE_KIND_LABELS` in `@better-giving/form/v1` is what
		// the page writes it out with — the same split `status` takes, and the reason a third kind
		// would be a type error there rather than a blank on a screen.
		await gift({ tributeKind: 'memory', tributeHonoree: 'Margaret Chen' });
		const [row] = (await runLoad()).donations;
		expect(row?.tribute).toEqual({ kind: 'memory', honoree: 'Margaret Chen' });
	});

	it('names the cause a gift was credited to, and never its id', async () => {
		const programId = '019fb300-0000-7000-8000-0000000000b1';
		await env.DB.prepare(
			`insert into program (id, name, status, created_at, updated_at)
			 values (?, 'Clean water', 'active', 0, 0)`
		)
			.bind(programId)
			.run();
		await gift({ programId });

		const loaded = await runLoad();
		expect(loaded.donations[0]?.program).toBe('Clean water');
		expect(JSON.stringify(loaded)).not.toContain(programId);
	});

	it('leaves a gift credited to no cause with no program', async () => {
		await gift();
		expect((await runLoad()).donations[0]?.program).toBeNull();
	});

	it('leaves a gift given for nobody with no dedication', async () => {
		await gift();
		expect((await runLoad()).donations[0]?.tribute).toBeNull();
	});

	it('never publishes who the donor asked us to tell', async () => {
		// the recipient is operational state, and the column that reports it —
		// `tribute_notified_at` — is written by nothing yet. it is a third party's address the donor
		// typed, and the donor is not who reads this screen.
		const id = await gift({ tributeKind: 'honor', tributeHonoree: 'Margaret Chen' });
		await env.DB.prepare(
			`update donation set tribute_notify_name = 'Iris Chen',
			                     tribute_notify_email = 'iris@example.org' where id = ?`
		)
			.bind(id)
			.run();

		const { donations } = await runLoad();
		// the honoree does cross on the same row, which is what makes the two absences a claim
		// about the projection rather than about an empty row.
		expect(donations[0]?.tribute?.honoree).toBe('Margaret Chen');
		expect(JSON.stringify(donations)).not.toContain('iris@example.org');
		expect(JSON.stringify(donations)).not.toContain('Iris Chen');
	});

	it('marks a charge collected under a standing commitment, and never sends its id', async () => {
		// the mark goes beside the figure rather than into Source, which is free text a staff member
		// typed: overloading it with a derived value would make one column mean two things. what
		// crosses is the fact, never `recurring_id` — an id nothing renders is a column reaching a
		// browser by accident.
		const plan = await commitment();
		await gift({ recurringId: plan });
		const [row] = (await runLoad()).donations;
		expect(row?.repeating).toBe(true);
		expect(JSON.stringify(row)).not.toContain(plan);
	});

	it('leaves a one-time gift unmarked', async () => {
		await gift();
		expect((await runLoad()).donations[0]?.repeating).toBe(false);
	});

	it('names the rail a card gift arrived on', async () => {
		// the word and not the value, unlike `status` above: the rail vocabulary is the `payment`
		// table's own and is declared in `$lib/server/db/schema.ts`, which a component may not
		// import — so the screen is handed what it prints.
		const id = await gift();
		await attempt(id);
		expect((await runLoad()).donations[0]?.paidWith).toBe('Card');
	});

	it('names a PayPal gift and a Venmo gift apart, on one page', async () => {
		// the pair the schema's two columns keep apart: Venmo is a rail PayPal settles, so both rows
		// carry `provider = 'paypal'`, and only `method` tells them apart. a screen reading the provider
		// would call a Venmo gift PayPal, which is a processor the donor never saw — and both on
		// one page is what makes that a difference the case can see.
		const paypal = await gift({
			id: '019fb300-0000-7000-8000-00000000000b',
			receivedAt: Date.UTC(2026, 6, 5)
		});
		await attempt(paypal, { id: '019fb300-0000-7000-8000-00000000000c', method: 'paypal' });
		const venmo = await gift({
			id: '019fb300-0000-7000-8000-00000000000d',
			receivedAt: Date.UTC(2026, 6, 4)
		});
		await attempt(venmo, {
			id: '019fb300-0000-7000-8000-00000000000e',
			method: 'venmo',
			provider: 'paypal'
		});

		// newest first, which is the order this list is read in.
		const { donations } = await runLoad();
		expect(donations.map((d) => d.paidWith)).toEqual(['PayPal', 'Venmo']);
	});

	it('never sends the processor that moved the money', async () => {
		// the narrowing that makes "no sentence names a processor that did not move the money"
		// structural rather than a copy review: nothing on this screen sends an operator to a
		// processor's dashboard, so the provider stops at the loader and cannot be printed by
		// anything downstream.
		const id = await gift();
		await attempt(id, { method: 'venmo', provider: 'paypal' });
		const { donations } = await runLoad();
		expect(donations[0]?.paidWith).toBe('Venmo');
		expect(JSON.stringify(donations)).not.toContain('paypal');
		expect(JSON.stringify(donations)).not.toContain('stripe');
	});

	it('names the rail alone on a gift no processor stands behind', async () => {
		// a cheque a staff member entered. `payment.provider` is nullable, and a rail with nothing
		// behind it is named by the rail — inventing a processor for it is worse than naming none.
		const id = await gift();
		await attempt(id, { method: 'check', provider: null });
		const { donations } = await runLoad();
		expect(donations[0]?.paidWith).toBe('Check');
		expect(JSON.stringify(donations)).not.toContain('manual');
	});

	it('leaves a gift nothing has been attempted on with no rail', async () => {
		// the quote is written with its own attempt, so this is a shape the app does not produce —
		// and the page draws the absence rather than a rail nobody used, the same as a cause.
		await gift();
		expect((await runLoad()).donations[0]?.paidWith).toBeNull();
	});

	it('reports the cap so the page can say the list is one', async () => {
		await gift();
		const { limit, hasMore } = await runLoad();
		expect(limit).toBeGreaterThan(0);
		expect(hasMore).toBe(false);
	});

	it('hands back an empty list on a deployment that has taken no gifts', async () => {
		const { donations, hasMore } = await runLoad();
		expect(donations).toEqual([]);
		expect(hasMore).toBe(false);
	});

	it('turns an anonymous caller away rather than listing anything', async () => {
		// the gate is on ./_app.tsx and this screen is under it, which is what puts it behind the
		// login — ../routes.spec.ts holds the other half, that the file is named so it nests there.
		await gift();
		const response = await request(new Request(`${ORIGIN}/admin/donations`));
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toContain('/login');
	});
});
