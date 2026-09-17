import { createActor } from 'xstate';
import { describe, expect, it } from 'vitest';
import {
	checkoutMachine,
	cryptoIsOffered,
	fundIsOffered,
	openFund,
	stepIsReachable,
	DEPOSIT_POLL_MS,
	MICRODEPOSIT_WINDOW_MS,
	PORT_TIMEOUT_MS
} from './checkout.machine';
import type { CheckoutEvent } from './checkout.machine';
import type { CheckoutPorts, ConfirmInput } from './ports';
import type { DonationStatus, FormConfig, Quote, QuoteRequest } from './v1';

// node pool: no browser, no DOM, no Stripe. that is the claim the machine exists to earn —
// the client's money path gets the same treatment as `src/lib/server/ledger/posting.ts` gets on
// the server — and this file is where it is either true or a slogan. everything the flow
// touches arrives through ./ports.ts, so the whole checkout runs on four ordinary functions.

const CONFIG: FormConfig = {
	formId: 'frm_a8x2k9',
	providers: [{ name: 'stripe', publishableKey: 'pk_test_x' }],
	currency: 'usd',
	suggestedAmountsMinor: [2500, 10_000],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time', 'monthly'],
	paymentMethods: ['card', 'ach', 'apple_pay'],
	feeCoverage: 'optional',
	feeRules: {
		card: { percent: 0.029, fixedMinor: 30 },
		ach: { percent: 0.008, fixedMinor: 0 },
		apple_pay: { percent: 0.029, fixedMinor: 30 },
		google_pay: { percent: 0.029, fixedMinor: 30 },
		paypal: { percent: 0.0349, fixedMinor: 49 },
		venmo: { percent: 0.0349, fixedMinor: 49 },
		daf: { percent: 0.029, fixedMinor: 0, roundUpMinor: 100 },
		crypto: { percent: 0.01, fixedMinor: 0 }
	},
	locale: 'en-US',
	orgLegalName: 'Acme Relief Fund',
	ein: '12-3456789',
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.'
};

/** a form that leaves the cause to the donor, which is the only shape that draws a control. */
const CHOICE_CONFIG: FormConfig = {
	...CONFIG,
	program: {
		mode: 'choice',
		options: [
			{ id: 'prg_water', name: 'Clean water' },
			{ id: 'prg_school', name: 'Schools' }
		]
	}
};

/** and one pinned to a single cause, which the server writes onto the gift from the form record. */
const PINNED_CONFIG: FormConfig = { ...CONFIG, program: { mode: 'pinned', name: 'Clean water' } };

/** a fixed start of time, so a deadline in a case reads as arithmetic rather than as `now`. */
const EPOCH = 1_700_000_000_000;

/**
 * a clock the test moves by hand, standing in for both the timer and `now()`.
 *
 * the microdeposit window is ten days. a test that waited for it would not be a test, and a
 * machine that reached for the ambient `setTimeout` would leave a ten-day timer pending in
 * every run that touched the state. Both problems are the same problem — the clock is an
 * input — and XState takes one on `createActor`, which is why this is eight lines rather than
 * a fake-timer library.
 */
function manualClock() {
	const timers = new Map<number, { readonly fn: () => void; readonly at: number }>();
	let seq = 0;
	let time = EPOCH;
	return {
		now: () => time,
		setTimeout(fn: () => void, ms: number): number {
			const id = ++seq;
			timers.set(id, { fn, at: time + ms });
			return id;
		},
		clearTimeout(id: number): void {
			timers.delete(id);
		},
		/** moves time forward and fires everything now due, including zero-delay transitions. */
		advance(ms: number): void {
			time += ms;
			for (const [id, timer] of [...timers]) {
				if (timer.at <= time) {
					timers.delete(id);
					timer.fn();
				}
			}
		}
	};
}

/** what each port was asked to do, so a spec can assert it was asked exactly once. */
type Calls = {
	quote: QuoteRequest[];
	confirm: ConfirmInput[];
	resume: string[];
	status: string[];
};

const QUOTE: Quote = { paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2606 };

type HarnessOptions = {
	readonly config?: FormConfig;
	readonly resume?: { readonly paymentToken: string };
	readonly quote?: (request: QuoteRequest) => Promise<Quote>;
	readonly confirm?: (input: ConfirmInput) => Promise<import('./ports').ConfirmOutcome>;
	readonly resumeWith?: () => Promise<import('./ports').ConfirmOutcome>;
	readonly status?: () => Promise<DonationStatus>;
};

/**
 * a started machine, the ports' call log, and the clock — the three things every case needs.
 *
 * The ports are plain functions rather than mocks: recording an argument and resolving a value
 * is all any of them does, and a mocking library here would only add a way to assert on the
 * stand-in instead of on the machine.
 */
function harness(options: HarnessOptions = {}) {
	const calls: Calls = { quote: [], confirm: [], resume: [], status: [] };
	const clock = manualClock();

	const ports: CheckoutPorts = {
		quote: (request) => {
			calls.quote.push(request);
			return options.quote?.(request) ?? Promise.resolve(QUOTE);
		},
		confirm: (input) => {
			calls.confirm.push(input);
			return options.confirm?.(input) ?? Promise.resolve({ kind: 'succeeded' as const });
		},
		resume: ({ paymentToken }) => {
			calls.resume.push(paymentToken);
			return options.resumeWith?.() ?? Promise.resolve({ kind: 'succeeded' as const });
		},
		status: ({ paymentToken }) => {
			calls.status.push(paymentToken);
			return options.status?.() ?? Promise.resolve({ state: 'waiting' as const });
		},
		now: clock.now
	};

	const actor = createActor(checkoutMachine, {
		clock,
		input: {
			config: options.config ?? CONFIG,
			ports,
			...(options.resume ? { resume: options.resume } : {})
		}
	});
	actor.start();
	return { actor, calls, clock };
}

/** lets every settled promise in the flow deliver before the next assertion. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** a port that accepts the call and never comes back, which is what a dropped response is. */
function neverAnswers(): Promise<never> {
	return new Promise(() => {});
}

/** drives a fresh machine to the details step with a $25 one-time gift already decided. */
function atDetails(options: HarnessOptions = {}) {
	const h = harness(options);
	h.actor.send({ type: 'SET_AMOUNT', amountMinor: 2500 });
	h.actor.send({ type: 'SET_FREQUENCY', frequency: 'one_time' });
	h.actor.send({ type: 'CONTINUE' });
	return h;
}

/** the review step, with the details behind it filled in and the rail reported. */
function readyToSubmit(options: HarnessOptions = {}) {
	const h = atDetails(options);
	h.actor.send({
		type: 'SET_CONTACT',
		email: 'donor@example.org',
		firstName: 'Ada',
		lastName: 'Lovelace'
	});
	h.actor.send({ type: 'CONTINUE' });
	h.actor.send({ type: 'SET_METHOD', method: 'card' });
	return h;
}

describe('the amount step', () => {
	it('opens on the amount step holding no decided value at all', () => {
		// `fv` is optional on this step and required after it, so a machine that opened with a
		// fabricated default — $25, one-time — would make that distinction unobservable and
		// would pre-decide a gift on the donor's behalf.
		const { actor } = harness();
		expect(actor.getSnapshot().value).toBe('amount');
		expect(actor.getSnapshot().context.fv).toBeNull();
	});

	it('opens with a cadence already chosen', () => {
		// a card that opened on an empty track asked the donor to answer a question that has an
		// obvious answer, and refused every press until they did. one-time is the answer wherever a
		// deployment offers it, and the first cadence it does offer where it does not — which is one
		// expression, because `FREQUENCIES` (./v1.ts) puts one-time first and the card draws the
		// cadences in that same order.
		expect(harness().actor.getSnapshot().context.draft.frequency).toBe('one_time');

		const monthlyOnward = harness({
			config: { ...CONFIG, frequencies: ['monthly', 'yearly'] }
		});
		expect(monthlyOnward.actor.getSnapshot().context.draft.frequency).toBe('monthly');
	});

	it('opens with the lowest suggestion as the amount, and none where nothing is suggested', () => {
		const { actor } = harness();
		expect(actor.getSnapshot().context.draft.amountMinor).toBe(
			Math.min(...CONFIG.suggestedAmountsMinor)
		);

		const bare = harness({ config: { ...CONFIG, suggestedAmountsMinor: [] } });
		expect(bare.actor.getSnapshot().context.draft.amountMinor).toBeUndefined();
	});

	it('ignores Continue until the donor has actually decided an amount', () => {
		// the guard is the transition, not a message. The screen already shows which choice is
		// empty; a sentence under a radio group the donor is looking at teaches nobody anything.
		// the seed is cleared first: the card opens holding the lowest suggestion, and this is the
		// donor who took it back.
		const { actor } = harness();
		actor.send({ type: 'CLEAR_AMOUNT' });
		actor.send({ type: 'CONTINUE' });
		expect(actor.getSnapshot().value).toBe('amount');

		actor.send({ type: 'SET_AMOUNT', amountMinor: 2500 });
		actor.send({ type: 'CONTINUE' });
		expect(actor.getSnapshot().value).toBe('details');
	});

	it('refuses to continue on an amount outside the bounds the org published', () => {
		// a client-side hint that saves a round trip, never a control: `/api/v1` re-checks both
		// bounds against the form record regardless, because a posted amount is never trusted.
		const { actor } = harness();
		actor.send({ type: 'SET_AMOUNT', amountMinor: 100 });
		actor.send({ type: 'SET_FREQUENCY', frequency: 'one_time' });
		actor.send({ type: 'CONTINUE' });
		expect(actor.getSnapshot().value).toBe('amount');
	});

	it('takes the amount back out of the draft when the donor withdraws it', () => {
		// a donor who deletes what they typed has un-decided the amount, and the draft is where
		// that has to land: an amount left in it is a gift the next press would carry into the
		// step that mints an intent.
		const { actor } = harness();
		actor.send({ type: 'SET_AMOUNT', amountMinor: 2500 });
		actor.send({ type: 'SET_FREQUENCY', frequency: 'one_time' });
		actor.send({ type: 'CLEAR_AMOUNT' });
		expect(actor.getSnapshot().context.draft.amountMinor).toBeUndefined();

		actor.send({ type: 'CONTINUE' });
		expect(actor.getSnapshot().value).toBe('amount');
	});

	it('answers a withdrawal on this step and on no other', () => {
		// past Continue the gift is committed and a quote may already be minted against it, so a
		// draft edited from behind that step would state an amount no figure on the card is for.
		// the event is dropped there the way any event a state does not handle is.
		const { actor } = atDetails();
		actor.send({ type: 'CLEAR_AMOUNT' });
		expect(actor.getSnapshot().context.draft.amountMinor).toBe(2500);
		expect(actor.getSnapshot().context.fv).toEqual({
			amountMinor: 2500,
			frequency: 'one_time',
			programId: null
		});
	});

	it('carries the decided value into the details step rather than leaving it behind', () => {
		// the design's one structural claim: a step is a variant that carries the value with it,
		// so an unreachable step cannot hold stale data. `fv` is non-null from here on.
		const { actor } = atDetails();
		expect(actor.getSnapshot().context.fv).toEqual({
			amountMinor: 2500,
			frequency: 'one_time',
			programId: null
		});
	});

	it('keeps the note the donor wrote on the step before it', () => {
		// the note belongs on the amount step, which every donor passes through, rather than on a
		// later one they may reach with the gift already decided.
		const { actor } = harness();
		actor.send({ type: 'SET_AMOUNT', amountMinor: 2500 });
		actor.send({ type: 'SET_FREQUENCY', frequency: 'one_time' });
		actor.send({ type: 'SET_NOTE', note: 'for the gala' });
		actor.send({ type: 'CONTINUE' });
		expect(actor.getSnapshot().context.fv?.note).toBe('for the gala');
	});

	it('holds a donor who opened the note to writing one', () => {
		// asking for the note is a decision the machine holds, so Continue is refused for a blank
		// one exactly as it is for a missing amount — and closing it again is the other way out.
		const { actor } = harness();
		actor.send({ type: 'SET_AMOUNT', amountMinor: 2500 });
		actor.send({ type: 'SET_FREQUENCY', frequency: 'one_time' });
		actor.send({ type: 'TOGGLE_NOTE' });
		actor.send({ type: 'CONTINUE' });
		expect(actor.getSnapshot().value).toBe('amount');

		actor.send({ type: 'TOGGLE_NOTE' });
		actor.send({ type: 'CONTINUE' });
		expect(actor.getSnapshot().value).toBe('details');
	});

	it('drops what was typed when the note is closed again', () => {
		// closing the note is the donor saying there is none, and a draft that kept the text would
		// carry it to the endpoint on a gift whose card no longer shows it.
		const { actor } = harness();
		actor.send({ type: 'TOGGLE_NOTE' });
		actor.send({ type: 'SET_NOTE', note: 'for the gala' });
		actor.send({ type: 'TOGGLE_NOTE' });
		expect(actor.getSnapshot().context.draft.note).toBeUndefined();
	});

	it('carries the cause the donor chose onto the decided gift', () => {
		const { actor } = harness({ config: CHOICE_CONFIG });
		actor.send({ type: 'SET_AMOUNT', amountMinor: 2500 });
		actor.send({ type: 'SET_PROGRAM', programId: 'prg_water' });

		expect(actor.getSnapshot().context.draft.programId).toBe('prg_water');

		actor.send({ type: 'CONTINUE' });

		expect(actor.getSnapshot().context.fv?.programId).toBe('prg_water');
	});

	it('reads a donor taking their choice back as a gift where it is needed most', () => {
		// the first option is an answer rather than a blank, so putting the select back on it is a
		// decision the flow holds — and one no press is ever refused for.
		const { actor } = harness({ config: CHOICE_CONFIG });
		actor.send({ type: 'SET_AMOUNT', amountMinor: 2500 });
		actor.send({ type: 'SET_PROGRAM', programId: 'prg_water' });
		actor.send({ type: 'SET_PROGRAM', programId: null });

		expect(actor.getSnapshot().context.draft.programId).toBeUndefined();

		actor.send({ type: 'CONTINUE' });

		expect(actor.getSnapshot().context.fv?.programId).toBeNull();
	});

	it('opens the tribute on a kind the control is already showing', () => {
		// the select is a two-member choice with no unset reading, so the draft is seeded with what
		// the control draws. a draft holding nothing under a select reading `In honor of` is the
		// screen and the flow saying different things about one gift.
		const { actor } = harness();
		actor.send({ type: 'TOGGLE_TRIBUTE' });
		expect(actor.getSnapshot().context.draft.tribute).toEqual({
			kind: 'honor',
			honoree: '',
			notifyName: '',
			notifyEmail: ''
		});
	});

	it('holds a donor who opened the tribute to naming somebody', () => {
		// the same shape the note's refusal has: opening it is a decision the machine holds, and
		// closing it again is the other way out.
		const { actor } = harness();
		actor.send({ type: 'SET_AMOUNT', amountMinor: 2500 });
		actor.send({ type: 'SET_FREQUENCY', frequency: 'one_time' });
		actor.send({ type: 'TOGGLE_TRIBUTE' });
		actor.send({ type: 'CONTINUE' });
		expect(actor.getSnapshot().value).toBe('amount');

		actor.send({ type: 'SET_TRIBUTE', honoree: 'Margaret Chen' });
		actor.send({ type: 'CONTINUE' });
		expect(actor.getSnapshot().value).toBe('details');
		expect(actor.getSnapshot().context.fv?.tribute).toEqual({
			kind: 'honor',
			honoree: 'Margaret Chen',
			notify: null
		});
	});

	it('drops what was typed when the tribute is closed again', () => {
		// closing it is the donor saying this gift carries none, and a draft that kept the name
		// would put a `tributeKind` on a gift whose card no longer shows one.
		const { actor } = harness();
		actor.send({ type: 'TOGGLE_TRIBUTE' });
		actor.send({ type: 'SET_TRIBUTE', kind: 'memory', honoree: 'Margaret Chen' });
		actor.send({ type: 'TOGGLE_TRIBUTE' });
		expect(actor.getSnapshot().context.draft.tribute).toBeUndefined();
	});

	it('ignores a tribute box typed into while the disclosure is closed', () => {
		// there is nothing to merge a box into, and fabricating a tribute out of one is a gift
		// dedicated by a stray event rather than by the donor.
		const { actor } = harness();
		actor.send({ type: 'SET_TRIBUTE', honoree: 'Margaret Chen' });
		expect(actor.getSnapshot().context.draft.tribute).toBeUndefined();
	});
});

describe('the details step', () => {
	it('refuses to continue until every field the receipt needs is filled in', () => {
		// the receipt is the thing the donor keeps, and it needs somewhere to go. a press that
		// could not produce one is a transition that does not happen rather than a donor carried
		// on to the screen that spends the money with nowhere to send what it buys.
		const { actor } = atDetails();
		actor.send({ type: 'CONTINUE' });
		expect(actor.getSnapshot().value).toBe('details');

		actor.send({
			type: 'SET_CONTACT',
			email: 'donor@example.org',
			firstName: 'Ada',
			lastName: 'Lovelace'
		});
		actor.send({ type: 'CONTINUE' });
		expect(actor.getSnapshot().value).toBe('give');
	});

	it('never holds the donor to a rail here, because the rail is on the step after', () => {
		// the fields are this step's whole question. the payment provider's own picker is on the
		// review step, so a guard that asked for a rail would refuse a Continue for the one thing
		// the donor has had no opportunity to do.
		const { actor } = atDetails();
		actor.send({
			type: 'SET_CONTACT',
			email: 'donor@example.org',
			firstName: 'Ada',
			lastName: 'Lovelace'
		});
		actor.send({ type: 'CONTINUE' });

		expect(actor.getSnapshot().value).toBe('give');
		expect(actor.getSnapshot().context.payerDraft.method).toBeUndefined();
	});

	it('keeps what was typed when the donor goes back for the amount and returns', () => {
		// walking the pair of steps is not an edit to anything the donor entered. `beginAttempt`
		// runs on entry to both and is idempotent for exactly this.
		const { actor } = atDetails();
		actor.send({ type: 'SET_CONTACT', email: 'donor@example.org' });
		actor.send({ type: 'GO_TO_STEP', step: 'amount' });
		expect(actor.getSnapshot().value).toBe('amount');

		actor.send({ type: 'CONTINUE' });

		expect(actor.getSnapshot().value).toBe('details');
		expect(actor.getSnapshot().context.payerDraft.email).toBe('donor@example.org');
	});
});

describe('the review step', () => {
	it('refuses to submit until the provider has reported a rail it can charge', () => {
		const { actor, calls } = atDetails();
		actor.send({
			type: 'SET_CONTACT',
			email: 'donor@example.org',
			firstName: 'Ada',
			lastName: 'Lovelace'
		});
		actor.send({ type: 'CONTINUE' });
		actor.send({ type: 'SUBMIT' });

		expect(actor.getSnapshot().value).toBe('give');
		expect(calls.quote).toHaveLength(0);
	});

	it('states an estimated fee before any rail is known, at the first rail on offer', () => {
		// the fee line is a stated amount rather than an abstract toggle, so a number has to exist
		// before the intent does — and the rail is picked inside the provider's own fields on the
		// review step, so waiting for one leaves the decision priced at nothing for as long as the
		// donor takes to fill them in. $25.00 at card's 2.9% + 30c grosses up to $26.06, and
		// `displayRail` reads card off `paymentMethods` above.
		const { actor } = atDetails();
		expect(actor.getSnapshot().context.estimate).toEqual({ feeMinor: 106, totalMinor: 2606 });
		actor.send({ type: 'SET_METHOD', method: 'card' });
		expect(actor.getSnapshot().context.estimate).toEqual({ feeMinor: 106, totalMinor: 2606 });
	});

	it('prices the default against the rails the deployment offers, never card by assumption', () => {
		// every rail but ach settles as a card, so a deployment that does not offer card is the one
		// configuration where the default is visible — and quoting it at card's price would state a
		// figure no donor on that deployment can ever be charged.
		const { actor } = atDetails({ config: { ...CONFIG, paymentMethods: ['ach'] } });

		expect(actor.getSnapshot().context.estimate).toEqual({ feeMinor: 21, totalMinor: 2521 });
	});

	it('re-estimates when the donor changes rails, because Stripe’s price is per rail', () => {
		// the whole reason `feeRules` is keyed by method. A bank debit at 0.8% and no flat
		// charge is a different number, and a fee line that did not move on a rail change would
		// be stating the wrong one.
		const { actor } = atDetails();
		actor.send({ type: 'SET_METHOD', method: 'ach' });
		expect(actor.getSnapshot().context.estimate).toEqual({ feeMinor: 21, totalMinor: 2521 });
	});

	it('drops the rail when the provider reports no selection, and prices the row as it found it', () => {
		// the report comes from the provider's own picker and `null` is one of its answers — a
		// collapsed picker, or a selection this form does not take. the payer is what it clears, and
		// that is the half that costs money: a rail left standing is a submit on one the donor is not
		// on. the stated figure goes back to the default rather than blank, which is where every
		// donor found the row before they touched the picker.
		const { actor } = readyToSubmit();
		actor.send({ type: 'SET_METHOD', method: 'ach' });
		expect(actor.getSnapshot().context.estimate).toEqual({ feeMinor: 21, totalMinor: 2521 });

		actor.send({ type: 'SET_METHOD', method: null });

		expect(actor.getSnapshot().context.estimate).toEqual({ feeMinor: 106, totalMinor: 2606 });
		expect(actor.getSnapshot().context.payerDraft.method).toBeUndefined();
	});

	// the guarantee the default is allowed to exist under, and it is a property of the guards rather
	// than of the figure: a rail nobody chose can never be the rail a gift is reconciled against,
	// because no press that mints an intent is taken while none is chosen. without it the default
	// would be a figure the correction screen measures a real charge against.
	it('never carries the default rail’s figure into a reconciliation', () => {
		const { actor } = atDetails();
		actor.send({
			type: 'SET_CONTACT',
			email: 'donor@example.org',
			firstName: 'Ada',
			lastName: 'Lovelace'
		});
		actor.send({ type: 'CONTINUE' });
		// the donor is standing on the review step with the default priced and no rail chosen.
		expect(actor.getSnapshot().value).toBe('give');
		expect(actor.getSnapshot().context.estimate).toEqual({ feeMinor: 106, totalMinor: 2606 });

		actor.send({ type: 'SUBMIT' });

		expect(actor.getSnapshot().value).toBe('give');
		expect(actor.getSnapshot().context.reconciliation).toBeNull();
	});

	it('lets the donor decline the fee, and change their mind again', () => {
		// the decision is the donor's both ways round: the estimate goes when they decline and
		// comes back when they do not, off the same event, so the figure the Donate button states
		// follows the control rather than the last press that happened to be handled.
		const { actor } = readyToSubmit();

		actor.send({ type: 'TOGGLE_FEE_COVERAGE' });
		expect(actor.getSnapshot().context.estimate).toBeNull();

		actor.send({ type: 'TOGGLE_FEE_COVERAGE' });
		expect(actor.getSnapshot().context.estimate).toEqual({ feeMinor: 106, totalMinor: 2606 });
	});

	it('answers no fee decision from the step before it', () => {
		// the control is inside the receipt and the receipt is here, so an event sent from the
		// details step is one the flow drops rather than a fee changed on a screen not showing one.
		const { actor } = atDetails();
		actor.send({ type: 'SET_METHOD', method: 'card' });
		actor.send({ type: 'TOGGLE_FEE_COVERAGE' });

		expect(actor.getSnapshot().context.estimate).toEqual({ feeMinor: 106, totalMinor: 2606 });
	});
});

describe('the press that spends the money', () => {
	it('mints exactly one intent however many times the donor presses Donate', async () => {
		// the claim the whole machine exists for, and the reason it is asserted on the port
		// rather than on a `disabled` attribute: a disabled button is a rendering detail that a
		// keyboard Enter, a host page's own script or a re-render that dropped the prop walks
		// straight past. Here the second press reaches a state that does not handle `SUBMIT`,
		// so there is no second intent to mint, and the surface a card-testing bot could farm
		// stays as small as one attempt.
		const { actor, calls } = readyToSubmit();
		actor.send({ type: 'SUBMIT' });
		actor.send({ type: 'SUBMIT' });
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(calls.quote).toHaveLength(1);
	});

	it('sends the decided gift and donor to the API in one request', async () => {
		const { actor, calls } = readyToSubmit();
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(calls.quote[0]).toEqual({
			formId: 'frm_a8x2k9',
			amountMinor: 2500,
			frequency: 'one_time',
			method: 'card',
			coversFee: true,
			email: 'donor@example.org',
			firstName: 'Ada',
			lastName: 'Lovelace',
			consentedToContact: false
		});
	});

	it('flattens a dedicated gift onto the four fields the endpoint parses', async () => {
		// the wire is flat where `FormValue` is nested, and this is the one seam between them. the
		// notify pair is omitted rather than emptied where the donor named nobody to tell, which is
		// the answer `parseTribute` reads as "tell nobody" — a blank string there is a value.
		const { actor, calls } = readyToSubmit();
		actor.send({ type: 'GO_TO_STEP', step: 'amount' });
		actor.send({ type: 'TOGGLE_TRIBUTE' });
		actor.send({ type: 'SET_TRIBUTE', kind: 'memory', honoree: 'Margaret Chen' });
		actor.send({ type: 'CONTINUE' });
		actor.send({ type: 'CONTINUE' });
		actor.send({ type: 'SET_METHOD', method: 'card' });
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(calls.quote[0]).toMatchObject({
			tributeKind: 'memory',
			tributeHonoree: 'Margaret Chen'
		});
		expect(calls.quote[0]).not.toHaveProperty('tributeNotifyName');
		expect(calls.quote[0]).not.toHaveProperty('tributeNotifyEmail');
	});

	it('sends the cause the donor chose', async () => {
		const { actor, calls } = readyToSubmit({ config: CHOICE_CONFIG });
		actor.send({ type: 'GO_TO_STEP', step: 'amount' });
		actor.send({ type: 'SET_PROGRAM', programId: 'prg_school' });
		actor.send({ type: 'CONTINUE' });
		actor.send({ type: 'CONTINUE' });
		actor.send({ type: 'SET_METHOD', method: 'card' });
		actor.send({ type: 'SUBMIT' });
		await settle();

		expect(calls.quote[0]).toMatchObject({ programId: 'prg_school' });
	});

	it('sends no program on a gift the donor chose no cause for', async () => {
		// an absent field is how the endpoint is told the gift goes where it is needed most, so an
		// empty string here would be an id nothing in the form's list carries.
		const { actor, calls } = readyToSubmit({ config: CHOICE_CONFIG });
		actor.send({ type: 'SUBMIT' });
		await settle();

		expect(calls.quote[0]).not.toHaveProperty('programId');
	});

	it('sends no program on a form pinned to one cause', async () => {
		// the pin is the server's to write from the form record. a client sending it back would be
		// offering to overwrite a decision it was only told about.
		const { actor, calls } = readyToSubmit({ config: PINNED_CONFIG });
		actor.send({ type: 'SUBMIT' });
		await settle();

		expect(calls.quote[0]).not.toHaveProperty('programId');
	});

	it('sends no tribute field at all on a gift that carries none', async () => {
		// absent is what says a gift has no tribute, so four empty strings would put a kind on
		// every gift ever given through this form.
		const { calls, actor } = readyToSubmit();
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(calls.quote[0]).not.toHaveProperty('tributeKind');
		expect(calls.quote[0]).not.toHaveProperty('tributeHonoree');
	});

	it('charges straight through when authority charges the figure that was shown', async () => {
		// one press, one charge. the correction screen is not a step in the flow — a donor whose
		// estimate was right never sees it, and putting them in front of it would be asking them
		// to agree with a number they have just agreed with.
		const { actor, calls } = readyToSubmit();
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().value).toBe('success');
		expect(calls.confirm).toHaveLength(1);
	});

	it('stops on the correction screen instead of charging, when the total moved', async () => {
		// the seam. The estimate came from a published rate; the server knows the real one. When
		// they differ the flow stops, because a donor who pressed a button saying $26.06 and was
		// charged $26.50 was not told.
		const { actor, calls } = readyToSubmit({
			quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 150, totalMinor: 2650 })
		});
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().value).toBe('confirm');
		expect(calls.confirm).toHaveLength(0);
		expect(actor.getSnapshot().context.reconciliation).toMatchObject({
			kind: 'adjusted',
			shownTotalMinor: 2606,
			totalMinor: 2650,
			deltaMinor: 44
		});
	});

	it('confirms only once, however many times the donor presses the correction’s control', async () => {
		// the same structural guarantee as the submit above, at the screen that actually moves
		// money — and the one where a double press is most likely, because the donor has already
		// pressed once and the figure moved under them.
		const { actor, calls } = readyToSubmit({
			quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 150, totalMinor: 2650 })
		});
		actor.send({ type: 'SUBMIT' });
		await settle();
		actor.send({ type: 'CONFIRM' });
		actor.send({ type: 'CONFIRM' });
		await settle();
		expect(calls.confirm).toHaveLength(1);
		expect(actor.getSnapshot().value).toBe('success');
	});

	it('lets the donor back out to the review step with the gift and their details intact', async () => {
		// backing out of the correction is a change of mind, not a reset. Losing the typed email
		// here would be the form punishing hesitation on the screen that asks for money.
		const { actor } = readyToSubmit({
			quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 150, totalMinor: 2650 })
		});
		actor.send({ type: 'SUBMIT' });
		await settle();
		actor.send({ type: 'BACK' });
		expect(actor.getSnapshot().value).toBe('give');
		expect(actor.getSnapshot().context.payerDraft.email).toBe('donor@example.org');
		expect(actor.getSnapshot().context.fv).toEqual({
			amountMinor: 2500,
			frequency: 'one_time',
			programId: null
		});
	});

	it('turns a refused quote into a failure the donor can retry from', async () => {
		// CLAUDE.md requires every 4xx to name the offending value and where to fix it, because
		// the integrator is usually an agent with no console. carrying that sentence through
		// instead of flattening it to "something went wrong" is what makes the requirement worth
		// anything on the client.
		const { actor } = readyToSubmit({
			quote: async () => {
				throw new Error('This origin is not on form frm_a8x2k9’s allowlist.');
			}
		});
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.failure?.message).toContain('allowlist');

		actor.send({ type: 'RETRY' });
		expect(actor.getSnapshot().value).toBe('give');
	});

	it('says outright that nothing was charged when a press did not become a quote', async () => {
		// the press that reaches this failure is the last one on the review step and looks like an
		// authorizing press. a donor not told their card was untouched reasonably assumes it was
		// and goes and gives somewhere else.
		const { actor } = readyToSubmit({
			quote: async () => {
				throw new Error('');
			}
		});
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().context.failure?.message).toBe(
			'This gift was not started, and nothing was charged. Please try again.'
		);
	});
});

/**
 * the press made over provider fields the donor has not filled in, which is not an attempt at all.
 *
 * the adapter's own validation stops it before anything leaves the page — no rail touched, nothing
 * refused — so there is nothing to tell the donor that the fields are not already telling them, and
 * nowhere to go but the step they are standing on.
 */
describe('a press over fields the donor has not finished', () => {
	it('stays on the review step rather than ending the gift', async () => {
		// the defect: read as a decline this lands on "this gift was not completed" with a Try again
		// that goes straight back to the same unfinished fields — a donor thrown out of a form and
		// returned to it for having not filled it in yet.
		const seen: unknown[] = [];
		const { actor } = readyToSubmit({ confirm: async () => ({ kind: 'unfinished' }) });
		actor.subscribe((snapshot) => seen.push(snapshot.value));
		actor.send({ type: 'SUBMIT' });
		await settle();

		expect(actor.getSnapshot().value).toBe('give');
		expect(seen).not.toContain('failed');
		expect(actor.getSnapshot().context.failure).toBeNull();
	});

	it('takes the next press once the donor has finished them', async () => {
		// the whole of what "the control is pressable again" means where no control is ever rendered
		// disabled: the state the flow came back to handles `SUBMIT`, and the press is a fresh attempt
		// against a fresh intent rather than a re-confirmation of the one this press abandoned.
		let confirmed = 0;
		const { actor, calls } = readyToSubmit({
			confirm: async () => {
				confirmed += 1;
				return confirmed === 1 ? { kind: 'unfinished' } : { kind: 'succeeded' };
			}
		});
		actor.send({ type: 'SUBMIT' });
		await settle();
		actor.send({ type: 'SUBMIT' });
		await settle();

		expect(actor.getSnapshot().value).toBe('success');
		expect(calls.confirm).toHaveLength(2);
		expect(calls.quote).toHaveLength(2);
	});

	// the half of the mapping this change does not touch. an issuer that says no *is* an outcome of
	// the gift, and it keeps the ending it has: a sentence in the rail's own words and a Try again.
	it('leaves an issuer’s refusal ending the gift, as it does today', async () => {
		const { actor } = readyToSubmit({
			confirm: async () => ({ kind: 'declined', message: 'Your card was declined.' })
		});
		actor.send({ type: 'SUBMIT' });
		await settle();

		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.failure?.message).toBe('Your card was declined.');
	});
});

/**
 * the mark that says the rail itself refused, which is not every way the flow stops.
 *
 * eleven transitions reach `failed` and one of them is an issuer saying no. what separates them is
 * what the donor can do next — different card details get a refused charge through, and nothing
 * they can type gets them past a quote the server would not mint — and the words alone cannot
 * carry that: `toFailure` gives a bare `{ message }` to either of them.
 */
describe('the mark on a failure the rail refused', () => {
	it('marks an issuer\u2019s refusal as the rail\u2019s own', async () => {
		const { actor } = readyToSubmit({
			confirm: async () => ({ kind: 'declined', message: 'Your card was declined.' })
		});
		actor.send({ type: 'SUBMIT' });
		await settle();

		expect(actor.getSnapshot().context.failure?.refusedByRail).toBe(true);
	});

	it('leaves a rejected quote unmarked, though it carries no fix either', async () => {
		// the discriminator an absent `fix` would be, refuted: this failure has none and no rail
		// was ever reached.
		const { actor } = readyToSubmit({
			quote: async () => {
				throw new Error('This form is not accepting donations right now.');
			}
		});
		actor.send({ type: 'SUBMIT' });
		await settle();

		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.failure?.fix).toBeUndefined();
		expect(actor.getSnapshot().context.failure?.refusedByRail).toBeUndefined();
	});
});

// the rule the correction screen is gated on, asserted on its own. routing on whether an estimate
// exists is the naive version of it and fails two ordinary cases outright: a donor who declines to
// cover the fee, and a rail this config publishes no rule for, both leave `currentEstimate`
// answering `null` while the charge can still match the button exactly. what decides is whether
// authority is charging the figure the donor was last shown, and nothing else.
describe('where the correction screen is and is not shown', () => {
	/** submits one gift under one configuration and reports where the flow came to rest. */
	async function route(
		options: HarnessOptions,
		drive: (send: (event: never) => void) => void = () => {}
	) {
		const h = readyToSubmit(options);
		drive(h.actor.send as (event: never) => void);
		h.actor.send({ type: 'SUBMIT' });
		await settle();
		return h;
	}

	it('charges through when the estimate matched', async () => {
		// $25.00 at 2.9% + 30c is $26.06, and the server says the same.
		const { actor, calls } = await route({});
		expect(actor.getSnapshot().value).toBe('success');
		expect(calls.confirm[0]?.paymentToken).toBe('pi_1_secret_x');
	});

	it('charges through where no rule could be estimated and the gift is what is charged', async () => {
		// the config publishes no card rule, so the donor is shown $25.00 and charged $25.00 with
		// nothing ever estimated. a flow keyed off the estimate would put every donor on this
		// deployment through a fourth screen, permanently.
		const { actor } = await route({
			config: {
				...CONFIG,
				feeRules: {
					ach: { percent: 0.008, fixedMinor: 0 },
					apple_pay: { percent: 0.029, fixedMinor: 30 },
					google_pay: { percent: 0.029, fixedMinor: 30 },
					paypal: { percent: 0.0349, fixedMinor: 49 },
					venmo: { percent: 0.0349, fixedMinor: 49 },
					daf: { percent: 0.029, fixedMinor: 0, roundUpMinor: 100 },
					crypto: { percent: 0.01, fixedMinor: 0 }
				} as FormConfig['feeRules']
			},
			quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 0, totalMinor: 2500 })
		});
		expect(actor.getSnapshot().value).toBe('success');
		expect(actor.getSnapshot().context.reconciliation?.kind).toBe('unestimated');
	});

	it('charges through for a donor who declined to cover the fee', async () => {
		// the other half of the same trap, and it is per donor rather than per deployment: the
		// estimate is `null` the moment coverage is declined, on a config that offers the choice.
		const { actor } = await route(
			{ quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 0, totalMinor: 2500 }) },
			(send) => send({ type: 'TOGGLE_FEE_COVERAGE' } as never)
		);
		expect(actor.getSnapshot().value).toBe('success');
		expect(actor.getSnapshot().context.reconciliation?.kind).toBe('unestimated');
	});

	it('stops on the correction screen when the estimate was off by a cent', async () => {
		const { actor, calls } = await route({
			quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 107, totalMinor: 2607 })
		});
		expect(actor.getSnapshot().value).toBe('confirm');
		expect(calls.confirm).toHaveLength(0);
		expect(actor.getSnapshot().context.reconciliation).toMatchObject({ deltaMinor: 1 });
	});

	it('stops on the correction screen where no rule could be estimated but a fee is charged', async () => {
		// the case a rule keyed off the estimate gets exactly backwards. the config publishes no
		// card rule, so the donor was shown the gift itself — and the server charges a fee on top
		// of it, which is a figure the donor has never seen.
		const { actor, calls } = await route({
			config: {
				...CONFIG,
				feeRules: {
					ach: { percent: 0.008, fixedMinor: 0 },
					apple_pay: { percent: 0.029, fixedMinor: 30 },
					google_pay: { percent: 0.029, fixedMinor: 30 },
					paypal: { percent: 0.0349, fixedMinor: 49 },
					venmo: { percent: 0.0349, fixedMinor: 49 },
					daf: { percent: 0.029, fixedMinor: 0, roundUpMinor: 100 },
					crypto: { percent: 0.01, fixedMinor: 0 }
				} as FormConfig['feeRules']
			},
			quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 175, totalMinor: 2675 })
		});
		expect(actor.getSnapshot().value).toBe('confirm');
		expect(calls.confirm).toHaveLength(0);
		expect(actor.getSnapshot().context.reconciliation).toMatchObject({
			kind: 'adjusted',
			shownTotalMinor: 2500,
			totalMinor: 2675
		});
	});
});

describe('the ACH mandate', () => {
	const withMandate = {
		quote: async (): Promise<Quote> => ({
			paymentToken: 'pi_ach_secret_x',
			feeMinor: 21,
			totalMinor: 2521,
			mandate: { text: 'By continuing you authorize Acme Relief Fund to debit your account.' }
		})
	};

	it('stands between the quote and the debit when the rail demands one', async () => {
		// the donor has to accept wording authorizing a debit from their bank account, and it is
		// Stripe's wording rather than ours — writing one would be authoring a legal instrument
		// on the org's behalf. it hangs off the same junction the correction screen does, so a
		// gift whose total never moved still cannot reach the charge without passing through it.
		const { actor, calls } = readyToSubmit(withMandate);
		actor.send({ type: 'SET_METHOD', method: 'ach' });
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().value).toBe('mandate');
		expect(calls.confirm).toHaveLength(0);
	});

	it('shows the correction before the authorization when the total moved as well', async () => {
		// ordering, and it is the rule rather than an accident: an authorization collected over a
		// figure the donor was never shown is a debit authorized for the wrong number.
		const { actor } = readyToSubmit({
			quote: async (): Promise<Quote> => ({
				paymentToken: 'pi_ach_secret_x',
				feeMinor: 50,
				totalMinor: 2550,
				mandate: { text: 'By continuing you authorize Acme Relief Fund to debit your account.' }
			})
		});
		actor.send({ type: 'SET_METHOD', method: 'ach' });
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().value).toBe('confirm');

		actor.send({ type: 'CONFIRM' });
		expect(actor.getSnapshot().value).toBe('mandate');
	});

	it('tells the rail the authorization was actually given', async () => {
		// passed rather than assumed, so an adapter cannot confirm a debit that no mandate state
		// was entered for — the ordering in the machine and the flag on the wire say the same
		// thing.
		const { actor, calls } = readyToSubmit(withMandate);
		actor.send({ type: 'SET_METHOD', method: 'ach' });
		actor.send({ type: 'SUBMIT' });
		await settle();
		actor.send({ type: 'ACCEPT_MANDATE' });
		await settle();
		expect(calls.confirm[0]).toMatchObject({ method: 'ach', mandateAccepted: true });
	});

	it('treats a declined authorization as a change of rail, not a failure', async () => {
		// refusing to let someone debit your bank account is not an error and must not be shown
		// as one; the donor lands back on the form with a card still available.
		const { actor } = readyToSubmit(withMandate);
		actor.send({ type: 'SET_METHOD', method: 'ach' });
		actor.send({ type: 'SUBMIT' });
		await settle();
		actor.send({ type: 'DECLINE_MANDATE' });
		// back on the review step, where the provider's own fields are: changing rail is what a
		// declined authorization is, and the picker is there.
		expect(actor.getSnapshot().value).toBe('give');
	});
});

describe('bank verification and its ten-day window', () => {
	const awaiting = {
		confirm: async () =>
			({ kind: 'awaiting_microdeposits', expiresAt: EPOCH + MICRODEPOSIT_WINDOW_MS }) as const
	};

	it('waits for the donor to find the microdeposits rather than calling the gift done', async () => {
		// not `success`. The money has not moved and the webhook has made no claim yet — the ledger
		// row is written when a verified delivery settles (`src/lib/server/donations/settle.ts`), and
		// this state is the client agreeing not to get ahead of it.
		const { actor } = readyToSubmit(awaiting);
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().value).toBe('awaitingVerification');
		expect(actor.getSnapshot().context.verificationDeadline).toBe(EPOCH + MICRODEPOSIT_WINDOW_MS);
	});

	it('expires the verification when the window closes, rather than waiting forever', async () => {
		// a timeout with a transition, not a wait. Stripe reverts the intent to requiring payment
		// details after ten days, so the machine has to have somewhere to be when that happens —
		// a state that just sat there would leave the donor's screen claiming a gift is pending
		// that Stripe has already abandoned.
		const { actor, clock } = readyToSubmit(awaiting);
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().value).toBe('awaitingVerification');

		clock.advance(MICRODEPOSIT_WINDOW_MS - 1);
		expect(actor.getSnapshot().value).toBe('awaitingVerification');
		clock.advance(1);
		expect(actor.getSnapshot().value).toBe('verificationExpired');
	});

	it('expires immediately for a donor who comes back after the deadline has passed', async () => {
		// the case that actually happens. Nobody sits on a donation form for ten days; they close
		// the tab and return on day twelve. The delay is computed from the deadline and floored
		// at zero, so a resume past it fires on the next tick — which is why this is one delayed
		// transition rather than a timer plus a separate staleness check somebody forgets.
		const { actor, clock } = harness({
			resume: { paymentToken: 'pi_ach_secret_x' },
			resumeWith: async () => ({
				kind: 'awaiting_microdeposits',
				expiresAt: EPOCH - 1
			})
		});
		await settle();
		clock.advance(0);
		expect(actor.getSnapshot().value).toBe('verificationExpired');
	});

	it('derives a deadline when the rail did not state one, so the branch can still fire', async () => {
		// a state with no deadline is a state the expiry branch can never leave. Erring generous
		// keeps the donor's gift alive and the next resume corrects it.
		const { actor } = readyToSubmit({
			confirm: async () => ({ kind: 'awaiting_microdeposits' })
		});
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().context.verificationDeadline).toBe(EPOCH + MICRODEPOSIT_WINDOW_MS);
	});

	it('sends an expired donor back for new payment details with no spent quote in hand', async () => {
		// the intent has reverted, so carrying its client secret forward would mean confirming
		// something that cannot be confirmed on a screen that just said "try again".
		const { actor, clock } = readyToSubmit(awaiting);
		actor.send({ type: 'SUBMIT' });
		await settle();
		clock.advance(MICRODEPOSIT_WINDOW_MS);
		actor.send({ type: 'RETRY' });
		expect(actor.getSnapshot().value).toBe('give');
		expect(actor.getSnapshot().context.quote).toBeNull();
	});
});

describe('3DS and the cold return', () => {
	it('parks in a state of its own when the browser leaves for the donor’s bank', async () => {
		// the redirect is a state, not an accident. There is nothing to observe afterwards — the
		// page is about to stop existing — but naming it is what gives the thing that comes back
		// somewhere to have come from, and keeps a "still processing" spinner off a page that is
		// navigating away.
		const { actor } = readyToSubmit({ confirm: async () => ({ kind: 'redirecting' }) });
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().value).toBe('redirecting');
	});

	it('resumes from a bare client secret on a page load that remembers nothing', async () => {
		// cross-origin, on the org's site, in a brand-new javascript context. Everything the
		// donor decided is gone; all that survives is a secret in the URL. Booting into `amount`
		// would show an empty donation form to somebody who has already paid — which is how a
		// donor gives twice.
		const { actor, calls } = harness({ resume: { paymentToken: 'pi_3ds_secret_x' } });
		await settle();
		expect(calls.resume).toEqual(['pi_3ds_secret_x']);
		expect(actor.getSnapshot().value).toBe('success');
	});

	it('never shows the amount step to a returning donor, not even for one frame', () => {
		// an eager fork rather than a redirect-after-render: the first snapshot anything can
		// observe is already past the decision, so there is no flash of an empty form.
		const seen: unknown[] = [];
		const { actor } = harness({ resume: { paymentToken: 'pi_3ds_secret_x' } });
		actor.subscribe((snapshot) => seen.push(snapshot.value));
		expect(actor.getSnapshot().value).toBe('resuming');
		expect(seen).not.toContain('amount');
	});

	it('reports a gift that failed while nobody was watching in the rail’s own words', async () => {
		const { actor } = harness({
			resume: { paymentToken: 'pi_3ds_secret_x' },
			resumeWith: async () => ({ kind: 'declined', message: 'Your bank declined the payment.' })
		});
		await settle();
		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.failure?.message).toBe('Your bank declined the payment.');
	});

	it('reports settlement still in flight rather than claiming the gift is complete', async () => {
		// ACH settles in 4–5 business days and the donor is gone. "Processing" is the honest
		// answer on re-entry; `success` would be the client asserting something only the webhook
		// can know.
		const { actor } = harness({
			resume: { paymentToken: 'pi_ach_secret_x' },
			resumeWith: async () => ({ kind: 'processing' })
		});
		await settle();
		expect(actor.getSnapshot().value).toBe('processing');
	});

	it('sends a returning donor back to their bank rather than telling them the gift failed', async () => {
		// the most common cold load there is: the donor is mid-3DS on a page that is about to be
		// replaced again. Reading that as a failure would put a Retry button in front of somebody
		// whose bank is still deciding, and that press mints a second intent against a live one.
		const { actor, calls } = harness({
			resume: { paymentToken: 'pi_3ds_secret_x' },
			resumeWith: async () => ({ kind: 'redirecting' })
		});
		await settle();
		expect(actor.getSnapshot().value).toBe('redirecting');
		expect(calls.quote).toHaveLength(0);
	});
});

// the marks on the step head are the only way back through the form, so what they are allowed to
// do is the whole of where a donor may stand. two rules, and they are not symmetrical: a step
// already behind the donor is always theirs to return to, and a step ahead is theirs only once the
// ones before it would have let a press through.
describe('moving between the numbered steps', () => {
	it('takes a donor on the review step back to the amount step in one event', () => {
		// the mark on the first step stands two screens away from the third, which is the move no
		// `BACK` could carry: it moves one step and names no destination.
		const { actor } = readyToSubmit();

		actor.send({ type: 'GO_TO_STEP', step: 'amount' });

		expect(actor.getSnapshot().value).toBe('amount');
	});

	it('takes a donor back one step as readily as two', () => {
		const { actor } = readyToSubmit();

		actor.send({ type: 'GO_TO_STEP', step: 'details' });
		expect(actor.getSnapshot().value).toBe('details');

		actor.send({ type: 'GO_TO_STEP', step: 'amount' });
		expect(actor.getSnapshot().value).toBe('amount');
	});

	it('refuses a step ahead that the donor has not earned yet', () => {
		// the same gate the step's own Continue is held to, reached from a different control. a mark
		// that walked past it would put a donor on the screen that spends the money over a gift the
		// flow never decided and with no address for the receipt.
		const { actor } = harness();
		actor.send({ type: 'CLEAR_AMOUNT' });

		actor.send({ type: 'GO_TO_STEP', step: 'details' });
		expect(actor.getSnapshot().value).toBe('amount');

		actor.send({ type: 'GO_TO_STEP', step: 'give' });
		expect(actor.getSnapshot().value).toBe('amount');
	});

	it('opens each step ahead as the one before it is completed, and no sooner', () => {
		const { actor } = harness();
		actor.send({ type: 'SET_AMOUNT', amountMinor: 2500 });
		actor.send({ type: 'SET_FREQUENCY', frequency: 'one_time' });

		// the gift is decided, so the details step is reachable and the review step is not.
		actor.send({ type: 'GO_TO_STEP', step: 'give' });
		expect(actor.getSnapshot().value).toBe('amount');

		actor.send({ type: 'GO_TO_STEP', step: 'details' });
		expect(actor.getSnapshot().value).toBe('details');

		actor.send({
			type: 'SET_CONTACT',
			email: 'donor@example.org',
			firstName: 'Ada',
			lastName: 'Lovelace'
		});
		actor.send({ type: 'GO_TO_STEP', step: 'give' });
		expect(actor.getSnapshot().value).toBe('give');
	});

	it('decides the gift on the way past the step that decides it', () => {
		// the jump from the first step to the third skips the second, and `fv` is what every state
		// past the first is allowed to assume — so the amount is committed on the transition rather
		// than by the screen the donor walked through.
		const { actor } = harness();
		actor.send({ type: 'SET_AMOUNT', amountMinor: 2500 });
		actor.send({ type: 'SET_FREQUENCY', frequency: 'one_time' });
		actor.send({ type: 'GO_TO_STEP', step: 'details' });
		actor.send({
			type: 'SET_CONTACT',
			email: 'donor@example.org',
			firstName: 'Ada',
			lastName: 'Lovelace'
		});
		actor.send({ type: 'GO_TO_STEP', step: 'amount' });
		actor.send({ type: 'GO_TO_STEP', step: 'give' });

		expect(actor.getSnapshot().value).toBe('give');
		expect(actor.getSnapshot().context.fv).toEqual({
			amountMinor: 2500,
			frequency: 'one_time',
			programId: null
		});
	});

	it('drops the last attempt on the way back into the review step', () => {
		// `beginAttempt` runs on entry to the two editable steps and a mark is a way in like any
		// other. a quote surviving one would leave a spent payment token behind the Donate button.
		const { actor } = readyToSubmit();
		actor.send({ type: 'SUBMIT' });

		actor.send({ type: 'GO_TO_STEP', step: 'amount' });
		actor.send({ type: 'GO_TO_STEP', step: 'give' });

		expect(actor.getSnapshot().context.quote).toBeNull();
		expect(actor.getSnapshot().context.mandateAccepted).toBe(false);
	});

	it('is not a way to press the step the donor is already standing on', () => {
		// the mark for the current step is a position rather than a control, and the flow says so
		// too: the review step's `GO_TO_STEP` names two destinations and neither is itself.
		//
		// asserted on the guard rather than on what a step entry leaves behind: a transition whose
		// target is its own state re-runs no entry unless it says `reenter: true`, which is off by
		// default (https://stately.ai/docs/transitions#re-entering), so a self-loop leaves nothing
		// for an assertion to see. what the guard refusing buys is that no branch lands here.
		const { actor } = readyToSubmit();

		expect(stepIsReachable(actor.getSnapshot().context, 'give', 'give')).toBe(false);

		actor.send({ type: 'GO_TO_STEP', step: 'give' });

		expect(actor.getSnapshot().value).toBe('give');
	});
});

describe('backing out of the correction screen', () => {
	it('mints one intent per attempt the donor makes and confirms only the current one', async () => {
		// backing out abandons the intent that screen was about. the review step's entry drops it,
		// so the next press is an attempt of its own rather than a confirmation of the first one
		// under details the donor may have changed in between — which is how a stale payment token
		// gets charged for a gift nobody re-authorized.
		let minted = 0;
		const { actor, calls } = readyToSubmit({
			quote: async () => {
				minted += 1;
				return { paymentToken: `pi_${minted}_secret_x`, feeMinor: 150, totalMinor: 2650 };
			}
		});
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().value).toBe('confirm');
		actor.send({ type: 'BACK' });
		expect(actor.getSnapshot().context.quote).toBeNull();

		actor.send({ type: 'SUBMIT' });
		await settle();
		actor.send({ type: 'CONFIRM' });
		await settle();
		expect(calls.quote).toHaveLength(2);
		expect(calls.confirm).toEqual([
			{ paymentToken: 'pi_2_secret_x', method: 'card', mandateAccepted: false }
		]);
	});
});

describe('a wallet rail and the ordinary Donate button', () => {
	it('mints an intent for a wallet through the same press a card uses', async () => {
		// the wallet's sheet is opened by the confirmation rather than by this press, so the whole
		// of the flow in front of it is the card's: the quote is minted first, and a total the
		// server moved reaches the correction screen while the donor is still looking at this page
		// and nothing has been authorized. that ordering is the reason a wallet is drawn inside the
		// provider's own box instead of as a button of its own.
		const { actor, calls } = readyToSubmit();
		actor.send({ type: 'SET_METHOD', method: 'apple_pay' });
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(calls.quote).toHaveLength(1);
		expect(calls.quote[0]?.method).toBe('apple_pay');
	});

	it('refuses a wallet the config does not offer', () => {
		// `completePayer` gates on the config's own list, which is what the `payerIsComplete` guard
		// is made of — the last gate standing if a rail the deployment was never approved for
		// reaches `payerDraft.method` through `SET_METHOD`.
		const { actor, calls } = readyToSubmit();
		actor.send({ type: 'SET_METHOD', method: 'google_pay' });
		actor.send({ type: 'SUBMIT' });
		expect(actor.getSnapshot().value).toBe('give');
		expect(calls.quote).toHaveLength(0);
	});
});

describe('a retried gift', () => {
	it('asks for the debit authorization again rather than reusing the last one', async () => {
		// an authorization belongs to the attempt that collected it. a `mandateAccepted` that
		// survived a retry would debit a bank account on wording the donor accepted for a
		// different intent, which is a charge nobody authorized.
		let minted = 0;
		const { actor, calls } = readyToSubmit({
			quote: async () => {
				minted += 1;
				return minted === 1
					? {
							paymentToken: 'pi_ach_1_secret_x',
							feeMinor: 21,
							totalMinor: 2521,
							mandate: {
								text: 'By continuing you authorize Acme Relief Fund to debit your account.'
							}
						}
					: { paymentToken: 'pi_ach_2_secret_x', feeMinor: 21, totalMinor: 2521 };
			},
			confirm: async () => ({ kind: 'declined', message: 'Your bank declined the payment.' })
		});
		actor.send({ type: 'SET_METHOD', method: 'ach' });
		actor.send({ type: 'SUBMIT' });
		await settle();
		actor.send({ type: 'ACCEPT_MANDATE' });
		await settle();
		expect(calls.confirm[0]).toMatchObject({ mandateAccepted: true });
		expect(actor.getSnapshot().value).toBe('failed');

		// the retry lands on the review step, because that is the earliest step still short of
		// anything: the gift and the details were both decided before the refusal.
		actor.send({ type: 'RETRY' });
		expect(actor.getSnapshot().value).toBe('give');
		actor.send({ type: 'SET_METHOD', method: 'ach' });
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(calls.confirm).toHaveLength(2);
		expect(calls.confirm[1]).toEqual({
			paymentToken: 'pi_ach_2_secret_x',
			method: 'ach',
			mandateAccepted: false
		});
	});
});

/**
 * one of every event the flow declares, for asserting that a state takes none of them.
 *
 * keyed by event type and checked against the whole of `CheckoutEvent`, so an event added to that
 * union is a `pnpm check` failure here until it is listed. a plain array would let a new event go
 * unsent, and "no event leaves this state" would quietly become a claim about the day it was
 * written.
 */
const EVERY_EVENT: readonly CheckoutEvent[] = Object.values({
	SET_AMOUNT: { type: 'SET_AMOUNT', amountMinor: 2500 },
	CLEAR_AMOUNT: { type: 'CLEAR_AMOUNT' },
	SET_FREQUENCY: { type: 'SET_FREQUENCY', frequency: 'monthly' },
	SET_NOTE: { type: 'SET_NOTE', note: 'for the roof' },
	TOGGLE_NOTE: { type: 'TOGGLE_NOTE' },
	SET_PROGRAM: { type: 'SET_PROGRAM', programId: 'prg_water' },
	SET_TRIBUTE: { type: 'SET_TRIBUTE', honoree: 'Margaret Chen' },
	TOGGLE_TRIBUTE: { type: 'TOGGLE_TRIBUTE' },
	CONTINUE: { type: 'CONTINUE' },
	BACK: { type: 'BACK' },
	GO_TO_STEP: { type: 'GO_TO_STEP', step: 'amount' },
	SET_METHOD: { type: 'SET_METHOD', method: 'card' },
	SET_COIN: { type: 'SET_COIN', coin: 'btc' },
	PAYMENT_UNAVAILABLE: {
		type: 'PAYMENT_UNAVAILABLE',
		failure: { message: 'The payment fields could not be shown.' }
	},
	CHALLENGE_UNAVAILABLE: {
		type: 'CHALLENGE_UNAVAILABLE',
		failure: { message: 'The security check could not be shown.' }
	},
	SET_CONTACT: { type: 'SET_CONTACT', email: 'donor@example.org' },
	TOGGLE_FEE_COVERAGE: { type: 'TOGGLE_FEE_COVERAGE' },
	SET_CONSENT: { type: 'SET_CONSENT', consented: true },
	SET_TURNSTILE_TOKEN: { type: 'SET_TURNSTILE_TOKEN', token: 'tk_x' },
	SUBMIT: { type: 'SUBMIT' },
	OPEN_FUND: { type: 'OPEN_FUND' },
	FUND_APPROVED: { type: 'FUND_APPROVED', authorizationId: 'wfs_x', authorizedMinor: 2500 },
	FUND_CLOSED: { type: 'FUND_CLOSED' },
	CONFIRM: { type: 'CONFIRM' },
	ACCEPT_MANDATE: { type: 'ACCEPT_MANDATE' },
	DECLINE_MANDATE: { type: 'DECLINE_MANDATE' },
	RETRY: { type: 'RETRY' }
} satisfies { [K in CheckoutEvent['type']]: Extract<CheckoutEvent, { type: K }> });

describe('an outcome nobody can classify', () => {
	it('re-reads the intent when the confirmation itself never answered', async () => {
		// a dropped response is indistinguishable from a refusal, and only one of the two is safe
		// to act on. `failed` is one Retry away from the form and that press mints a second intent
		// against one that may already have succeeded — so the answer is to ask what became of the
		// intent, on the token this attempt already minted.
		const seen: unknown[] = [];
		const { actor, calls } = readyToSubmit({
			confirm: async () => {
				throw new Error('The connection was lost.');
			},
			resumeWith: async () => ({ kind: 'indeterminate' })
		});
		actor.subscribe((snapshot) => seen.push(snapshot.value));
		actor.send({ type: 'SUBMIT' });
		await settle();
		await settle();
		expect(actor.getSnapshot().matches({ indeterminate: 'unresolved' })).toBe(true);
		expect(seen).not.toContain('failed');
		expect(calls.resume).toEqual(['pi_1_secret_x']);
		expect(calls.quote).toHaveLength(1);
	});

	it('leaves a resume that could not be read unknown, and stops there', async () => {
		// this state exists for a donor who has already paid, so telling them the gift failed is
		// the one answer that is certainly wrong — and so is handing them a control. the outcome is
		// settled by the webhook (src/routes/api.stripe.webhook.ts, through
		// src/lib/server/donations/settle.ts), so the flow ends after the one automatic read.
		const { actor, calls } = harness({
			resume: { paymentToken: 'pi_3ds_secret_x' },
			resumeWith: async () => {
				throw new Error('The connection was lost.');
			}
		});
		await settle();
		expect(actor.getSnapshot().matches({ indeterminate: 'unresolved' })).toBe(true);
		expect(actor.getSnapshot().context.failure?.message).toBe('The connection was lost.');

		// no event moves this state, asserted over every event the machine declares rather than over
		// the ones a screen sends today, so a control wired here later fails this. three are accepted
		// wherever the machine happens to be (`SET_METHOD`, `SET_TURNSTILE_TOKEN` and
		// `CHALLENGE_UNAVAILABLE`, on the root) and none of them takes a transition — the last is held
		// against a state that could answer it, and this state is one nothing leaves.
		for (const event of EVERY_EVENT) {
			actor.send(event);
			expect(actor.getSnapshot().matches({ indeterminate: 'unresolved' })).toBe(true);
		}
		expect(actor.getSnapshot().can({ type: 'RETRY' })).toBe(false);
		await settle();
		expect(actor.getSnapshot().matches({ indeterminate: 'unresolved' })).toBe(true);
		expect(calls.resume).toEqual(['pi_3ds_secret_x']);
		expect(calls.quote).toHaveLength(0);
	});
});

describe('the edges of the microdeposit window', () => {
	it('holds a deadline further out than the window to the window itself', async () => {
		// a deadline forty days out is a delay the ambient `setTimeout` coerces to a 32-bit
		// integer, which fires at 1ms and expires the gift of a donor whose microdeposits are
		// still in the post. Capping the delay at the window is what keeps the expiry a real
		// deadline rather than an immediate one.
		const fortyDays = 40 * 24 * 60 * 60 * 1000;
		const { actor, clock } = readyToSubmit({
			confirm: async () => ({ kind: 'awaiting_microdeposits', expiresAt: EPOCH + fortyDays })
		});
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().value).toBe('awaitingVerification');

		clock.advance(MICRODEPOSIT_WINDOW_MS - 1);
		expect(actor.getSnapshot().value).toBe('awaitingVerification');
		clock.advance(1);
		expect(actor.getSnapshot().value).toBe('verificationExpired');
	});

	it('refuses a deadline that cannot be Unix milliseconds and derives one instead', async () => {
		// a provider that reports seconds is the ordinary case, and a seconds value read as
		// milliseconds is a deadline in 1970 — the delay computes to zero and the donor is told to
		// start over while their microdeposits are on their way.
		const { actor, clock } = readyToSubmit({
			confirm: async () => ({
				kind: 'awaiting_microdeposits',
				expiresAt: Math.floor((EPOCH + MICRODEPOSIT_WINDOW_MS) / 1000)
			})
		});
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().context.verificationDeadline).toBe(EPOCH + MICRODEPOSIT_WINDOW_MS);

		clock.advance(0);
		expect(actor.getSnapshot().value).toBe('awaitingVerification');
	});
});

describe('a quote that cannot be stated', () => {
	it('refuses to put a garbled total on the screen that asks the donor to authorize it', async () => {
		// the confirm screen is a claim about the money and nothing downstream measures it against
		// the intent again. A negative fee, a fractional minor unit, a total below the gift itself
		// or a token nothing can be confirmed with are all failures the donor is told about rather
		// than numbers that are rendered.
		const garbled: readonly Quote[] = [
			{ paymentToken: 'pi_1_secret_x', feeMinor: -1, totalMinor: 2606 },
			{ paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: -2606 },
			{ paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2606.5 },
			{ paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2499 },
			{ paymentToken: '', feeMinor: 106, totalMinor: 2606 }
		];
		for (const quote of garbled) {
			const { actor, calls } = readyToSubmit({ quote: async () => quote });
			actor.send({ type: 'SUBMIT' });
			await settle();
			expect(actor.getSnapshot().value).toBe('failed');
			expect(calls.confirm).toHaveLength(0);
		}
	});

	it('names the offending value and where to fix it, because the integrator has no console', async () => {
		// CLAUDE.md: a 4xx body is read by an AI agent rather than by a human at a console, so the
		// sentence has to name what was wrong. A form that fails silently here is
		// indistinguishable from a nonprofit having a bad month.
		const { actor } = readyToSubmit({
			quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2499 })
		});
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().context.failure?.fix).toContain('totalMinor');
	});
});

describe('a port that never answers', () => {
	it('gives up on a quote, because nothing was authorized to abandon', async () => {
		// a promise that never settles otherwise leaves a donation form spinning on a stranger's
		// page with no way out of it. The mint can be abandoned safely — nothing was authorized —
		// so this is one of the two ports the machine owns a timeout for.
		const { actor, clock } = readyToSubmit({ quote: neverAnswers });
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().value).toBe('quoting');

		clock.advance(PORT_TIMEOUT_MS);
		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.failure?.fix).toContain('can be made again');
	});

	it('gives up on a resume read and calls the result unknown rather than failed', async () => {
		// the read can be abandoned, but its subject cannot: the intent named by the token in the
		// URL was never read, so its state is still unknown and must not be assumed either way.
		const { actor, clock } = harness({
			resume: { paymentToken: 'pi_3ds_secret_x' },
			resumeWith: neverAnswers
		});
		await settle();
		expect(actor.getSnapshot().value).toBe('resuming');

		clock.advance(PORT_TIMEOUT_MS);
		expect(actor.getSnapshot().matches({ indeterminate: 'unresolved' })).toBe(true);
	});

	it('waits on a confirmation for as long as it takes, having no timeout at all', async () => {
		// the absence is the point and it is asserted so nobody adds one. Giving up on a
		// confirmation tells nobody whether the charge landed, and a timeout that routed anywhere
		// would be that unknown wearing a decision. The answer to an unanswered confirmation is
		// `indeterminate`, which the port reaches by rejecting or by saying so.
		const { actor, clock } = readyToSubmit({ confirm: neverAnswers });
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(actor.getSnapshot().value).toBe('confirming');

		clock.advance(PORT_TIMEOUT_MS * 10);
		expect(actor.getSnapshot().value).toBe('confirming');
	});
});

describe('a config the wire mangled', () => {
	it('keeps the form alive when no rule was published for the rail the donor picked', () => {
		// `feeRules` is untrusted JSON keyed by rail and the type saying every rail has a rule does
		// not make the response carry one. A throw inside an assign stops the actor, and a stopped
		// actor is a donation form frozen on the payment step with a live-looking button on it.
		const { actor } = readyToSubmit({
			config: {
				...CONFIG,
				feeRules: {
					ach: { percent: 0.008, fixedMinor: 0 },
					apple_pay: { percent: 0.029, fixedMinor: 30 },
					google_pay: { percent: 0.029, fixedMinor: 30 },
					paypal: { percent: 0.0349, fixedMinor: 49 },
					venmo: { percent: 0.0349, fixedMinor: 49 },
					daf: { percent: 0.029, fixedMinor: 0, roundUpMinor: 100 },
					crypto: { percent: 0.01, fixedMinor: 0 }
				} as FormConfig['feeRules']
			}
		});
		expect(actor.getSnapshot().status).toBe('active');
		expect(actor.getSnapshot().value).toBe('give');
		expect(actor.getSnapshot().context.estimate).toBeNull();
	});
});

describe('a payment surface that never came up', () => {
	// the defect this exists for: the provider's fields cannot complete their mount, so the
	// donor sits in front of a form with no card fields on it and nothing anywhere says so. it
	// reaches the same `failed` state a refusal reaches — there is no second error path — and it
	// carries the sentence and the fix the adapter wrote, because a form that cannot take a payment
	// is an integrator's problem as much as a donor's.
	it('stops the amount step on the failure the payment surface reported', () => {
		const { actor } = harness();
		actor.send({
			type: 'PAYMENT_UNAVAILABLE',
			failure: { message: 'The payment fields could not be shown.', fix: 'Check the key.' }
		});

		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.failure).toEqual({
			message: 'The payment fields could not be shown.',
			fix: 'Check the key.'
		});
	});

	it('stops the review step on it too, where the missing fields are what the donor is looking at', () => {
		const { actor } = readyToSubmit();
		actor.send({
			type: 'PAYMENT_UNAVAILABLE',
			failure: { message: 'The payment fields could not be shown.' }
		});

		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.failure).toEqual({
			message: 'The payment fields could not be shown.'
		});
	});

	// the report arrives whenever the provider's script gets around to it, and nothing about it is
	// synchronised with the flow. Past the press there is an intent at the processor and possibly a
	// charge against it, and "the fields never loaded" is not an answer to what happened to that
	// money — the states that own a confirmation are the only ones allowed to end it.
	it('is ignored once a gift has been submitted, because it says nothing about the money', async () => {
		const { actor } = readyToSubmit({ quote: neverAnswers });
		actor.send({ type: 'SUBMIT' });
		await settle();
		actor.send({
			type: 'PAYMENT_UNAVAILABLE',
			failure: { message: 'The payment fields could not be shown.' }
		});

		expect(actor.getSnapshot().value).toBe('quoting');
		expect(actor.getSnapshot().context.failure).toBeNull();
	});
});

describe('where a Try again lands', () => {
	// `failed` is reachable from every step there is, because a payment surface or a challenge that
	// reports it will never come up reports whenever its own script gets around to it. one target
	// for all of them puts a donor who never chose an amount in front of a Donate button, so the
	// retry goes to the earliest step whose decisions are still incomplete.
	it('sends a donor who never decided a gift back to the amount step', () => {
		const { actor } = harness();
		actor.send({ type: 'CLEAR_AMOUNT' });
		actor.send({
			type: 'CHALLENGE_UNAVAILABLE',
			failure: { message: 'The security check could not be shown.' }
		});
		actor.send({ type: 'RETRY' });

		expect(actor.getSnapshot().value).toBe('amount');
	});

	it('sends a donor who has a gift but no details back to the details step', () => {
		const { actor } = atDetails();
		actor.send({
			type: 'PAYMENT_UNAVAILABLE',
			failure: { message: 'The payment fields could not be shown.' }
		});
		actor.send({ type: 'RETRY' });

		expect(actor.getSnapshot().value).toBe('details');
		expect(actor.getSnapshot().context.fv).toEqual({
			amountMinor: 2500,
			frequency: 'one_time',
			programId: null
		});
	});

	it('sends a donor who answered both back to the review step, which is the ordinary case', async () => {
		const { actor } = readyToSubmit({
			quote: async () => {
				throw new Error('This gift was refused.');
			}
		});
		actor.send({ type: 'SUBMIT' });
		await settle();
		actor.send({ type: 'RETRY' });

		expect(actor.getSnapshot().value).toBe('give');
		expect(actor.getSnapshot().context.payerDraft.email).toBe('donor@example.org');
	});
});

describe('an anti-abuse challenge that will never mint a token', () => {
	// the endpoint requires a token on every quote (`QuoteRequest.turnstileToken` in ./v1.ts), so a
	// challenge that cannot produce one is a form on which every press is refused after the donor
	// has filled the whole thing in. it ends where the payment surface's own report ends, and for
	// the same reason: nothing is authorized yet, so "this cannot be completed" is the whole truth.
	it('stops the details step on the failure the challenge reported', () => {
		const { actor } = atDetails();
		actor.send({
			type: 'CHALLENGE_UNAVAILABLE',
			failure: { message: 'The security check could not be shown.', fix: 'Check the sitekey.' }
		});

		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.failure).toEqual({
			message: 'The security check could not be shown.',
			fix: 'Check the sitekey.'
		});
	});

	// the widget is drawn on the details step and outlives a Back press, so the report can land here.
	it('stops the amount step too, where a donor who pressed Back is standing', () => {
		const { actor } = harness();
		actor.send({
			type: 'CHALLENGE_UNAVAILABLE',
			failure: { message: 'The security check could not be shown.' }
		});

		expect(actor.getSnapshot().value).toBe('failed');
	});

	// same as the payment surface's: past the press there is an intent at the processor, and the
	// challenge reporting on itself says nothing whatever about what happened to that money.
	it('is ignored once a gift has been submitted', async () => {
		const { actor } = readyToSubmit({ quote: neverAnswers });
		actor.send({ type: 'SUBMIT' });
		await settle();
		actor.send({
			type: 'CHALLENGE_UNAVAILABLE',
			failure: { message: 'The security check could not be shown.' }
		});

		expect(actor.getSnapshot().value).toBe('quoting');
		expect(actor.getSnapshot().context.failure).toBeNull();
	});

	// ignored where it lands is not the same as gone. the widget reports whenever its own script
	// gets around to it, so a report can arrive in the one window nothing may act on — and dropped
	// there it is never raised again, which leaves the donor pressing into the endpoint's own
	// `challenge_failed` with nothing on the card to explain it.
	it('holds a report that arrived mid-charge until the flow can answer it', async () => {
		const { actor, calls, clock } = readyToSubmit({ quote: neverAnswers });
		actor.send({ type: 'SUBMIT' });
		await settle();
		actor.send({
			type: 'CHALLENGE_UNAVAILABLE',
			failure: { message: 'The security check could not be shown.', fix: 'Check the sitekey.' }
		});

		// the charge is untouched: nothing about the challenge says what became of the intent.
		expect(actor.getSnapshot().value).toBe('quoting');
		expect(actor.getSnapshot().context.failure).toBeNull();
		expect(calls.quote).toHaveLength(1);

		// the quote's own deadline is what ends the wait here, and it reports its own failure.
		clock.advance(PORT_TIMEOUT_MS);
		await settle();
		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.failure?.message).not.toBe(
			'The security check could not be shown.'
		);

		// and the held report is delivered on the step the Try again lands on, before the donor can
		// press into a gift the endpoint would refuse for want of a token.
		actor.send({ type: 'RETRY' });

		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.failure).toEqual({
			message: 'The security check could not be shown.',
			fix: 'Check the sitekey.'
		});
		expect(calls.quote).toHaveLength(1);
	});

	// delivered once, and not again on the next step a donor reaches: the report is a thing that
	// happened rather than a state of the form, and a card that could not be got off would be a form
	// nobody can use after one report.
	it('delivers a held report once', async () => {
		const { actor, clock } = readyToSubmit({ quote: neverAnswers });
		actor.send({ type: 'SUBMIT' });
		await settle();
		actor.send({
			type: 'CHALLENGE_UNAVAILABLE',
			failure: { message: 'The security check could not be shown.' }
		});
		clock.advance(PORT_TIMEOUT_MS);
		await settle();
		actor.send({ type: 'RETRY' });

		expect(actor.getSnapshot().value).toBe('failed');

		actor.send({ type: 'RETRY' });

		expect(actor.getSnapshot().value).toBe('give');
	});
});

describe('a gift from a donor-advised fund', () => {
	const DAF_CONFIG: FormConfig = {
		...CONFIG,
		providers: [...CONFIG.providers, { name: 'chariot', publishableKey: 'cid_x' }],
		paymentMethods: ['card', 'daf']
	};

	/**
	 * the review step with a card picked and the fund's own button beside it, about to be pressed.
	 *
	 * the press is the fund's rail chosen and its window opened in one go, so nothing reports the
	 * rail ahead of it.
	 */
	function onFundRail(options: HarnessOptions = {}) {
		return readyToSubmit({ config: DAF_CONFIG, ...options });
	}

	const GRANT: Quote = { paymentToken: 'grant_1', feeMinor: 100, totalMinor: 2600 };

	// the fund's window is the authorization and the quote is the gift: the server creates the grant
	// in the same POST that mints the quote, so nothing is confirmed after it.
	it('sends the fund’s approval with the gift and confirms nothing after it', async () => {
		const { actor, calls } = onFundRail({ quote: () => Promise.resolve(GRANT) });
		actor.send({ type: 'OPEN_FUND' });
		expect(actor.getSnapshot().value).toBe('authorizing');
		expect(calls.quote).toHaveLength(0);

		actor.send({ type: 'FUND_APPROVED', authorizationId: 'wfs_1', authorizedMinor: 2600 });
		await settle();

		expect(calls.quote).toHaveLength(1);
		expect(calls.quote[0]).toMatchObject({
			method: 'daf',
			authorizationId: 'wfs_1',
			authorizedMinor: 2600
		});
		expect(calls.confirm).toHaveLength(0);
		expect(actor.getSnapshot().value).toBe('processing');
	});

	it('goes back to the review step with nothing sent when the window closes unapproved', async () => {
		const { actor, calls } = onFundRail();
		actor.send({ type: 'OPEN_FUND' });
		actor.send({ type: 'FUND_CLOSED' });
		await settle();

		expect(actor.getSnapshot().value).toBe('give');
		expect(calls.quote).toHaveLength(0);
	});

	// the fund's own button is pressed from wherever the donor's rail stood, and a window closed
	// unapproved leaves them standing there: a card picked in the inline fields is still the card the
	// Donate control spends, with nothing to pick again.
	it('puts the donor back on the rail they were on when the window closes unapproved', async () => {
		const { actor, calls } = onFundRail();
		actor.send({ type: 'OPEN_FUND' });
		expect(actor.getSnapshot().context.payerDraft.method).toBe('daf');
		actor.send({ type: 'FUND_CLOSED' });

		expect(actor.getSnapshot().context.payerDraft.method).toBe('card');
		actor.send({ type: 'SUBMIT' });
		await settle();
		expect(calls.quote[0]?.method).toBe('card');
	});

	// the server answers a repeated session with the grant it already holds, so an answer that never
	// arrived is sent again on the same approval rather than asked of the donor a second time — and
	// sent on a token minted after the one the first send spent.
	it('resends the same approval on a fresh token after a send that did not land', async () => {
		let answer: () => Promise<Quote> = () =>
			Promise.reject({
				message: 'This gift was not started.',
				fix: 'POST unreachable.',
				unanswered: true
			});
		const { actor, calls } = onFundRail({ quote: () => answer() });
		actor.send({ type: 'SET_TURNSTILE_TOKEN', token: 'first' });
		actor.send({ type: 'OPEN_FUND' });
		actor.send({ type: 'FUND_APPROVED', authorizationId: 'wfs_1', authorizedMinor: 2600 });
		await settle();
		expect(actor.getSnapshot().value).toBe('failed');

		answer = () => Promise.resolve(GRANT);
		actor.send({ type: 'RETRY' });
		await settle();
		expect(calls.quote).toHaveLength(1);

		actor.send({ type: 'SET_TURNSTILE_TOKEN', token: 'second' });
		await settle();
		expect(calls.quote).toHaveLength(2);
		expect(calls.quote[1]).toMatchObject({
			authorizationId: 'wfs_1',
			authorizedMinor: 2600,
			turnstileToken: 'second'
		});
		expect(actor.getSnapshot().value).toBe('processing');
	});

	it('keeps the approval through a send that timed out', async () => {
		let answer: () => Promise<Quote> = neverAnswers;
		const { actor, calls, clock } = onFundRail({ quote: () => answer() });
		actor.send({ type: 'SET_TURNSTILE_TOKEN', token: 'first' });
		actor.send({ type: 'OPEN_FUND' });
		actor.send({ type: 'FUND_APPROVED', authorizationId: 'wfs_1', authorizedMinor: 2600 });
		clock.advance(PORT_TIMEOUT_MS);
		await settle();
		expect(actor.getSnapshot().value).toBe('failed');

		answer = () => Promise.resolve(GRANT);
		actor.send({ type: 'SET_TURNSTILE_TOKEN', token: 'second' });
		actor.send({ type: 'RETRY' });
		await settle();
		expect(calls.quote[1]?.authorizationId).toBe('wfs_1');
		expect(actor.getSnapshot().value).toBe('processing');
	});

	// the answers worth sending the same approval to again: the processor faulted, the token was
	// refused, or nothing answered. every other refusal answers the same approval the same way, so a
	// Try again that resent it would be a donor pressing into the same refusal forever.
	it.each([
		['the processor faulted', { code: 'payments_unavailable', message: 'The processor faulted.' }],
		[
			'the challenge was refused',
			{ code: 'challenge_failed', message: 'The check did not clear.' }
		],
		['nothing answered', { message: 'This gift was not started.', unanswered: true }]
	])('keeps the approval for a Try again when %s', async (_label, refusal) => {
		const { actor } = onFundRail({ quote: () => Promise.reject(refusal) });
		actor.send({ type: 'OPEN_FUND' });
		actor.send({ type: 'FUND_APPROVED', authorizationId: 'wfs_1', authorizedMinor: 2600 });
		await settle();
		expect(actor.getSnapshot().value).toBe('failed');

		actor.send({ type: 'RETRY' });

		expect(actor.getSnapshot().value).toBe('resending');
		expect(actor.getSnapshot().context.authorization?.authorizationId).toBe('wfs_1');
	});

	it.each([
		['the approval expired', { code: 'daf_authorization_expired', message: 'Expired.' }],
		['the fund declined', { code: 'daf_grant_declined', message: 'Declined.' }],
		[
			'the approved amount is outside the form’s range',
			{ message: 'The amount is above this form’s maximum.' }
		],
		[
			'the approval could not be found',
			{ message: 'That approval could not be found.', fix: 'POST answered 404.' }
		],
		['payments are not configured', { code: 'payments_not_configured', message: 'Not set up.' }],
		['the form is retired', { code: 'form_retired', message: 'Retired.' }],
		['the form is unpublished', { code: 'form_not_published', message: 'Unpublished.' }],
		['the server faulted', { message: 'Something went wrong.', fix: 'POST answered 500.' }]
	])('spends the approval and returns to the fund’s button when %s', async (_label, refusal) => {
		const { actor, calls } = onFundRail({ quote: () => Promise.reject(refusal) });
		actor.send({ type: 'OPEN_FUND' });
		actor.send({ type: 'FUND_APPROVED', authorizationId: 'wfs_1', authorizedMinor: 2600 });
		await settle();
		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.authorization).toBeNull();

		actor.send({ type: 'RETRY' });

		expect(actor.getSnapshot().value).toBe('give');
		expect(fundIsOffered(actor.getSnapshot())).toBe(true);
		expect(calls.quote).toHaveLength(1);
	});

	it('spends the approval on an answer that is not a grant', async () => {
		const { actor } = onFundRail({
			quote: () => Promise.resolve({ paymentToken: 'grant_1', feeMinor: -1, totalMinor: 2600 })
		});
		actor.send({ type: 'OPEN_FUND' });
		actor.send({ type: 'FUND_APPROVED', authorizationId: 'wfs_1', authorizedMinor: 2600 });
		await settle();
		expect(actor.getSnapshot().value).toBe('failed');

		actor.send({ type: 'RETRY' });

		expect(actor.getSnapshot().value).toBe('give');
	});

	// the grant may have been created before the answer was lost, so the donor is not told nothing
	// happened — and the resend is safe to press, because the server answers it with the grant it holds.
	it.each([
		['the processor faulted', { code: 'payments_unavailable', message: 'The processor faulted.' }],
		['nothing answered', { message: 'This gift was not started.', unanswered: true }]
	])('tells the donor their fund may already have the request when %s', async (_label, refusal) => {
		const { actor } = onFundRail({ quote: () => Promise.reject(refusal) });
		actor.send({ type: 'OPEN_FUND' });
		actor.send({ type: 'FUND_APPROVED', authorizationId: 'wfs_1', authorizedMinor: 2600 });
		await settle();

		expect(actor.getSnapshot().context.failure?.message).toMatch(/fund may already have/i);
	});

	it('tells the donor their fund may already have the request when the send timed out', async () => {
		const { actor, clock } = onFundRail({ quote: neverAnswers });
		actor.send({ type: 'OPEN_FUND' });
		actor.send({ type: 'FUND_APPROVED', authorizationId: 'wfs_1', authorizedMinor: 2600 });
		clock.advance(PORT_TIMEOUT_MS);
		await settle();

		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.failure?.message).toMatch(/fund may already have/i);
	});

	it('keeps saying so when no fresh token arrives to send the approval again', async () => {
		const { actor, clock } = onFundRail({
			quote: () => Promise.reject({ message: 'This gift was not started.', unanswered: true })
		});
		actor.send({ type: 'OPEN_FUND' });
		actor.send({ type: 'FUND_APPROVED', authorizationId: 'wfs_1', authorizedMinor: 2600 });
		await settle();
		actor.send({ type: 'RETRY' });
		clock.advance(PORT_TIMEOUT_MS);
		await settle();

		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.failure?.message).toMatch(/fund may already have/i);
		expect(actor.getSnapshot().context.authorization?.authorizationId).toBe('wfs_1');
	});

	// off the fund's rail a processor fault is still the ordinary sentence: nothing was charged.
	it('keeps the ordinary sentence for a processor fault on a card', async () => {
		const { actor } = readyToSubmit({
			config: DAF_CONFIG,
			quote: () =>
				Promise.reject({ code: 'payments_unavailable', message: 'The processor faulted.' })
		});
		actor.send({ type: 'SUBMIT' });
		await settle();

		expect(actor.getSnapshot().context.failure?.message).toBe('The processor faulted.');
	});

	// an approval the fund gave too long before the grant was created cannot be sent again: the
	// donor approves again in the fund's window, which the review step's fund button reopens.
	it('tells the donor their fund’s approval expired and lets them approve again', async () => {
		let answer: () => Promise<Quote> = () =>
			Promise.reject({
				code: 'daf_authorization_expired',
				message: 'Grant session wfs_1 is past its window.',
				fix: 'Open the fund window again.'
			});
		const { actor, calls } = onFundRail({ quote: () => answer() });
		actor.send({ type: 'OPEN_FUND' });
		actor.send({ type: 'FUND_APPROVED', authorizationId: 'wfs_1', authorizedMinor: 2600 });
		await settle();

		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.failure?.message).toMatch(/approval .*expired/i);

		actor.send({ type: 'RETRY' });
		expect(actor.getSnapshot().value).toBe('give');
		expect(actor.getSnapshot().context.authorization).toBeNull();

		answer = () => Promise.resolve(GRANT);
		actor.send({ type: 'OPEN_FUND' });
		actor.send({ type: 'FUND_APPROVED', authorizationId: 'wfs_2', authorizedMinor: 2600 });
		await settle();
		expect(calls.quote[1]?.authorizationId).toBe('wfs_2');
		expect(actor.getSnapshot().value).toBe('processing');
	});

	// the fund's own reason, as the server carried it, and marked as the rail's: the donor settles it
	// with the fund or a different amount, beside the fund's button on the step a retry lands on.
	it('carries the fund’s reason for refusing the grant as the rail’s refusal', async () => {
		const { actor } = onFundRail({
			quote: () =>
				Promise.reject({
					code: 'daf_grant_declined',
					message: 'Your fund requires grants of at least $50.'
				})
		});
		actor.send({ type: 'OPEN_FUND' });
		actor.send({ type: 'FUND_APPROVED', authorizationId: 'wfs_1', authorizedMinor: 2600 });
		await settle();

		expect(actor.getSnapshot().value).toBe('failed');
		expect(actor.getSnapshot().context.failure).toEqual({
			message: 'Your fund requires grants of at least $50.',
			refusedByRail: true
		});
	});

	// a fund's grant repeats nowhere this deployment can match, so a press on the fund's button is
	// never taken on a repeating gift — the button is not drawn there (`fundIsOffered`), and a stale
	// one pressed anyway opens nothing.
	it('takes no press of the fund’s button on a repeating gift', () => {
		const { actor, calls } = onFundRail();
		actor.send({ type: 'GO_TO_STEP', step: 'amount' });
		actor.send({ type: 'SET_FREQUENCY', frequency: 'monthly' });
		actor.send({ type: 'GO_TO_STEP', step: 'give' });

		actor.send({ type: 'OPEN_FUND' });

		expect(actor.getSnapshot().value).toBe('give');
		expect(actor.getSnapshot().context.payerDraft.method).toBe('card');
		expect(calls.quote).toHaveLength(0);
	});

	// a token minted before the window may expire while the donor is in it, and the widget replaces
	// it on its own — so the one the request carries is the last to arrive before the window closed.
	it('sends the challenge token that arrived while the fund’s window was open', async () => {
		const { actor, calls } = onFundRail({ quote: () => Promise.resolve(GRANT) });
		actor.send({ type: 'SET_TURNSTILE_TOKEN', token: 'before' });
		actor.send({ type: 'OPEN_FUND' });
		actor.send({ type: 'SET_TURNSTILE_TOKEN', token: 'after' });
		actor.send({ type: 'FUND_APPROVED', authorizationId: 'wfs_1', authorizedMinor: 2600 });
		await settle();

		expect(calls.quote[0]?.turnstileToken).toBe('after');
	});

	// what the fund's window is opened with: the total the donor was shown and the receipt's fields,
	// read in the same task as the press, and nothing at all where the press was refused.
	it('names the gift the fund’s window opens on, and only for a press the flow took', () => {
		// a form offering no fund, where a press on a fund's button is not one the flow takes.
		const refused = readyToSubmit();
		expect(openFund(refused.actor)).toBeNull();

		const { actor } = onFundRail();
		expect(openFund(actor)).toEqual({
			amountMinor: 2600,
			email: 'donor@example.org',
			firstName: 'Ada',
			lastName: 'Lovelace'
		});
		expect(actor.getSnapshot().value).toBe('authorizing');
		expect(openFund(actor)).toBeNull();
	});

	// Chariot's button is the fund's option on the card, so it stands exactly where a press on it
	// can be taken — and through the open window, whose endings are heard on that element.
	it('offers the fund on the review step of a one-time gift, and through its open window', () => {
		const details = atDetails({ config: DAF_CONFIG });
		expect(fundIsOffered(details.actor.getSnapshot())).toBe(false);

		const { actor } = readyToSubmit({ config: DAF_CONFIG });
		expect(fundIsOffered(actor.getSnapshot())).toBe(true);
		actor.send({ type: 'OPEN_FUND' });
		expect(fundIsOffered(actor.getSnapshot())).toBe(true);

		const monthly = readyToSubmit({ config: DAF_CONFIG });
		monthly.actor.send({ type: 'GO_TO_STEP', step: 'amount' });
		monthly.actor.send({ type: 'SET_FREQUENCY', frequency: 'monthly' });
		monthly.actor.send({ type: 'GO_TO_STEP', step: 'give' });
		expect(fundIsOffered(monthly.actor.getSnapshot())).toBe(false);

		expect(fundIsOffered(readyToSubmit().actor.getSnapshot())).toBe(false);
	});
});

describe('a crypto gift', () => {
	const COINS = [
		{
			coin: 'usdttrc20',
			ticker: 'usdt',
			name: 'Tether USD (Tron)',
			network: 'trx',
			memoRequired: false
		},
		{ coin: 'btc', ticker: 'btc', name: 'Bitcoin', network: 'btc', memoRequired: false }
	];
	const CRYPTO_CONFIG: FormConfig = {
		...CONFIG,
		paymentMethods: ['card', 'crypto'],
		coins: COINS
	};
	const VALID_UNTIL = EPOCH + 7 * 24 * 60 * 60 * 1000;
	const DEPOSIT_QUOTE: Quote = {
		paymentToken: 'don_crypto_1',
		feeMinor: 25,
		totalMinor: 2525,
		deposit: {
			address: 'TbdBAaeHZo9WeEtpitUFqfEuUXDRfLpjeV',
			memo: null,
			coin: 'usdttrc20',
			network: 'trx',
			coinAmount: '25.004187',
			validUntil: new Date(VALID_UNTIL).toISOString(),
			qr: { rows: ['101', '010', '101'] }
		}
	};

	/** the review step of a one-time crypto gift, with the rail reported and no coin picked yet. */
	function onCryptoRail(options: HarnessOptions = {}) {
		const h = readyToSubmit({
			config: CRYPTO_CONFIG,
			quote: async () => DEPOSIT_QUOTE,
			...options
		});
		h.actor.send({ type: 'SET_METHOD', method: 'crypto' });
		return h;
	}

	it('sends the coin the donor picked and waits on the address the quote minted', async () => {
		const { actor, calls } = onCryptoRail();
		actor.send({ type: 'SET_COIN', coin: 'usdttrc20' });
		actor.send({ type: 'SUBMIT' });
		await settle();

		expect(calls.quote[0]?.coin).toBe('usdttrc20');
		expect(calls.confirm).toHaveLength(0);
		expect(actor.getSnapshot().matches('awaitingDeposit')).toBe(true);
	});

	/** the address screen, reached with a coin picked and the quote's deposit in hand. */
	async function awaitingDeposit(options: HarnessOptions = {}) {
		const h = onCryptoRail(options);
		h.actor.send({ type: 'SET_COIN', coin: 'usdttrc20' });
		h.actor.send({ type: 'SUBMIT' });
		await settle();
		return h;
	}

	it('turns to the thank-you once the gift is read as received', async () => {
		let state: DonationStatus['state'] = 'waiting';
		const { actor, calls, clock } = await awaitingDeposit({
			status: async () => ({ state })
		});

		clock.advance(DEPOSIT_POLL_MS);
		await settle();
		expect(calls.status).toEqual(['don_crypto_1']);
		expect(actor.getSnapshot().matches('awaitingDeposit')).toBe(true);

		state = 'received';
		clock.advance(DEPOSIT_POLL_MS);
		await settle();
		expect(actor.getSnapshot().value).toBe('success');
	});

	// only the server's own `expired` withdraws the address: a rejection is how a rate-limited read
	// reaches a browser, and a body that is not ours is a reading nobody has.
	it('keeps waiting through an unreadable answer, and stops only on the server’s expired', async () => {
		let answer: () => Promise<DonationStatus> = () =>
			Promise.reject(new TypeError('Failed to fetch'));
		const { actor, clock } = await awaitingDeposit({ status: () => answer() });

		clock.advance(DEPOSIT_POLL_MS);
		await settle();
		expect(actor.getSnapshot().matches('awaitingDeposit')).toBe(true);

		answer = () => Promise.resolve({ state: 'closed' } as unknown as DonationStatus);
		clock.advance(DEPOSIT_POLL_MS);
		await settle();
		expect(actor.getSnapshot().matches('awaitingDeposit')).toBe(true);

		answer = () => Promise.resolve({ state: 'expired' });
		clock.advance(DEPOSIT_POLL_MS);
		await settle();
		expect(actor.getSnapshot().value).toBe('depositExpired');
	});

	it('starts again on the review step with the coin still picked', async () => {
		const { actor, clock } = await awaitingDeposit({ status: async () => ({ state: 'expired' }) });
		clock.advance(DEPOSIT_POLL_MS);
		await settle();

		actor.send({ type: 'RETRY' });

		expect(actor.getSnapshot().value).toBe('give');
		expect(actor.getSnapshot().context.payerDraft).toMatchObject({
			method: 'crypto',
			coin: 'usdttrc20'
		});
		expect(actor.getSnapshot().context.quote).toBeNull();
	});

	it('reads nothing once the donor leaves the address for a different coin', async () => {
		const { actor, calls, clock } = await awaitingDeposit();

		actor.send({ type: 'BACK' });
		clock.advance(DEPOSIT_POLL_MS * 3);
		await settle();

		expect(actor.getSnapshot().value).toBe('give');
		expect(actor.getSnapshot().context.payerDraft.coin).toBe('usdttrc20');
		expect(calls.status).toHaveLength(0);
	});

	// past the address's own send-by on this device, and the server still waiting: the address is
	// withdrawn so nobody sends to it, and the reading goes on — a coin sent in time may still land.
	it('closes the address at its send-by and keeps reading until the gift is settled', async () => {
		let state: DonationStatus['state'] = 'waiting';
		const { actor, clock } = await awaitingDeposit({ status: async () => ({ state }) });

		clock.advance(VALID_UNTIL - EPOCH - 1);
		await settle();
		expect(actor.getSnapshot().matches({ awaitingDeposit: { address: 'open' } })).toBe(true);

		clock.advance(1);
		await settle();
		expect(actor.getSnapshot().matches({ awaitingDeposit: { address: 'closed' } })).toBe(true);

		// no way back to the review step from a closed address: that screen draws no control.
		actor.send({ type: 'BACK' });
		expect(actor.getSnapshot().matches({ awaitingDeposit: { address: 'closed' } })).toBe(true);

		state = 'received';
		clock.advance(DEPOSIT_POLL_MS);
		await settle();
		expect(actor.getSnapshot().value).toBe('success');
	});

	it('closes the address at once for a quote whose send-by has already passed here', async () => {
		const { actor, clock } = await awaitingDeposit({
			quote: async () => ({
				...DEPOSIT_QUOTE,
				deposit: { ...DEPOSIT_QUOTE.deposit!, validUntil: new Date(EPOCH - 1000).toISOString() }
			})
		});
		clock.advance(0);

		expect(actor.getSnapshot().matches({ awaitingDeposit: { address: 'closed' } })).toBe(true);
	});

	// the option comes off the payment box the moment a repeating cadence is chosen, before any step
	// commits it, and comes back with one-time — nothing is said on the amount step either way.
	it('offers crypto on a one-time gift only, following the cadence as the donor picks it', () => {
		const { actor } = onCryptoRail();
		expect(cryptoIsOffered(actor.getSnapshot())).toBe(true);

		actor.send({ type: 'GO_TO_STEP', step: 'amount' });
		actor.send({ type: 'SET_FREQUENCY', frequency: 'monthly' });
		expect(cryptoIsOffered(actor.getSnapshot())).toBe(false);

		actor.send({ type: 'SET_FREQUENCY', frequency: 'one_time' });
		expect(cryptoIsOffered(actor.getSnapshot())).toBe(true);

		expect(cryptoIsOffered(readyToSubmit().actor.getSnapshot())).toBe(false);
	});

	describe('a refusal of the coin or the amount', () => {
		const refused =
			(code: string, extra: Record<string, unknown> = {}) =>
			() =>
				Promise.reject({ code, message: `refused: ${code}`, fix: 'pick another', ...extra });

		async function refusedWith(code: string, extra: Record<string, unknown> = {}) {
			return awaitingDeposit({ quote: refused(code, extra) });
		}

		it('lands a gift below the coin’s minimum on the amount step, carrying the minimum', async () => {
			const { actor } = await refusedWith('below_minimum', { minAmountMinor: 1200 });

			expect(actor.getSnapshot().value).toBe('amount');
			expect(actor.getSnapshot().context.coinRefusal).toEqual({
				code: 'below_minimum',
				coin: 'usdttrc20',
				minAmountMinor: 1200
			});
			expect(actor.getSnapshot().context.failure).toBeNull();
		});

		it('lands a gift over the coin’s cap on the amount step, with no figure to carry', async () => {
			const { actor } = await refusedWith('above_maximum');

			expect(actor.getSnapshot().value).toBe('amount');
			expect(actor.getSnapshot().context.coinRefusal).toEqual({
				code: 'above_maximum',
				coin: 'usdttrc20'
			});
		});

		it('clears the amount refusal once the donor changes the amount', async () => {
			const { actor } = await refusedWith('below_minimum', { minAmountMinor: 1200 });

			actor.send({ type: 'SET_AMOUNT', amountMinor: 5000 });

			expect(actor.getSnapshot().context.coinRefusal).toBeNull();
		});

		it('keeps the coin and the rail for the press after the amount is raised', async () => {
			const { actor } = await refusedWith('below_minimum', { minAmountMinor: 1200 });
			actor.send({ type: 'SET_AMOUNT', amountMinor: 5000 });
			actor.send({ type: 'CONTINUE' });
			actor.send({ type: 'CONTINUE' });

			expect(actor.getSnapshot().value).toBe('give');
			expect(actor.getSnapshot().context.payerDraft).toMatchObject({
				method: 'crypto',
				coin: 'usdttrc20'
			});
		});

		it('lands a coin the account no longer takes back on the review step, that coin refused', async () => {
			const { actor, calls } = await refusedWith('coin_not_accepted');

			expect(actor.getSnapshot().value).toBe('give');
			expect(actor.getSnapshot().context.refusedCoins).toEqual(['usdttrc20']);

			// a retry of the same coin answers the same, so the press is refused here instead.
			actor.send({ type: 'SUBMIT' });
			expect(actor.getSnapshot().value).toBe('give');
			expect(calls.quote).toHaveLength(1);
		});

		it('takes the press again once the donor picks a coin the account has not refused', async () => {
			const { actor } = await refusedWith('coin_not_accepted');

			actor.send({ type: 'SET_COIN', coin: 'btc' });
			expect(actor.getSnapshot().context.coinRefusal).toBeNull();
			actor.send({ type: 'SUBMIT' });

			expect(actor.getSnapshot().value).toBe('quoting');
		});

		it('leaves every other refusal on the failure screen, as it does today', async () => {
			const { actor } = await refusedWith('challenge_failed');

			expect(actor.getSnapshot().value).toBe('failed');
			expect(actor.getSnapshot().context.coinRefusal).toBeNull();
		});
	});
});
