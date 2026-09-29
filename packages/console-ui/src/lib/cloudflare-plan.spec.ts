import { DELIVERY_PACE } from '@better-giving/operator/delivery-pace';
import { describe, expect, it } from 'vitest';
import type { FeedsInUse } from './cloudflare-plan';
import {
	PAID_PLAN,
	PLAN_FIELD,
	PLAN_PAID,
	freePlanPace,
	planConcern,
	planEdit
} from './cloudflare-plan';
import { heldValues } from './held-values';

// the two positions the paid-plan switch can be in, what each writes, and the pace the screen
// states while the account is on the Free plan.
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

describe('the pace stated while the account is on the Free plan', () => {
	it('is the Free plan’s where the deployment holds no answer', () => {
		expect(freePlanPace(holding(null))).toEqual(DELIVERY_PACE.free);
	});

	it('is the Free plan’s for every answer the deployment does not read as paid', () => {
		for (const said of ['false', 'no', '1', 'yes', 'paid']) {
			expect(freePlanPace(holding(said))).toEqual(DELIVERY_PACE.free);
		}
	});

	it('is gone once the account is on the paid plan, in any case the deployment reads', () => {
		// the deployment lowercases before it compares (`planAnswered` in
		// packages/operator/src/delivery-pace.ts), so a screen reading this exactly would state the
		// Free pace over a deployment already delivering at the paid one.
		expect(freePlanPace(holding('true'))).toBeNull();
		expect(freePlanPace(holding('True'))).toBeNull();
	});

	it('is gone for the word carried with the whitespace a hand edit leaves round it', () => {
		// the deployment trims every value before it reads one (`readConfigEnv` in
		// packages/app/src/lib/server/config/env.ts), so a screen reading this untrimmed would state
		// the Free pace over a deployment already delivering at the paid one.
		expect(freePlanPace(holding(' true'))).toBeNull();
		expect(freePlanPace(holding('TRUE\n'))).toBeNull();
	});

	it('is not stated where the answer is withheld, which the deployment may be reading as paid', () => {
		expect(freePlanPace(heldValues([{ name: PAID_PLAN, kind: 'withheld' }]))).toBeNull();
	});
});

/** every feed idle but the ones named, which are in use. */
const using = (...feeds: (keyof FeedsInUse)[]): FeedsInUse => ({
	zapier: feeds.includes('zapier'),
	webhooks: feeds.includes('webhooks'),
	books: feeds.includes('books')
});

const UNREAD: FeedsInUse = { zapier: null, webhooks: null, books: null };

describe('whether the plan is a concern', () => {
	it('is, where the plan reads as Free and any one feed is in use', () => {
		for (const feed of ['zapier', 'webhooks', 'books'] as const) {
			expect(planConcern(holding(null), using(feed))).toBe(true);
			expect(planConcern(holding('false'), using(feed))).toBe(true);
		}
	});

	it('is not where nothing is delivered, whatever the plan reads as', () => {
		expect(planConcern(holding(null), using())).toBe(false);
	});

	it('is not where the plan reads as paid, in any case or with the whitespace round it', () => {
		const all = using('zapier', 'webhooks', 'books');
		expect(planConcern(holding('true'), all)).toBe(false);
		expect(planConcern(holding(' TRUE\n'), all)).toBe(false);
	});

	it('is not where the answer is withheld, which the deployment may be reading as paid', () => {
		const withheld = heldValues([{ name: PAID_PLAN, kind: 'withheld' }]);
		expect(planConcern(withheld, using('zapier', 'webhooks', 'books'))).toBe(false);
	});

	it('is never raised by a feed this console could not read', () => {
		expect(planConcern(holding(null), UNREAD)).toBe(false);
		expect(planConcern(holding(null), { ...UNREAD, books: false })).toBe(false);
	});

	it('is raised by a feed read as in use beside one that could not be read', () => {
		expect(planConcern(holding(null), { ...UNREAD, webhooks: true })).toBe(true);
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
