import { describe, expect, it } from 'vitest';
import {
	ACCOUNTING_RUN_COST,
	CONNECTIONS_AT_ONCE,
	CONNECTIONS_KEPT,
	deliveryPace,
	HEADROOM,
	MINUTE_RUN,
	PACE,
	type Plan,
	PLAN_LIMITS,
	type RunCost,
	type Share,
	shareOn,
	WEBHOOK_RUN_COST,
	ZAPIER_RUN_COST
} from './budget';

const shares: readonly Share[] = Object.values(MINUTE_RUN);
const PLANS: readonly Plan[] = ['free', 'paid'];

describe("the minute cron's shares", () => {
	const total = (of: (share: Share) => number) => shares.reduce((sum, share) => sum + of(share), 0);

	it('leave a connection free of posts for D1 and SMTP', () => {
		expect(total((s) => s.lanes)).toBeLessThanOrEqual(CONNECTIONS_AT_ONCE - CONNECTIONS_KEPT);
	});

	it.each(PLANS)("spend no more than the %s invocation's limits, less the headroom", (plan) => {
		const on = shares.map((share) => shareOn(plan, share));
		const scaled = (limit: number, free: number) => limit - (HEADROOM * limit) / free;
		const { external, queries } = PLAN_LIMITS[plan];
		expect(on.reduce((sum, s) => sum + s.external, 0)).toBeLessThanOrEqual(
			scaled(external, PLAN_LIMITS.free.external)
		);
		expect(on.reduce((sum, s) => sum + s.queries, 0)).toBeLessThanOrEqual(
			scaled(queries, PLAN_LIMITS.free.queries)
		);
	});
});

describe.each([
	['zapier', MINUTE_RUN.zapier, ZAPIER_RUN_COST, PACE.free.zapier, PACE.paid.zapier],
	['webhooks', MINUTE_RUN.webhooks, WEBHOOK_RUN_COST, PACE.free.webhooks, PACE.paid.webhooks],
	['books', MINUTE_RUN.books, ACCOUNTING_RUN_COST, PACE.free.books, PACE.paid.books]
] as const)('the %s claim', (_, share: Share, cost: RunCost, free: number, paid: number) => {
	it.each([
		['free', free],
		['paid', paid]
	] as const)(
		'keeps a %s run in which every row costs its most inside its share',
		(plan, claims) => {
			const on = shareOn(plan, share);
			expect(cost.queries + claims * cost.queriesPerRow).toBeLessThanOrEqual(on.queries);
			expect(cost.external + claims * cost.externalPerRow).toBeLessThanOrEqual(on.external);
		}
	);

	it('takes at least a row for every lane on either plan, so no lane is idle for want of one', () => {
		expect(free).toBeGreaterThanOrEqual(share.lanes);
		expect(paid).toBeGreaterThanOrEqual(share.lanes);
	});

	it('goes faster on the Paid plan', () => {
		expect(paid).toBeGreaterThan(free);
	});
});

describe('deliveryPace()', () => {
	it("reads the Paid plan off the operator's `true`, in any case", () => {
		expect(deliveryPace({ CLOUDFLARE_PAID_PLAN: 'True' })).toEqual({
			plan: 'paid',
			zapierPerMinute: PACE.paid.zapier,
			webhooksPerMinute: PACE.paid.webhooks,
			booksPerMinute: PACE.paid.books
		});
	});

	it.each([
		{ label: 'unset', env: {} },
		{ label: 'false', env: { CLOUDFLARE_PAID_PLAN: 'false' } },
		{ label: 'yes', env: { CLOUDFLARE_PAID_PLAN: 'yes' } },
		{ label: '1', env: { CLOUDFLARE_PAID_PLAN: '1' } }
	])('reads every other answer, $label included, as the Free plan', ({ env }) => {
		expect(deliveryPace(env)).toEqual({
			plan: 'free',
			zapierPerMinute: PACE.free.zapier,
			webhooksPerMinute: PACE.free.webhooks,
			booksPerMinute: PACE.free.books
		});
	});
});
