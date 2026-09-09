/**
 * @import { ReactNode } from 'react'
 */

/**
 * @typedef {'unset' | 'stored' | 'value' | 'literal'} SettingReading
 *
 * @typedef {object} SettingRowProps
 * @property {ReactNode} [label]
 * @property {ReactNode} [value] what the row holds. absent under the `value` reading, the row reads
 *   as `unset` instead: a blank beside a label reads as a screen that failed to load one rather than
 *   as a setting nobody has set, and this row already has the reading that says that in words.
 * @property {SettingReading | undefined} [reading]
 * @property {ReactNode} [note] what stands after the label: the mark saying this row is the one at
 *   fault, and the card it opens.
 */

/* four readings in the value cell: a not-set state word, a stored state word, a plain value and a
   literal in the code face. `literal` hides nothing — it is the same value `value` draws, in the
   face an operator checks a key or a host character for character.

   one mark, and it is a slot rather than a name on a bare mark: a mark with nothing behind it says
   the row is at fault and gives a reader no way to find out why. it stands after the label, because
   the row is read and then the note saying it is the one at fault.

   nothing stands after the value. a second slot there held the mark that opened a card naming the
   terminal command that sets the row — a shape the console argues against, since an operator uses
   it instead of a terminal, and a screen that cannot avoid naming one draws it in its own flow
   rather than hiding it behind a mark somebody has to find.

   what opens a card is the screen's and not this part's — a part here carries no machine of its
   own. no suite renders every export in this package to check that; packages/gallery draws them
   for somebody to look at. */
/** @param {SettingRowProps} props */
export function SettingRow({ label, value, reading = 'value', note }) {
	// a value cell with nothing in it draws the blank this row has a word for, so it takes the word.
	// an empty string is the same blank by another door — a nullable column mapped through `?? ''`
	// on the way to the screen — and the two are one condition rather than two.
	const read = reading === 'value' && (value == null || value === '') ? 'unset' : reading;
	return (
		<div className="adm-setting">
			{/* the label and the mark are written with no whitespace between them because the gap
			    between the two is stated in packages/operator/src/styles/adm.css. */}
			<div className="adm-setting__label">
				{label}
				{note}
			</div>
			<div className="adm-setting__value">
				{read === 'unset' ? <span className="adm-state adm-state--unset">Not set</span> : null}
				{read === 'stored' ? <span className="adm-state">Stored</span> : null}
				{read === 'value' ? <span className="adm-state">{value}</span> : null}
				{/* the chip and never the inline literal: this is the whole of the value cell, with no
				    sentence running up against it. ../../styles/adm.css draws the difference. */}
				{read === 'literal' ? <code className="adm-chip">{value}</code> : null}
			</div>
		</div>
	);
}
