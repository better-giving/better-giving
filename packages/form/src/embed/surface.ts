// one payment surface over however many processors a served config names.
//
// the seam the rest of this package is written against is a single `PaymentSurface` — ./stripe.ts
// declares it, ../element.ts holds exactly one, and `deploymentPorts` on the deployment's own
// donation page holds exactly one. a deployment taking gifts through two processors does not move
// any of that: this module is where the two adapters become one surface, and everything above it
// keeps taking one.
//
// what it owns is therefore three decisions and no more. **which adapters exist at all**, off the
// rails the config offers rather than off the processors it names — `STRIPE_RAILS` and
// `PAYPAL_RAILS` in ./rails.ts cover the vocabulary exactly once, so a config offering a rail is a
// config needing that rail's adapter, and an adapter whose own processor the config does not name
// reports that for itself. **which adapter a reading belongs to** — a confirmation by the rail its
// order was minted on, a rail report by the box the donor pressed in, a re-read by whichever
// processor can answer for the token. and **stopping all of them**, which is the one thing a caller
// holding a single surface could not do for itself.
//
// what it deliberately does not own is any donor-facing sentence. each adapter writes its own,
// naming its own processor where that is the honest noun, and the only thing decided here is
// *whether* one is said at all: a form whose card box works and whose PayPal button did not is a
// form that works, and a donor told otherwise would be reading a refusal over a box they can pay
// with.
//
// `../../package.json` exports this module as `./embed/surface`. it is what a consumer composes
// rather than either adapter, and the deployment's own donation page moves onto it the same way
// ./runtime.ts does here.

import type { Failure } from '../checkout.machine';
import type { CheckoutPorts, ConfirmOutcome } from '../ports';
import type { FormConfig, PaymentMethod } from '../v1';
import { createPaymentSurface as createPaypalSurface, type PaypalSeam } from './paypal';
import { isPaypalRail, isStripeRail } from './rails';
import {
	createPaymentSurface as createStripeSurface,
	type PaymentSeam,
	type PaymentSurface
} from './stripe';

/**
 * the seams both adapters take, one entry each, and nothing production passes.
 *
 * carried through rather than answered here: what a spec stands in for is each processor's own SDK,
 * and this module is between them rather than in front of them.
 */
export type PaymentSeams = {
	readonly stripe?: PaymentSeam;
	readonly paypal?: PaypalSeam;
};

/**
 * one processor's adapter, plus the two questions composing it asks.
 *
 * `owns` is read off ./rails.ts rather than off the surface, because the rail vocabulary is what
 * the two lists there partition and an adapter has no opinion about a rail it never draws.
 */
type Part = {
	readonly owns: (rail: PaymentMethod) => boolean;
	readonly surface: PaymentSurface;
	/** whether this page load is a return from this processor's own window. */
	claimsReturn(): Promise<boolean>;
};

/**
 * the geometry a node in this document has to be pinned to, because a host page's own stylesheet
 * reaches it.
 *
 * these nodes are light-DOM descendants of the node ../element.ts hands over, which is outside the
 * shadow root's encapsulation for the reason `#openPaymentBox` there argues at length: a provider's
 * own surface has to be reachable by scripts this project does not ship. so a `div { margin: 2rem }`
 * in the host's stylesheet lands on them, and an inline declaration is what outranks it.
 *
 * zeroes and keywords rather than values from ../styles/tokens.css, because this is not a look: the
 * look is on the `payment` box one level up in the shadow tree, and each adapter dresses the inside
 * of its own node. two things it cannot answer and nothing can — a host declaration marked
 * `!important`, and anything inherited, which reaches these nodes through the slot from the shadow
 * tree and is therefore already the card's.
 */
const PINNED =
	'display:block;box-sizing:border-box;margin:0;padding:0;border:0;' +
	'inline-size:100%;min-inline-size:0;max-inline-size:none;' +
	'block-size:auto;min-block-size:0;max-block-size:none;' +
	'position:static;float:none;clear:none;overflow:visible';

/**
 * what separates one processor's surface from the next.
 *
 * the card's own block step, and it is the caller's spacing rather than either adapter's: the rails
 * inside the inline box stack flush because they are one list of one object (`accordionItemSpacing`
 * in ../styles/appearance.ts argues that), and two processors are two objects. the first node takes
 * none — a root carries no outer spacing, and the box above it already holds the step.
 */
const BETWEEN = 'margin-block-start:var(--_sp4)';

/**
 * every processor this form can take a gift through, behind one surface.
 *
 * the adapters are built in the order they are read here and that order is what a donor sees: the
 * inline fields, then the hosted window's buttons under them.
 */
export function createPaymentSurface(
	config: FormConfig,
	mount: HTMLElement,
	onRail: (rail: PaymentMethod | null) => void,
	onUnavailable: (failure: Failure) => void,
	seams?: PaymentSeams
): PaymentSurface {
	const doc = mount.ownerDocument;
	const parts: Part[] = [];

	/**
	 * the first processor to say its surface never came up, held until every one of them has.
	 *
	 * a form whose card box works and whose PayPal button did not is a form a donor can give on, so
	 * the report is withheld until there is nothing left to give on. the first sentence rather than
	 * the last is the one said, because the adapters are built in the order a donor reads them and
	 * the first is the one they were looking at.
	 */
	let unsaid: Failure | null = null;
	let quiet = 0;
	const held = (failure: Failure): void => {
		if (unsaid === null) unsaid = failure;
		quiet += 1;
		// every adapter reports through a promise chain of its own, so the earliest this can be
		// reached is a microtask after the two blocks below have finished pushing.
		if (quiet === parts.length) onUnavailable(unsaid);
	};

	/**
	 * the rail a donor has picked and the processor whose box they picked it in.
	 *
	 * held because the two boxes report independently and one of them saying *nothing* is not the
	 * same as the donor un-picking: the inline picker reports a collapse whenever it is closed, and
	 * a donor who has just pressed the PayPal button beneath it would otherwise have that press
	 * silently taken back. a processor is only allowed to clear what it itself set.
	 */
	let chosen: { readonly part: Part; readonly rail: PaymentMethod } | null = null;
	const reported = (part: Part, rail: PaymentMethod | null): void => {
		if (rail === null && chosen !== null && chosen.part !== part) return;
		chosen = rail === null ? null : { part, rail };
		onRail(rail);
	};

	/** the node one adapter owns, placed and pinned here and dressed inside by the adapter itself. */
	const open = (): HTMLElement => {
		const node = doc.createElement('div');
		node.style.cssText = parts.length === 0 ? PINNED : `${PINNED};${BETWEEN}`;
		mount.appendChild(node);
		return node;
	};

	if (config.paymentMethods.some(isStripeRail)) {
		const inline = createStripeSurface(
			config,
			open(),
			(rail) => reported(part, rail),
			held,
			seams?.stripe
		);
		const part: Part = {
			owns: isStripeRail,
			surface: inline,
			// the inline fields recognise no return ahead of a read: the token a redirect comes back
			// with is the intent's own, and reading it is exactly what that adapter's `resume` does.
			// so it claims nothing, and it is the fallback below instead.
			claimsReturn: () => Promise.resolve(false)
		};
		parts.push(part);
	}

	if (config.paymentMethods.some(isPaypalRail)) {
		const paypal = createPaypalSurface(
			config,
			open(),
			(rail) => reported(part, rail),
			held,
			seams?.paypal
		);
		const part: Part = {
			owns: isPaypalRail,
			surface: paypal,
			claimsReturn: () => paypal.claimsReturn()
		};
		parts.push(part);
	}

	/** whichever processor last took a confirmation, which is whose order a re-read is about. */
	let confirmed: Part | null = null;

	const confirm: CheckoutPorts['confirm'] = async (input): Promise<ConfirmOutcome> => {
		const part = parts.find((candidate) => candidate.owns(input.method));
		// the two lists in ./rails.ts cover the rail vocabulary exactly once and an adapter is built
		// for every rail the config offers, so a rail with no adapter is a rail no button ever drew.
		// answered as an answer nobody has rather than as a refusal, which is the direction that costs
		// a re-read rather than a Retry against an order that may exist.
		if (part === undefined) return { kind: 'indeterminate' };
		confirmed = part;
		return part.surface.confirm(input);
	};

	/**
	 * what became of an order this page did not watch, read through the processor that minted it.
	 *
	 * three readings in falling order of how sure each is. the processor that took the confirmation
	 * settles it outright, where this page load made one. then a processor that says this page load
	 * is a return from its own window, which PayPal's session answers without reading the token at
	 * all. only then the first processor, which on a two-processor form is the one holding a real
	 * read of its own intent — handed a token that is not its own it answers that nobody knows,
	 * which is the direction that costs a re-read rather than a second charge.
	 */
	const resume: CheckoutPorts['resume'] = async (input): Promise<ConfirmOutcome> => {
		if (confirmed !== null) return confirmed.surface.resume(input);
		for (const part of parts) {
			if (await part.claimsReturn()) return part.surface.resume(input);
		}
		const first = parts[0];
		return first === undefined ? { kind: 'indeterminate' } : first.surface.resume(input);
	};

	return {
		confirm,
		resume,
		quoted(request, quote) {
			for (const part of parts) part.surface.quoted(request, quote);
		},
		cadence(frequency) {
			for (const part of parts) part.surface.cadence(frequency);
		},
		stop() {
			// each adapter's own `stop` is safe in whatever order it is reached in and safe twice, so
			// nothing here is arranged on their behalf and a second call costs nothing.
			for (const part of parts) part.surface.stop();
		}
	};
}
