import { describe, expect, it } from 'vitest';
import {
	CHARITY_APPROVED,
	CHARITY_FIELD,
	CHARITY_RATE,
	charityApproved,
	charityEdit
} from './paypal-charity';

// the two positions the charity-rate switch can be in, and what each of them writes.
//
// held here because this package has no DOM pool (../../vite.config.ts), and because the thing that
// would go wrong is silent at every other gate: a third position reaches the console's door, is
// refused with a 400 before cloudflare is asked, and the operator is told the console will not
// store what the screen just offered them.

/** what the press reads, with the switch on or off. */
const pressed = (on: boolean): FormData => {
	const posted = new FormData();
	if (on) posted.set(CHARITY_FIELD, CHARITY_APPROVED);
	return posted;
};

describe('where the switch is drawn', () => {
	it('is on for the one word the deployment reads as yes', () => {
		expect(charityApproved('true')).toBe(true);
	});

	it('is on for an operator who answered from a terminal in another case', () => {
		// the deployment lowercases before it compares (`paypalFeeRules` in
		// packages/app/src/lib/server/payments/fees.ts), so a screen reading this exactly would say
		// standard rate over a deployment quoting the charity one.
		expect(charityApproved('True')).toBe(true);
		expect(charityApproved('TRUE')).toBe(true);
	});

	it('is off for a deployment holding nothing', () => {
		expect(charityApproved('')).toBe(false);
	});

	it('is off for every other spelling, which the deployment prices at the standard rate', () => {
		for (const said of ['false', 'no', '1', 'yes', 'approved']) {
			expect(charityApproved(said)).toBe(false);
		}
	});
});

describe('what one press of the switch puts on the deployment', () => {
	it('stores the one word where the switch is on', () => {
		expect(charityEdit(pressed(true))).toEqual({ [CHARITY_RATE]: CHARITY_APPROVED });
	});

	it('takes the name off where it is off, which is the only way this console says no', () => {
		expect(charityEdit(pressed(false))).toEqual({ [CHARITY_RATE]: null });
	});

	it('names one value and never a second', () => {
		expect(Object.keys(charityEdit(pressed(true)))).toEqual([CHARITY_RATE]);
	});

	it('falls to off for anything that is not the word, so no third thing reaches the door', () => {
		// the case this composition exists for. the door refuses every other spelling with a 400
		// (`charityRate` in packages/console/internal/server/values.go), and a payload built from what
		// a body claimed rather than from the two positions is how a press on this page reaches it.
		const posted = new FormData();
		posted.set(CHARITY_FIELD, 'false');
		expect(charityEdit(posted)).toEqual({ [CHARITY_RATE]: null });
		posted.set(CHARITY_FIELD, 'TRUE');
		expect(charityEdit(posted)).toEqual({ [CHARITY_RATE]: null });
	});
});
