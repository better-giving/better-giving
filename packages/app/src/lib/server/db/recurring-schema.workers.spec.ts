import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { POSTING_ACCOUNTS } from './accounts';

// the constraints on `recurring_plan` and on `donation.recurring_id` that are one-way.
//
// why this file exists. `recurring_plan` is born with `donation` pointing at it, so from the
// first commitment onward D1 will not let the table be dropped — and sqlite can neither ALTER
// a check in nor ALTER one out, so every constraint below had to be right at birth. the same
// reasoning ./donation-schema.workers.spec.ts opens with, one table over.
//
// these probes run against the committed `migrations/` SQL applied to a real D1 (see
// ./d1.setup.ts), so what is under test is the schema that deploys rather than one rebuilt
// from a drizzle snapshot. that matters more here than usual: `donation.recurring_id` arrives
// as `ALTER TABLE ... ADD COLUMN ... REFERENCES recurring_plan(id)`, and a foreign key sqlite
// cannot resolve is legal at DDL time and fails only when DML runs — so the clause being
// present in the migration proves nothing, and the pair of probes at the bottom of this file
// is what proves it resolves.
//
// what is deliberately not here, on the redundancy rule ./donation-schema.workers.spec.ts
// states: `recurring_plan_amount_minor_positive_check` (one shape, `> 0` against a literal,
// asserted twice already on `donation` and `payment`), `recurring_plan_currency_check` and the
// two not-blank checks (all three are shared helper bodies with their own precedents), and
// `recurring_plan_status_check` (the same `enumCheck` body as the interval check below, on a
// column whose wrong values are not near-misses). `STRICT` on this table and `NO ACTION` on
// both of its foreign keys are covered without an edit here: ./strict.workers.spec.ts reads
// sqlite's own catalogue, so a table added by a later migration is covered the moment it
// exists.
//
// every query below is scoped to its own rows — the pool gives per-file storage rather than
// per-test, so a probe that succeeds leaves its row behind for every test after it.

const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';
const SQLITE_CONSTRAINT_FOREIGNKEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';
const SQLITE_CONSTRAINT_UNIQUE = 'SQLITE_CONSTRAINT_UNIQUE';

/**
 * runs `fn`, requires D1 to have rejected it, and hands back the message. throws rather than
 * returning a sentinel when the statement succeeds, so a probe that stops being rejected fails
 * loudly instead of passing quietly. (same helper as ./donation-schema.workers.spec.ts and
 * ./strict.workers.spec.ts — duplicated rather than shared, for the reason stated there.)
 */
async function rejection(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
	} catch (e) {
		return String((e as Error).message);
	}
	throw new Error('expected D1 to reject this statement, but it succeeded');
}

const CONTACT_ID = '019fb200-0000-7000-8000-000000000001';
const FORM_ID = 'frm_recurringprobe';

/** a donor and a form for the commitments to hang off. the chart of accounts is seeded. */
beforeAll(async () => {
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, created_at, updated_at)
		 values (?, 'individual', 'Probe Donor', 0, 0)`
	)
		.bind(CONTACT_ID)
		.run();
	await env.DB.prepare(
		`insert into form (id, name, revenue_account_id, currency, created_at, updated_at)
		 values (?, 'probe', ?, 'USD', 0, 0)`
	)
		.bind(FORM_ID, POSTING_ACCOUNTS.donationsDeductible.id)
		.run();
});

/**
 * a commitment, with every column a probe ever varies exposed. `subscription_id` doubles as
 * the row's own handle so no two probes collide on the unique index by accident.
 */
const insertPlan = (opts: {
	id: string;
	interval?: string;
	status?: string;
	provider?: string;
	subscriptionId?: string;
	endedAt?: number | null;
}) =>
	env.DB.prepare(
		`insert into recurring_plan
		   (id, contact_id, form_id, amount_minor, currency, "interval", status,
		    provider, provider_subscription_id, provider_customer_id,
		    started_at, ended_at, created_at, updated_at)
		 values (?, ?, ?, 2500, 'USD', ?, ?, ?, ?, 'cus_probe', 0, ?, 0, 0)`
	)
		.bind(
			opts.id,
			CONTACT_ID,
			FORM_ID,
			opts.interval ?? 'monthly',
			opts.status ?? 'active',
			opts.provider ?? 'stripe',
			opts.subscriptionId ?? `sub_${opts.id}`,
			opts.endedAt ?? null
		)
		.run();

describe('a commitment repeats monthly or yearly, and nothing else', () => {
	it('accepts the two the public contract offers', async () => {
		// the positive control the rejections below are worth nothing without.
		await insertPlan({ id: 'plan-monthly', interval: 'monthly' });
		await insertPlan({ id: 'plan-yearly', interval: 'yearly' });
		const { results } = await env.DB.prepare(
			`select "interval" as i from recurring_plan where id in ('plan-monthly', 'plan-yearly')
			 order by "interval"`
		).all();
		expect(results).toEqual([{ i: 'monthly' }, { i: 'yearly' }]);
	});

	it('refuses `one_time`, which is a frequency but not an interval', async () => {
		// the near-miss this check exists for: `one_time` is a legal `Frequency` on the wire
		// (`FREQUENCIES` in packages/form/src/v1.ts) and a commitment that never repeats is not a
		// commitment — it is a donation with no row in this table at all.
		const message = await rejection(() =>
			insertPlan({ id: 'plan-one-time', interval: 'one_time' })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('recurring_plan_interval_check');
	});

	it('refuses a cadence nothing can charge', async () => {
		const message = await rejection(() => insertPlan({ id: 'plan-weekly', interval: 'weekly' }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('recurring_plan_interval_check');
	});
});

describe('a commitment that has ended says when, and one that is live does not', () => {
	/** the two ended states and the live one, each read back rather than merely inserted. */
	const endState = (id: string) =>
		env.DB.prepare('select status, ended_at as endedAt from recurring_plan where id = ?')
			.bind(id)
			.first();

	it('accepts a cancelled commitment with an end instant', async () => {
		await insertPlan({ id: 'plan-cancelled', status: 'cancelled', endedAt: 1_700_000_000_000 });
		expect(await endState('plan-cancelled')).toEqual({
			status: 'cancelled',
			endedAt: 1_700_000_000_000
		});
	});

	it('accepts a lapsed commitment with an end instant', async () => {
		await insertPlan({ id: 'plan-lapsed', status: 'lapsed', endedAt: 1_700_000_000_000 });
		expect(await endState('plan-lapsed')).toEqual({ status: 'lapsed', endedAt: 1_700_000_000_000 });
	});

	it('accepts a live commitment with no end instant', async () => {
		await insertPlan({ id: 'plan-live', status: 'active', endedAt: null });
		expect(await endState('plan-live')).toEqual({ status: 'active', endedAt: null });
	});

	it('refuses an ended commitment with no end instant', async () => {
		// the shape a cancel action produces when it writes `status` and forgets the
		// timestamp: a commitment the dashboard can say nothing about except that it stopped.
		const message = await rejection(() =>
			insertPlan({ id: 'plan-ended-undated', status: 'cancelled', endedAt: null })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('recurring_plan_ended_at_check');
	});

	it('refuses a live commitment that has already ended', async () => {
		const message = await rejection(() =>
			insertPlan({ id: 'plan-live-ended', status: 'active', endedAt: 1_700_000_000_000 })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('recurring_plan_ended_at_check');
	});
});

describe('one rail-side subscription is one commitment', () => {
	it('refuses a second commitment naming the same subscription', async () => {
		// the provisioning path is not idempotent on its own — this index is what makes a
		// retried or redelivered creation a rejection rather than a second commitment
		// charging the same donor twice, and it is also what makes the lookup every rebill
		// performs a single-row read.
		await insertPlan({ id: 'plan-sub-first', subscriptionId: 'sub_shared' });
		const message = await rejection(() =>
			insertPlan({ id: 'plan-sub-second', subscriptionId: 'sub_shared' })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_UNIQUE);
	});
});

describe('a commitment names a processor the schema knows', () => {
	it.each(['stripe', 'paypal'])(
		'accepts %s, which is a processor that runs one',
		async (provider) => {
			// the positive control the rejection below is worth nothing without: a commitment
			// carried by PayPal is a row here exactly as a Stripe one is.
			await insertPlan({ id: `plan-${provider}`, provider });
			const row = await env.DB.prepare('select provider as p from recurring_plan where id = ?')
				.bind(`plan-${provider}`)
				.first();
			expect(row).toEqual({ p: provider });
		}
	);

	it('refuses a processor outside the list', async () => {
		const message = await rejection(() =>
			insertPlan({ id: 'plan-badprovider', provider: 'braintree' })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('recurring_plan_provider_check');
	});
});

describe('donation.recurring_id resolves against recurring_plan', () => {
	const insertDonation = (id: string, recurringId: string | null) =>
		env.DB.prepare(
			`insert into donation (id, contact_id, total_minor, currency, received_at, created_at,
			                       recurring_id)
			 values (?, ?, 2500, 'USD', 0, 0, ?)`
		)
			.bind(id, CONTACT_ID, recurringId)
			.run();

	const recurringIdOf = (id: string) =>
		env.DB.prepare('select recurring_id as recurringId from donation where id = ?')
			.bind(id)
			.first();

	it('accepts a charge pointing at a commitment', async () => {
		await insertPlan({ id: 'plan-charged' });
		await insertDonation('019fb200-0000-7000-8000-000000000010', 'plan-charged');
		expect(await recurringIdOf('019fb200-0000-7000-8000-000000000010')).toEqual({
			recurringId: 'plan-charged'
		});
	});

	it('accepts a one-time gift, which points at nothing', async () => {
		await insertDonation('019fb200-0000-7000-8000-000000000011', null);
		expect(await recurringIdOf('019fb200-0000-7000-8000-000000000011')).toEqual({
			recurringId: null
		});
	});

	it('refuses a charge pointing at no commitment', async () => {
		// the whole reason the column arrived by ALTER TABLE rather than in the original
		// CREATE TABLE: sqlite resolves a foreign key when DML runs, so a REFERENCES to a
		// table that did not exist yet would have shipped green and failed here instead.
		const message = await rejection(() =>
			insertDonation('019fb200-0000-7000-8000-000000000012', 'plan-that-never-existed')
		);
		expect(message).toContain(SQLITE_CONSTRAINT_FOREIGNKEY);
	});
});
