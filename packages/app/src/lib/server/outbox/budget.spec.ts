import { describe, expect, it } from 'vitest';
import {
	CONNECTIONS_AT_ONCE,
	CONNECTIONS_KEPT,
	D1_QUERIES_PER_INVOCATION,
	EXTERNAL_SUBREQUESTS_PER_INVOCATION,
	HEADROOM,
	MINUTE_RUN,
	type RunCost,
	type Share,
	WEBHOOK_CLAIMS_PER_RUN,
	WEBHOOK_RUN_COST,
	ZAPIER_CLAIMS_PER_RUN,
	ZAPIER_RUN_COST
} from './budget';

const shares: readonly Share[] = Object.values(MINUTE_RUN);
const total = (of: (share: Share) => number) => shares.reduce((sum, share) => sum + of(share), 0);

describe("the minute cron's shares", () => {
	it('leave a connection free of posts for D1 and SMTP', () => {
		expect(total((s) => s.lanes)).toBeLessThanOrEqual(CONNECTIONS_AT_ONCE - CONNECTIONS_KEPT);
	});

	it("spend no more than the invocation's external subrequests, less the headroom", () => {
		expect(total((s) => s.external)).toBeLessThanOrEqual(
			EXTERNAL_SUBREQUESTS_PER_INVOCATION - HEADROOM
		);
	});

	it("spend no more than the invocation's D1 queries, less the headroom", () => {
		expect(total((s) => s.queries)).toBeLessThanOrEqual(D1_QUERIES_PER_INVOCATION - HEADROOM);
	});
});

describe.each([
	['zapier', MINUTE_RUN.zapier, ZAPIER_RUN_COST, ZAPIER_CLAIMS_PER_RUN],
	['webhooks', MINUTE_RUN.webhooks, WEBHOOK_RUN_COST, WEBHOOK_CLAIMS_PER_RUN]
] as const)('the %s claim', (_, share: Share, cost: RunCost, claims: number) => {
	it('keeps a run in which every row costs its most inside its share', () => {
		expect(cost.queries + claims * cost.queriesPerRow).toBeLessThanOrEqual(share.queries);
		expect(claims * cost.externalPerRow).toBeLessThanOrEqual(share.external);
	});

	it('takes more than one row, so a lane is never idle for want of one', () => {
		expect(claims).toBeGreaterThanOrEqual(share.lanes);
	});
});
