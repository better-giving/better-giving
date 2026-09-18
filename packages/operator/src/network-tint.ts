// which colour a network's pill is painted in on an operator screen, as a pure function of the
// network's own words.
//
// it exists so that there is no table from a network to a colour. NOWPayments lists the chains it
// pays out over and adds to that list without telling anybody, so a map — even one with a default
// arm — is a list this repository would be permanently one entry behind, and every chain added
// after it would paint the default. a hash modulo the palette is total by construction: a network
// listed tomorrow takes a colour with nobody editing this package.
//
// so no entry matches any chain's brand, and two networks may land on the same one. both are
// intended. the pill carries the network's words as well, so the colour is a scanning aid and never
// the identifier, and a collision costs an operator nothing they can read.
//
// **packages/form/src/coins.ts holds a function of the same shape for the donation form, and the
// two are independent.** the operator surfaces and the donation form are two design systems that
// never meet (.claude/CLAUDE.md), the palettes they index into are authored in two different token
// files, and neither module imports the other. the same network is therefore not expected to be the
// same colour on a donation page and on an operator screen, and nothing holds the two to each
// other.

/** how many entries the palette holds (`--admin-net-0-tint` … in ./styles/tokens.css). */
export const NETWORK_TINTS = 6;

/**
 * the palette entry a network's pill takes, as an index the sheet reads straight off the node
 * (`[data-tint='0']` in ./styles/adm.css).
 *
 * FNV-1a over the trimmed, lowercased name. the arithmetic is `Math.imul` and `>>> 0` so it stays
 * in 32 bits rather than drifting into a float at the fifth character, and the answer is a pure
 * function of the string: the same network is the same colour on every load, in every browser,
 * whatever else the list holds and in whatever order the deployment listed it.
 *
 * numbered from zero because the index is the hash's own answer and the sheet reads it straight. a
 * ladder starting at one would put an off-by-one between a name and the number that picks it, in
 * the one place in this package where a name is chosen by arithmetic.
 */
export function networkTint(network: string): number {
	const text = network.trim().toLowerCase();
	let hash = 0x811c9dc5;
	for (let at = 0; at < text.length; at += 1) {
		hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193) >>> 0;
	}
	return hash % NETWORK_TINTS;
}
