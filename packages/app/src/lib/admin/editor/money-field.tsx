import { useState } from 'react';
import { groupAmountEntry } from '$lib/forms/amounts';
import { deleteOverSeparator, regroupAmountBox } from '../amount-box';
import { AffixedField, type AffixedFieldProps } from './affixed-field';

// every box on the page editor and the AI's question card an operator types a sum of money in: the
// goal (./goal-sheet.tsx), a tier's amount (./block-edit.tsx), and an amount question's box and a
// tiers question's amounts (../chat/question-card.tsx). an affixed box (./affixed-field.tsx) that
// groups its digits as they are typed and hands on the text with the separators taken out, as
// ../amount-box.ts states for every money box. an example figure in the box is grouped as well.
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

export type MoneyFieldProps = Omit<
	AffixedFieldProps,
	'value' | 'onValueChange' | 'inputMode' | 'onKeyDown'
> &
	MoneyEntry & {
		/** the three-letter code the figure is in, which decides how its digits are grouped. */
		readonly currency: string;
	};

export function MoneyField({
	currency,
	value,
	onValueChange,
	name,
	defaultValue,
	placeholder,
	...field
}: MoneyFieldProps) {
	const [held, setHeld] = useState(defaultValue ?? '');
	const text = value ?? held;
	return (
		<>
			<AffixedField
				{...field}
				inputMode="decimal"
				placeholder={
					placeholder === undefined ? undefined : groupAmountEntry(placeholder, currency)
				}
				value={groupAmountEntry(text, currency)}
				onKeyDown={(event) => deleteOverSeparator(event, currency)}
				onValueChange={(_, box) => {
					const entry = regroupAmountBox(box, currency);
					if (onValueChange === undefined) setHeld(entry);
					else onValueChange(entry);
				}}
			/>
			{name === undefined ? null : <input type="hidden" name={name} value={held} />}
		</>
	);
}
