import { describe, expect, it } from 'vitest';
import {
	ACCOUNTING_RUN_COST,
	CONNECTIONS_AT_ONCE,
	CONNECTIONS_KEPT,
	claimsWithin,
	HEADROOM,
	MINUTE_RUN,
	PACE,
	LIMITS,
	paceOf,
	type RunCost,
	type Share,
	WEBHOOK_RUN_COST,
	ZAPIER_RUN_COST
} from './budget';

const shares: readonly Share[] = Object.values(MINUTE_RUN);

describe("the minute cron's shares", () => {
	const total = (of: (share: Share) => number) => shares.reduce((sum, share) => sum + of(share), 0);

	it('leave a connection free of posts for D1 and SMTP', () => {
		expect(total((s) => s.lanes)).toBeLessThanOrEqual(CONNECTIONS_AT_ONCE - CONNECTIONS_KEPT);
	});

	it("spend no more than the invocation's limits, less the headroom", () => {
		const unspent = (limit: number) => limit - HEADROOM * limit;
		expect(total((s) => s.external)).toBeLessThanOrEqual(unspent(LIMITS.external));
		expect(total((s) => s.queries)).toBeLessThanOrEqual(unspent(LIMITS.queries));
	});
});

describe.each([
	['zapier', MINUTE_RUN.zapier, ZAPIER_RUN_COST, PACE.zapier],
	['webhooks', MINUTE_RUN.webhooks, WEBHOOK_RUN_COST, PACE.webhooks],
	['books', MINUTE_RUN.books, ACCOUNTING_RUN_COST, PACE.books]
] as const)('the %s claim', (_, share: Share, cost: RunCost, claims: number) => {
	it('keeps a run in which every row costs its most inside its share', () => {
		expect(cost.queries + claims * cost.queriesPerRow).toBeLessThanOrEqual(share.queries);
		expect(cost.external + claims * cost.externalPerRow).toBeLessThanOrEqual(share.external);
	});

	it('takes at least a row for every lane, so no lane is idle for want of one', () => {
		expect(claims).toBeGreaterThanOrEqual(share.lanes);
	});

	it('claims all its share pays for and its lanes answer in a minute, and no fewer', () => {
		expect(claims).toBe(Math.min(claimsWithin(share, cost), paceOf(share, cost)));
	});
});
