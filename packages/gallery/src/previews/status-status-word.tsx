import { StatusWord } from '@better-giving/operator/components/status/StatusWord';

/*
 * two registers, and everything each one ignores about the other.
 *
 * descriptive is a fact and is drawn as the registry's badge
 * (packages/operator/src/registry/styles/badge-css.css). untoned it is the neutral chip, and the
 * quiet word and the unset one are drawn beside it as the same chip: the badge has nothing quieter,
 * so `unset` and `secondary` are stated and draw nothing of their own. that sameness is the finding
 * those rows are kept for.
 *
 * `tone` is the other drawing and there are four of it, one per member of the shared set
 * (packages/operator/src/components/closed-sets.js): done the accent's chip, attention the warning
 * chip, blocker the destructive chip, and note the neutral chip with its ground taken away
 * (`.adm-state--note` in packages/operator/src/styles/adm.css), which is all that tells an ended
 * record from the untoned chip a record at rest takes. only a record's own lifecycle status is
 * meant to carry one — $lib/admin/status-tones.ts in packages/app maps the four unions the
 * dashboard renders.
 *
 * the long word is the specimen the badge is tested against: a status word can be computed from a
 * list rather than chosen from one, and the badge does not wrap.
 *
 * momentary is the other register and it discards four of the props. `unset`, `secondary` and
 * `tone` are read only on the descriptive path
 * (packages/operator/src/components/status/StatusWord.jsx), so a momentary word handed any of them
 * is the plain momentary word — drawn here beside one that was not, because the two are identical
 * and that is the finding.
 *
 * `mark` is the momentary register's only variable and defaults to the tick. `blocked` is the
 * momentary word that reports the thing could not be done, and it is the whole of the second
 * drawing: same shape, attention ink, and the triangle in place of the tick — drawn beside one
 * handed the triangle by name, because the two are identical and a refusal left to the default
 * never reads as done. `neutral` is the third: a press that changed nothing, in ink with the info
 * mark, and it cannot be handed alongside `blocked`.
 *
 * a word with no children is the last specimen in each register, because `children` is optional in
 * both. descriptive draws an empty inline box and momentary draws its mark with nothing after it —
 * a tick standing alone beside a control, which is what a screen ships when the outcome copy comes
 * back blank.
 *
 * the register is carried by position and accompaniment rather than by hue, and position is the
 * one thing this page cannot show: a momentary word belongs beside the control that caused it and
 * is never a banner at the head of a screen. src/previews/controls-save-button.tsx is where it is
 * drawn in its place.
 */
export default function StatusStatusWordPreview() {
	return (
		<div className="adm-stack">
			<p>
				<StatusWord>Live</StatusWord>
			</p>
			<p>
				<StatusWord secondary>Draft</StatusWord>
			</p>
			<p>
				<StatusWord unset>Not set</StatusWord>
			</p>
			<p>
				<StatusWord unset secondary>
					Not set, and quiet
				</StatusWord>
			</p>
			<p>
				<StatusWord>
					Charging cards, sending receipts and collecting monthly gifts, which is a status word long
					enough to wrap and is what an operator screen gets when the word is computed from a list
					rather than chosen from one
				</StatusWord>
			</p>
			<p>
				<StatusWord />
			</p>
			<p>
				<StatusWord tone="done">Live</StatusWord>
			</p>
			<p>
				<StatusWord tone="attention">Draft</StatusWord>
			</p>
			<p>
				<StatusWord tone="blocker">Payment failed</StatusWord>
			</p>
			<p>
				<StatusWord tone="note">Archived</StatusWord>
			</p>
			<p>
				<StatusWord tone="done" secondary>
					Live — handed a tone and secondary, and the tone is what it is drawn in
				</StatusWord>
			</p>
			<p>
				<StatusWord tone="blocker">
					Payment failed on the card this donor last used, which is a toned status word long enough
					to wrap and is what the pill has to survive
				</StatusWord>
			</p>
			<p>
				<StatusWord register="momentary">Saved</StatusWord>
			</p>
			<p>
				<StatusWord register="momentary" mark="copy">
					Copied
				</StatusWord>
			</p>
			<p>
				<StatusWord register="momentary" blocked>
					Could not save
				</StatusWord>
			</p>
			<p>
				<StatusWord register="momentary" blocked mark="triangle-alert">
					Could not save
				</StatusWord>
			</p>
			<p>
				<StatusWord register="momentary" neutral>
					Already in the books, from the earlier press
				</StatusWord>
			</p>
			<p>
				<StatusWord register="momentary" unset secondary>
					Saved — handed unset and secondary, and drawn as if it were handed neither
				</StatusWord>
			</p>
			<p>
				<StatusWord register="momentary" />
			</p>
		</div>
	);
}
