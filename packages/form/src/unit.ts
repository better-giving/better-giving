// what the donor gives, on the first step: every sentence that step says about it, the currency
// table, the marks the unit pill draws, and the readings of the config they are drawn from.
//
// pure, with no DOM, so the element (./views.ts) and the deployment's own donation page
// (`src/lib/donate/` in packages/app) draw the pill, its list, the entry and the Continue from one
// set of words. what the flow decides — what is offered, what is picked, what is priced — is
// `connect`'s (./connect.ts), which hands it to these.
//
// `../package.json` exports this module as `./unit` for that second surface.

import { formatMinor, formatOffer } from './money';
import type { CoinRefusal, coinEstimate } from './checkout.machine';
import type { GiftUnit } from './value';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type FormConfig, type PaymentMethod } from './v1';

/** the open list's dialog name, and the hidden label on its search box. */
export const UNIT_PANEL_NAME = 'What you give';
export const SEARCH_WITH_STOCK = 'Search currency, crypto or stock';
export const SEARCH_WITHOUT_STOCK = 'Search currency or crypto';

/** the list's three group headings. */
export const UNIT_GROUPS = { currency: 'Currencies', coin: 'Crypto', stock: 'Stocks' } as const;

/**
 * the sentence for a search that found nothing, quoting what was typed: the Stocks group's, or the
 * Crypto group's where stocks are off (`Listing` in ./unit-panel.ts).
 */
export function noStockMatch(query: string): string {
	return `No match for “${query}”. Try a name or a ticker.`;
}

/** the Stocks group's sentence where the search could not be made. */
export const STOCK_SEARCH_FAILED = 'Couldn’t search stocks. Try again in a moment.';

/** the note under the cadence track while a coin or stock is picked. */
export const ONE_TIME_ONLY = {
	coin: 'Crypto gifts are one-time only.',
	stock: 'Stock gifts are one-time only.'
} as const;

/** the unit at the end of a share count's box. */
export const SHARES = 'shares';

/** the line under a coin amount the estimate priced, as `About $482.10`. */
export function aboutEstimate(minor: number, config: Pick<FormConfig, 'locale' | 'currency'>) {
	return `About ${formatMinor(minor, config.locale, config.currency)}`;
}

/**
 * the note under a coin amount, on a deployment in US dollars. it is worded for that currency alone,
 * so a deployment in any other states no note.
 */
export const VALUED_IN_USD = 'Your gift is valued in US dollars when it arrives.';

/** the sentence beside a coin amount whose price could not be checked: its read failed or answered none. */
export const COIN_PRICE_FAILED =
	'Couldn’t check the price. Retype the amount or pick the coin again.';

/** the first step's Continue, and what it says of the payment step after it. */
export const CONTINUE = 'Continue';
export const NEXT_PAYMENT = 'Next: payment';
export const CONTINUE_TO_PAYMENT = 'Continue to payment';

/** a coin gift's review step: its head, the receipt's three labels, and its one press, `CONTINUE`. */
export const REVIEW = 'Review';
export const ONE_TIME_GIFT = 'One-time gift';
export const COVER_THE_FEE = 'Cover the processing fee';
export const TOTAL_TODAY = 'Total today';

/**
 * a coin gift's review step as it reads: the money step's receipt with its fee switch, every figure
 * "about" because the coin is valued when it arrives. `fee` stands beside the switch only while it is
 * on; `feeLine` says what the switch does either way, and both are `null` where it is on and the rail
 * prices no fee, which leaves nothing true to add.
 */
export type CoinReview = {
	readonly heading: typeof REVIEW;
	readonly giftLabel: typeof ONE_TIME_GIFT;
	readonly gift: string;
	readonly feeSwitch: typeof COVER_THE_FEE;
	readonly fee: string | null;
	readonly feeLine: string | null;
	readonly totalLabel: typeof TOTAL_TODAY;
	readonly total: string;
	readonly action: typeof CONTINUE;
};

/**
 * the words for a coin gift's review step. `feeMinor` is the covered fee, `null` with the switch off
 * or unpriced; `totalMinor` is the figure the quote is measured against (`shownTotalMinor` in
 * ./checkout.machine.ts), passed in rather than summed here so the receipt and the press state one.
 */
export function coinReview(
	config: Pick<FormConfig, 'locale' | 'currency' | 'orgLegalName'>,
	figures: {
		readonly giftMinor: number;
		readonly covers: boolean;
		readonly feeMinor: number | null;
		readonly totalMinor: number;
	}
): CoinReview {
	const money = (minor: number) => formatMinor(minor, config.locale, config.currency);
	const { covers, feeMinor } = figures;
	const added = covers && feeMinor !== null ? money(feeMinor) : null;
	return {
		heading: REVIEW,
		giftLabel: ONE_TIME_GIFT,
		gift: aboutEstimate(figures.giftMinor, config),
		feeSwitch: COVER_THE_FEE,
		fee: added === null ? null : `+ about ${added}`,
		feeLine: !covers
			? `${config.orgLegalName} pays the processing fee out of your gift.`
			: added === null
				? null
				: `You add about ${added} toward the processing fee.`,
		totalLabel: TOTAL_TODAY,
		total: aboutEstimate(figures.totalMinor, config),
		action: CONTINUE
	};
}

/** the address screen's way back to the first step. */
export const CHANGE_WHAT_YOU_GIVE = 'Change what you give';

/** the sentence a refused coin carries in the list, under its own unchanged label. */
export const COIN_REFUSED = 'no longer accepted';

/**
 * a coin gift's refusal, beside the entry where it is fixed. the coin is named by the name the served
 * list gives it, and by its own code where the list no longer carries it; the minimum is offered the
 * way a tile offers a figure (./money.ts). a coin no longer accepted is named before the words its
 * list row carries.
 */
export function coinRefusalSentence(
	refusal: CoinRefusal,
	config: Pick<FormConfig, 'coins' | 'locale' | 'currency'>
): string {
	const coinName =
		config.coins?.find((coin) => coin.coin === refusal.coin)?.name ?? refusal.coin.toUpperCase();
	if (refusal.code !== 'below_minimum') {
		return refusal.code === 'above_maximum'
			? `Enter a smaller amount for ${coinName}, or choose another coin`
			: `${coinName} is ${COIN_REFUSED}`;
	}
	return refusal.minAmountMinor === undefined
		? `Enter a larger amount for ${coinName}, or choose another coin`
		: `Enter at least ${formatOffer(refusal.minAmountMinor, config.locale, config.currency)} in ${coinName}, or choose another coin`;
}

/** the countries a flag is drawn for, as circle-flags names its files. */
export type FlagCountry = 'us' | 'eu' | 'gb';

/** a currency's code, its plain-text name, and the country whose flag stands for it, where one does. */
export type Currency = {
	readonly code: string;
	readonly name: string;
	readonly country?: FlagCountry;
};

/** the currencies a flag is drawn for, with the plain-text name where the design gives one. */
const CURRENCY_TABLE: Readonly<Record<string, { country: FlagCountry; name?: string }>> = {
	USD: { country: 'us', name: 'US dollar' },
	EUR: { country: 'eu' },
	GBP: { country: 'gb' }
};

/**
 * a currency code as the list and the pill name it: the table's own name where it has one, else the
 * locale's (`Intl.DisplayNames`), else the code; a flag only for a code in the table.
 */
export function currencyOf(code: string, locale: string): Currency {
	const upper = code.toUpperCase();
	const entry = CURRENCY_TABLE[upper];
	const name = entry?.name ?? displayName(upper, locale) ?? upper;
	return entry === undefined
		? { code: upper, name }
		: { code: upper, name, country: entry.country };
}

function displayName(code: string, locale: string): string | undefined {
	try {
		return new Intl.DisplayNames(locale, { type: 'currency' }).of(code);
	} catch {
		return undefined;
	}
}

/** an svg file's text as an image source, which asks no origin for it. */
function inlineSvg(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * the round flags, as circle-flags draws them (https://github.com/HatScripts/circle-flags, MIT;
 * THIRD_PARTY_NOTICES.md), each file's text unchanged.
 *
 * drawn as an `<img>` source rather than inline svg: each file masks its circle with `id="a"`, and an
 * image keeps its ids to itself where two inline flags in one tree would share one. inline, so a form
 * embedded in a page this project does not own asks no origin for a flag.
 */
export const FLAG_SRC: Readonly<Record<FlagCountry, string>> = {
	us: inlineSvg(
		'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><mask id="a"><circle cx="256" cy="256" r="256" fill="#fff"/></mask><g mask="url(#a)"><path fill="#eee" d="M256 0h256v64l-32 32 32 32v64l-32 32 32 32v64l-32 32 32 32v64l-256 32L0 448v-64l32-32-32-32v-64z"/><path fill="#d80027" d="M224 64h288v64H224Zm0 128h288v64H256ZM0 320h512v64H0Zm0 128h512v64H0Z"/><path fill="#0052b4" d="M0 0h256v256H0Z"/><path fill="#eee" d="m187 243 57-41h-70l57 41-22-67zm-81 0 57-41H93l57 41-22-67zm-81 0 57-41H12l57 41-22-67zm162-81 57-41h-70l57 41-22-67zm-81 0 57-41H93l57 41-22-67zm-81 0 57-41H12l57 41-22-67Zm162-82 57-41h-70l57 41-22-67Zm-81 0 57-41H93l57 41-22-67zm-81 0 57-41H12l57 41-22-67Z"/></g></svg>' // raw-colour-ok: circle-flags' own artwork.
	),
	eu: inlineSvg(
		'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><mask id="a"><circle cx="256" cy="256" r="256" fill="#fff"/></mask><g mask="url(#a)"><path fill="#0052b4" d="M0 0h512v512H0z"/><path fill="#ffda44" d="m256 100.2 8.3 25.5H291l-21.7 15.7 8.3 25.6-21.7-15.8-21.7 15.8 8.3-25.6-21.7-15.7h26.8zm-110.2 45.6 24 12.2 18.9-19-4.2 26.5 23.9 12.2-26.5 4.2-4.2 26.5-12.2-24-26.5 4.3 19-19zM100.2 256l25.5-8.3V221l15.7 21.7 25.6-8.3-15.8 21.7 15.8 21.7-25.6-8.3-15.7 21.7v-26.8zm45.6 110.2 12.2-24-19-18.9 26.5 4.2 12.2-23.9 4.2 26.5 26.5 4.2-24 12.2 4.3 26.5-19-19zM256 411.8l-8.3-25.5H221l21.7-15.7-8.3-25.6 21.7 15.8 21.7-15.8-8.3 25.6 21.7 15.7h-26.8zm110.2-45.6-24-12.2-18.9 19 4.2-26.5-23.9-12.2 26.5-4.2 4.2-26.5 12.2 24 26.5-4.3-19 19zM411.8 256l-25.5 8.3V291l-15.7-21.7-25.6 8.3 15.8-21.7-15.8-21.7 25.6 8.3 15.7-21.7v26.8zm-45.6-110.2-12.2 24 19 18.9-26.5-4.2-12.2 23.9-4.2-26.5-26.5-4.2 24-12.2-4.3-26.5 19 19z"/></g></svg>' // raw-colour-ok: circle-flags' own artwork.
	),
	gb: inlineSvg(
		'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><mask id="a"><circle cx="256" cy="256" r="256" fill="#fff"/></mask><g mask="url(#a)"><path fill="#eee" d="m0 0 8 22-8 23v23l32 54-32 54v32l32 48-32 48v32l32 54-32 54v68l22-8 23 8h23l54-32 54 32h32l48-32 48 32h32l54-32 54 32h68l-8-22 8-23v-23l-32-54 32-54v-32l-32-48 32-48v-32l-32-54 32-54V0l-22 8-23-8h-23l-54 32-54-32h-32l-48 32-48-32h-32l-54 32L68 0H0z"/><path fill="#0052b4" d="M336 0v108L444 0Zm176 68L404 176h108zM0 176h108L0 68ZM68 0l108 108V0Zm108 512V404L68 512ZM0 444l108-108H0Zm512-108H404l108 108Zm-68 176L336 404v108z"/><path fill="#d80027" d="M0 0v45l131 131h45L0 0zm208 0v208H0v96h208v208h96V304h208v-96H304V0h-96zm259 0L336 131v45L512 0h-45zM176 336 0 512h45l131-131v-45zm160 0 176 176v-45L381 336h-45z"/></g></svg>' // raw-colour-ok: circle-flags' own artwork.
	)
};

/**
 * the Apple mark, as simple-icons draws it (https://simpleicons.org, CC0; THIRD_PARTY_NOTICES.md), the
 * file's text unchanged: one path in the svg's default black, inline for the flags' reason above.
 */
export const APPLE_SRC = inlineSvg(
	'<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Apple</title><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>'
);

/**
 * a mark the unit pill draws in a 14px disc, decorative beside the pill's own name: a currency's
 * flag, a coin's logo as the served list gives it, or the Apple mark standing for AAPL. `src` is the
 * image each is drawn from: the processor's path for a logo, inline for the other two.
 */
export type UnitMark =
	| { readonly mark: 'flag'; readonly country: FlagCountry; readonly src: string }
	| { readonly mark: 'logo'; readonly src: string }
	| { readonly mark: 'apple'; readonly src: string };

function flagMark(country: FlagCountry): UnitMark {
	return { mark: 'flag', country, src: FLAG_SRC[country] };
}

const APPLE_MARK: UnitMark = { mark: 'apple', src: APPLE_SRC };

/** the one ticker the pill has a mark for (the design's recognisable stock example). */
export const MARKED_TICKER = 'AAPL';

/**
 * a list option's value for a unit, and the unit read back from one: `currency`, `coin:<code>` or
 * `stock:<ticker>`. a select keys its options by string (`NO_PROGRAM` in ./connect.ts).
 */
export function unitKey(unit: GiftUnit): string {
	if (unit.kind === 'coin') return `coin:${unit.coin}`;
	if (unit.kind === 'stock') return `stock:${unit.ticker}`;
	return 'currency';
}

export function unitOfKey(key: string): GiftUnit | null {
	if (key === 'currency') return { kind: 'currency' };
	const [kind, ...rest] = key.split(':');
	const id = rest.join(':');
	if (id === '') return null;
	if (kind === 'coin') return { kind: 'coin', coin: id };
	if (kind === 'stock') return { kind: 'stock', ticker: id };
	return null;
}

/**
 * the unit pill: `text` where the deployment offers its currency alone (plain text, not a control),
 * `initial` until the donor picks, `picked` once they have, the currency again included. `name` is its
 * accessible name, and the code alone on plain text.
 */
export type UnitPill = {
	readonly state: 'text' | 'initial' | 'picked';
	readonly code: string;
	readonly name: string;
	readonly marks: readonly UnitMark[];
};

/** which kinds besides the currency the first step offers (`unitsOffered` in ./checkout.machine.ts). */
export type UnitsOffered = { readonly coin: boolean; readonly stock: boolean };

type PillConfig = Pick<FormConfig, 'currency' | 'locale' | 'coins'>;

export function unitPill(
	config: PillConfig,
	offered: UnitsOffered,
	picked: GiftUnit | undefined
): UnitPill {
	const currency = currencyOf(config.currency, config.locale);
	const flag: UnitMark[] = currency.country === undefined ? [] : [flagMark(currency.country)];
	if (!offered.coin && !offered.stock)
		return { state: 'text', code: currency.code, name: currency.code, marks: [] };
	if (picked === undefined) {
		const also = [offered.coin ? 'crypto' : null, offered.stock ? 'stocks' : null].filter(
			(kind) => kind !== null
		);
		const coin = offered.coin ? exampleCoinMark(config) : [];
		const apple: UnitMark[] = offered.stock ? [APPLE_MARK] : [];
		return {
			state: 'initial',
			code: currency.code,
			name: `Currency: ${currency.code}. Also ${also.join(' and ')}`,
			marks: [...flag, ...coin, ...apple]
		};
	}
	if (picked.kind === 'coin') {
		const coin = config.coins?.find((offer) => offer.coin === picked.coin);
		const code = (coin?.ticker ?? picked.coin).toUpperCase();
		const marks: UnitMark[] = coin?.logo === undefined ? [] : [{ mark: 'logo', src: coin.logo }];
		return { state: 'picked', code, name: `Crypto: ${code}`, marks };
	}
	if (picked.kind === 'stock') {
		const marks: UnitMark[] = picked.ticker === MARKED_TICKER ? [APPLE_MARK] : [];
		return { state: 'picked', code: picked.ticker, name: `Stock: ${picked.ticker}`, marks };
	}
	return { state: 'picked', code: currency.code, name: `Currency: ${currency.code}`, marks: flag };
}

/**
 * the entry for a gift in kind: the unit at the end of its one box, and the lines under it — a coin's
 * estimate once one is priced and its valuation note, nothing under a share count. `null` on a gift
 * in the currency, which the amount tiles take.
 *
 * `unpriced` is `COIN_PRICE_FAILED` while the price check of the coin amount in the box has failed,
 * and `null` otherwise: while a read is out, once it prices, on an empty box and under a share count.
 */
export type UnitEntry = {
	readonly unitLabel: string;
	readonly estimate: string | null;
	readonly note: string | null;
	readonly unpriced: string | null;
};

export function unitEntry(
	config: PillConfig & Pick<FormConfig, 'currency'>,
	picked: GiftUnit | undefined,
	estimate: ReturnType<typeof coinEstimate>
): UnitEntry | null {
	if (picked?.kind === 'stock') {
		return { unitLabel: SHARES, estimate: null, note: null, unpriced: null };
	}
	if (picked?.kind !== 'coin') return null;
	return {
		unitLabel: unitPill(config, { coin: true, stock: false }, picked).code,
		estimate: estimate?.status === 'priced' ? aboutEstimate(estimate.minor, config) : null,
		note: currencyOf(config.currency, config.locale).code === 'USD' ? VALUED_IN_USD : null,
		unpriced: estimate?.status === 'unpriced' ? COIN_PRICE_FAILED : null
	};
}

/** the note under the cadence track, or `null` on a gift in the currency. */
export function cadenceNote(picked: GiftUnit | undefined): string | null {
	if (picked?.kind === 'coin') return ONE_TIME_ONLY.coin;
	if (picked?.kind === 'stock') return ONE_TIME_ONLY.stock;
	return null;
}

/** the coin the initial stack shows: BTC where it is served, else the first coin by ticker. */
function exampleCoinMark(config: PillConfig): UnitMark[] {
	const coins = [...(config.coins ?? [])].sort((a, b) => a.ticker.localeCompare(b.ticker));
	const coin = coins.find((offer) => offer.ticker === 'btc') ?? coins[0];
	return coin?.logo === undefined ? [] : [{ mark: 'logo', src: coin.logo }];
}

/**
 * the first step's Continue. `methods` and `one-method` head toward the payment step, whose methods
 * are named in the eyebrow's hidden description, in the order the design lists them: the
 * deployment's own, less the coin and stock the first step picks (`NOT_ON_THE_PAYMENT_STEP`).
 * `in-kind` is a coin or stock gift, which chooses no payment method: a coin's Review step lists
 * none, and a stock has no Review step.
 */
export type ContinueCase =
	| {
			readonly case: 'methods' | 'one-method';
			readonly label: typeof CONTINUE;
			readonly eyebrow: typeof NEXT_PAYMENT;
			readonly name: typeof CONTINUE_TO_PAYMENT;
			readonly description: string;
			readonly methods: readonly { readonly method: PaymentMethod; readonly label: string }[];
	  }
	| { readonly case: 'in-kind'; readonly label: typeof CONTINUE };

/** chosen on the first step, never on the payment step. */
const NOT_ON_THE_PAYMENT_STEP: readonly PaymentMethod[] = ['crypto', 'stock'];

export function continueCase(
	config: Pick<FormConfig, 'paymentMethods'>,
	inKind: boolean
): ContinueCase {
	if (inKind) return { case: 'in-kind', label: CONTINUE };
	const methods = PAYMENT_METHODS.filter(
		(method) => config.paymentMethods.includes(method) && !NOT_ON_THE_PAYMENT_STEP.includes(method)
	).map((method) => ({ method, label: PAYMENT_METHOD_LABELS[method] }));
	return {
		case: methods.length > 1 ? 'methods' : 'one-method',
		label: CONTINUE,
		eyebrow: NEXT_PAYMENT,
		name: CONTINUE_TO_PAYMENT,
		description: `Payment methods on the next step: ${methods.map((entry) => entry.label).join(', ')}`,
		methods
	};
}
