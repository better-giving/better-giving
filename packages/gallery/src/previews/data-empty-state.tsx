import { EmptyState } from '@better-giving/operator/components/data/EmptyState';

/*
 * one sentence, and the four shapes that sentence takes.
 *
 * the component has one prop and no closed set, so what is worth drawing is the copy rather than
 * the states: the sentence alone, the sentence with the way out inside it, the sentence long enough
 * to reach the prose measure and wrap, and the sentence nobody wrote.
 *
 * the last one is the specimen. `children` is optional and an empty state handed nothing is a
 * paragraph with padding and no words — a gap on the screen where the explanation was meant to be,
 * which looks like a loading state that never finished. nothing reports it.
 *
 * what this component refuses is not visible here and has to be said instead: no illustration, no
 * bordered box, no centred graphic with a call to action under it — dressing up a normal state
 * tells the reader something went wrong. packages/operator/src/styles/adm.css argues it at
 * `.adm-empty`.
 */
export default function DataEmptyStatePreview() {
	return (
		<div className="adm-stack">
			<EmptyState>No donations yet.</EmptyState>
			<EmptyState>
				No donation forms yet. <a href="#new-form">Write the first one</a> and paste its snippet
				into your site.
			</EmptyState>
			<EmptyState>
				No recurring gifts yet. A donor who chooses to give every month appears here after their
				first payment clears, which is the payment that writes the commitment down — an
				authorisation on its own is not a gift, so nothing is recorded until the money moves.
			</EmptyState>
			<EmptyState />
		</div>
	);
}
