// what a gift can be given in, as the amount step's unit list draws it (./unit-picker.ts): which of
// its groups stand, and the words that name only what the deployment takes.
//
// a reading of the served config and nothing else, so no DOM: the groups are fixed in order —
// currencies, crypto, stocks — and a group stands only where its rail does. currencies always
// stand, one entry today (`FormConfig.currency`), and the list is a list so a second currency is a
// row rather than a shape.

import type { FormConfig } from './v1';

/** which of the unit list's groups stand beside currencies, and whether there is a choice at all. */
export type UnitRails = {
	/**
	 * the crypto group: the crypto rail on offer with at least one coin served, on a deployment taking
	 * one-time gifts — a coin gift is one, and a cadence it cannot charge is never offered.
	 */
	readonly coins: boolean;
	/** the stocks group: the stock rail, which no deployment offers yet. */
	readonly stocks: boolean;
	/** whether the unit is a control, or the deployment's one currency as plain text. */
	readonly chooses: boolean;
};

/** the words the unit list says, each naming only what `UnitRails` says stands. */
export type UnitWords = {
	/** the search box's placeholder, and its accessible name. */
	readonly placeholder: string;
	/** the line under the box saying what the list mixes; `''` where currencies stand alone. */
	readonly hint: string;
	/** the sentence standing where the rows would when a search finds none. */
	readonly noMatch: string;
};

export function unitRails(config: FormConfig): UnitRails {
	const coins =
		config.paymentMethods.includes('crypto') &&
		config.frequencies.includes('one_time') &&
		(config.coins ?? []).length > 0;
	const stocks = false;
	return { coins, stocks, chooses: coins || stocks };
}

export function unitWords(rails: Pick<UnitRails, 'coins' | 'stocks'>): UnitWords {
	const { coins, stocks } = rails;
	if (coins && stocks) {
		return {
			placeholder: 'Search for currency, crypto token, or stock ticker',
			hint: 'Currencies, crypto and stocks',
			noMatch: 'No currency, coin or stock matches.'
		};
	}
	if (coins) {
		return {
			placeholder: 'Search for currency or crypto token',
			hint: 'Currencies and crypto',
			noMatch: 'No currency or coin matches.'
		};
	}
	if (stocks) {
		return {
			placeholder: 'Search for currency or stock ticker',
			hint: 'Currencies and stocks',
			noMatch: 'No currency or stock matches.'
		};
	}
	return { placeholder: 'Search for currency', hint: '', noMatch: 'No currency matches.' };
}
