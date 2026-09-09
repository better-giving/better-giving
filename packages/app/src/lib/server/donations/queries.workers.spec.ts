import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { DONATION_LIST_LIMIT, listDonations, readGiftsByMonth } from './queries';

// the gifts list, against a real D1 over the committed migrations.
//
// what this file holds and ./queries.spec.ts does not: the ordering, the cap and its probe row,
// the donor's name arriving with the gift, and the note surviving the round trip. the states
// themselves are asserted there, over rows written by hand — a fixture cannot produce every shape
// the projection has to answer for, and the one case that crosses over is here to prove the read
// hands the projection the rows it needs at all.
//
// fixtures are written past drizzle on purpose: what this page reads is columns, and a fixture
// going through the module that reads them would be testing itself.

let db: Db;

let revenueAccountId: string;

beforeAll(async () => {
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

beforeEach(async () => {
	// children first — every FK in this schema is `NO ACTION`.
	await env.DB.prepare('delete from payment').run();
	await env.DB.prepare('delete from donation').run();
	await env.DB.prepare('delete from recurring_plan').run();
	await env.DB.prepare('delete from contact').run();
	await env.DB.prepare('delete from form').run();
	await env.DB.prepare('delete from program').run();
});

let sequence = 0;

/** an id in the shape the app mints, ordered by the counter so a case can rely on it. */
function nextId(): string {
	sequence += 1;
	return `019fb200-0000-7000-8000-${String(sequence).padStart(12, '0')}`;
}

/** a donor, named, with the consent answer left unasked. */
async function donor(displayName: string): Promise<string> {
	const id = nextId();
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, attributes, created_at, updated_at)
		 values (?, 'individual', ?, '{}', 0, 0)`
	)
		.bind(id, displayName)
		.run();
	return id;
}

type GiftOptions = {
	receivedAt?: number;
	totalMinor?: number;
	note?: string | null;
	source?: string | null;
	id?: string;
	recurringId?: string | null;
	tributeKind?: string | null;
	tributeHonoree?: string | null;
	programId?: string | null;
};

/**
 * a standing commitment for this donor, and the form it was made on.
 *
 * the form is here because `recurring_plan.form_id` is NOT NULL — a commitment with no form would
 * have nowhere to post anything after the browser that made it had gone.
 */
async function commitment(contactId: string): Promise<string> {
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
		 values (?, ?, ?, 2500, 'USD', 'monthly', 'active', 'stripe', ?, ?, 0, null, null, 0, 0)`
	)
		.bind(id, contactId, formId, `sub_${id}`, `cus_${id}`)
		.run();
	return id;
}

/** one gift, with no settlement attempt on it yet. */
async function gift(contactId: string, over: GiftOptions = {}): Promise<string> {
	const {
		receivedAt = 1_700_000_000_000,
		totalMinor = 10_000,
		note = null,
		source = null,
		id = nextId(),
		recurringId = null,
		tributeKind = null,
		tributeHonoree = null,
		programId = null
	} = over;
	await env.DB.prepare(
		`insert into donation (id, contact_id, total_minor, currency, received_at, source, note,
		                       recurring_id, tribute_kind, tribute_honoree, program_id, created_at)
		 values (?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, 0)`
	)
		.bind(
			id,
			contactId,
			totalMinor,
			receivedAt,
			source,
			note,
			recurringId,
			tributeKind,
			tributeHonoree,
			programId
		)
		.run();
	return id;
}

/** one settlement attempt against a gift. */
async function attempt(
	donationId: string,
	direction: 'inbound' | 'refund',
	status: 'pending' | 'succeeded' | 'failed' | 'cancelled',
	occurredAt: number,
	amountMinor = 10_000
): Promise<void> {
	await env.DB.prepare(
		`insert into payment (id, donation_id, amount_minor, currency, direction, method, status, occurred_at, created_at)
		 values (?, ?, ?, 'USD', ?, 'card', ?, ?, 0)`
	)
		.bind(nextId(), donationId, amountMinor, direction, status, occurredAt)
		.run();
}

describe('the gifts list', () => {
	it('names the donor on every gift', async () => {
		// a list that identified gifts only by uuid is not a screen a fundraiser can use.
		const ada = await donor('Ada Okafor');
		await gift(ada);

		const { donations } = await listDonations(db);
		expect(donations.map((d) => d.donorName)).toEqual(['Ada Okafor']);
	});

	it('lists gifts by business date, newest first', async () => {
		const ada = await donor('Ada Okafor');
		const older = await gift(ada, { receivedAt: 1_000 });
		const newer = await gift(ada, { receivedAt: 2_000 });

		const { donations } = await listDonations(db);
		expect(donations.map((d) => d.id)).toEqual([newer, older]);
	});

	it('breaks a tie on the business date by id, so the order never reshuffles', async () => {
		// `received_at` is Unix ms, so two gifts entered in one request tie on it — and an
		// unordered list is one that comes back differently on the next load.
		const ada = await donor('Ada Okafor');
		const first = await gift(ada, { receivedAt: 5_000 });
		const second = await gift(ada, { receivedAt: 5_000 });

		const { donations } = await listDonations(db);
		expect(donations.map((d) => d.id)).toEqual([second, first]);
	});

	it('hands the note over whole', async () => {
		// the donor wrote it to be read. it is stored, so a list that dropped it would be the
		// same loss the missing column was, moved one step later.
		const message = 'In memory of my mother, who taught at the school for thirty years.';
		const ada = await donor('Ada Okafor');
		await gift(ada, { note: message });

		const { donations } = await listDonations(db);
		expect(donations[0]?.note).toBe(message);
	});

	it('projects the state from the gift’s own attempts', async () => {
		// the read's half of the projection: the right `payment` rows reach it, keyed to the right
		// gift. which state each shape of rows produces is ./queries.spec.ts.
		const ada = await donor('Ada Okafor');
		const retried = await gift(ada, { receivedAt: 2_000 });
		const untouched = await gift(ada, { receivedAt: 1_000 });
		await attempt(retried, 'inbound', 'failed', 100);
		await attempt(retried, 'inbound', 'succeeded', 200);

		const { donations } = await listDonations(db);
		expect(donations.map((d) => [d.id, d.status])).toEqual([
			[retried, 'completed'],
			[untouched, 'pending']
		]);
	});

	it('caps the page and says nothing was hidden when it is exactly full', async () => {
		const ada = await donor('Ada Okafor');
		for (let i = 0; i < DONATION_LIST_LIMIT; i += 1) await gift(ada, { receivedAt: i });

		const { donations, hasMore } = await listDonations(db);
		expect(donations).toHaveLength(DONATION_LIST_LIMIT);
		expect(hasMore).toBe(false);
	});

	it('reports the one gift past the cap without ever returning it', async () => {
		// the probe row is the whole of `hasMore`, and it never leaves the module: a page that
		// rendered `DONATION_LIST_LIMIT + 1` rows would be one that forgot to slice.
		const ada = await donor('Ada Okafor');
		for (let i = 0; i <= DONATION_LIST_LIMIT; i += 1) await gift(ada, { receivedAt: i });

		const { donations, hasMore } = await listDonations(db);
		expect(donations).toHaveLength(DONATION_LIST_LIMIT);
		expect(hasMore).toBe(true);
	});

	it('says a charge came from a standing commitment, without publishing which one', async () => {
		// a boolean and never the id: an id in a browser payload that nothing renders is a column
		// reaching a browser by accident, which the projection exists to prevent. what the screen
		// needs is the fact, beside the figure.
		const ada = await donor('Ada Okafor');
		const plan = await commitment(ada);
		const collected = await gift(ada, { receivedAt: 2_000, recurringId: plan });
		const oneOff = await gift(ada, { receivedAt: 1_000 });

		const { donations } = await listDonations(db);
		expect(donations.map((d) => [d.id, d.repeating])).toEqual([
			[collected, true],
			[oneOff, false]
		]);
		expect(Object.keys(donations[0] ?? {})).not.toContain('recurringId');
	});

	it('brings the dedication back off the gift’s own columns', async () => {
		// the read's half: the two columns are selected and reach the projection paired. which
		// stored values become a dedication and which become none is ./queries.spec.ts.
		const ada = await donor('Ada Okafor');
		await gift(ada, { tributeKind: 'memory', tributeHonoree: 'Margaret Chen' });

		const { donations } = await listDonations(db);
		expect(donations[0]?.tribute).toEqual({ kind: 'memory', honoree: 'Margaret Chen' });
	});

	it('never carries the person the donor asked us to tell', async () => {
		// that pair is operational state the notification owns, and the column reporting it —
		// `tribute_notified_at` — is written by nothing yet. a third party's name and address
		// reaching a browser is a column selected for no screen.
		const ada = await donor('Ada Okafor');
		const id = await gift(ada, { tributeKind: 'honor', tributeHonoree: 'Margaret Chen' });
		await env.DB.prepare(
			`update donation set tribute_notify_name = 'Iris Chen',
			                     tribute_notify_email = 'iris@example.org' where id = ?`
		)
			.bind(id)
			.run();

		const { donations } = await listDonations(db);
		// the honoree is on the same row and does cross, which is what makes the two absences below
		// a claim about the projection rather than about the row being empty.
		expect(donations[0]?.tribute?.honoree).toBe('Margaret Chen');
		expect(JSON.stringify(donations)).not.toContain('iris@example.org');
		expect(JSON.stringify(donations)).not.toContain('Iris Chen');
	});

	it('names the cause a gift was credited to', async () => {
		// the name and not `program_id`: a pointer in a browser payload is a column reaching a
		// browser for no screen, which is what the projection exists to stop.
		const programId = nextId();
		await env.DB.prepare(
			`insert into program (id, name, status, created_at, updated_at)
			 values (?, 'Clean water', 'active', 0, 0)`
		)
			.bind(programId)
			.run();
		const ada = await donor('Ada Okafor');
		await gift(ada, { programId });

		const { donations } = await listDonations(db);
		expect(donations[0]?.programName).toBe('Clean water');
		expect(JSON.stringify(donations)).not.toContain(programId);
	});

	// the join is left, because a gift credited to no cause is the ordinary one — an inner join
	// would drop every gift this deployment has taken.
	it('names none for a gift credited to no cause', async () => {
		const ada = await donor('Ada Okafor');
		await gift(ada);

		const { donations } = await listDonations(db);
		expect(donations).toHaveLength(1);
		expect(donations[0]?.programName).toBeNull();
	});

	it('hands back an empty page on a deployment that has taken no gifts', async () => {
		const { donations, hasMore } = await listDonations(db);
		expect(donations).toEqual([]);
		expect(hasMore).toBe(false);
	});
});

describe('readGiftsByMonth()', () => {
	it('counts a gift in the month its money first moved, and only the once', async () => {
		// the month is the first *settled* inbound attempt's business time, which is the rule
		// `readDonorSummary` in ../contacts/queries.ts applies to a donor. a gift retried across a
		// month boundary is one gift in the month it collected in — counting the row again for the
		// second attempt would state more gifts than the deployment has taken.
		const ada = await donor('Ada Okafor');
		const first = await gift(ada);
		await attempt(first, 'inbound', 'failed', Date.UTC(2026, 7, 20));
		await attempt(first, 'inbound', 'succeeded', Date.UTC(2026, 8, 2));
		await attempt(first, 'inbound', 'succeeded', Date.UTC(2026, 9, 2));

		expect(await readGiftsByMonth(db)).toEqual([{ month: '2026-09', gifts: 1 }]);
	});

	it('counts nothing for a gift whose only attempt is still pending', async () => {
		// a gift with no succeeded attempt has taken no money, and a headline counting it would
		// state a month's giving off the strength of an intention.
		const ada = await donor('Ada Okafor');
		await attempt(await gift(ada), 'inbound', 'pending', Date.UTC(2026, 8, 2));

		expect(await readGiftsByMonth(db)).toEqual([]);
	});

	it('buckets on business time to the millisecond, and never on the gift’s own', async () => {
		// `received_at` is when the gift was made and `occurred_at` when the money moved. every
		// fixture here was received at one fixed instant, so a read grouping on the gift's column
		// would put both in one month.
		const ada = await donor('Ada Okafor');
		await attempt(await gift(ada), 'inbound', 'succeeded', Date.UTC(2026, 8, 1) - 1);
		await attempt(await gift(ada), 'inbound', 'succeeded', Date.UTC(2026, 8, 1));

		expect(await readGiftsByMonth(db)).toEqual([
			{ month: '2026-08', gifts: 1 },
			{ month: '2026-09', gifts: 1 }
		]);
	});
});
