import { describe, expect, it } from 'vitest';
import type { FeedsInUse } from '../api/types';
import { PAID_PLAN, PLAN_FIELD, PLAN_PAID, planConcern, planEdit } from './cloudflare-plan';
import { heldValues } from './held-values';

// the two positions the paid-plan switch can be in, what each writes, and when the plan is worth
// the operator's look.
//
// held here because this package has no DOM pool (../../vite.config.ts), and because a third
// position is silent at every other gate: it reaches the console's door, is refused with a 400
// before cloudflare is asked, and the operator is told the console will not store what the screen
// just offered them.

/** what the deployment holds where the answer it stores is `value`, and nothing where it is `null`. */
const holding = (value: string | null) =>
	heldValues(value === null ? [] : [{ name: PAID_PLAN, kind: 'value', value }]);

/** what the press reads, with the switch on or off. */
const pressed = (on: boolean): FormData => {
	const posted = new FormData();
	if (on) posted.set(PLAN_FIELD, PLAN_PAID);
	return posted;
};

/** every feed idle but the ones named, which are in use. */
const using = (...feeds: (keyof FeedsInUse)[]): FeedsInUse => ({
	zapier: feeds.includes('zapier'),
	webhooks: feeds.includes('webhooks'),
	books: feeds.includes('books')
});

const ALL = using('zapier', 'webhooks', 'books');

describe('whether the plan is a concern', () => {
	it('is, where the plan reads as Free and any one feed is in use', () => {
		for (const feed of ['zapier', 'webhooks', 'books'] as const) {
			expect(planConcern(holding(null), using(feed))).toBe(true);
		}
	});

	it('is, for every answer the deployment does not read as paid', () => {
		for (const said of ['false', 'no', '1', 'yes', 'paid']) {
			expect(planConcern(holding(said), ALL)).toBe(true);
		}
	});

	it('is not where nothing is delivered, whatever the plan reads as', () => {
		expect(planConcern(holding(null), using())).toBe(false);
	});

	it('is not where the plan reads as paid, in any case or with the whitespace round it', () => {
		// the deployment lowercases and trims before it compares (`planAnswered` in
		// packages/operator/src/delivery-pace.ts, `readConfigEnv` in
		// packages/app/src/lib/server/config/env.ts), so a reading of this exactly would mark a
		// deployment already delivering at the paid pace.
		for (const said of ['true', 'True', ' true', 'TRUE\n']) {
			expect(planConcern(holding(said), ALL)).toBe(false);
		}
	});

	it('is not where the answer is withheld, which the deployment may be reading as paid', () => {
		const withheld = heldValues([{ name: PAID_PLAN, kind: 'withheld' }]);
		expect(planConcern(withheld, ALL)).toBe(false);
	});

	it('is never raised where the deployment did not say which feeds are in use', () => {
		expect(planConcern(holding(null), null)).toBe(false);
	});
});

describe('what one press of the switch puts on the deployment', () => {
	it('stores the one word where the switch is on', () => {
		expect(planEdit(pressed(true))).toEqual({ CLOUDFLARE_PAID_PLAN: 'true' });
	});

	it('takes the name off where it is off, which is the only way this console says Free', () => {
		expect(planEdit(pressed(false))).toEqual({ CLOUDFLARE_PAID_PLAN: null });
	});

	it('names one value and never a second', () => {
		expect(Object.keys(planEdit(pressed(true)))).toEqual([PAID_PLAN]);
	});

	it('falls to off for anything that is not the word, so no third thing reaches the door', () => {
		// the door refuses every other spelling with a 400 (`answerSwitches` in
		// packages/console/internal/server/values.go).
		const posted = new FormData();
		posted.set(PLAN_FIELD, 'TRUE');
		expect(planEdit(posted)).toEqual({ CLOUDFLARE_PAID_PLAN: null });
		posted.set(PLAN_FIELD, 'false');
		expect(planEdit(posted)).toEqual({ CLOUDFLARE_PAID_PLAN: null });
	});
});
