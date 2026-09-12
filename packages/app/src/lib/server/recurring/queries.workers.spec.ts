import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RecurringPlanStatus } from '$lib/recurring/statuses';
import { createDb, type Db } from '../db/client';
import {
	listRecurringPlans,
	readActiveRecurringCount,
	readRecurringPlan,
	RECURRING_LIST_LIMIT,
	stopRecurringPlan
} from './queries';

// real D1 inside workerd, over the committed migrations — so the check constraints and the
// `recurring_plan_ended_at_check` these rows have to satisfy are the deployed ones.

let db: Db;
let revenueAccountId: string;

const FORM_ID = 'frm_recurringqueries1';
const DONOR_ID = '019fb400-0000-7000-8000-000000000001';

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

let minted = 0;

/**
 * one commitment, written past drizzle: what these reads take is columns, and a fixture going
 * through the query that reads them would be testing itself.
 *
 * `ended_at` follows `status` rather than being asked for, because `recurring_plan_ended_at_check`
 * refuses the two disagreeing — a fixture able to spell that state is one that fails at insert
 * with nothing about the read under test.
 */
async function plan(
	over: {
		id?: string;
		contactId?: string;
		status?: RecurringPlanStatus;
		amountMinor?: number;
		interval?: 'monthly' | 'yearly';
		startedAt?: number;
		nextChargeAt?: number | null;
	} = {}
): Promise<string> {
	minted += 1;
	const {
		id = `019fb400-0000-7000-8000-${String(minted).padStart(12, '0')}`,
		contactId = DONOR_ID,
		status = 'active',
		amountMinor = 2500,
		interval = 'monthly',
		startedAt = Date.UTC(2026, 5, 1),
		nextChargeAt = Date.UTC(2026, 8, 4)
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
			startedAt,
			nextChargeAt,
			status === 'active' ? null : Date.UTC(2026, 6, 1)
		)
		.run();
	return id;
}

describe('listRecurringPlans', () => {
	it('carries the donor’s name and email beside the commitment', async () => {
		// the screen's whole job is finding the person who wrote in, so the two things that
		// identify them travel with the row rather than being looked up per record.
		const id = await plan();
		const { plans } = await listRecurringPlans(db);
		expect(plans).toEqual([
			{
				id,
				donorName: 'Ada Okafor',
				donorEmail: 'ada@example.org',
				amountMinor: 2500,
				currency: 'USD',
				interval: 'monthly',
				status: 'active',
				nextChargeAt: new Date(Date.UTC(2026, 8, 4))
			}
		]);
	});

	it('carries a null next charge through rather than standing something in for it', async () => {
		// null means "none expected", which covers an ended commitment and one the rail has not
		// spoken about — two different sentences on the screen, and neither is reachable from a
		// value this read chose.
		await plan({ nextChargeAt: null });
		expect((await listRecurringPlans(db)).plans[0]?.nextChargeAt).toBeNull();
	});

	it('carries a donor with no email address as `null`, keeping the row', async () => {
		// `primary_email` is nullable and the console's own create form writes a donor without one,
		// so this is an ordinary row rather than an edge. the screen draws the absence as a state;
		// what it must never do is lose the commitment over it.
		const donorWithNoEmail = '019fb400-0000-7000-8000-0000000000ff';
		await env.DB.prepare(
			`insert into contact (id, kind, display_name, created_at, updated_at)
			 values (?, 'individual', 'Grace Mensah', 0, 0)`
		)
			.bind(donorWithNoEmail)
			.run();
		await plan({ contactId: donorWithNoEmail });
		const { plans } = await listRecurringPlans(db);
		expect(plans[0]?.donorName).toBe('Grace Mensah');
		expect(plans[0]?.donorEmail).toBeNull();
	});

	it('hands back an empty list on a deployment nobody has committed to', async () => {
		const { plans, hasMore } = await listRecurringPlans(db);
		expect(plans).toEqual([]);
		expect(hasMore).toBe(false);
	});

	it('reads the ones that can still be acted on first: active, then payment-failed, then stopped', async () => {
		// not newest-first like the other two lists, and the reason is the job: only the first two
		// statuses have a control on them, so status-first is what keeps the rows the cap keeps the
		// rows an operator can do something about.
		const stopped = await plan({ status: 'cancelled' });
		const failed = await plan({ status: 'lapsed' });
		const collecting = await plan({ status: 'active' });
		const { plans } = await listRecurringPlans(db);
		expect(plans.map((row) => row.id)).toEqual([collecting, failed, stopped]);
	});

	it('reads newest first inside one status, and breaks a tie by id', async () => {
		// `started_at` is Unix ms, so two commitments opened in one `batch()` tie on it — without
		// the tiebreak the list reshuffles between loads with nothing on the screen having changed.
		const startedAt = Date.UTC(2026, 5, 1);
		const older = await plan({ startedAt: Date.UTC(2026, 4, 1) });
		const tiedFirst = await plan({ startedAt });
		const tiedSecond = await plan({ startedAt });
		const { plans } = await listRecurringPlans(db);
		expect(plans.map((row) => row.id)).toEqual([tiedSecond, tiedFirst, older]);
	});

	it('caps the page and says so through a probe row rather than a full page', async () => {
		// `plans.length >= RECURRING_LIST_LIMIT` is wrong at exactly one number — the one a
		// deployment sits on while "only the first 50 are shown" is a lie about its own books.
		for (let n = 0; n < RECURRING_LIST_LIMIT; n += 1) await plan();
		expect((await listRecurringPlans(db)).hasMore).toBe(false);
		await plan();
		const { plans, hasMore } = await listRecurringPlans(db);
		expect(plans).toHaveLength(RECURRING_LIST_LIMIT);
		expect(hasMore).toBe(true);
	});
});

describe('readRecurringPlan', () => {
	it('reads the one commitment, with what the detail screen and the stop both need', async () => {
		// the subscription id is on this row because the stop names it, the processor because the
		// stop picks the adapter to cancel with off it, and the form id because the screen links to
		// the form rather than to the fund — the fund is read off the form at the moment each charge
		// settles, so a fund stated here would be today's answer over a series whose earlier charges
		// posted somewhere else.
		const id = await plan();
		expect(await readRecurringPlan(db, id)).toEqual({
			id,
			contactId: DONOR_ID,
			formId: FORM_ID,
			amountMinor: 2500,
			currency: 'USD',
			interval: 'monthly',
			status: 'active',
			provider: 'stripe',
			providerSubscriptionId: `sub_${id}`,
			startedAt: new Date(Date.UTC(2026, 5, 1)),
			nextChargeAt: new Date(Date.UTC(2026, 8, 4)),
			endedAt: null
		});
	});

	it('answers null for an id no commitment carries rather than throwing', async () => {
		expect(await readRecurringPlan(db, crypto.randomUUID())).toBeNull();
	});

	it('reads a stopped commitment, and says when it stopped', async () => {
		// a stopped commitment is a record rather than a 404: the screen it renders is the one a
		// staff member opens to check that the thing they were asked to stop is stopped.
		const id = await plan({ status: 'cancelled' });
		const record = await readRecurringPlan(db, id);
		expect(record?.status).toBe('cancelled');
		expect(record?.endedAt).toEqual(new Date(Date.UTC(2026, 6, 1)));
	});
});

describe('stopRecurringPlan', () => {
	it('marks an active commitment stopped, dated, and expecting nothing further', async () => {
		const id = await plan();
		const endedAt = new Date(Date.UTC(2026, 7, 10, 9, 30));
		expect(await stopRecurringPlan(db, id, endedAt)).toBe(true);
		const record = await readRecurringPlan(db, id);
		expect(record?.status).toBe('cancelled');
		expect(record?.endedAt).toEqual(endedAt);
		// cleared, because null means "none expected" and a date left behind would be this
		// deployment saying a stopped commitment is due to charge.
		expect(record?.nextChargeAt).toBeNull();
	});

	it('stops a payment-failed commitment and keeps the date collection really ended', async () => {
		// `ended_at` means when collection ended, which for a lapsed commitment is when the rail
		// gave up rather than when a person pressed the button. overwriting it would lose the only
		// record of that, and the row label says `Stopped collecting` for exactly this reason.
		const id = await plan({ status: 'lapsed' });
		const lapsedOn = (await readRecurringPlan(db, id))?.endedAt;
		expect(await stopRecurringPlan(db, id, new Date(Date.UTC(2026, 7, 10)))).toBe(true);
		const record = await readRecurringPlan(db, id);
		expect(record?.status).toBe('cancelled');
		expect(record?.endedAt).toEqual(lapsedOn);
	});

	it('writes nothing over a commitment that is already stopped, and says so', async () => {
		// a double press or a stale tab. refusing it is what keeps `ended_at` from being
		// overwritten — the same reason `archiveForm` refuses a form that is already archived.
		const id = await plan({ status: 'cancelled' });
		const before = await readRecurringPlan(db, id);
		expect(await stopRecurringPlan(db, id, new Date(Date.UTC(2026, 7, 10)))).toBe(false);
		expect(await readRecurringPlan(db, id)).toEqual(before);
	});

	it('answers false for an id no commitment carries', async () => {
		expect(await stopRecurringPlan(db, crypto.randomUUID(), new Date())).toBe(false);
	});
});

describe('readActiveRecurringCount', () => {
	it('counts the commitments still collecting and no others', async () => {
		// `active` and nothing else. a cancelled or lapsed commitment is one that is not collecting
		// now, so a dashboard counting either would state a figure for money that is not coming —
		// which is the same reading the donor file's recurring view takes (../contacts/queries.ts,
		// at `activeCommitment`).
		await plan({ status: 'active' });
		await plan({ status: 'active' });
		await plan({ status: 'cancelled' });
		await plan({ status: 'lapsed' });

		expect(await readActiveRecurringCount(db)).toBe(2);
	});

	it('reads a deployment holding none as nought', async () => {
		// a `count()` over no rows is zero rather than null, and the figure a screen states is a
		// nought rather than a blank.
		expect(await readActiveRecurringCount(db)).toBe(0);
	});
});
