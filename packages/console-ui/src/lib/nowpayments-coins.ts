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
 * what the box leads with while the deployment holds no coin of its own.
 *
 * it is offered only there, and its value is empty so that it cannot be stored: the box would
 * otherwise come up on whichever coin sorts first and the next press would store that, with nothing
 * having said so. chosen, it is refused as a blank box like any other (./nowpayments-setup.ts).
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

/** one line of the box: the code that is stored, under the name an operator reads. */
export type CoinOption = { readonly value: string; readonly label: string };

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

/**
 * a coin's line: its name, and its network where another coin would read the same without it.
 *
 * the code is what is stored and what NOWPayments is asked for, so it is the value and never the
 * label — an operator choosing `usdcmatic` out of a list of codes is the typing this box replaced.
 */
const lines = (listing: NowpaymentsListing): readonly CoinOption[] => {
	const named = new Map<string, number>();
	for (const coin of listing.coins) named.set(coin.name, (named.get(coin.name) ?? 0) + 1);
	return listing.coins.map((coin) => ({
		value: coin.code,
		label: (named.get(coin.name) ?? 0) > 1 ? `${coin.name} (${coin.network})` : coin.name
	}));
};

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
	/** the coins the account can be paid out in, which is the whole of what there is to choose. */
	const listed = read.landed === null ? [] : lines(read.landed);
	/* the coin this deployment is holding goes on being offered whatever the list says, because the
	   box is what the next press posts: dropped, the select would come up on whichever coin sorts
	   first and store that, with nothing having said so. */
	const held =
		stored !== '' && !listed.some((option) => option.value === stored)
			? { value: stored, label: stored }
			: undefined;
	/* **it is said to be no longer offered only by a list that came back without it.** every other
	   reading — nothing read yet, a key turned down, no answer — is the box not knowing what the
	   account can be paid out in, and a deployment's own coin marked retired on that is the screen
	   stating as fact something it has not been told. */
	const retired = read.landed?.kind === 'listed' ? held : undefined;
	const stopped = stopping(read.landed);
	return {
		options: [
			...(stored === '' ? [{ value: '', label: COINS_CHOOSE }] : []),
			...(retired === undefined && held !== undefined ? [held] : []),
			...listed
		],
		retired,
		note: read.key === '' ? COINS_UNKEYED : (stopped?.note ?? null),
		detail: stopped?.detail ?? null,
		disabled: listed.length === 0
	};
}
