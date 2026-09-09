import { useEffect, useRef, useState } from 'react';

// where the card says out loud what a reader who is not watching the screen would miss.
//
// the discipline is `createAnnouncer` and `#announce`'s in packages/form, restated for a tree react
// owns rather than one an element patches:
//
//   - the region is on the page before anything is written into it. a live region announces what
//     arrives in it while it is already there, so a node created and filled in one breath is
//     dropped by assistive technology that diffs the tree per task. here that is structural: the
//     region is committed with the card and every sentence arrives from an effect, which is at
//     least one commit later, and the live actor's first sentence is later still.
//   - the region is outside whatever carries `aria-busy`. that flag is an instruction to hold a
//     region's changes back until it clears, and holding it silences exactly the wait the region
//     exists to narrate. the card's interior takes the flag; this never sits inside it.
//   - a sentence already on screen, said again, is a clear and a write a task apart. a `role=status`
//     node handed the words it is already holding is not a change and is announced by nobody — and
//     the review step's refusal is a sentence a donor may be refused with as many times as they
//     press.
//
// the words are decided by the card, on one channel, in one place. this component decides when they
// are heard and nothing about what they say.

export type DonateAnnouncerProps = {
	/** the sentence the card is stating, or nothing where it has nothing to say. */
	readonly words: string;
	/**
	 * which press asked for these words.
	 *
	 * a counter rather than a flag, because it is asked for by the press rather than by the words
	 * being the same: most patches write the words they wrote last and only a press is news. a new
	 * value over unchanged words is the sentence said again.
	 */
	readonly again: number;
};

export function DonateAnnouncer({ words, again }: DonateAnnouncerProps) {
	const [shown, setShown] = useState('');
	/** what was last put on the region, and the press it was put there for. */
	const said = useRef({ words: '', again: Number.NaN });

	useEffect(() => {
		const last = said.current;
		said.current = { words, again };
		// a clear is not a sentence: it says nothing, so it neither waits a task nor spends the wait
		// a repeat takes.
		if (words === '') {
			setShown('');
			return () => {};
		}
		if (words === last.words && again === last.again) return () => {};
		if (words !== last.words) {
			setShown(words);
			return () => {};
		}
		setShown('');
		const timer = setTimeout(() => setShown(words), 0);
		return () => clearTimeout(timer);
	}, [words, again]);

	// its own `lang`, for the reason the card carries one: it is the card's sibling rather than its
	// child, so a declaration on the card covers nothing that is said out loud.
	return (
		<div className="vh" lang="en" role="status" aria-live="polite">
			{shown}
		</div>
	);
}
