// which of a refused press's sentences still stand, read off the boxes typed in since the answer.
//
// ./use-console-form.ts draws from it and argues why the far end's answer is kept beside conform's
// pass; this is the reading alone, so a spec can hold it without a DOM.
//
// **a sentence about one box goes when that box is typed in, and no other box ends it** — it is about
// what that box was holding. **a sentence about several boxes together goes when any one of them is
// typed in** — a key turned down at an address is fixed as well by a new address as by a new key, so
// holding the press until the operator also retypes the key would refuse a fix already made.

/** the boxes typed in, and what that leaves standing. */
export type RefusalStanding = {
	/** the named boxes whose sentence still stands, in the order the answer named them. */
	readonly unfixed: readonly string[];
	/** the boxes whose next keystroke would end a sentence, which is where the seam listens. */
	readonly listening: readonly string[];
};

export function refusalStanding({
	named,
	fixed,
	together
}: {
	/** the boxes the answer named, in its order. */
	named: readonly string[];
	/** the boxes typed in since the answer arrived. */
	fixed: readonly string[];
	/** the boxes the answer is about as one, or none where each sentence is about its own box. */
	together: readonly string[];
}): RefusalStanding {
	const shared = together.some((name) => named.includes(name));
	const sharedFixed = shared && together.some((name) => fixed.includes(name));
	const unfixed = named.filter(
		(name) => !fixed.includes(name) && !(sharedFixed && together.includes(name))
	);
	const sharedStanding = shared && unfixed.some((name) => together.includes(name));
	const listening = sharedStanding
		? [...unfixed, ...together.filter((name) => !unfixed.includes(name))]
		: unfixed;
	return { unfixed, listening };
}
