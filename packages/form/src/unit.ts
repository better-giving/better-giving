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
import type { CoinRefusal } from './checkout.machine';
import type { GiftUnit } from './value';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type FormConfig, type PaymentMethod } from './v1';

/** the open list's dialog name, and the hidden label on its search box. */
export const UNIT_PANEL_NAME = 'What you give';
export const SEARCH_WITH_STOCK = 'Search currency, crypto or stock';
export const SEARCH_WITHOUT_STOCK = 'Search currency or crypto';

/** the list's three group headings. */
export const UNIT_GROUPS = { currency: 'Currencies', coin: 'Crypto', stock: 'Stocks' } as const;

/** the Stocks group's sentence where the search found nothing, quoting what was typed. */
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

/** the first step's Continue, and what it says of the payment step after it. */
export const CONTINUE = 'Continue';
export const NEXT_PAYMENT = 'Next: payment';
export const CONTINUE_TO_PAYMENT = 'Continue to payment';

/** the address screen's way back to the first step. */
export const CHANGE_WHAT_YOU_GIVE = 'Change what you give';

/** the sentence a refused coin carries in the list, under its own unchanged label. */
export const COIN_REFUSED = 'no longer accepted';

/**
 * a coin gift's refusal, beside the entry where it is fixed. the coin is named by the name the served
 * list gives it, and by its own code where the list no longer carries it; the minimum is offered the
 * way a tile offers a figure (./money.ts). a coin no longer accepted says what its list row says.
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
			: COIN_REFUSED;
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

/**
 * a mark the unit pill draws in a 14px disc, decorative beside the pill's own name: a currency's
 * flag, a coin's logo as the served list gives it, or the Apple mark standing for AAPL.
 */
export type UnitMark =
	| { readonly mark: 'flag'; readonly country: FlagCountry }
	| { readonly mark: 'logo'; readonly src: string }
	| { readonly mark: 'apple' };

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
	const flag: UnitMark[] =
		currency.country === undefined ? [] : [{ mark: 'flag', country: currency.country }];
	if (!offered.coin && !offered.stock)
		return { state: 'text', code: currency.code, name: currency.code, marks: [] };
	if (picked === undefined) {
		const also = [offered.coin ? 'crypto' : null, offered.stock ? 'stocks' : null].filter(
			(kind) => kind !== null
		);
		const coin = offered.coin ? exampleCoinMark(config) : [];
		const apple: UnitMark[] = offered.stock ? [{ mark: 'apple' }] : [];
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
		const marks: UnitMark[] = picked.ticker === MARKED_TICKER ? [{ mark: 'apple' }] : [];
		return { state: 'picked', code: picked.ticker, name: `Stock: ${picked.ticker}`, marks };
	}
	return { state: 'picked', code: currency.code, name: `Currency: ${currency.code}`, marks: flag };
}

/**
 * the entry for a gift in kind: the unit at the end of its one box, and the lines under it — a coin's
 * estimate once one is priced and its valuation note, nothing under a share count. `null` on a gift
 * in the currency, which the amount tiles take.
 */
export type UnitEntry = {
	readonly unitLabel: string;
	readonly estimate: string | null;
	readonly note: string | null;
};

export function unitEntry(
	config: PillConfig & Pick<FormConfig, 'currency'>,
	picked: GiftUnit | undefined,
	estimateMinor: number | null
): UnitEntry | null {
	if (picked?.kind === 'stock') return { unitLabel: SHARES, estimate: null, note: null };
	if (picked?.kind !== 'coin') return null;
	return {
		unitLabel: unitPill(config, { coin: true, stock: false }, picked).code,
		estimate: estimateMinor === null ? null : aboutEstimate(estimateMinor, config),
		note: currencyOf(config.currency, config.locale).code === 'USD' ? VALUED_IN_USD : null
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
 * the first step's Continue. `methods` and `one-method` go to the payment step, whose methods are
 * named in the eyebrow's hidden description, in the order the design lists them and only the
 * deployment's own; `in-kind` is a coin or stock gift, which skips that step.
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
