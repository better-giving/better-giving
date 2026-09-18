// every reading of the coin list a surface drawing it needs: which coins a typed search shows and in
// what order, and which tint a network's pill takes.
//
// both are a reading of the list `coinSelect` projects (./connect.ts) and of what the donor has
// typed, and nothing else: no DOM, so the element's list (./coin-picker.ts) and any other surface
// drawing the same choice order and paint the same coins the same way.
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

/** how many entries the network palette holds (`--_net-0-tint` … in ./styles/tokens.css). */
export const NETWORK_TINTS = 6;

/**
 * which palette entry a network's pill is painted in: a hash of the network's own words, taken
 * modulo the palette.
 *
 * total by construction, which is the whole point. a network the processor adds tomorrow takes a
 * colour with nobody editing this repository, because there is no table here to be missing from — a
 * name-to-colour map, even one with a default arm, is a maintenance burden that silently paints every
 * new network the default.
 *
 * so the colour matches no chain's brand, and that is intended: the pill carries the network's words
 * too, so the colour is a scanning aid rather than the identifier, and two networks landing on one
 * entry cost nothing for the same reason.
 *
 * FNV-1a over the trimmed, lowercased name. the arithmetic is `Math.imul` and `>>> 0` so it stays in
 * 32 bits rather than drifting into a float at the fifth character, and the answer is a pure function
 * of the string: the same network is the same colour on every page load, in every browser, whatever
 * else the list holds and in whatever order the deployment served it.
 */
export function networkTint(network: string): number {
	const text = network.trim().toLowerCase();
	let hash = 0x811c9dc5;
	for (let at = 0; at < text.length; at += 1) {
		hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193) >>> 0;
	}
	return hash % NETWORK_TINTS;
}
