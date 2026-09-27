import { useEffect, useEffectEvent, useRef } from 'react';
import { useRevalidator } from 'react-router';
import type { PaymentsRead, RecurringRead } from '../api/types';

// the page read again after a run that stored a processor's key, on both processor screens.

/**
 * how long a screen waits before reading the deployment again once a run has stored the key, and —
 * by its length — how many times it is willing to.
 *
 * **this is the tail after the run's own wait, not the wait itself.** a run that stored a key has
 * already asked the deployment until its edge served it, for as long as `KeyBound` in
 * packages/console/internal/deployment/keyed.go allows, and answers `awaitingKey` only once that ran
 * out. what is left for the screen is the page's own reads: each is a fresh request that can still
 * land on an edge that has not caught up, and the answer to that is a reading the screen draws nothing
 * for, or a note on the stopped line about a key no reading has reported (./awaiting-note.ts).
 *
 * front-loaded and bounded, because the run already spent the long wait: what happens at the end of
 * it is nothing at all, and the screen goes on drawing what the last reading said — except under a
 * `keyless` note, which promises the press once the key lands, so the last wait repeats until it does.
 */
const REREADS: readonly number[] = [1500, 3000, 5000, 8000, 12000];

/**
 * how long a screen goes on reading: `REREADS` out where `bounded`, on past them at the last wait
 * where `unbounded`, and not at all where `null`.
 */
export type Rereading = 'unbounded' | 'bounded' | null;

/**
 * reads the page again after a run that stored a key, for as long as `keepGoing` says the latest
 * reading is still behind it.
 *
 * the promises are what this waits on rather than the run: they are handed down fresh by every
 * revalidation, so each answer is what schedules the next ask. the count is a ref because nothing on
 * the screen is drawn from it.
 *
 * the press is taken out of the revalidator: that object is remade every time the revalidation state
 * changes — twice per ask — so an effect keyed on it would clear and restart its own wait, while the
 * function inside it is the router's own and does not move.
 */
export function useKeyRereads(
	stored: boolean,
	payments: Promise<PaymentsRead | null>,
	recurring: Promise<RecurringRead | null>,
	keepGoing: (payments: PaymentsRead | null, gifts: RecurringRead | null) => Rereading
): void {
	const { revalidate } = useRevalidator();
	const behind = useEffectEvent(keepGoing);
	const rereads = useRef(0);
	useEffect(() => {
		if (!stored) {
			rereads.current = 0;
			return;
		}
		let gone = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		void Promise.all([payments, recurring]).then(
			([payments, gifts]) => {
				if (gone) return;
				const going = behind(payments, gifts);
				const wait =
					REREADS[rereads.current] ?? (going === 'unbounded' ? REREADS.at(-1) : undefined);
				if (going === null || wait === undefined) return;
				timer = setTimeout(() => {
					rereads.current += 1;
					void revalidate();
				}, wait);
			},
			// a read that threw is the page's error boundary's, and the screen is off the page by then.
			() => {}
		);
		return () => {
			gone = true;
			clearTimeout(timer);
		};
	}, [stored, payments, recurring, revalidate]);
}
