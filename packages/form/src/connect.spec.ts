import { createActor } from 'xstate';
import { describe, expect, it } from 'vitest';
import { checkoutMachine } from './checkout.machine';
import type { CheckoutEvent } from './checkout.machine';
import { connect, TOP_LEVEL_STATES, type PropTypes } from './connect';
import type { CheckoutPorts } from './ports';
import type { FormConfig } from './v1';

// node pool, and that is the point of the seam: prop getters are plain objects until a
// framework's `normalize` turns them into props, so the projection is testable with no DOM at
// all. a `connect` that reached for an element would have to be a `*.dom.spec.ts`, which is
// the signal that the seam had been put in the wrong place.

const CONFIG: FormConfig = {
	formId: 'frm_a8x2k9',
	provider: { name: 'stripe', publishableKey: 'pk_test_x' },
	currency: 'usd',
	suggestedAmountsMinor: [2500],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time', 'monthly'],
	paymentMethods: ['card', 'apple_pay'],
	feeCoverage: 'optional',
	feeRules: {
		card: { percent: 0.029, fixedMinor: 30 },
		ach: { percent: 0.008, fixedMinor: 0 },
		apple_pay: { percent: 0.029, fixedMinor: 30 },
		google_pay: { percent: 0.029, fixedMinor: 30 }
	},
	locale: 'en-US',
	orgLegalName: 'Acme Relief Fund',
	ein: '12-3456789',
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.'
};

const PORTS: CheckoutPorts = {
	quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 106, totalMinor: 2606 }),
	confirm: async () => ({ kind: 'succeeded' }),
	resume: async () => ({ kind: 'succeeded' }),
	now: () => 1_700_000_000_000
};

/**
 * the identity normalizer — what a framework adapter replaces.
 *
 * a React adapter hands back the props unchanged, a Svelte one renames `onClick`, a headless
 * consumer may ignore them entirely. the seam exists so that choice never reaches this file.
 */
const identity: PropTypes<{
	button: Record<string, unknown>;
	group: Record<string, unknown>;
	field: Record<string, unknown>;
	select: Record<string, unknown>;
}> = {
	button: (props) => props,
	group: (props) => props,
	field: (props) => props,
	select: (props) => props
};

/** a started machine plus its api, which is what a host holds. */
function api(
	drive: (send: (event: never) => void) => void = () => {},
	overrides: { readonly config?: FormConfig; readonly ports?: Partial<CheckoutPorts> } = {},
	resume?: { readonly paymentToken: string }
) {
	const actor = createActor(checkoutMachine, {
		input: {
			config: overrides.config ?? CONFIG,
			ports: { ...PORTS, ...overrides.ports },
			...(resume === undefined ? {} : { resume })
		}
	});
	actor.start();
	drive(actor.send as (event: never) => void);
	return { actor, get: () => connect(actor.getSnapshot(), actor.send, identity) };
}

/** lets a quote settle before the projection is read. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** the donor at the review step with everything a typed rail needs already filled in. */
const readyToSubmit = (send: (event: never) => void) => {
	send({ type: 'SET_AMOUNT', amountMinor: 2500 } as never);
	send({ type: 'SET_FREQUENCY', frequency: 'one_time' } as never);
	send({ type: 'CONTINUE' } as never);
	send({
		type: 'SET_CONTACT',
		email: 'donor@example.org',
		firstName: 'Ada',
		lastName: 'Lovelace'
	} as never);
	send({ type: 'CONTINUE' } as never);
	send({ type: 'SET_METHOD', method: 'card' } as never);
};

describe('the state projection', () => {
	it('reports the amount step with no decided value, exactly as the type allows', () => {
		// the union's whole purpose: on this step `fv` is optional, and a consumer that wants to
		// render a total has to narrow before it can reach one.
		const { get } = api();
		const state = get().state;
		expect(state.step).toBe('amount');
		if (state.step !== 'amount') throw new Error('expected the amount step');
		expect(state.fv).toBeUndefined();
	});

	it('makes the value non-optional from the details step onward', () => {
		// a step carries its value by construction. Once narrowed to `details`, `fv` is a
		// `FormValue` and not a `FormValue | undefined` — so there is no branch in a consumer
		// where a payment screen renders an absent amount, and no `?? 0` to write.
		const { get } = api((send) => {
			send({ type: 'SET_AMOUNT', amountMinor: 2500 } as never);
			send({ type: 'SET_FREQUENCY', frequency: 'one_time' } as never);
			send({ type: 'CONTINUE' } as never);
		});
		const state = get().state;
		if (state.step !== 'details') throw new Error(`expected the details step, got ${state.step}`);
		expect(state.fv.amountMinor).toBe(2500);
	});

	it('names which beat of the press a busy flow is on, and says nothing else about it', async () => {
		// one press spans the mint and the charge, and the collapse into one `working` step would
		// otherwise leave a donor who cannot see the spinner hearing the same four words for the
		// whole of it.
		const { actor, get } = api(readyToSubmit, { ports: { quote: () => new Promise(() => {}) } });
		actor.send({ type: 'SUBMIT' });
		const minting = get().state;
		if (minting.step !== 'working') throw new Error(`expected working, got ${minting.step}`);
		expect(minting.phase).toBe('quoting');

		const charging = api(readyToSubmit, { ports: { confirm: () => new Promise(() => {}) } });
		charging.actor.send({ type: 'SUBMIT' });
		await settle();
		const state = charging.get().state;
		if (state.step !== 'working') throw new Error(`expected working, got ${state.step}`);
		expect(state.phase).toBe('confirming');
	});

	it('names the resume as its own beat, because it is neither a mint nor a charge', async () => {
		const { get } = api(
			() => {},
			{ ports: { resume: () => new Promise(() => {}) } },
			{
				paymentToken: 'pi_1_secret_x'
			}
		);
		const state = get().state;
		if (state.step !== 'working') throw new Error(`expected working, got ${state.step}`);
		expect(state.phase).toBe('resuming');
	});

	it('carries an adjusted reconciliation on the correction step and can carry no other', async () => {
		// the correction screen exists only where the figure moved, so the projection narrows to the
		// one member that has a screen. handing a consumer the whole union would let it render the
		// correction copy over a total that never changed, which is the silent overwrite this screen
		// exists to prevent wearing the other face.
		const { get } = api(readyToSubmit, {
			ports: {
				quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 150, totalMinor: 2650 })
			}
		});
		(get().submitButton as { onClick: () => void }).onClick();
		await settle();
		const state = get().state;
		if (state.step !== 'confirm') throw new Error(`expected the confirm step, got ${state.step}`);
		expect(state.reconciliation.kind).toBe('adjusted');
		expect(state.reconciliation.shownTotalMinor).toBe(2606);
		expect(state.quote.totalMinor).toBe(2650);
		expect(state.fv.amountMinor).toBe(2500);
	});

	it('names the rail on the correction step, taken off the payer the quote was minted for', async () => {
		// this form draws no rail control, so the word on the screen that authorizes the charge
		// cannot come from one. it comes off the committed payer, which is the rail the intent was
		// actually minted on — a screen echoing anything else would be describing a different gift.
		const { get } = api(
			(send) => {
				send({ type: 'SET_AMOUNT', amountMinor: 2500 } as never);
				send({ type: 'SET_FREQUENCY', frequency: 'one_time' } as never);
				send({ type: 'CONTINUE' } as never);
				send({
					type: 'SET_CONTACT',
					email: 'donor@example.org',
					firstName: 'Ada',
					lastName: 'Lovelace'
				} as never);
				send({ type: 'CONTINUE' } as never);
				send({ type: 'SET_METHOD', method: 'ach' } as never);
				send({ type: 'SUBMIT' } as never);
			},
			{
				config: { ...CONFIG, paymentMethods: ['card', 'ach'] },
				ports: {
					quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 50, totalMinor: 2550 })
				}
			}
		);
		await settle();
		const state = get().state;
		if (state.step !== 'confirm') throw new Error(`expected the confirm step, got ${state.step}`);
		expect(state.method).toBe('ach');
	});

	// the promise the correction screen rests on, at the seam where it could quietly stop being
	// true: the figure the label states and the figure the server's answer is measured against are
	// one expression in one place (`shownTotalMinor` in ./checkout.machine.ts). two derivations
	// would agree today and part on the next edit, and what parts with them is the guarantee.
	it('states the same figure on the Donate label that the reconciliation is measured against', async () => {
		const { get } = api(readyToSubmit, {
			ports: {
				quote: async () => ({ paymentToken: 'pi_1_secret_x', feeMinor: 150, totalMinor: 2650 })
			}
		});
		const shown = (get().submitButton as { totalMinor: number | null }).totalMinor;
		(get().submitButton as { onClick: () => void }).onClick();
		await settle();
		const state = get().state;
		if (state.step !== 'confirm') throw new Error(`expected the confirm step, got ${state.step}`);
		expect(state.reconciliation.shownTotalMinor).toBe(shown);
	});

	it('lists exactly the machine’s own top-level states, read off the machine itself', () => {
		// the expectation comes from the machine, not from a second copy of the list. a test that
		// re-typed the same list would pass forever; this one fails the moment a state is added to
		// the machine and left unprojected, which is the only way the switch in `toState` can be
		// trusted to be total.
		expect([...TOP_LEVEL_STATES].sort()).toEqual(Object.keys(checkoutMachine.states).sort());
	});

	it('carries the API’s fix out to whatever renders the failure', async () => {
		// CLAUDE.md: a 4xx body names the offending value and where to change it, because the
		// integrator is an agent with no console. This is the last hop where that sentence can
		// die — a failure channel that carried only a message would drop it here.
		const { get } = api(readyToSubmit, {
			ports: {
				quote: async () => {
					throw Object.assign(new Error('This origin is not on form frm_a8x2k9’s allowlist.'), {
						fix: 'Add https://example.org to the form’s allowed origins in /admin.'
					});
				}
			}
		});
		(get().submitButton as { onClick: () => void }).onClick();
		await settle();
		const state = get().state;
		if (state.step !== 'failed') throw new Error(`expected the failed step, got ${state.step}`);
		expect(state.message).toContain('allowlist');
		expect(state.fix).toBe('Add https://example.org to the form’s allowed origins in /admin.');
	});

	it('omits fix entirely when the failure carried none', async () => {
		// an absent key rather than an empty string, so a layout renders no second line at all
		// instead of an empty one under the message.
		const { get } = api(readyToSubmit, {
			ports: {
				quote: async () => {
					throw new Error('Your bank declined the payment.');
				}
			}
		});
		(get().submitButton as { onClick: () => void }).onClick();
		await settle();
		const state = get().state;
		if (state.step !== 'failed') throw new Error(`expected the failed step, got ${state.step}`);
		expect(state).not.toHaveProperty('fix');
	});
});

describe('the prop getters', () => {
	it('routes a press through the machine rather than through the consumer', () => {
		// the getters carry the intent, so a host that renders its own button still cannot
		// invent a transition — it can only send an event the machine may ignore.
		const { get, actor } = api();
		actor.send({ type: 'SET_AMOUNT', amountMinor: 2500 });
		actor.send({ type: 'SET_FREQUENCY', frequency: 'one_time' });
		const props = get().continueButton as { onClick: () => void };
		props.onClick();
		expect(actor.getSnapshot().value).toBe('details');
	});

	it('sends a withdrawal as its own event and a figure as the other', () => {
		// the free entry says two things and they are not one event with a nullable payload: `null`
		// is the box emptied, a number is the box holding a figure, and the machine is told which
		// by which event arrives. a renderer that could only send a number has no way to say the
		// donor took the amount back.
		const sent: CheckoutEvent[] = [];
		const actor = createActor(checkoutMachine, { input: { config: CONFIG, ports: PORTS } });
		actor.start();
		const group = connect(
			actor.getSnapshot(),
			(event) => {
				sent.push(event);
			},
			identity
		).amountGroup as { readonly onTyped: (amountMinor: number | null) => void };

		group.onTyped(3000);
		group.onTyped(null);

		expect(sent).toEqual([{ type: 'SET_AMOUNT', amountMinor: 3000 }, { type: 'CLEAR_AMOUNT' }]);
	});

	it('never emits a disabled prop, on any control, in any state', () => {
		// the one prop this seam must not have. Double-submit is prevented by the machine's
		// shape; a `disabled` here would invite a consumer to believe that attribute is the
		// guarantee, and any second entry point walks straight past an attribute. Asserted
		// across every getter rather than argued in a comment.
		const { get } = api();
		const surface = get();
		for (const [name, value] of Object.entries(surface)) {
			if (name === 'state' || typeof value !== 'object' || value === null) continue;
			// `stepButtons` is a list, and checking the list object would pass while every
			// button inside it went unexamined.
			for (const props of Array.isArray(value) ? value : [value]) {
				expect(props).not.toHaveProperty('disabled');
			}
		}
	});

	it('marks a control busy while the flow is working, which is a report and not a gate', () => {
		// `aria-busy` tells a screen reader what is happening; it stops nothing, which is
		// exactly right — the stopping is the machine's job and the announcing is the prop's.
		const { get, actor } = api(readyToSubmit);
		expect((get().submitButton as { 'aria-busy': boolean })['aria-busy']).toBe(false);
		actor.send({ type: 'SUBMIT' });
		expect((get().submitButton as { 'aria-busy': boolean })['aria-busy']).toBe(true);
	});

	it('hands the frequency group native radio semantics rather than re-implementing them', () => {
		// native `<fieldset>` + radios give roving focus, arrow-key traversal and form semantics
		// for free; a `role="radiogroup"` rebuilt in JS gives none of it for free. the getter
		// supplies the name and the checked state and stops there.
		const { get } = api();
		const group = get().frequencyGroup as { name: string; options: { value: string }[] };
		expect(group.options.map((option) => option.value)).toEqual(['one_time', 'monthly']);
	});

	it('offers no rail control of its own, and no wallet control, on any deployment', () => {
		// the payment provider's own fields are the picker. a second control here would be a
		// choice a donor could set two ways, and the provider collects for whichever rail its own
		// fields are showing — so ours would be the copy that is wrong. the flow learns the rail
		// from the provider instead, through `SET_METHOD`.
		//
		// a wallet the deployment lists gets no control either, and that is the exclusion rather
		// than an omission: nothing in this package opens a wallet sheet, so a button for one
		// would take a donor's authorization and have nowhere to spend it. asserted on a config
		// that lists both wallets, which is the only config on which the absence means anything.
		const { get } = api(() => {}, {
			config: { ...CONFIG, paymentMethods: ['card', 'ach', 'apple_pay', 'google_pay'] }
		});
		expect(get()).not.toHaveProperty('methodGroup');
		expect(get()).not.toHaveProperty('walletButtons');
	});

	it('carries the donor’s contact details on the fields that collect them', () => {
		// each field carries its own value, so a layout never reaches into `payerDraft` — which
		// is the same re-derivation the step-mark getter exists to prevent, one field lower down.
		const { get } = api((send) => {
			send({ type: 'SET_AMOUNT', amountMinor: 2500 } as never);
			send({ type: 'SET_FREQUENCY', frequency: 'one_time' } as never);
			send({ type: 'CONTINUE' } as never);
			send({
				type: 'SET_CONTACT',
				email: 'donor@example.org',
				firstName: 'Ada',
				lastName: 'Lovelace'
			} as never);
		});
		const surface = get();
		expect((surface.emailField as { value: string }).value).toBe('donor@example.org');
		expect((surface.firstNameField as { value: string }).value).toBe('Ada');
		expect((surface.lastNameField as { value: string }).value).toBe('Lovelace');
	});

	it('carries the note the donor wrote on the field that collects it', () => {
		const { get } = api((send) => send({ type: 'SET_NOTE', note: 'for the gala' } as never));
		expect((get().noteField as { value: string }).value).toBe('for the gala');
	});

	it('carries whether the donor asked to write a note at all', () => {
		// the disclosure is a decision the flow holds rather than a DOM node's `checked`, which is
		// what lets `state.missing` name the note on a refused press the way it names every other
		// control on the step.
		const { get } = api();
		expect((get().noteToggle as { pressed: boolean }).pressed).toBe(false);

		const opened = api((send) => send({ type: 'TOGGLE_NOTE' } as never));
		expect((opened.get().noteToggle as { pressed: boolean }).pressed).toBe(true);
		expect(opened.get().state).toMatchObject({
			step: 'amount',
			missing: expect.arrayContaining(['note'])
		});
	});

	// one getter per numbered step, in the order a donor is asked. what each carries is where the
	// donor is and whether the flow would take a press — the two things a mark on the step head is
	// drawn from, off `stepIsReachable` (./checkout.machine.ts) rather than re-derived here.
	it('offers one step control per numbered step, marking the one the donor is on', () => {
		const { get } = api((send) => {
			send({ type: 'SET_AMOUNT', amountMinor: 2500 } as never);
			send({ type: 'SET_FREQUENCY', frequency: 'one_time' } as never);
			send({ type: 'CONTINUE' } as never);
		});

		expect(get().stepButtons.map((button) => button as { step: number; current: boolean })).toEqual(
			[
				expect.objectContaining({ step: 1, current: false }),
				expect.objectContaining({ step: 2, current: true }),
				expect.objectContaining({ step: 3, current: false })
			]
		);
	});

	it('offers no step a donor has not earned and every step behind them', () => {
		const available = (surface: ReturnType<typeof connect>): boolean[] =>
			surface.stepButtons.map((button) => (button as { available: boolean }).available);

		// nothing decided past the seeded suggestion, which the donor takes back: the first mark is
		// where the donor stands and the other two are shut.
		const opened = api();
		opened.actor.send({ type: 'CLEAR_AMOUNT' });
		expect(available(opened.get())).toEqual([false, false, false]);

		// on the last step every mark behind is open, whatever the flow would say about going on.
		expect(available(api(readyToSubmit).get())).toEqual([true, true, false]);
	});

	it('routes a mark press through the machine, and a shut one moves nothing', () => {
		const { get, actor } = api();
		actor.send({ type: 'CLEAR_AMOUNT' });
		(get().stepButtons[1] as { onClick: () => void }).onClick();
		expect(actor.getSnapshot().value).toBe('amount');

		actor.send({ type: 'SET_AMOUNT', amountMinor: 2500 });
		actor.send({ type: 'SET_FREQUENCY', frequency: 'one_time' });
		(get().stepButtons[1] as { onClick: () => void }).onClick();

		expect(actor.getSnapshot().value).toBe('details');
	});

	it('shuts every mark on a screen that is not a numbered step', () => {
		// a takeover draws no step head, and the marks it would carry stand for screens the donor
		// cannot walk back to from a thank-you.
		const { get, actor } = api(readyToSubmit);
		actor.send({ type: 'SUBMIT' });

		expect(get().stepButtons.map((button) => (button as { current: boolean }).current)).toEqual([
			false,
			false,
			false
		]);
	});

	it('passes every prop through normalize, so no framework leaks into the core', () => {
		// the seam itself. `connect` never constructs a framework's prop object; it builds a
		// plain record and hands it to `normalize`. This is what will let one machine drive two
		// layouts and, later, an adapter per framework — and it is asserted by giving normalize
		// a marker and finding it on the way out.
		const marked: PropTypes<{
			button: { marked: true };
			group: { marked: true };
			field: { marked: true };
			select: { marked: true };
		}> = {
			button: () => ({ marked: true }),
			group: () => ({ marked: true }),
			field: () => ({ marked: true }),
			select: () => ({ marked: true })
		};
		const actor = createActor(checkoutMachine, { input: { config: CONFIG, ports: PORTS } });
		actor.start();
		const surface = connect(actor.getSnapshot(), actor.send, marked);
		expect(surface.continueButton).toEqual({ marked: true });
		expect(surface.frequencyGroup).toEqual({ marked: true });
	});
});
