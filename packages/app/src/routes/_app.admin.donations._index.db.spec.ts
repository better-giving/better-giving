import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb, type Db } from '$lib/server/db/client';
import { TRACKING_ID_BUDGET_MS } from '$lib/server/donations/tracking-ids';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { finishSetup } from '../webhook-routes.testing';
import * as layout from './_app';
import * as donations from './_app.admin.donations._index';
import { client, first, run, stmt } from '$lib/server/db/database.testing';

// a db spec rather than a node one because every case here reads a row, and CLAUDE.md splits
// the pools by what a spec needs. the screen has no action: nothing on it writes.
//
// what is asserted here is the projection — what crosses to the browser and in what form — and not
// the read, which is `$lib/server/donations/queries.db.spec.ts`, nor the states, which are
// that module's node spec.
//
// the chain is mounted rather than the loader called, which is ../route-request.testing.ts's
// pattern: the session gate is a `middleware` on ./_app.tsx and the handle is on the request
// context, so a loader called on its own is a loader with the gate above it never run.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the deploy-time values that make Chariot a processor this deployment can call. */
const CHARIOT_CONFIGURED = {
	CHARIOT_API_KEY: 'notarealchariotkey',
	CHARIOT_API_URL: 'https://sandboxapi.givechariot.com'
};

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

let db: Db;
let request: RouteRequester;
let bindings: Env;
let cookie: string;
let donorId: string;
let revenueAccountId: string;

beforeAll(async () => {
	db = createDb(client);
	// the pathless layout carries no path of its own, which is what makes the gate cover a screen
	// without adding a segment to its address.
	bindings = await finishSetup(PASSWORD);
	const mounted = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/donations', module: donations }
	]);
	request = (incoming, options) => mounted(incoming, { env: bindings, ...options });
	cookie = await signIn();

	const row = await first<{ id: string }>(
		stmt(`select id from account where is_postable = 1 and code = '4110'`)
	);
	if (!row)
		throw new Error(
			'no 4110 account — has the chart of accounts in migrations/0000_initial_schema.sql moved?'
		);
	revenueAccountId = row.id;
});

beforeEach(async () => {
	// the auth tables are left alone: the session above is signed in once and every case here is
	// about gifts rather than about who is reading them.
	await run(stmt('delete from payment'));
	await run(stmt('delete from donation'));
	await run(stmt('delete from recurring_plan'));
	await run(stmt('delete from contact'));
	await run(stmt('delete from form'));
	await run(stmt('delete from program'));
	donorId = '019fb300-0000-7000-8000-000000000001';
	await run(
		stmt(
			`insert into contact (id, kind, display_name, attributes, created_at, updated_at)
		 values (?, 'individual', 'Ada Okafor', '{}', 0, 0)`,
			donorId
		)
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

/**
 * the finished deployment's bindings with a case's deploy-time values.
 */
function envWith(values: Record<string, string>): Env {
	return { ...bindings, ...values } as Env;
}

/**
 * Get Grant, answered by `answer` for every grant asked for, and the paths asked.
 *
 * `answer` returning a promise that never settles is Chariot hanging.
 */
function chariotAnswers(answer: (grantId: string) => Response | Promise<Response>): {
	readonly reads: string[];
} {
	const reads: string[] = [];
	vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		const path = new URL(request.url).pathname;
		reads.push(`${request.method} ${path}`);
		return answer(decodeURIComponent(path.split('/').at(-1) ?? ''));
	});
	return { reads };
}

/** a grant still on its way, as Get Grant answers it. */
function pendingGrant(id: string, trackingId: string) {
	return {
		id,
		workflowSessionId: 'cfe09e64-6a74-4dab-a565-361185a6f248',
		fundId: 'daf-id',
		amount: 12_300,
		trackingId,
		createdAt: '2026-09-14T12:00:00.000Z',
		updatedAt: '2026-09-14T12:00:00.000Z',
		status: 'Initiated'
	};
}

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
	await run(
		stmt(
			`insert into donation (id, contact_id, total_minor, currency, received_at, source, note,
		                       recurring_id, tribute_kind, tribute_honoree, program_id, created_at)
		 values (?, ?, 12345, 'USD', ?, 'Annual appeal', ?, ?, ?, ?, ?, 0)`,
			id,
			donorId,
			receivedAt,
			note,
			recurringId,
			tributeKind,
			tributeHonoree,
			programId
		)
	);
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
		coin?: string | null;
		coinAmount?: string | null;
		parentPaymentId?: string | null;
		providerReference?: string | null;
	} = {}
) {
	const {
		id = '019fb300-0000-7000-8000-000000000009',
		method = 'card',
		provider = 'stripe',
		status = 'succeeded',
		coin = null,
		coinAmount = null,
		parentPaymentId = null,
		providerReference = null
	} = over;
	await run(
		stmt(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
		                      provider, provider_txn_id, occurred_at, created_at, coin, coin_amount,
		                      parent_payment_id, provider_reference)
		 values (?, ?, 12345, 'USD', 'inbound', ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
			id,
			donationId,
			method,
			status,
			provider,
			provider === null ? null : `txn_${id}`,
			coin,
			coinAmount,
			parentPaymentId,
			providerReference
		)
	);
}

/** the standing commitment a repeating charge is collected under, and the form it was made on. */
async function commitment() {
	const formId = 'frm_giftslistrepeat1';
	const id = '019fb300-0000-7000-8000-00000000000a';
	await run(
		stmt(
			`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins, created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`,
			formId,
			revenueAccountId
		)
	);
	await run(
		stmt(
			`insert into recurring_plan (id, contact_id, form_id, amount_minor, currency, interval,
		                             status, provider, provider_subscription_id,
		                             provider_customer_id, started_at, next_charge_at, ended_at,
		                             created_at, updated_at)
		 values (?, ?, ?, 12345, 'USD', 'monthly', 'active', 'stripe', 'sub_giftslist1',
		         'cus_giftslist1', 0, null, null, 0, 0)`,
			id,
			donorId,
			formId
		)
	);
	return id;
}

/**
 * what the screen is handed, off one request through the chain the deployment serves it under.
 *
 * the loader returns a plain object, so ../route-request.testing.ts answers with it as json — the
 * same serialization a browser receives, which is what makes the key sweep below a claim about
 * what crosses rather than about what was constructed.
 */
async function runLoad(configEnv?: Env) {
	const response = await request(
		new Request(`${ORIGIN}/admin/donations`, { headers: { cookie } }),
		configEnv === undefined ? undefined : { env: configEnv }
	);
	expect(response.status).toBe(200);
	return (await response.json()) as {
		donations: {
			id: string;
			donorName: string;
			amount: string;
			receivedAt: string;
			timeZone?: 'UTC';
			source: string | null;
			note: string | null;
			status: string;
			paidWith: string | null;
			coinReceived?: string;
			repeating: boolean;
			tribute: { kind: string; honoree: string } | null;
			program: string | null;
			trackingId: string | null;
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

	it('crosses the received instant and leaves the day to the page', async () => {
		// the loader does not know the browser zone, so the instant crosses and the page formats
		// the day. a sliced UTC day is the defect: 23:30Z is already the next calendar day east of UTC.
		await gift();
		const { donations } = await runLoad();
		const row = donations[0];
		expect(row?.receivedAt).toBe('2026-07-04T23:30:00.000Z');
		expect(row).not.toHaveProperty('timeZone');
	});

	it('passes UTC on a cheque and no zone on a card at the same midnight', async () => {
		// the day an operator typed is stored as UTC midnight by `readAccountingDate` in
		// packages/app/src/lib/ledger/input-schema.ts, so a cheque crosses with `UTC`. a card at
		// that same midnight does not: the signal is the rail, not the clock.
		const cheque = await gift({
			id: '019fb300-0000-7000-8000-000000000021',
			receivedAt: Date.UTC(2026, 9, 22)
		});
		await attempt(cheque, {
			id: '019fb300-0000-7000-8000-000000000022',
			method: 'check',
			provider: null
		});
		const card = await gift({
			id: '019fb300-0000-7000-8000-000000000023',
			receivedAt: Date.UTC(2026, 9, 22)
		});
		await attempt(card, {
			id: '019fb300-0000-7000-8000-000000000024',
			method: 'card'
		});
		const { donations } = await runLoad();
		const chequeRow = donations.find((row) => row.id === cheque);
		const cardRow = donations.find((row) => row.id === card);
		expect(chequeRow?.receivedAt).toBe('2026-10-22T00:00:00.000Z');
		expect(chequeRow?.timeZone).toBe('UTC');
		expect(cardRow?.receivedAt).toBe('2026-10-22T00:00:00.000Z');
		expect(cardRow).not.toHaveProperty('timeZone');
	});

	it('hands the state over as a value, for the page to put a word to', async () => {
		// the word an operator reads is `DONATION_STATUS_LABELS` in `$lib/donations/statuses.ts`,
		// which a component may import — so the label is not built here. a state the page has no
		// word for is a type error rather than a blank on a screen.
		const id = await gift();
		const { donations } = await runLoad();
		expect(donations[0]?.status).toBe('pending');

		await run(
			stmt(
				`insert into payment (id, donation_id, amount_minor, currency, direction, method, status, occurred_at, created_at)
			 values ('019fb300-0000-7000-8000-000000000009', ?, 12345, 'USD', 'inbound', 'card', 'succeeded', 0, 0)`,
				id
			)
		);
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
			'receivedAt',
			'repeating',
			'source',
			'status',
			'trackingId',
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
		await run(
			stmt(
				`insert into program (id, name, status, created_at, updated_at)
			 values (?, 'Clean water', 'active', 0, 0)`,
				programId
			)
		);
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
		await run(
			stmt(
				`update donation set tribute_notify_name = 'Iris Chen',
			                     tribute_notify_email = 'iris@example.org' where id = ?`,
				id
			)
		);

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
		expect(donations[0]?.paidWith).toBe('Cheque');
		expect(JSON.stringify(donations)).not.toContain('manual');
	});

	it('names the coin and how much of it arrived beside a settled crypto gift', async () => {
		// the code and never a name off NOWPayments' coin list: the loader asks the processor nothing.
		const id = await gift();
		await attempt(id, {
			method: 'crypto',
			provider: 'nowpayments',
			coin: 'xrp',
			coinAmount: '19.36121163'
		});
		const [row] = (await runLoad()).donations;
		expect(row?.paidWith).toBe('Crypto');
		expect(row?.coinReceived).toBe('19.36121163 XRP');
	});

	it('names only the rail on a crypto gift still waiting on its deposit', async () => {
		const id = await gift();
		await attempt(id, {
			method: 'crypto',
			provider: 'nowpayments',
			status: 'pending',
			coin: 'xrp'
		});
		const [row] = (await runLoad()).donations;
		expect(row?.status).toBe('pending');
		expect(row?.paidWith).toBe('Crypto');
		expect(row).not.toHaveProperty('coinReceived');
	});

	it('lists a repeat deposit as a gift of its own, and never the payment it followed', async () => {
		const first = await gift({
			id: '019fb300-0000-7000-8000-00000000000b',
			receivedAt: Date.UTC(2026, 6, 4)
		});
		const firstPayment = '019fb300-0000-7000-8000-00000000000c';
		await attempt(first, {
			id: firstPayment,
			method: 'crypto',
			provider: 'nowpayments',
			coin: 'xrp',
			coinAmount: '19.36121163'
		});
		const repeat = await gift({
			id: '019fb300-0000-7000-8000-00000000000d',
			receivedAt: Date.UTC(2026, 6, 5)
		});
		await attempt(repeat, {
			id: '019fb300-0000-7000-8000-00000000000e',
			method: 'crypto',
			provider: 'nowpayments',
			coin: 'xrp',
			coinAmount: '2.5',
			parentPaymentId: firstPayment
		});

		const { donations } = await runLoad();
		expect(donations.map((d) => [d.id, d.coinReceived])).toEqual([
			[repeat, '2.5 XRP'],
			[first, '19.36121163 XRP']
		]);
		expect(JSON.stringify(donations)).not.toContain(firstPayment);
	});

	it('leaves the coin row out of a card gift', async () => {
		const id = await gift();
		await attempt(id);
		expect((await runLoad()).donations[0]).not.toHaveProperty('coinReceived');
	});

	it('leaves a gift nothing has been attempted on with no rail', async () => {
		// the quote is written with its own attempt, so this is a shape the app does not produce —
		// and the page draws the absence rather than a rail nobody used, the same as a cause.
		await gift();
		expect((await runLoad()).donations[0]?.paidWith).toBeNull();
	});

	it('reads the tracking id of a grant still on its way from Chariot, where none is stored', async () => {
		// the organisation marks a grant received in Chariot's dashboard, matching the fund's payment
		// by this id. a grant written before the id was stored is asked about live.
		const id = await gift();
		await attempt(id, { method: 'daf', provider: 'chariot', status: 'pending' });
		const { reads } = chariotAnswers((grantId) =>
			Response.json(pendingGrant(grantId, 'L9E182VBGP'))
		);

		const { donations } = await runLoad(envWith(CHARIOT_CONFIGURED));
		expect(donations[0]?.trackingId).toBe('L9E182VBGP');
		expect(reads).toEqual(['GET /v1/grants/txn_019fb300-0000-7000-8000-000000000009']);
	});

	it('draws the page without the id when Chariot refuses', async () => {
		const id = await gift();
		await attempt(id, { method: 'daf', provider: 'chariot', status: 'pending' });
		chariotAnswers(() => Response.json({ title: 'Internal Server Error' }, { status: 500 }));

		const { donations } = await runLoad(envWith(CHARIOT_CONFIGURED));
		expect(donations[0]?.status).toBe('pending');
		expect(donations[0]?.trackingId).toBeNull();
	});

	it('draws the page without the id when Chariot does not answer in time', async () => {
		const id = await gift();
		await attempt(id, { method: 'daf', provider: 'chariot', status: 'pending' });
		chariotAnswers(() => new Promise<Response>(() => {}));
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

		const loading = runLoad(envWith(CHARIOT_CONFIGURED));
		await vi.waitUntil(() => vi.getTimerCount() > 0);
		await vi.advanceTimersByTimeAsync(TRACKING_ID_BUDGET_MS);
		const { donations } = await loading;
		expect(donations[0]?.trackingId).toBeNull();
	});

	it('asks Chariot nothing about a gift that is not a grant still on its way', async () => {
		const card = await gift({ id: '019fb300-0000-7000-8000-00000000000b' });
		await attempt(card, { id: '019fb300-0000-7000-8000-00000000000c', status: 'pending' });
		const received = await gift({ id: '019fb300-0000-7000-8000-00000000000d' });
		await attempt(received, {
			id: '019fb300-0000-7000-8000-00000000000e',
			method: 'daf',
			provider: 'chariot'
		});
		const { reads } = chariotAnswers((grantId) =>
			Response.json(pendingGrant(grantId, 'L9E182VBGP'))
		);

		const { donations } = await runLoad(envWith(CHARIOT_CONFIGURED));
		expect(reads).toEqual([]);
		expect(donations.map((d) => d.trackingId)).toEqual([null, null]);
	});

	it('draws the tracking id stored on a grant that has settled', async () => {
		const id = await gift();
		await attempt(id, { method: 'daf', provider: 'chariot', providerReference: 'L9E182VBGP' });

		const { donations } = await runLoad();
		expect(donations[0]?.trackingId).toBe('L9E182VBGP');
	});

	it('draws the tracking id stored on a grant still on its way, asking Chariot nothing', async () => {
		const id = await gift();
		await attempt(id, {
			method: 'daf',
			provider: 'chariot',
			status: 'pending',
			providerReference: 'L9E182VBGP'
		});
		const { reads } = chariotAnswers((grantId) =>
			Response.json(pendingGrant(grantId, 'LIVEANSWER'))
		);

		const { donations } = await runLoad(envWith(CHARIOT_CONFIGURED));
		expect(reads).toEqual([]);
		expect(donations[0]?.trackingId).toBe('L9E182VBGP');
	});

	it('draws no tracking id on a gift Chariot did not move, whatever its payment stores', async () => {
		const id = await gift();
		await attempt(id, { providerReference: 'ch_reference' });

		const { donations } = await runLoad();
		expect(donations[0]?.trackingId).toBeNull();
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
