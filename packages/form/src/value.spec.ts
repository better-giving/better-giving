import { describe, expect, it } from 'vitest';
import {
	completeAmount,
	completePayer,
	missingAmountDecisions,
	payerCoversFee,
	DEFAULT_COVERS_FEE,
	OPENED_TRIBUTE
} from './value';
import type { FormConfig } from './v1';

// node pool, no browser — every rule here is decidable from a draft and a config, which is
// what lets the machine's guards be one function call rather than a paragraph of conditions
// re-typed at each transition.

/** the ordinary deployment: one-time or monthly, card or bank, $5 to $50,000. */
const CONFIG: FormConfig = {
	formId: 'frm_a8x2k9',
	providers: [{ name: 'stripe', publishableKey: 'pk_test_x' }],
	currency: 'usd',
	suggestedAmountsMinor: [2500, 10_000],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time', 'monthly'],
	paymentMethods: ['card', 'ach'],
	feeCoverage: 'optional',
	feeRules: {
		card: { percent: 0.029, fixedMinor: 30 },
		ach: { percent: 0.008, fixedMinor: 0 },
		apple_pay: { percent: 0.029, fixedMinor: 30 },
		google_pay: { percent: 0.029, fixedMinor: 30 },
		paypal: { percent: 0.0349, fixedMinor: 49 },
		venmo: { percent: 0.0349, fixedMinor: 49 }
	},
	locale: 'en-US',
	orgLegalName: 'Acme Relief Fund',
	ein: '12-3456789',
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.'
};

/** unwraps an amount that must have completed, naming the draft when it did not. */
function amount(draft: Parameters<typeof completeAmount>[0], config: FormConfig = CONFIG) {
	const value = completeAmount(draft, config);
	if (value === null) throw new Error(`expected ${JSON.stringify(draft)} to complete`);
	return value;
}

describe('completeAmount', () => {
	it('turns a filled draft into the value every later step is allowed to assume', () => {
		// the whole point of the function: `fv` is required from the details step onward by
		// construction, which is only true if there is exactly one place a draft becomes a
		// value and it refuses everything that is not one.
		expect(amount({ amountMinor: 2500, frequency: 'monthly' })).toEqual({
			amountMinor: 2500,
			frequency: 'monthly',
			programId: null
		});
	});

	it('carries the cause the donor chose and settles a gift with no choice as none', () => {
		// `null` is an answer rather than a gap — the gift goes where it is needed most — which is why
		// the value carries the field on every gift and no press is ever refused for it.
		expect(amount({ amountMinor: 2500, frequency: 'one_time', programId: 'prg_water' })).toEqual({
			amountMinor: 2500,
			frequency: 'one_time',
			programId: 'prg_water'
		});
		expect(amount({ amountMinor: 2500, frequency: 'one_time' }).programId).toBeNull();
		expect(missingAmountDecisions({ amountMinor: 2500, frequency: 'one_time' }, CONFIG)).toEqual(
			[]
		);
	});

	it('refuses a draft the donor has not finished', () => {
		// this is what the `CONTINUE` guard is: a press with no amount picked is not an error
		// to render, it is a transition that does not happen.
		expect(completeAmount({}, CONFIG)).toBeNull();
		expect(completeAmount({ frequency: 'monthly' }, CONFIG)).toBeNull();
		expect(completeAmount({ amountMinor: 2500 }, CONFIG)).toBeNull();
	});

	it('refuses an amount outside the bounds the config publishes', () => {
		// a client-side hint and nothing more: `/api/v1` re-checks both bounds against the form
		// record because a posted amount is never trusted. this exists to stop a donor watching
		// a submit fail for a reason the screen already knew, not to enforce anything.
		expect(completeAmount({ amountMinor: 499, frequency: 'one_time' }, CONFIG)).toBeNull();
		expect(completeAmount({ amountMinor: 5_000_001, frequency: 'one_time' }, CONFIG)).toBeNull();
		expect(amount({ amountMinor: 500, frequency: 'one_time' }).amountMinor).toBe(500);
		expect(amount({ amountMinor: 5_000_000, frequency: 'one_time' }).amountMinor).toBe(5_000_000);
	});

	it('refuses an amount that is not a whole minor unit', () => {
		// the "Other" box is the entry point and a host page can set an attribute, so a float
		// reaching here is a live path — and a fractional cent propagates through the gross-up
		// into a total that reconciles against nothing.
		expect(completeAmount({ amountMinor: 2500.5, frequency: 'one_time' }, CONFIG)).toBeNull();
		expect(completeAmount({ amountMinor: Number.NaN, frequency: 'one_time' }, CONFIG)).toBeNull();
	});

	it('carries a trimmed note and omits an unwritten one entirely', () => {
		// the note is omitted, not emptied. It rides to a payment-initiating endpoint, and an
		// empty string there is a value someone stores; an absent key is not. `exactOptional
		// PropertyTypes` is on, so this distinction is one the compiler holds us to.
		//
		// a note of spaces never reaches this branch: it is a decision the draft is short of, which
		// is the refusal below.
		expect(amount({ amountMinor: 2500, frequency: 'one_time', note: '  for the gala  ' })).toEqual({
			amountMinor: 2500,
			frequency: 'one_time',
			programId: null,
			note: 'for the gala'
		});
		expect(amount({ amountMinor: 2500, frequency: 'one_time' })).not.toHaveProperty('note');
	});

	it('refuses a draft whose note was asked for and never written', () => {
		// the guard and the sentence come from one rule, so a note the donor opened and left blank
		// stops the press the same way a missing amount does. an absent note is a donor who never
		// asked for one, and it completes.
		expect(
			completeAmount({ amountMinor: 2500, frequency: 'one_time', note: '' }, CONFIG)
		).toBeNull();
		expect(completeAmount({ amountMinor: 2500, frequency: 'one_time' }, CONFIG)).not.toBeNull();
	});

	it('carries a trimmed tribute and omits an unopened one entirely', () => {
		// absent must be unambiguous on the wire: `parseTribute` reads an absent `tributeKind` as a
		// gift with no tribute, and an empty shape here would put a kind on every gift ever given.
		expect(
			amount({
				amountMinor: 2500,
				frequency: 'one_time',
				tribute: { ...OPENED_TRIBUTE, kind: 'memory', honoree: '  Margaret Chen  ' }
			}).tribute
		).toEqual({ kind: 'memory', honoree: 'Margaret Chen', notify: null });
		expect(amount({ amountMinor: 2500, frequency: 'one_time' })).not.toHaveProperty('tribute');
	});

	it('makes a half-filled person to tell unrepresentable rather than merely refused', () => {
		// `notify` is one object or `null`, which is where the pairing stops being a rule anybody
		// has to remember: there is no value of this type that carries a name and no address. the
		// server's `ParsedQuoteRequest.tribute` is nested for the same reason.
		expect(
			amount({
				amountMinor: 2500,
				frequency: 'one_time',
				tribute: {
					...OPENED_TRIBUTE,
					honoree: 'Margaret Chen',
					notifyName: '  James Okonkwo  ',
					notifyEmail: '  james@example.org  '
				}
			}).tribute
		).toEqual({
			kind: 'honor',
			honoree: 'Margaret Chen',
			notify: { name: 'James Okonkwo', email: 'james@example.org' }
		});
	});

	it('refuses a draft whose tribute was opened and never named', () => {
		expect(
			completeAmount({ amountMinor: 2500, frequency: 'one_time', tribute: OPENED_TRIBUTE }, CONFIG)
		).toBeNull();
	});
});

describe('missingAmountDecisions', () => {
	it('names every decision the draft is short of, in the order they are asked', () => {
		// every one of them rather than the first: a donor who has decided neither is missing both,
		// and naming them one press at a time makes the same button look refused twice.
		expect(missingAmountDecisions({}, CONFIG)).toEqual(['amount']);
		expect(missingAmountDecisions({ note: '' }, CONFIG)).toEqual(['amount', 'note']);
		expect(missingAmountDecisions({ amountMinor: 2500, frequency: 'one_time' }, CONFIG)).toEqual(
			[]
		);
	});

	it('holds the donor to a note only once they have asked to write one', () => {
		// the whole distinction the draft's shape carries: an absent note was never asked for, and
		// an empty one was. without it "never opened the note" and "opened it and wrote nothing"
		// reach this function as the same draft.
		const decided = { amountMinor: 2500, frequency: 'one_time' } as const;

		expect(missingAmountDecisions(decided, CONFIG)).toEqual([]);
		expect(missingAmountDecisions({ ...decided, note: '' }, CONFIG)).toEqual(['note']);
		expect(missingAmountDecisions({ ...decided, note: 'for the gala' }, CONFIG)).toEqual([]);
	});

	it('counts a note that is only whitespace as one nobody wrote', () => {
		// the note is trimmed before it is carried, so a space is a note that reaches the endpoint
		// as nothing at all — which is a press refused with the field reading full.
		const decided = { amountMinor: 2500, frequency: 'one_time' } as const;

		expect(missingAmountDecisions({ ...decided, note: '   \n\t' }, CONFIG)).toEqual(['note']);
	});

	it('holds the donor to an honoree only once they have opened the tribute', () => {
		// the same distinction the note carries, one level down: an absent tribute is a donor who
		// never opened the disclosure, and an opened one is a decision they still owe. without it
		// "never opened it" and "opened it and named nobody" reach this function as one draft — and
		// the second is a gift `/api/v1` refuses (`parseTribute` names `tributeHonoree`).
		const decided = { amountMinor: 2500, frequency: 'one_time' } as const;

		expect(missingAmountDecisions(decided, CONFIG)).toEqual([]);
		expect(missingAmountDecisions({ ...decided, tribute: OPENED_TRIBUTE }, CONFIG)).toEqual([
			'tribute-honoree'
		]);
		expect(
			missingAmountDecisions(
				{ ...decided, tribute: { ...OPENED_TRIBUTE, honoree: '  Margaret Chen  ' } },
				CONFIG
			)
		).toEqual([]);
		// trimmed, for the reason the note is: a name of spaces reaches the endpoint as nothing at
		// all, so accepting it here is a press refused nowhere and a tribute naming nobody.
		expect(
			missingAmountDecisions({ ...decided, tribute: { ...OPENED_TRIBUTE, honoree: ' \t' } }, CONFIG)
		).toEqual(['tribute-honoree']);
	});

	it('asks for the person to tell as a pair, and for neither of them alone', () => {
		// the case the pairing rule exists for and the easy one to get wrong: both boxes blank is a
		// donor who asked for nobody to be told, and it is not a decision they are short of.
		const named = {
			amountMinor: 2500,
			frequency: 'one_time',
			tribute: { ...OPENED_TRIBUTE, honoree: 'Margaret Chen' }
		} as const;

		expect(missingAmountDecisions(named, CONFIG)).toEqual([]);
		expect(
			missingAmountDecisions(
				{ ...named, tribute: { ...named.tribute, notifyName: 'James Okonkwo' } },
				CONFIG
			)
		).toEqual(['tribute-notify-email']);
		expect(
			missingAmountDecisions(
				{ ...named, tribute: { ...named.tribute, notifyEmail: 'james@example.org' } },
				CONFIG
			)
		).toEqual(['tribute-notify-name']);
		expect(
			missingAmountDecisions(
				{
					...named,
					tribute: {
						...named.tribute,
						notifyName: 'James Okonkwo',
						notifyEmail: 'james@example.org'
					}
				},
				CONFIG
			)
		).toEqual([]);
	});

	it('refuses an address for the person to tell that is not one', () => {
		// the notification goes to somebody who never gave us their address, on the domain every
		// receipt also leaves from — so the shape is checked here rather than becoming a bounce
		// scored against that domain. the same rule the payer's own address is held to.
		const named = {
			amountMinor: 2500,
			frequency: 'one_time',
			tribute: {
				...OPENED_TRIBUTE,
				honoree: 'Margaret Chen',
				notifyName: 'James Okonkwo',
				notifyEmail: 'james'
			}
		} as const;

		expect(missingAmountDecisions(named, CONFIG)).toEqual(['tribute-notify-email']);
	});

	it('names the tribute’s decisions after the note, in the order the controls sit', () => {
		// the order is what a refused press reads to put the caret, so it is the order the block is
		// laid out in and never the order the rules were written in.
		expect(
			missingAmountDecisions(
				{ note: '', tribute: { ...OPENED_TRIBUTE, notifyEmail: 'james@example.org' } },
				CONFIG
			)
		).toEqual(['amount', 'note', 'tribute-honoree', 'tribute-notify-name']);
	});
});

describe('payerCoversFee', () => {
	it('answers with the donor’s own decision', () => {
		expect(payerCoversFee({ coversFee: true })).toBe(true);
		expect(payerCoversFee({ coversFee: false })).toBe(false);
	});

	it('covers the fee for a donor who has not decided yet', () => {
		// the line is opt-out: it is on when the receipt first renders and the donor turns it off.
		// asserted against the constant as well as against the value, because a call site that
		// defaulted for itself is the thing this function exists to prevent.
		expect(payerCoversFee({})).toBe(DEFAULT_COVERS_FEE);
		expect(payerCoversFee({ coversFee: undefined })).toBe(true);
	});
});

describe('completePayer', () => {
	const filled = {
		method: 'card',
		email: 'donor@example.org',
		firstName: 'Ada',
		lastName: 'Lovelace',
		coversFee: true,
		consentedToContact: false
	} as const;

	it('turns a filled donor draft into the payer a quote can be minted for', () => {
		expect(completePayer(filled, CONFIG)).toEqual({
			method: 'card',
			email: 'donor@example.org',
			firstName: 'Ada',
			lastName: 'Lovelace',
			coversFee: true,
			consentedToContact: false
		});
	});

	it('refuses a payer missing any field the receipt needs', () => {
		// the receipt is the thing the donor keeps, and it needs a name and an address to reach.
		// A blank one is a submit that cannot happen rather than an error rendered after a
		// round trip.
		expect(completePayer({ ...filled, email: '' }, CONFIG)).toBeNull();
		expect(completePayer({ ...filled, firstName: '   ' }, CONFIG)).toBeNull();
		expect(completePayer({ ...filled, lastName: '' }, CONFIG)).toBeNull();
		expect(completePayer({ ...filled, method: undefined }, CONFIG)).toBeNull();
	});

	it('refuses an address that could not be an address', () => {
		// deliberately shallow. Deliverability is not decidable from a string and the receipt
		// bouncing is the only real test; what this catches is the typo the donor can still fix
		// while looking at the field. Anything stricter starts refusing real addresses.
		expect(completePayer({ ...filled, email: 'donor' }, CONFIG)).toBeNull();
		expect(completePayer({ ...filled, email: 'donor@' }, CONFIG)).toBeNull();
		expect(completePayer({ ...filled, email: 'a b@example.org' }, CONFIG)).toBeNull();
	});

	it('refuses a rail this deployment does not offer', () => {
		// `paymentMethods` is data on the wire and which rails a deployment offers is that
		// deployment's decision, so a rail being in the union says nothing about the config in
		// front of this donor.
		expect(completePayer({ ...filled, method: 'apple_pay' }, CONFIG)).toBeNull();
	});

	it('takes the fee decision through the one function that holds the default', () => {
		// the boundary where the fee stops being a checkbox and becomes part of what is charged. a
		// draft that answered is honoured, and one that never did covers the fee — a `?? true` here
		// instead would be a second copy of the default, free to drift from the control's own state.
		expect(completePayer({ ...filled, coversFee: false }, CONFIG)?.coversFee).toBe(false);
		expect(completePayer({ ...filled, coversFee: undefined }, CONFIG)?.coversFee).toBe(true);
	});

	it('trims what it carries so a pasted address does not reach the API with spaces', () => {
		const payer = completePayer({ ...filled, email: ' donor@example.org ' }, CONFIG);
		expect(payer?.email).toBe('donor@example.org');
	});
});

describe('a wallet rail', () => {
	/** a deployment whose site is registered for both wallets, so the rail is genuinely offered. */
	const withWallets: FormConfig = {
		...CONFIG,
		paymentMethods: ['card', 'ach', 'apple_pay', 'google_pay']
	};

	const filled = {
		email: 'donor@example.org',
		firstName: 'Ada',
		lastName: 'Lovelace',
		coversFee: true,
		consentedToContact: false
	} as const;

	it('completes where the org offers it, exactly as a card does', () => {
		// a wallet takes its authorization in a sheet, and the sheet is opened by the confirmation
		// rather than by this press — so by the time a donor is standing on the Donate button a
		// wallet is complete in the same sense a card is, and refusing it here would refuse a rail
		// the provider's own box drew and the donor picked.
		expect(completePayer({ ...filled, method: 'apple_pay' }, withWallets)).not.toBeNull();
		expect(completePayer({ ...filled, method: 'google_pay' }, withWallets)).not.toBeNull();
		expect(completePayer({ ...filled, method: 'card' }, withWallets)).not.toBeNull();
	});

	it('is refused where the org does not offer it', () => {
		// the config's own list is the whole gate. a wallet the deployment was not approved for is
		// one the provider's box never draws, so a draft naming it is a report from nowhere.
		const noWallets = { ...withWallets, paymentMethods: ['card', 'ach'] } as FormConfig;
		expect(completePayer({ ...filled, method: 'apple_pay' }, noWallets)).toBeNull();
	});
});
