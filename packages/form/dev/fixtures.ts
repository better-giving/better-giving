import type { FormRuntime } from '../src/element';
import { EmbedFailure } from '../src/embed/api';
import { createPaymentSurface } from '../src/embed/surface';
import { estimateFee } from '../src/fee';
import type { CheckoutPorts } from '../src/ports';
import {
	FREQUENCIES,
	PAYMENT_METHODS,
	type Deposit,
	type FeeCoverage,
	type FeeRule,
	type FormConfig,
	type PayableCoin,
	type PaymentMethod,
	type Program,
	type Provider
} from '../src/v1';

// the thirteen configurations ./main.ts can put the element on, and the runtime that serves them.
//
// nothing here reaches the network, and that is the whole premise of the page rather than a
// convenience: `loadConfig` answers from this file, `checkout` never lets Stripe.js be asked for —
// a stub on every fixture but `crypto`, and on that one the real surface with the Stripe half's
// loader answering nothing — and no fixture names a `turnstileSiteKey`, which is what keeps
// ../src/embed/turnstile.ts from loading a widget. a contributor needs no deployment, no database
// and no vendor account.
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
	readonly coins?: readonly PayableCoin[];
};

/**
 * the provider set every fixture carries.
 *
 * the key is a shape and not a credential: `checkout` below builds a payment surface for `crypto`
 * alone, and hands that one's Stripe half a loader that answers nothing, so no SDK reads this and
 * nothing is initialised with it. one processor, which is what a deployment holding one serves.
 */
const PROVIDERS: readonly Provider[] = [{ name: 'stripe', publishableKey: 'pk_live_x' }];

/** the processors' published list prices, which is what a deployment's own rules look like. */
const RULES: Record<PaymentMethod, FeeRule> = {
	card: { percent: 0.029, fixedMinor: 30 },
	ach: { percent: 0.008, fixedMinor: 0 },
	apple_pay: { percent: 0.029, fixedMinor: 30 },
	google_pay: { percent: 0.029, fixedMinor: 30 },
	paypal: { percent: 0.0349, fixedMinor: 49 },
	venmo: { percent: 0.0349, fixedMinor: 49 },
	daf: { percent: 0.029, fixedMinor: 0, roundUpMinor: 100 },
	crypto: { percent: 0.01, fixedMinor: 0 }
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

/**
 * the coins `crypto` serves, one per screen worth looking at.
 *
 * xrp carries a memo and usdt on tron does not, which are the two address screens. ada's address is
 * the long one. `fail` is no coin at all: its quote refuses as `below_minimum`, which is the step the
 * refusal lands back on. every address is plainly not one, and nothing here would pay anybody.
 */
const COINS: readonly PayableCoin[] = [
	{ coin: 'xrp', ticker: 'xrp', name: 'Ripple', network: 'xrp', memoRequired: true },
	{
		coin: 'usdttrc20',
		ticker: 'usdt',
		name: 'Tether USD (Tron)',
		network: 'trx',
		memoRequired: false
	},
	{ coin: 'btc', ticker: 'btc', name: 'Bitcoin', network: 'btc', memoRequired: false },
	{ coin: 'ada', ticker: 'ada', name: 'Cardano', network: 'ada', memoRequired: false },
	{ coin: 'fail', ticker: 'fail', name: 'Refused on purpose', network: 'dev', memoRequired: false }
];

/** a coin's made-up address and its made-up price in minor units per whole coin, keyed by `coin`. */
const WALLETS: Readonly<Record<string, { readonly address: string; readonly priceMinor: number }>> =
	{
		xrp: { address: 'rDEVxFAKExADDRESSxNOTxREALxXRP0000', priceMinor: 52 },
		usdttrc20: { address: 'TDEVxFAKExADDRESSxNOTxREALxTRON000', priceMinor: 100 },
		btc: { address: 'bc1qdevxfakexaddressxnotxrealxbitcoin0000000', priceMinor: 6_100_000 },
		ada: {
			address:
				'addr1_dev_fake_address_not_real_cardano_0000000000000000000000000000000000000000000000000000000000000000',
			priceMinor: 35
		}
	};

/** the floor `fail`'s refusal names, as `ApiError.minAmountMinor` in ../src/v1.ts. */
const FAIL_MINIMUM_MINOR = 5000;

/** the memo a memo coin's quote carries. */
const MEMO = '104729';

/**
 * the address as the module matrix a quote carries, written out rather than encoded.
 *
 * a square with a finder in three corners and noise between, so the screen draws what a QR code
 * looks like. it does not scan and is not meant to.
 */
const QR_ROWS = [
	'1111111010110111101111111',
	'1000001000011101101000001',
	'1011101011001111001011101',
	'1011101000110110101011101',
	'1011101010000011101011101',
	'1000001011110010101000001',
	'1111111010101010101111111',
	'0000000000011011100000000',
	'0111011111111011111000011',
	'0011000111100000010000000',
	'0101001001010101001110111',
	'1000100010011111100000000',
	'0111001100001110010111001',
	'1100110010010000000000011',
	'0000101001001011100100011',
	'1101110000010111011110001',
	'0111011000111111011101110',
	'0000000010000010110011100',
	'1111111001111000001001110',
	'1000001011011010000100000',
	'1011101001011000001110110',
	'1011101011110011110001011',
	'1011101011110001101100011',
	'1000001000001011111001000',
	'1111111001111111111111101'
] as const;

/** card and crypto, on both cadences, so the monthly one shows the crypto row leaving the box. */
const CRYPTO: ServedConfig = {
	...DEFAULT,
	formId: 'frm_crypto',
	paymentMethods: ['card', 'crypto'],
	coins: COINS
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
	'crypto',
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
	crypto: {
		formId: CRYPTO.formId,
		note: 'Card and crypto, five coins. ?deposit= picks the ending: received (default), expired or late. The coin named fail is refused as under its minimum.',
		load: async () => CRYPTO
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
 * how a `crypto` gift's address ends, which `?deposit=` on the page picks (./main.ts).
 *
 * `received` and `expired` are the server's two readings, each after `READINGS_BEFORE_ENDING` of
 * `waiting`. `late` is a send-by already past on this device, so the address closes at once and the
 * reading goes on with nothing ever arriving — the screen that says so stays up.
 */
export const DEPOSIT_ENDINGS = ['received', 'expired', 'late'] as const;
export type DepositEnding = (typeof DEPOSIT_ENDINGS)[number];

/** readings of `waiting` before the ending, each `DEPOSIT_POLL_MS` in ../src/checkout.machine.ts apart. */
const READINGS_BEFORE_ENDING = 3;

/** how long an address stays open on the `received` and `expired` endings. */
const ADDRESS_OPEN_MS = 30 * 60 * 1000;

/** a whole-coin figure as `Deposit.coinAmount`'s canonical decimal text. */
function coinAmount(totalMinor: number, priceMinor: number): string {
	return (totalMinor / priceMinor).toFixed(8).replace(/\.?0+$/, '');
}

/**
 * the address a `crypto` quote hands over, or the refusal `fail` answers with.
 *
 * the refusal is an `EmbedFailure` carrying the code and floor, which is exactly what the real quote
 * port (`createQuote` in ../src/embed/api.ts) rejects with, so the machine routes it the same way.
 */
function deposit(coin: string, totalMinor: number, ending: DepositEnding): Deposit {
	const wallet = WALLETS[coin];
	const served = COINS.find((one) => one.coin === coin);
	if (wallet === undefined || served === undefined) {
		throw new EmbedFailure(
			`A gift of this size is under what NOWPayments accepts in ${coin.toUpperCase()}. No address was created.`,
			'Nothing is wrong with this deployment: the coin named fail in packages/form/dev/fixtures.ts is refused on purpose.',
			'below_minimum',
			undefined,
			FAIL_MINIMUM_MINOR
		);
	}
	const until = Date.now() + (ending === 'late' ? -60 * 60 * 1000 : ADDRESS_OPEN_MS);
	return {
		address: wallet.address,
		memo: served.memoRequired ? MEMO : null,
		coin,
		network: served.network,
		coinAmount: coinAmount(totalMinor, wallet.priceMinor),
		validUntil: new Date(until).toISOString(),
		qr: { rows: QR_ROWS }
	};
}

/**
 * the money path, answered from the configuration the flow is already holding.
 *
 * derived rather than fixed, because `quoteIsUsable` in ../src/fee.ts refuses a total below the
 * amount — a constant quote would be usable for one gift and rejected for every larger one, and the
 * review step would read as broken rather than as unwired. this is the same arithmetic the card
 * already shows in its fee row, so the two agree and no correction screen is reached.
 */
function ports(config: FormConfig, ending: DepositEnding): CheckoutPorts {
	let minted = 0;
	/** readings made per donation id, so each address counts to its ending from zero. */
	const readings = new Map<string, number>();
	return {
		quote: async (request) => {
			const covered = request.coversFee
				? estimateFee(request.amountMinor, config.feeRules[request.method])
				: null;
			const feeMinor = covered?.feeMinor ?? 0;
			const totalMinor = covered?.totalMinor ?? request.amountMinor;
			if (request.method !== 'crypto' || request.coin === undefined) {
				return { paymentToken: `pi_dev_${request.formId}`, feeMinor, totalMinor };
			}
			minted += 1;
			return {
				paymentToken: `don_dev_${minted}`,
				feeMinor,
				totalMinor,
				deposit: deposit(request.coin, totalMinor, ending)
			};
		},
		confirm: async () => ({ kind: 'succeeded' }),
		resume: async () => ({ kind: 'succeeded' }),
		status: async ({ paymentToken }) => {
			const read = (readings.get(paymentToken) ?? 0) + 1;
			readings.set(paymentToken, read);
			if (ending === 'late' || read <= READINGS_BEFORE_ENDING) return { state: 'waiting' };
			return { state: ending };
		},
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
 *
 * `crypto` is the exception, composed the way ../src/embed/runtime.ts composes it so the coin row,
 * its list and the monthly cadence taking it away are the shipped code. its Stripe half is handed a
 * loader that answers nothing, which that adapter reads as fields that never came up and
 * ../src/embed/surface.ts withholds, since the crypto half never reports the same — so the card row
 * is counted in the box's header and never drawn.
 */
export function devRuntime(ending: DepositEnding): FormRuntime {
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
		checkout: (config, mount, onRail, onUnavailable, _boot, fund, coins) => {
			if (config.formId === CRYPTO.formId) {
				const surface = createPaymentSurface(config, mount, onRail, onUnavailable, fund, coins, {
					stripe: { load: async () => null }
				});
				const fake = ports(config, ending);
				const quote: CheckoutPorts['quote'] = async (request) => {
					const answered = await fake.quote(request);
					surface.quoted(request, answered);
					return answered;
				};
				return {
					input: {
						config,
						ports: { ...fake, quote, confirm: surface.confirm, resume: surface.resume }
					},
					cadence: surface.cadence,
					offerFund: surface.offerFund,
					offerCrypto: surface.offerCrypto,
					rows: surface.rows,
					stop: surface.stop
				};
			}
			// after the caller has finished starting the flow, the way a provider's own report always
			// arrives: a rail named inside this call would reach a machine that does not exist yet.
			queueMicrotask(() => onRail(config.paymentMethods[0] ?? null));
			return {
				input: { config, ports: ports(config, ending) },
				cadence: () => {},
				offerFund: () => {},
				offerCrypto: () => {},
				// no provider draws here, so the box is headed as though every offered rail were a row.
				rows: (listener) => listener(config.paymentMethods.length),
				stop: () => {}
			};
		},
		challenge: () => ({ reset: () => {}, stop: () => {} })
	};
}
