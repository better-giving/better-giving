import { StatusWord } from '@better-giving/operator/components/status/StatusWord';

/*
 * two registers, and everything each one ignores about the other.
 *
 * descriptive is a fact and takes three drawings: the plain word, the quiet one for a value nobody
 * needs to act on, and the unset one for no value at all. `unset` and `secondary` say different
 * things and compose in the class list, so the row carrying both is drawn — nothing in the
 * component stops it, and what wins is whichever rule comes last in
 * packages/operator/src/styles/adm.css rather than anything either prop states.
 *
 * momentary is the other register and it discards three of the props. `unset` and `secondary` are
 * read only on the descriptive path (packages/operator/src/components/status/StatusWord.jsx:41),
 * so a momentary word handed either is the plain momentary word — drawn here beside one that was
 * not, because the two are identical and that is the finding.
 *
 * `mark` is the momentary register's only variable and defaults to the tick. `blocked` is the
 * momentary word that reports the thing could not be done, and it is the whole of the second
 * drawing: same shape, attention ink.
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
