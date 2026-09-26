import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

// the constraints `dispute` carries, which are one-way for the reason
// ./donation-schema.workers.spec.ts opens with: each is a rebuild of the table to change.
//
// what is deliberately not here, on that file's redundancy rule: `STRICT` on the table and
// `NO ACTION` on its one foreign key, both read off sqlite's catalogue by ./strict.workers.spec.ts,
// and the `optionalNotBlank` body on `reason` beyond the three blanks below (the shared helper,
// pinned on `payment.provider_txn_id`).
//
// every query below is scoped to its own rows — the pool gives per-file storage, not per-test.

const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';
const SQLITE_CONSTRAINT_PRIMARYKEY = 'SQLITE_CONSTRAINT_PRIMARYKEY';
const SQLITE_CONSTRAINT_FOREIGNKEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';

/** runs `fn` and requires D1 to have rejected it; same helper as the sibling schema specs. */
async function rejection(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
	} catch (e) {
		return String((e as Error).message);
	}
	throw new Error('expected D1 to reject this statement, but it succeeded');
}

const CONTACT_ID = '019fb700-0000-7000-8000-000000000001';
const DONATION_ID = '019fb700-0000-7000-8000-000000000002';

/** a refund-direction row per case, so no case's dispute collides with another's on the key. */
const withdrawal = (n: number) => `019fb700-0000-7000-8001-${String(n).padStart(12, '0')}`;
const WITHDRAWALS = 20;

beforeAll(async () => {
	await env.DB.batch([
		env.DB.prepare(
			`insert into contact (id, kind, display_name, created_at, updated_at)
			 values (?, 'individual', 'Probe Donor', 0, 0)`
		).bind(CONTACT_ID),
		env.DB.prepare(
			`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
			 values (?, ?, 10000, 'USD', 0, 0)`
		).bind(DONATION_ID, CONTACT_ID),
		...Array.from({ length: WITHDRAWALS }, (_, i) =>
			env.DB.prepare(
				`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
				                      provider, provider_txn_id, occurred_at, created_at)
				 values (?, ?, 10000, 'USD', 'refund', 'card', 'succeeded', 'stripe', ?, 0, 0)`
			).bind(withdrawal(i), DONATION_ID, `du_probe_${i}`)
		)
	]);
});

let next = 0;
/** a withdrawal no case has disputed yet. */
const freshWithdrawal = () => {
	if (next >= WITHDRAWALS) throw new Error('seed more withdrawals');
	return withdrawal(next++);
};

const insertDispute = (
	paymentId: string,
	opts: { outcome?: string | null; closedAt?: number | null; reason?: string | null } = {}
) =>
	env.DB.prepare(
		`insert into dispute (payment_id, outcome, respond_by, reason, closed_at, created_at, updated_at)
		 values (?, ?, 5, ?, ?, 0, 0)`
	)
		.bind(paymentId, opts.outcome ?? null, opts.reason ?? null, opts.closedAt ?? null)
		.run();

const disputeRow = (paymentId: string) =>
	env.DB.prepare('select outcome, respond_by, reason, closed_at from dispute where payment_id = ?')
		.bind(paymentId)
		.first();

describe('a dispute belongs to one payment row that exists', () => {
	it('opens against an existing payment row, with no outcome', async () => {
		const id = freshWithdrawal();
		await insertDispute(id, { reason: 'fraudulent' });
		expect(await disputeRow(id)).toEqual({
			outcome: null,
			respond_by: 5,
			reason: 'fraudulent',
			closed_at: null
		});
	});

	it('refuses a payment id naming no payment', async () => {
		const message = await rejection(() => insertDispute('019fb700-0000-7000-8000-00000000dead'));
		expect(message).toContain(SQLITE_CONSTRAINT_FOREIGNKEY);
	});

	it('refuses a second dispute on the same payment row', async () => {
		const id = freshWithdrawal();
		await insertDispute(id);
		const message = await rejection(() => insertDispute(id));
		expect(message).toContain(SQLITE_CONSTRAINT_PRIMARYKEY);
	});
});

describe('a dispute closes won or lost, and only then', () => {
	it.each(['won', 'lost'])('accepts a dispute closed %s', async (outcome) => {
		const id = freshWithdrawal();
		await insertDispute(id, { outcome, closedAt: 9 });
		expect(await disputeRow(id)).toMatchObject({ outcome, closed_at: 9 });
	});

	it.each(['WON', 'pending', 'withdrawn', ''])('refuses an outcome of %j', async (outcome) => {
		const message = await rejection(() =>
			insertDispute(freshWithdrawal(), { outcome, closedAt: 9 })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('dispute_outcome_check');
	});

	it.each([
		['a close with no outcome', null, 9],
		['an outcome with no close', 'lost', null]
	])('refuses %s', async (_, outcome, closedAt) => {
		const message = await rejection(() => insertDispute(freshWithdrawal(), { outcome, closedAt }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('dispute_closed_with_outcome_check');
	});

	it('closes an open dispute by setting both at once', async () => {
		const id = freshWithdrawal();
		await insertDispute(id);
		await env.DB.prepare(
			`update dispute set outcome = 'won', closed_at = 11 where payment_id = ? and outcome is null`
		)
			.bind(id)
			.run();
		expect(await disputeRow(id)).toMatchObject({ outcome: 'won', closed_at: 11 });
	});
});

describe("a dispute's reason is the processor's words or nothing", () => {
	it.each([
		['empty', ''],
		['a lone space', ' '],
		['a non-breaking space', ' ']
	])('refuses %s', async (_, reason) => {
		const message = await rejection(() => insertDispute(freshWithdrawal(), { reason }));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('dispute_reason_not_blank_check');
	});
});
