import { useEffect, useRef, useState } from 'react';
import { useRevalidator } from 'react-router';
import type { ChariotRunRead, PaypalRunRead, StripeRunRead } from '../api/types';
import { pollRun, runDrawn } from './processor-cache';
import type { HeldPoll } from './run-poll';
import { heldPoll, pollOutlived, runKind, standingRun, stopUnmade } from './run-poll';

// a processor page's poll of its own setup run: the one ask on a timer, what it is answered with,
// the last run either reading said anything about, and the page read again once the run stops.
// ./stripe-section.tsx, ./paypal-section.tsx and ./chariot-section.tsx each draw their run out of
// this. which run is drawn, and when a poll's answer gives way, is decided in ./run-poll.ts rather
// than here: ../../vite.config.ts pins one node pool and no dom, so those functions are the part a
// suite here can hold.

/** a run one of the three processors' binaries answers with. NOWPayments' press is a save. */
type SetupRun = StripeRunRead | PaypalRunRead | ChariotRunRead;

/** how often a processor page asks how far its run has got. the Creating screen's interval. */
const POLL_MS = 2500;

/**
 * the run `processor`'s page draws, out of `run` — the page's own reading — and the poll this
 * keeps going for as long as what it draws is running. `pressing` is the page's own setup press in
 * flight, which drops whatever answer the poll is holding.
 *
 * the poll is asked of the binary rather than of the page: reading the page again is every round
 * trip on it, one of them against the deployment the run is setting up.
 */
export function useRunPoll(
	processor: 'stripe',
	run: StripeRunRead | null,
	pressing: boolean
): StripeRunRead | null;
export function useRunPoll(
	processor: 'paypal',
	run: PaypalRunRead | null,
	pressing: boolean
): PaypalRunRead | null;
export function useRunPoll(
	processor: 'chariot',
	run: ChariotRunRead | null,
	pressing: boolean
): ChariotRunRead | null;
export function useRunPoll(
	processor: 'stripe' | 'paypal' | 'chariot',
	run: SetupRun | null,
	pressing: boolean
): SetupRun | null {
	const [held, setHeld] = useState<HeldPoll<SetupRun> | undefined>(undefined);
	const polled = held === undefined ? undefined : held.run;

	/* the reading as it stands when an answer arrives, which is later than the render that asked. */
	const reading = useRef(run);
	useEffect(() => {
		reading.current = run;
	}, [run]);

	/* the last thing either reading said, kept here rather than read off whichever answered last.
	   a run that landed is consumed by the reading that observed it, so the answer after that is
	   `null` on both doors — and the report an operator is looking at would go off the screen under
	   them. what clears this is the next run, which arrives running again. */
	const [remembered, setRemembered] = useState<SetupRun | null>(null);
	const { answered, live } = standingRun({ run, polled, remembered });
	useEffect(() => {
		if (answered === null) return;
		setRemembered(answered);
	}, [answered]);

	const { revalidate } = useRevalidator();

	useEffect(() => {
		const going = live;
		if (going?.kind !== 'running') return;
		let gone = false;
		const timer = setTimeout(() => {
			// read through the page's own reader, so a report this answer carries is held for the next
			// visit where the operator has left (`pollRun` in ./processor-cache.ts). a read that did
			// not land ends the run as the console's own stop until a reading says the run is still
			// going (`stopUnmade`, below), and an answer holding no run reads the page again
			// (`polledRun` in ./run-poll.ts).
			void pollRun(processor)
				.then(
					(run) => ({ run }),
					() => null
				)
				.then((answer) => {
					if (gone) return;
					const next = heldPoll(going, answer, reading.current);
					if (next.run === null) {
						setRemembered(null);
						void revalidate();
					}
					setHeld(next);
				});
		}, POLL_MS);
		return () => {
			gone = true;
			clearTimeout(timer);
		};
		// `live` schedules the next ask: each answer is a new value, so the poll goes on with the run.
	}, [live]);

	/* a report the poll was handed, let go of once it is drawn here (`runDrawn` in
	   ./processor-cache.ts) — the page's own reading lets go of the ones it was handed the same way. */
	useEffect(() => {
		if (polled?.kind === 'ended') runDrawn(polled);
	}, [polled]);

	/* and dropped the moment another press is made, or the page's reading moves to a run the poll
	   cannot speak for (`pollOutlived` in ./run-poll.ts). a poll's answer stands in front of the run
	   prop for as long as it is held, so an earlier stopped run would mask the one a press here or
	   anywhere else starts — and with nothing reading as running, nothing would ever ask after it
	   again. */
	useEffect(() => {
		if (pressing) setHeld(undefined);
	}, [pressing]);
	const loaded = runKind(run);
	const seen = useRef(loaded);
	useEffect(() => {
		if (!pollOutlived(seen.current, loaded)) return;
		seen.current = loaded;
		setHeld(undefined);
	}, [loaded]);

	/* and a stop made up for a read that did not land, the moment a reading finds the run still going
	   (`stopUnmade` in ./run-poll.ts): the run is drawn going again, and the poll goes on with it. */
	useEffect(() => {
		if (stopUnmade(held, run)) setHeld(undefined);
	}, [held, run]);

	/* the page read again once, when the run stops: what the page heads with is a reading of the
	   account this press just set up, and only the deployment can report on that — the answer on
	   screen was taken before any of it existed. the flag is a ref rather than a dependency because
	   the revalidator is a fresh object on every render — read as one, this would revalidate the page
	   for as long as the report stayed up. */
	const settled = live?.kind === 'ended';
	const asked = useRef(false);
	useEffect(() => {
		if (!settled) {
			asked.current = false;
			return;
		}
		if (asked.current) return;
		asked.current = true;
		void revalidate();
	}, [settled, revalidate]);

	return live;
}
