import { checkoutMachine } from '@better-giving/form/machine';
import type { Failure } from '@better-giving/form/machine';
import { toState, type CheckoutSnapshot, type State } from '@better-giving/form/connect';
import type { CheckoutPorts } from '@better-giving/form/ports';
import { createPaymentSurface, type PaymentSeams } from '@better-giving/form/embed/surface';
import { createChallenge, type ChallengeSeam } from '@better-giving/form/embed/turnstile';
import type { FormConfig, PaymentMethod } from '@better-giving/form/v1';
import { createActor, type Actor } from 'xstate';
import { deploymentPorts } from './ports';

// the actor's life, and the two imperative surfaces that live exactly as long as it does.
//
// the split from the views is where the seam already is: everything below this module reads a
// `connect` projection and nothing else, and everything the flow cannot do itself arrives here as a
// port. what is in this file rather than in a component is what react cannot own — a provider's
// element group registered inside a script we did not write, a challenge widget registered under an
// id nothing here ever sees, and an actor whose subscription is what tells either of them that the
// flow moved.
//
// the payment surface is created here rather than in ./payment.tsx because it is not a rendering
// concern at all: `confirm` and `resume` are ports, so the actor cannot be built without it. the
// challenge is here for the mirror reason — it is reset on the transition out of a busy flow, and
// the actor's own subscription is the only thing that sees a transition. what the two components
// own is the box each is mounted into: its markup, its part names, whether it is on screen, and
// what a refused press says about it.
//
// no react and no document global. the two mount nodes arrive as arguments, which is what keeps
// this module testable with a plain object for each seam.

export type { CheckoutSnapshot };

/**
 * the snapshot a card renders from before anything has started.
 *
 * a pure function of the configuration, and it has to be: the loader has the config server-side, so
 * the amounts, the cadences and the tiles are in the HTML, and the client's first render has to
 * produce the same tree or hydration mismatches on the screen that takes money. `boot` reaches
 * `amount` on an `always` transition that calls no port and arms no timer, so starting an actor on
 * inert ports and reading one snapshot off it is a value rather than an effect.
 *
 * the ports never settle rather than rejecting. nothing reaches them on the way to `amount`, and a
 * rejection would be an outcome this snapshot could be built holding.
 */
export function initialSnapshot(config: FormConfig): CheckoutSnapshot {
	const inert = (): Promise<never> => new Promise<never>(() => {});
	const ports: CheckoutPorts = {
		quote: inert,
		confirm: inert,
		resume: inert,
		now: () => 0
	};
	const actor = createActor(checkoutMachine, { input: { config, ports } });
	actor.start();
	const snapshot = actor.getSnapshot();
	actor.stop();
	return snapshot;
}

/** what a card hands over when it starts the live flow. */
export type CheckoutMounts = {
	/** the node the payment provider paints its own fields into. */
	readonly paymentMount: HTMLElement;
	/** the node the anti-abuse challenge is drawn in. */
	readonly challengeMount: HTMLElement;
	/** the payment this page was sent back to, where it was sent anywhere. */
	readonly resumeToken: string | null;
	/**
	 * what a spec replaces so no processor's script is reached.
	 *
	 * `payment` is one entry per processor rather than one seam, because the composer this page
	 * builds its surface through is in between the two adapters rather than in front of them.
	 */
	readonly seams?: { readonly payment?: PaymentSeams; readonly challenge?: ChallengeSeam };
};

export type Checkout = {
	readonly actor: Actor<typeof checkoutMachine>;
	/**
	 * everything this checkout started, let go of.
	 *
	 * safe in any order and any number of times, because every stop it reaches is. the provider's
	 * element group and the challenge widget are both registered inside scripts this project did not
	 * write, under handles nothing here sees, so removing the nodes they painted in collects the DOM
	 * and tells neither script anything — a card that stopped without this leaves one live group per
	 * gift, each still reporting into a flow that has ended.
	 */
	stop(): void;
};

/**
 * the flow, running, with every provider wired into it.
 *
 * the payment surface is built before the actor because two of the actor's four ports are its own.
 * it is the composer in @better-giving/form/embed/surface rather than either processor's adapter,
 * so a deployment holding two of them still hands the flow one surface and nothing below this line
 * learns there was more than one.
 * the challenge is built on arrival at the details step instead, which is the last moment it can be
 * drawn without a donor waiting on it: from there it has that step's typing and the review step to
 * finish in.
 *
 * the token is spent by the press that leaves a busy flow, and spent is spent — it is valid once
 * whether the endpoint honoured it or refused it. so the widget is reset on the way out of
 * `working` rather than on the donor's Try again, which gives the reset the whole of the failure
 * screen to finish in.
 *
 * every report either provider makes becomes an event rather than a call: the rail the donor picked,
 * the fields never coming up, a token minted, a challenge that could not be shown. the token goes
 * through the projection's own setter rather than at the actor, so the one this page collects and
 * the one a headless integrator would hand in travel one path.
 */
export function startCheckout(config: FormConfig, mounts: CheckoutMounts): Checkout {
	const { paymentMount, challengeMount, resumeToken, seams } = mounts;

	// through holders rather than straight at the actor: both surfaces are handed their callbacks
	// while the actor is still being constructed, and every real report arrives with a provider's
	// script, which is later than both.
	let rail: (method: PaymentMethod | null) => void = () => {};
	let unavailable: (failure: Failure) => void = () => {};

	const surface = createPaymentSurface(
		config,
		paymentMount,
		(method) => rail(method),
		(failure) => unavailable(failure),
		seams?.payment
	);

	const actor = createActor(checkoutMachine, {
		input: {
			config,
			ports: deploymentPorts(surface),
			...(resumeToken === null ? {} : { resume: { paymentToken: resumeToken } })
		}
	});

	rail = (method) => actor.send({ type: 'SET_METHOD', method });
	unavailable = (failure) => actor.send({ type: 'PAYMENT_UNAVAILABLE', failure });

	let challenge: { reset(): void; stop(): void } | null = null;
	/** the step the last reading was on, which is what makes a reading a transition. */
	let previous: State['step'] | null = null;

	const read = (): void => {
		const state = toState(actor.getSnapshot());
		// told on every reading rather than on a change: nothing here holds a memory of what it last
		// said, and the surface is where a reading that changes nothing stops.
		surface.cadence('fv' in state ? state.fv?.frequency : undefined);

		if (state.step === 'details' && challenge === null) {
			challenge = createChallenge(
				config,
				challengeMount,
				(token) => actor.send({ type: 'SET_TURNSTILE_TOKEN', token }),
				(failure) => actor.send({ type: 'CHALLENGE_UNAVAILABLE', failure }),
				seams?.challenge
			);
		}

		if (previous === 'working' && state.step !== 'working') challenge?.reset();
		previous = state.step;
	};

	const subscription = actor.subscribe(read);
	actor.start();
	read();

	return {
		actor,
		stop() {
			subscription.unsubscribe();
			actor.stop();
			const widget = challenge;
			challenge = null;
			widget?.stop();
			surface.stop();
		}
	};
}
