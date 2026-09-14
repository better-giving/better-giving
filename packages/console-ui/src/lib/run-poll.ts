// which setup run a processor page draws, out of the three places one can come from: the page's own
// reading, the page's poll of the binary, and the last run either said anything about.
// ./stripe-section.tsx and ./paypal-section.tsx both hold all three, and this is the reading they
// share.
//
// a module beside the sections rather than expressions inside them, for ./stripe-press.ts's
// reason: ../../vite.config.ts pins one node pool and no dom, so this is the part a suite here can
// hold.

type RunLike = { readonly kind: 'running' | 'ended' };

/** where a run stands, and `null` where the reading held none. */
export type RunKind = RunLike['kind'] | null;

export const runKind = (run: RunLike | null): RunKind => run?.kind ?? null;

/**
 * whether the page's reading has moved to a run the poll's answer cannot speak for.
 *
 * **it keys on where the run stands and never on the reading's identity.** every re-read hands down
 * a fresh object, including the one the page asks for itself the moment a run stops — so a poll
 * dropped on identity would be dropped by the reading its own answer set off. what a poll's answer
 * cannot outlast is the reading changing state: a run starting where the page held none or a
 * stopped one (started from another screen, or read ahead from the rail), or a run the reading saw
 * stop before the poll did.
 */
export const pollOutlived = (was: RunKind, now: RunKind): boolean => was !== now;

/**
 * the run a page draws: the poll's answer while one is held, then the reading, then the last run
 * either of them said anything about.
 *
 * the last is what keeps a landed run on the screen: a run that stopped is consumed by the reading
 * that observed it (../api/client.ts), so every answer after that one is `null`.
 */
export function standingRun<R extends RunLike>(read: {
	readonly run: R | null;
	readonly polled: R | null | undefined;
	readonly remembered: R | null;
}): { readonly answered: R | null; readonly live: R | null } {
	const answered = read.polled === undefined ? read.run : read.polled;
	return { answered, live: answered ?? read.remembered };
}
