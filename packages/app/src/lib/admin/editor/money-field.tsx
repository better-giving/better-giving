import { useState } from 'react';
import { digitGrouping } from '$lib/donations/money';
import { groupAmountEntry, ungroupAmountEntry } from '$lib/forms/amounts';
import { AffixedField, type AffixedFieldProps } from './affixed-field';

// every box on the page editor and the AI's question card an operator types a sum of money in: the
// goal (./goal-sheet.tsx), a tier's amount (./block-edit.tsx) and an amount question
// (../chat/question-card.tsx). an affixed box (./affixed-field.tsx) whose digits are grouped as
// they are typed, `100000` drawn `100,000`, the way a screen groups the currency
// (`groupAmountEntry` in `$lib/forms/amounts.ts`).
//
// the grouping is the drawing alone. what the caller is handed, and what the form posts, is the
// text with the separators taken out — the text `readAmount` reads, which refuses a separator.
//
// the caret stays among the digits the operator was typing between: after a press it stands after
// as many digits and points as it stood after in what was typed, wherever the grouping moved the
// separators. a paste is a press like any other.
//
// the box is the caller's to hold, with `value` and `onValueChange`, or the form's, with `name` and
// `defaultValue`, in which case it holds what is typed itself and posts it from a hidden box under
// `name` with the rest of the form's boxes — a block's tier amounts. the drawn box posts nothing.

/** who holds what is typed, separators taken out: the caller, or the form the box posts with. */
type MoneyEntry =
	| {
			readonly value: string;
			readonly onValueChange: (text: string) => void;
			readonly name?: undefined;
			readonly defaultValue?: undefined;
	  }
	| {
			readonly name: string;
			readonly defaultValue: string;
			readonly value?: undefined;
			readonly onValueChange?: undefined;
	  };

export type MoneyFieldProps = Omit<AffixedFieldProps, 'value' | 'onValueChange' | 'inputMode'> &
	MoneyEntry & {
		/** the three-letter code the figure is in, which decides how its digits are grouped. */
		readonly currency: string;
	};

/**
 * where the caret goes in `shown` to stand after as many characters that are not `separator` as it
 * stood after at `caret` in `typed`.
 */
function caretIn(shown: string, typed: string, caret: number, separator: string): number {
	if (shown === typed) return caret;
	const kept = typed.slice(0, caret).split(separator).join('').length;
	let at = 0;
	for (let passed = 0; at < shown.length && passed < kept; at += 1) {
		if (shown[at] !== separator) passed += 1;
	}
	return at;
}

export function MoneyField({
	currency,
	value,
	onValueChange,
	name,
	defaultValue,
	...field
}: MoneyFieldProps) {
	const [held, setHeld] = useState(defaultValue ?? '');
	const text = value ?? held;
	return (
		<>
			<AffixedField
				{...field}
				inputMode="decimal"
				value={groupAmountEntry(text, currency)}
				onValueChange={(typed, box) => {
					const entry = ungroupAmountEntry(typed, currency);
					const shown = groupAmountEntry(entry, currency);
					const caret = caretIn(
						shown,
						typed,
						box.selectionStart ?? typed.length,
						digitGrouping(currency).separator
					);
					// drawn and placed here, before react renders the same text: an input whose value
					// already matches is left alone, so the caret is not thrown to the end.
					box.value = shown;
					box.setSelectionRange(caret, caret);
					if (onValueChange === undefined) setHeld(entry);
					else onValueChange(entry);
				}}
			/>
			{name === undefined ? null : <input type="hidden" name={name} value={held} />}
		</>
	);
}
