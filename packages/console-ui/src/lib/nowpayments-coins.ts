import type { NowpaymentsListing } from '../api/types';

// what the payout currency box on ./nowpayments-section.tsx offers, out of the listing the binary
// answers for one API key.

/**
 * how long the key box rests before the list behind it is read again, in milliseconds.
 *
 * a key is pasted as often as typed and neither arrives as one change, so the read is held until
 * the box stops moving — long enough that a key typed out by hand is one round trip and not forty,
 * short enough that a paste is answered before the operator has read the label beneath it.
 */
export const COINS_DEBOUNCE = 400;

/** what the box says while there is no key to read a list under. */
export const COINS_UNKEYED = 'Paste your API key to choose a coin.';

/**
 * what the closed box asks while the deployment holds no coin of its own.
 *
 * it is the box's placeholder and not a line of the list, which is what keeps it unstorable: there
 * is no row to land on and nothing is chosen until a coin is, so a press made over it sends the
 * empty string and is refused as a blank box like any other (./nowpayments-setup.ts).
 */
export const COINS_CHOOSE = 'Choose a coin';

/** what it says where NOWPayments would not read the account under that key. */
export const COINS_KEY_REFUSED = 'NOWPayments turned that key down, so it lists no coins.';

/** what it says where NOWPayments did not answer at all. */
export const COINS_UNANSWERED = 'NOWPayments didn’t answer, so it lists no coins.';

/** what it says where NOWPayments read the account and it can be paid out in nothing. */
export const COINS_UNPAYABLE_ACCOUNT =
	'This NOWPayments account has no coin it can be paid out in.';

/** the sentence each way a listing named no coin is drawn under the box with. */
const STOPPED = {
	key_refused: COINS_KEY_REFUSED,
	unanswered: COINS_UNANSWERED
} as const satisfies Record<Exclude<NowpaymentsListing['kind'], 'listed'>, string>;

/**
 * one row of the list, which is what `CoinPicker` draws a coin as
 * (`@better-giving/operator/components/forms/CoinPicker`): the mark, the ticker, and the network
 * under it.
 *
 * **the code is the value and the ticker is the first line**, and the two are different strings:
 * the code is what is stored and what NOWPayments is asked for, and the ticker with the network
 * under it is how NOWPayments' own dashboard names the coin an operator is matching this list
 * against. so `usdcmatic` is stored and `usdc` over a `matic` pill is read. it is `''` where a list
 * named none, which is the row's one fallback to the code. the name is carried and drawn nowhere: a
 * search still finds a coin by it, and its first letter is the mark a coin with no logo falls back
 * to.
 */
export type CoinOption = {
	readonly code: string;
	readonly ticker: string;
	readonly name: string;
	readonly network: string;
	/** the processor's own picture of the coin, empty where the binary's entry carried none. */
	readonly logo: string;
};

/** what the box is drawn with. */
export type CoinsBox = {
	/** every line the box offers, in the order it offers them. */
	readonly options: readonly CoinOption[];
	/** the deployment's own coin, where a listing came back without it. */
	readonly retired: CoinOption | undefined;
	/** why there is nothing to choose from, in this console's own words. */
	readonly note: string | null;
	/** NOWPayments' own words about that, drawn under the note (./said.tsx). */
	readonly detail: string | null;
	/**
	 * NOWPayments has named no coin, so there is nothing here to choose between.
	 *
	 * an empty key box, a first read still in flight, a listing NOWPayments stopped and an account
	 * it will pay out in nothing are one state to a reader — whatever the box is left holding, it
	 * is not a choice — and the note beside it says which.
	 */
	readonly disabled: boolean;
};

/** the key a list was read under, and the last answer that landed for it. */
export type CoinsRead = {
	readonly key: string;
	readonly landed: NowpaymentsListing | null;
};

/** no key typed and nothing read. */
export const COINS_UNREAD: CoinsRead = { key: '', landed: null };

/** the reading after the key box changed to `key`. */
export const coinsTyped = (read: CoinsRead, key: string): CoinsRead => {
	const asked = key.trim();
	if (asked === '') return COINS_UNREAD;
	return { key: asked, landed: read.landed };
};

/**
 * the answer to a read made under `key`, or the reading untouched where the box has moved past it.
 *
 * the answer is dropped by the key it was asked under rather than by any handle on the request: the
 * box reads again on every change, debounced, so two answers can be open at once and the older one
 * lands second as often as not — kept, it would put a list back that the key on screen is not about.
 */
export const coinsLanded = (
	read: CoinsRead,
	key: string,
	listing: NowpaymentsListing
): CoinsRead => (key === read.key ? { key, landed: listing } : read);

/** what a listing that named no coin says under the box, and `null` where it named coins. */
const stopping = (listing: NowpaymentsListing | null): Pick<CoinsBox, 'note' | 'detail'> | null => {
	if (listing === null) return null;
	if (listing.kind !== 'listed') return { note: STOPPED[listing.kind], detail: listing.detail };
	/* a listing that read the account and named nothing carries no detail — NOWPayments said nothing
	   about it, and the sentence an operator reads is this console's own. */
	if (listing.coins.length === 0) return { note: COINS_UNPAYABLE_ACCOUNT, detail: null };
	return null;
};

/** the box as that reading leaves it, holding `stored` until another coin is chosen. */
export function coinsBox(read: CoinsRead, stored: string): CoinsBox {
	/* the coins the account can be paid out in, which is the whole of what there is to choose. the
	   binary sends each one whole and a row draws four of its members, so there is nothing to
	   compose here: two coins that would once have read the same as two names are one ticker on two
	   networks, which is the distinction the row makes for itself. */
	const listed: readonly CoinOption[] = read.landed === null ? [] : read.landed.coins;
	/* the coin this deployment is holding goes on being offered whatever the list says, because the
	   box is what the next press posts. it is all the box knows about that coin — a code the
	   deployment reported and no listing to read a ticker, a name or a chain out of — so it carries
	   no ticker and the row falls back to the code, with no pill under it. */
	const held: CoinOption | undefined =
		stored !== '' && !listed.some((option) => option.code === stored)
			? { code: stored, ticker: '', name: stored, network: '', logo: '' }
			: undefined;
	/* **it is said to be no longer offered only by a list that came back without it.** every other
	   reading — nothing read yet, a key turned down, no answer — is the box not knowing what the
	   account can be paid out in, and a deployment's own coin marked retired on that is the screen
	   stating as fact something it has not been told. */
	const retired = read.landed?.kind === 'listed' ? held : undefined;
	const stopped = stopping(read.landed);
	return {
		options: [...(retired === undefined && held !== undefined ? [held] : []), ...listed],
		retired,
		note: read.key === '' ? COINS_UNKEYED : (stopped?.note ?? null),
		detail: stopped?.detail ?? null,
		disabled: listed.length === 0
	};
}
