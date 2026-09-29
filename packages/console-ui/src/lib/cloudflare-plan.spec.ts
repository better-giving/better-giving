import { describe, expect, it } from 'vitest';
import { PAID_PLAN, PLAN_FIELD, PLAN_PAID, freePlanPace, planEdit } from './cloudflare-plan';

// the two positions the paid-plan switch can be in, what each writes, and the pace the screen
// states while the account is on the Free plan.
//
// held here because this package has no DOM pool (../../vite.config.ts), and because a third
// position is silent at every other gate: it reaches the console's door, is refused with a 400
// before cloudflare is asked, and the operator is told the console will not store what the screen
// just offered them.

/** what the press reads, with the switch on or off. */
const pressed = (on: boolean): FormData => {
	const posted = new FormData();
	if (on) posted.set(PLAN_FIELD, PLAN_PAID);
	return posted;
};

describe('the pace stated while the account is on the Free plan', () => {
	it('is the Free plan’s where the deployment holds no answer', () => {
		expect(freePlanPace('')).toEqual({ zapier: 5, webhooks: 4, books: 1 });
	});

	it('is the Free plan’s for every answer the deployment does not read as paid', () => {
		for (const said of ['false', 'no', '1', 'yes', 'paid']) {
			expect(freePlanPace(said)).toEqual({ zapier: 5, webhooks: 4, books: 1 });
		}
	});

	it('is gone once the account is on the paid plan, in any case the deployment reads', () => {
		// the deployment lowercases before it compares (`planAnswered` in
		// packages/operator/src/delivery-pace.ts), so a screen reading this exactly would state the
		// Free pace over a deployment already delivering at the paid one.
		expect(freePlanPace('true')).toBeNull();
		expect(freePlanPace('True')).toBeNull();
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
