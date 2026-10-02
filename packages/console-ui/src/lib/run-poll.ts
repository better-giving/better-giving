// which setup run a processor page draws, out of the three places one can come from: the page's own
// reading, the page's poll of the binary, and the last run either said anything about.
// ./use-run-poll.ts holds all three for ./stripe-section.tsx, ./paypal-section.tsx and
// ./chariot-section.tsx, and this is the reading it takes.
//
// a module beside the hook rather than expressions inside it, for ./stripe-press.ts's
// reason: ../../vite.config.ts pins one node pool and no dom, so this is the part a suite here can
// hold.

type RunLike = { readonly kind: 'running' | 'ended' };

/** a run as every processor's binary answers it: a stage and its facts, and an outcome once ended. */
type StagedRun = RunLike & {
	readonly stage: string;
	readonly outcome?: { readonly kind: string } | null;
};

/** the outcome every processor's binary ends a run that died on its own goroutine with. */
type ConsoleStop = { readonly kind: 'console-stopped' };

/**
 * nothing more to pass where `R`'s ended arm can carry the console's own stop (`console-stopped` in
 * ../api/types.ts), and an argument nothing can be where it cannot — so a run handed to
 * {@link polledRun} without one is a type error at the call, rather than a value its own type says
 * it cannot hold.
 */
type StopsAsConsole<R> = [ConsoleStop] extends [EndedOutcome<R>]
	? []
	: [endedArmLacksConsoleStop: never];

/** the outcomes `R`'s ended arm can carry. */
type EndedOutcome<R> = R extends { readonly kind: 'ended'; readonly outcome: infer O } ? O : never;

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
 * run is the binary's own memory, so a poll nobody answered is drawn as a console that has
 * stopped — held on `Working` the screen would wait for ever with every control on it closed. the stop is the
 * arm the binary answers a run that died on its own goroutine with, which says nothing was observed
 * and to press again (./press-stopped.ts): a press made against a run still going is answered
 * with that run rather than a second one, so the sentence is safe whichever it was. the stop is
 * the page's own, and the re-read it sets off takes it back where the run is still going
 * ({@link stopUnmade}).
 *
 * **an answer holding no run is no run**, and the page drops the one it remembers and reads itself
 * again: the report went to a read this window does not hold, which is another window on the same
 * console (./processor-cache.ts holds every read this one made), and the reading that comes back is
 * what the press left.
 */
export function polledRun<R extends StagedRun>(
	going: R,
	answer: { readonly run: R | null } | null,
	..._stoppable: StopsAsConsole<R>
): R | null {
	if (answer !== null) return answer.run;
	return { ...going, kind: 'ended', outcome: { kind: 'console-stopped' } };
}

/**
 * a poll's answer as a page holds it. `stoppedOver` is the page's reading at the moment a read
 * that did not land was drawn as the console's own stop, and `null` where the binary answered.
 */
export type HeldPoll<R> = {
	readonly run: R | null;
	readonly stoppedOver: { readonly reading: R | null } | null;
};

/** {@link polledRun}, held: `reading` is the page's own reading as the answer arrives. */
export function heldPoll<R extends StagedRun>(
	going: R,
	answer: { readonly run: R | null } | null,
	reading: R | null,
	...stoppable: StopsAsConsole<R>
): HeldPoll<R> {
	return {
		run: polledRun(going, answer, ...stoppable),
		stoppedOver: answer === null ? { reading } : null
	};
}

/**
 * whether a stop the page made up gives way to the page's reading.
 *
 * **a stop drawn for a read that did not land is taken back by a reading that finds the run still
 * going.** one rejected read is as often a 5xx or a fetch dropped across a sleep and a wake as a
 * console that has stopped, and the stop reads the page again as it is drawn (the re-read once a run
 * stops, ./use-run-poll.ts). that reading is a fresh object, so it is told from the one the stop was
 * drawn over by identity — {@link pollOutlived} keys on where the run stands and sees `running`
 * either side of it. a reading that finds the run over or gone is {@link pollOutlived}'s, and a stop
 * the binary answered is what it said, which no reading takes back.
 */
export const stopUnmade = <R extends RunLike>(
	held: HeldPoll<R> | undefined,
	reading: R | null
): boolean =>
	held?.stoppedOver != null && reading !== held.stoppedOver.reading && reading?.kind === 'running';
