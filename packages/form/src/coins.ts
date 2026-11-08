// the reading of the coin list a surface drawing it needs: which coins a typed search shows and in
// what order.
//
// it is a reading of the list `coinSelect` projects (./connect.ts) and of what the donor has typed,
// and nothing else: no DOM, so the element's list (./coin-picker.ts) and any other surface drawing
// the same choice order the same coins the same way.
//
// the search is the whole of how the list is narrowed: there is no second narrowing beside it, so
// what the list holds while a donor types is a reading of the typed text alone.

/** as much of a listed coin as a search reads: its code, the ticker it is listed under, its name. */
export type SearchableCoin = {
	readonly value: string;
	readonly label: string;
	readonly name: string;
};

/**
 * the coins `query` finds, best match first.
 *
 * case never matters, and text is found anywhere in the ticker, the name or the processor's own code
 * — so `tron` and `trc20` both find Tether on Tron. the order is an exact ticker, then a ticker the
 * text starts, then a name the text starts, then any other match, and within each the order the list
 * was given in. empty text lists everything.
 */
export function searchCoins<T extends SearchableCoin>(coins: readonly T[], query: string): T[] {
	const text = query.trim().toLowerCase();
	if (text === '') return [...coins];
	const rank = (coin: T): number => {
		const ticker = coin.label.toLowerCase();
		const name = coin.name.toLowerCase();
		if (ticker === text) return 0;
		if (ticker.startsWith(text)) return 1;
		if (name.startsWith(text)) return 2;
		if (ticker.includes(text) || name.includes(text) || coin.value.toLowerCase().includes(text)) {
			return 3;
		}
		return -1;
	};
	return coins
		.map((coin, at) => ({ coin, at, rank: rank(coin) }))
		.filter((entry) => entry.rank !== -1)
		.sort((a, b) => a.rank - b.rank || a.at - b.at)
		.map((entry) => entry.coin);
}
