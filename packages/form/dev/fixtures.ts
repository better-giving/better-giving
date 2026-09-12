import type { FormRuntime } from '../src/element';
import { estimateFee } from '../src/fee';
import type { CheckoutPorts } from '../src/ports';
import {
	FREQUENCIES,
	PAYMENT_METHODS,
	type FeeCoverage,
	type FeeRule,
	type FormConfig,
	type PaymentMethod,
	type Program,
	type Provider
} from '../src/v1';

// the twelve configurations ./main.ts can put the element on, and the runtime that serves them.
//
// nothing here reaches the network, and that is the whole premise of the page rather than a
// convenience: `loadConfig` answers from this file, `checkout` is a stub so Stripe.js is never
// asked for, and no fixture names a `turnstileSiteKey`, which is what keeps ../src/embed/turnstile.ts
// from loading a widget. a contributor needs no deployment, no database and no vendor account.
//
// each fixture is a served body rather than a `FormConfig`: ../src/config.ts is what turns one into
// the other, and going through it is what makes a fixture a state the element can actually be in.
// so a missing key here is a missing key on the wire — `minimal` omits `suggestedAmountsMinor` and
// `feeRules` outright rather than passing empty ones.
//
// the ids are distinct per fixture, which is what makes the picker work at all: `#bootIfNeeded` in
// ../src/element.ts drops a boot for the form already live, so switching fixtures is a boot only
// because the id moved with it.

/**
 * a served body, before ../src/config.ts makes it true.
 *
 * loose exactly where the wire is loose. the two optional keys are the ones `minimal` leaves out,
 * and `feeRules` is partial because a response is not obliged to price every rail it offers.
 */
type ServedConfig = {
	readonly formId: string;
	readonly providers: readonly Provider[];
	readonly currency: string;
	readonly suggestedAmountsMinor?: readonly number[];
	readonly minAmountMinor: number;
	readonly maxAmountMinor: number;
	readonly frequencies: readonly string[];
	readonly paymentMethods: readonly string[];
	readonly feeCoverage: FeeCoverage;
	readonly feeRules?: Partial<Record<PaymentMethod, FeeRule>>;
	readonly locale: string;
	readonly orgLegalName: string;
	readonly ein: string;
	readonly deductibilityStatement: string;
	readonly program?: Program;
};

/**
 * the provider set every fixture carries.
 *
 * the key is a shape and not a credential: `checkout` below hands the flow its ports directly and
 * never builds a payment surface, so no SDK reads this and nothing is initialised with it. one
 * processor, which is what a deployment holding one serves.
 */
const PROVIDERS: readonly Provider[] = [{ name: 'stripe', publishableKey: 'pk_live_x' }];

/** the processors' published list prices, which is what a deployment's own rules look like. */
const RULES: Record<PaymentMethod, FeeRule> = {
	card: { percent: 0.029, fixedMinor: 30 },
	ach: { percent: 0.008, fixedMinor: 0 },
	apple_pay: { percent: 0.029, fixedMinor: 30 },
	google_pay: { percent: 0.029, fixedMinor: 30 },
	paypal: { percent: 0.0349, fixedMinor: 49 },
	venmo: { percent: 0.0349, fixedMinor: 49 }
};

const IDENTITY = {
	locale: 'en-US',
	orgLegalName: 'Acme Relief Fund',
	ein: '12-3456789',
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.'
} as const;

/** the fixture ../src/element.browser.spec.ts drives the element from, reproduced. */
const DEFAULT: ServedConfig = {
	formId: 'frm_a8x2k9',
	providers: PROVIDERS,
	currency: 'usd',
	suggestedAmountsMinor: [2500, 10_000],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time', 'monthly'],
	paymentMethods: ['card'],
	feeCoverage: 'optional',
	feeRules: RULES,
	...IDENTITY
};

/** the shortest card this element draws: one frequency, one rail, no tiles and no fee row. */
const MINIMAL: ServedConfig = {
	formId: 'frm_minimal',
	providers: PROVIDERS,
	currency: 'usd',
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: ['one_time'],
	paymentMethods: ['card'],
	feeCoverage: 'optional',
	...IDENTITY
};

/**
 * the widest card, off the two vocabularies rather than off a list written out here.
 *
 * `FREQUENCIES` and `PAYMENT_METHODS` in ../src/v1.ts are the closed sets ../src/config.ts filters a
 * response against, so a member added to either is a member this fixture offers the same day.
 */
const MANY: ServedConfig = {
	formId: 'frm_many',
	providers: PROVIDERS,
	currency: 'usd',
	suggestedAmountsMinor: [2500, 10_000, 25_000, 100_000],
	minAmountMinor: 500,
	maxAmountMinor: 5_000_000,
	frequencies: FREQUENCIES,
	paymentMethods: PAYMENT_METHODS,
	feeCoverage: 'optional',
	feeRules: RULES,
	...IDENTITY
};

/**
 * one cadence beside a full row of presets, which is the card that draws no frequency control.
 *
 * `minimal` is one cadence too and does not exercise this: with no presets and no fee rules it is
 * short everywhere, so what a missing control does to the step above a real amount grid is not
 * visible on it.
 */
const SETTLED: ServedConfig = {
	...DEFAULT,
	formId: 'frm_settled',
	frequencies: ['monthly'],
	suggestedAmountsMinor: [2500, 10_000, 25_000, 100_000]
};

/**
 * the ladder the counting fixtures below take their presets from the head of.
 *
 * every entry sits inside `DEFAULT`'s own bounds, so `parseConfig` in ../src/config.ts drops none of
 * them and the count a fixture is named for is the count the card draws.
 */
const LADDER = [
	1000, 2500, 5000, 7500, 10_000, 15_000, 25_000, 50_000, 75_000, 100_000, 250_000, 500_000
] as const;

/**
 * a card offering exactly `count` presets, which is the one thing this page cannot otherwise be put
 * into: how the tiles wrap is settled by the count alone, and the fixtures above serve 0, 2 and 4.
 *
 * the counts worth looking at are the ones whose last row holds a single stretched tile — every odd
 * count two-up on a narrow card, and 4, 7, 10 three-up on a wide one.
 */
function counting(count: number): ServedConfig {
	return {
		...DEFAULT,
		formId: `frm_presets_${count}`,
		suggestedAmountsMinor: LADDER.slice(0, count)
	};
}

/** one suggestion: no tiles, and the box opens holding it. */
const PRESETS_1 = counting(1);
const PRESETS_5 = counting(5);
const PRESETS_7 = counting(7);
/** twelve is the most an operator can save (`MAX_SUGGESTED_AMOUNTS` in packages/app/src/lib/forms/amounts.ts). */
const PRESETS_12 = counting(12);

/**
 * a form pinned to one cause, which is the half of the program shape that draws no control.
 *
 * `choice` below cannot stand in for it: the picker is what that one is for, and this one is about
 * a card that carries a cause with nothing on the amount step to say so — the receipt's line is the
 * whole of where it appears, and a card that drew a select here would be offering a decision the
 * form has already made.
 */
const PINNED: ServedConfig = {
	...DEFAULT,
	formId: 'frm_pinned',
	program: { mode: 'pinned', name: 'Clean water' }
};

/**
 * a form offering causes, which is the one fixture that draws the picker at all.
 *
 * three rather than two, so what opens is a list rather than a pair — and the card adds its own
 * resting entry above them, so what a donor sees is four. `pinned` above cannot stand in for it for
 * the reason written there.
 */
const CHOICE: ServedConfig = {
	...DEFAULT,
	formId: 'frm_choice',
	program: {
		mode: 'choice',
		options: [
			{ id: 'prg_water', name: 'Clean water' },
			{ id: 'prg_school', name: 'Schools' },
			{ id: 'prg_relief', name: 'Emergency relief' }
		]
	}
};

/** the body the `slow` fixture answers with once it has finished being slow. */
const SLOW: ServedConfig = { ...DEFAULT, formId: 'frm_slow' };

/** how long `slow` waits. well inside `CONFIG_DEADLINE_MS` in ../src/element.ts, which is 30s. */
const SLOW_MS = 2000;

/** an error shaped the way `describe` in ../src/element.ts reads one: a sentence, and a fix under it. */
function unloadable(message: string, fix: string): Error {
	return Object.assign(new Error(message), { fix });
}

function after<T>(ms: number, value: T): Promise<T> {
	return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export const FIXTURE_NAMES = [
	'default',
	'minimal',
	'settled',
	'many',
	'pinned',
	'choice',
	'one',
	'five',
	'seven',
	'twelve',
	'unavailable',
	'slow'
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

export type Fixture = {
	/** what the picker puts on the `form` attribute. */
	readonly formId: string;
	/** the line under the picker, saying which state of the element this is. */
	readonly note: string;
	/** what `loadConfig` does for this id. */
	readonly load: () => Promise<unknown>;
};

export const FIXTURES: Readonly<Record<FixtureName, Fixture>> = {
	default: {
		formId: DEFAULT.formId,
		note: 'Two frequencies, card only, two suggested amounts.',
		load: async () => DEFAULT
	},
	minimal: {
		formId: MINIMAL.formId,
		note: 'One frequency, one rail, no suggested amounts and no fee rules.',
		load: async () => MINIMAL
	},
	settled: {
		formId: SETTLED.formId,
		note: 'One frequency beside four suggested amounts, so the card draws no frequency control.',
		load: async () => SETTLED
	},
	many: {
		formId: MANY.formId,
		note: 'Every frequency and rail the config parser accepts, and four suggested amounts.',
		load: async () => MANY
	},
	pinned: {
		formId: PINNED.formId,
		note: 'One cause the form is pinned to: no picker on the card, and the receipt names it.',
		load: async () => PINNED
	},
	choice: {
		formId: CHOICE.formId,
		note: 'Three causes the donor picks between, a select under the amount, and the receipt names the pick.',
		load: async () => CHOICE
	},
	one: {
		formId: PRESETS_1.formId,
		note: 'One suggested amount: no tiles, the box opens holding it.',
		load: async () => PRESETS_1
	},
	five: {
		formId: PRESETS_5.formId,
		note: 'Five suggested amounts, so the last row holds one stretched tile on a narrow card.',
		load: async () => PRESETS_5
	},
	seven: {
		formId: PRESETS_7.formId,
		note: 'Seven suggested amounts, the count that leaves a lone tile at two-up and at three-up alike.',
		load: async () => PRESETS_7
	},
	twelve: {
		formId: PRESETS_12.formId,
		note: 'Twelve suggested amounts, the most an operator can save, and no row left short at either width.',
		load: async () => PRESETS_12
	},
	unavailable: {
		formId: 'frm_unavailable',
		note: 'The read fails, so the card that says a form could not be loaded draws instead.',
		load: async () => {
			throw unloadable(
				'This donation form could not be loaded.',
				'Nothing is wrong with this deployment: the unavailable fixture in packages/form/dev/fixtures.ts rejects on purpose, so that this card can be looked at.'
			);
		}
	},
	slow: {
		formId: SLOW.formId,
		note: `The read answers after ${SLOW_MS / 1000} seconds, so the loading skeleton stays on screen. Re-boot runs it again.`,
		load: () => after(SLOW_MS, SLOW)
	}
};

/**
 * the money path, answered from the configuration the flow is already holding.
 *
 * derived rather than fixed, because `quoteIsUsable` in ../src/fee.ts refuses a total below the
 * amount — a constant quote would be usable for one gift and rejected for every larger one, and the
 * review step would read as broken rather than as unwired. this is the same arithmetic the card
 * already shows in its fee row, so the two agree and no correction screen is reached.
 */
function ports(config: FormConfig): CheckoutPorts {
	return {
		quote: async (request) => {
			const covered = request.coversFee
				? estimateFee(request.amountMinor, config.feeRules[request.method])
				: null;
			return {
				paymentToken: `pi_dev_${request.formId}`,
				feeMinor: covered?.feeMinor ?? 0,
				totalMinor: covered?.totalMinor ?? request.amountMinor
			};
		},
		confirm: async () => ({ kind: 'succeeded' }),
		resume: async () => ({ kind: 'succeeded' }),
		now: () => Date.now()
	};
}

/**
 * the three functions the element is registered with.
 *
 * `checkout` and `challenge` are the stubs ../src/element.browser.spec.ts registers, and they are
 * why this page loads no third-party script: the payment surface and the anti-abuse widget are the
 * two things that would, and neither is built. nothing is painted into either mount, so the payment
 * box stays closed and no challenge token is ever minted — which the quote above is untroubled by,
 * the token being optional on the request.
 *
 * the one thing added to those stubs is the rail report. a payment surface tells the card which
 * rail the donor's own fields are showing, and with no fields there is nobody to say — so the
 * review step refuses every press with "Choose how you would like to pay." over a box that is not
 * on the screen, which reads as a broken card rather than as an absent vendor. the first rail the
 * deployment offers is reported once instead, through the same callback a real surface reports it
 * through.
 */
export function devRuntime(): FormRuntime {
	return {
		loadConfig: async (formId) => {
			const fixture = Object.values(FIXTURES).find((one) => one.formId === formId);
			if (fixture === undefined) {
				throw unloadable(
					'This donation form could not be loaded.',
					`No fixture in packages/form/dev/fixtures.ts serves the id ${formId}. The picker sets one that does.`
				);
			}
			return fixture.load();
		},
		checkout: (config, _mount, onRail) => {
			// after the caller has finished starting the flow, the way a provider's own report always
			// arrives: a rail named inside this call would reach a machine that does not exist yet.
			queueMicrotask(() => onRail(config.paymentMethods[0] ?? null));
			return { input: { config, ports: ports(config) }, cadence: () => {}, stop: () => {} };
		},
		challenge: () => ({ reset: () => {}, stop: () => {} })
	};
}
