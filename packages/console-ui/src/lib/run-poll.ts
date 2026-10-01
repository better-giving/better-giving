// which setup run a processor page draws, out of the three places one can come from: the page's own
// reading, the page's poll of the binary, and the last run either said anything about.
// ./stripe-section.tsx, ./paypal-section.tsx and ./chariot-section.tsx each hold all three, and this
// is the reading they share.
//
// a module beside the sections rather than expressions inside them, for ./stripe-press.ts's
// reason: ../../vite.config.ts pins one node pool and no dom, so this is the part a suite here can
// hold.

type RunLike = { readonly kind: 'running' | 'ended' };

/**
 * a run as every processor's binary answers it: a stage and its facts, and on an ended run an
 * outcome whose arms include the console's own stop (`console-stopped` in ../api/types.ts).
 */
type StagedRun = RunLike & {
	readonly stage: string;
	readonly outcome?: { readonly kind: string } | null;
};

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

/**
 * the run a page draws after one poll of a run it was drawing as going. `answer` is what the binary
 * said, and `null` where the read did not land.
 *
 * **a read that did not land ends the run where it was last seen, as the console's own stop.** the
 * run is the binary's own memory, so a poll nobody answered is a console that has stopped — and
 * held on `Working` the screen would wait for ever with every control on it closed. the stop is the
 * arm the binary answers a run that died on its own goroutine with, which says nothing was observed
 * and to press again (./press-stopped.ts): a press made against a run still going is answered
 * with that run rather than a second one, so the sentence is safe whichever it was.
 *
 * **an answer holding no run is no run**, and the page drops the one it remembers and reads itself
 * again: the report went to a read this window does not hold, which is another window on the same
 * console (./processor-cache.ts holds every read this one made), and the reading that comes back is
 * what the press left.
 */
export function polledRun<R extends StagedRun>(
	going: R,
	answer: { readonly run: R | null } | null
): R | null {
	if (answer !== null) return answer.run;
	return { ...going, kind: 'ended', outcome: { kind: 'console-stopped' } };
}
