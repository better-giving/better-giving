import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RecurringPlanStatus } from '$lib/recurring/statuses';
import { createDb, type Db } from '../db/client';
import type { PaymentProviderName } from '../db/schema';
import type {
	PaymentProvider,
	PaymentResult,
	ProcessorName,
	RecurringGiftEnd
} from '../payments/provider';
import { readRecurringPlan } from './queries';
import { soleProcessor } from '../payments/processors.testing';
import { stopRecurringGift } from './stop';

// a workers spec because every case here reads or writes a row, and the ordering this module owns
// is only true against a real one: "Stripe refused, so nothing was written" is a claim about the
// row after the call.
//
// the provider is the seam and it is a value, which is the arrangement
// ../payments/recurring-provision.spec.ts is written under — the route builds its provider from a
// request's `platform.env`, so a case wanting a cancel that succeeds could otherwise only get one
// by standing in for the whole platform. D1 is never stood in for (CLAUDE.md); the port is.

let db: Db;
let revenueAccountId: string;

const FORM_ID = 'frm_recurringstop1';
const DONOR_ID = '019fb500-0000-7000-8000-000000000001';
const PLAN_ID = '019fb500-0000-7000-8000-000000000002';
const SUBSCRIPTION_ID = 'sub_stoptest1';

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

/**
 * the commitment a case acts on, written past drizzle.
 *
 * `provider` is a parameter because the column is: a commitment lives on whichever processor
 * collected its first charge, and what this act names in a refusal is that column and never a name
 * the caller supplied.
 */
async function plan(
	status: RecurringPlanStatus = 'active',
	provider: PaymentProviderName = 'stripe'
): Promise<void> {
	await env.DB.prepare(
		`insert into recurring_plan (id, contact_id, form_id, amount_minor, currency, interval,
		                             status, provider, provider_subscription_id,
		                             provider_customer_id, started_at, next_charge_at, ended_at,
		                             created_at, updated_at)
		 values (?, ?, ?, 2500, 'USD', 'monthly', ?, ?, ?, 'cus_stoptest1', ?, ?, ?, 0, 0)`
	)
		.bind(
			PLAN_ID,
			DONOR_ID,
			FORM_ID,
			status,
			provider,
			SUBSCRIPTION_ID,
			Date.UTC(2026, 5, 1),
			Date.UTC(2026, 8, 4),
			status === 'active' ? null : Date.UTC(2026, 6, 1)
		)
		.run();
}

const STOPPED_AT = new Date(Date.UTC(2026, 7, 10, 9, 30));

/** what the port answers when the processor stopped the commitment. */
const ended = (over: Partial<RecurringGiftEnd> = {}): PaymentResult<RecurringGiftEnd> => ({
	ok: true,
	value: { providerGiftId: SUBSCRIPTION_ID, endedAt: STOPPED_AT, ...over }
});

/**
 * a port whose cancel answers from a script and whose every other arm fails by name.
 *
 * the arms this act must not reach throw rather than answering, which is what pins the claim:
 * stopping a gift reads no processor state and provisions nothing, so a call to any of them is a
 * defect this file names rather than a difference nobody notices.
 *
 * `called` is what the cases about ordering read — "the row was already stopped, so Stripe was
 * never asked" is a claim about a call that did not happen.
 */
function port(
	answer: PaymentResult<RecurringGiftEnd>,
	processor: ProcessorName = 'stripe'
): PaymentProvider & { called: string[] } {
	const called: string[] = [];
	const unused = (name: string) => () => {
		throw new Error(`${name} is not part of stopping a repeating gift`);
	};
	return {
		processor,
		called,
		async cancelRecurringGift(providerGiftId: string) {
			called.push(providerGiftId);
			return answer;
		},
		prepareRecurringGifts: unused('prepareRecurringGifts'),
		readRecurringGiftProvision: unused('readRecurringGiftProvision'),
		createRecurringGift: unused('createRecurringGift'),
		createIntent: unused('createIntent'),
		verifyEvent: unused('verifyEvent'),
		readSettlement: unused('readSettlement'),
		readRecurringGift: unused('readRecurringGift'),
		readAccountChargeability: unused('readAccountChargeability'),
		readRailSwitchboard: unused('readRailSwitchboard'),
		listWebhookEndpoints: unused('listWebhookEndpoints'),
		registerWebhookEndpoint: unused('registerWebhookEndpoint'),
		resubscribeWebhookEndpoint: unused('resubscribeWebhookEndpoint'),
		replaceWebhookEndpoint: unused('replaceWebhookEndpoint'),
		listWalletDomains: unused('listWalletDomains'),
		registerWalletDomain: unused('registerWalletDomain')
	};
}

describe('stopRecurringGift', () => {
	it('asks the processor by the subscription id on the row, then records the end', async () => {
		await plan();
		const processor = port(ended());
		expect(await stopRecurringGift(db, soleProcessor(processor), PLAN_ID)).toEqual({
			outcome: 'stopped'
		});
		expect(processor.called).toEqual([SUBSCRIPTION_ID]);
		const record = await readRecurringPlan(db, PLAN_ID);
		expect(record?.status).toBe('cancelled');
		expect(record?.endedAt).toEqual(STOPPED_AT);
		expect(record?.nextChargeAt).toBeNull();
	});

	it('says a commitment it cannot find is gone, and asks the processor nothing', async () => {
		const processor = port(ended());
		expect(await stopRecurringGift(db, soleProcessor(processor), crypto.randomUUID())).toEqual({
			outcome: 'gone'
		});
		expect(processor.called).toEqual([]);
	});

	it('refuses a commitment that is already stopped without calling the processor', async () => {
		// the order is the point rather than the answer: a double press or a stale tab must not
		// reach Stripe at all, and refusing before the call is what keeps `ended_at` from being
		// overwritten by a second attempt.
		await plan('cancelled');
		const processor = port(ended());
		const before = await readRecurringPlan(db, PLAN_ID);
		expect(await stopRecurringGift(db, soleProcessor(processor), PLAN_ID)).toEqual({
			outcome: 'already-stopped'
		});
		expect(processor.called).toEqual([]);
		expect(await readRecurringPlan(db, PLAN_ID)).toEqual(before);
	});

	it('writes nothing when the processor refuses, and says whether trying again is worth anything', async () => {
		// nothing is written on this arm, and that is the whole reason the call comes before the
		// write: a row marked stopped over a subscription Stripe is still collecting on is a
		// dashboard that says a donor was let go while their card keeps being charged.
		await plan();
		const processor = port({
			ok: false,
			reason: 'unreachable',
			detail: 'Stripe did not answer in time.'
		});
		expect(await stopRecurringGift(db, soleProcessor(processor), PLAN_ID)).toEqual({
			outcome: 'refused',
			retryable: true,
			detail: 'Stripe did not answer in time.',
			processor: 'stripe'
		});
		expect((await readRecurringPlan(db, PLAN_ID))?.status).toBe('active');
	});

	it('reports a terminal refusal as one, so the screen does not offer another attempt', async () => {
		await plan();
		const processor = port({
			ok: false,
			reason: 'invalid_request',
			detail: 'Stripe refused the request as malformed.'
		});
		expect(await stopRecurringGift(db, soleProcessor(processor), PLAN_ID)).toMatchObject({
			outcome: 'refused',
			retryable: false
		});
		expect((await readRecurringPlan(db, PLAN_ID))?.status).toBe('active');
	});

	it('records a gift the processor has no subscription for as stopped', async () => {
		// the operator who cancelled in the Stripe dashboard first. there is nothing left to cancel,
		// so the row is what is out of date — and refusing here would leave it collecting forever on
		// a dashboard with no other way to correct it.
		await plan();
		const processor = port({
			ok: false,
			reason: 'not_found',
			detail: 'Stripe has no such object on this account.'
		});
		const before = Date.now();
		expect(await stopRecurringGift(db, soleProcessor(processor), PLAN_ID)).toEqual({
			outcome: 'nothing-to-stop'
		});
		expect(processor.called).toEqual([SUBSCRIPTION_ID]);
		const record = await readRecurringPlan(db, PLAN_ID);
		expect(record?.status).toBe('cancelled');
		expect(record?.nextChargeAt).toBeNull();
		// this deployment's own clock, because there is no processor answer to take a date from.
		expect(record?.endedAt?.getTime()).toBeGreaterThanOrEqual(before);
		expect(record?.endedAt?.getTime()).toBeLessThanOrEqual(Date.now());
	});

	it('keeps a payment-failed gift’s own end date when there is nothing to cancel', async () => {
		// the date means when collection really ended, which on this row is the day the rail gave up
		// rather than the day somebody pressed a button. `stopRecurringPlan`'s `coalesce` is what
		// holds it, and this arm goes through the same statement rather than around it.
		await plan('lapsed');
		const processor = port({
			ok: false,
			reason: 'not_found',
			detail: 'Stripe has no such object on this account.'
		});
		expect(await stopRecurringGift(db, soleProcessor(processor), PLAN_ID)).toEqual({
			outcome: 'nothing-to-stop'
		});
		const record = await readRecurringPlan(db, PLAN_ID);
		expect(record?.status).toBe('cancelled');
		expect(record?.endedAt).toEqual(new Date(Date.UTC(2026, 6, 1)));
	});

	it('treats a row the webhook stopped first as a success rather than a failure', async () => {
		// the inbound `customer.subscription.deleted` for the cancel this act just made can reach
		// the row before this statement does — `recordStanding` in ../donations/collect.ts writes
		// exactly this transition. the conditional update then matches nothing, and reporting a
		// failure there would be a failure rendered over a completed act.
		await plan();
		const webhookFirst = port(ended());
		const processor: PaymentProvider = {
			...webhookFirst,
			async cancelRecurringGift(id: string) {
				await env.DB.prepare(
					`update recurring_plan set status = 'cancelled', ended_at = ?, next_charge_at = null
					 where id = ?`
				)
					.bind(Date.UTC(2026, 7, 10), PLAN_ID)
					.run();
				return webhookFirst.cancelRecurringGift(id);
			}
		};
		expect(await stopRecurringGift(db, soleProcessor(processor), PLAN_ID)).toEqual({
			outcome: 'stopped'
		});
		expect((await readRecurringPlan(db, PLAN_ID))?.status).toBe('cancelled');
	});

	it('says the end was not recorded when the write fails after the processor stopped it', async () => {
		// money has stopped and the row may still read as collecting, which is a different sentence
		// from either success or refusal and the one worth designing carefully.
		//
		// the throw is provoked by an end date the column refuses — `STRICT` will not take a
		// non-integer — because the real cause is a database that went away mid-request and there
		// is no reproducing that. what is under test is the arm, not the cause.
		await plan();
		const processor = port(ended({ endedAt: new Date('not a date') }));
		expect(await stopRecurringGift(db, soleProcessor(processor), PLAN_ID)).toEqual({
			outcome: 'unrecorded',
			processor: 'stripe'
		});
		expect((await readRecurringPlan(db, PLAN_ID))?.status).toBe('active');
	});

	it('carries which processor answered, so no screen has to guess one', async () => {
		// every sentence this act's refusals are rendered into names a dashboard to go and look at,
		// and a deployment charges on whichever processor it holds keys for. the name travels with
		// the outcome rather than being read off the route's own configuration, because the
		// commitment lives on the processor that collected its first charge and nothing else knows
		// which that was.
		await plan('active', 'paypal');
		const processor = port(
			{ ok: false, reason: 'unreachable', detail: 'PayPal did not answer in time.' },
			'paypal'
		);
		expect(await stopRecurringGift(db, soleProcessor(processor), PLAN_ID)).toMatchObject({
			outcome: 'refused',
			processor: 'paypal'
		});
	});

	it('refuses a commitment no processor answers for without naming one', async () => {
		// `recurring_plan.provider` keeps `manual`, which no adapter answers for. there is nothing to
		// call and no dashboard to send anybody to, so the refusal carries no processor and the
		// screen writes no sentence that needs one.
		await plan('active', 'manual');
		const processor = port(ended());
		expect(await stopRecurringGift(db, soleProcessor(processor), PLAN_ID)).toMatchObject({
			outcome: 'refused',
			retryable: false,
			processor: null
		});
		expect(processor.called).toEqual([]);
		expect((await readRecurringPlan(db, PLAN_ID))?.status).toBe('active');
	});
});
