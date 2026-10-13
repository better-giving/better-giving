import { useState } from 'react';
import { drawAmountEntry, isComposing, keyInAmountBox, regroupAmountBox } from '../amount-box';
import { AffixedField, type AffixedFieldProps } from './affixed-field';

// every box on the page editor an operator types a sum of money in: the goal (./goal-sheet.tsx)
// and a tier's amount (./block-edit.tsx). an affixed box (./affixed-field.tsx) that groups its
// digits as they are typed and hands on the text with the box's own separators taken out, as
// ../amount-box.ts states for every money box. an example figure in the box is grouped as well.
//
// the box is the caller's to hold, with `value` and `onValueChange`, or the form's, with `name` and
// `defaultValue`, in which case it holds what is typed itself and posts the text it draws, grouped,
// under `name` with the rest of the form's boxes — a block's tier amounts. the server markup draws
// the seed grouped too, so the box posts the same text with no script running.
//
// while an input method composes in the box it draws the box's own text as it stands, which is
// the one value react can write without cancelling the composition, and draws the grouping again
// once the composition ends.

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
	'value' | 'onValueChange' | 'inputMode' | 'onKeyDown' | 'onCompositionEnd' | 'name'
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
	const [composed, setComposed] = useState<string | null>(null);
	const text = value ?? held;
	const handOn = (entry: string) => {
		if (onValueChange === undefined) setHeld(entry);
		else onValueChange(entry);
	};
	return (
		<AffixedField
			{...field}
			name={name}
			inputMode="decimal"
			placeholder={placeholder === undefined ? undefined : drawAmountEntry(placeholder, currency)}
			value={composed ?? drawAmountEntry(text, currency)}
			onKeyDown={(event) => keyInAmountBox(event, currency)}
			onValueChange={(_, event) => {
				const entry = regroupAmountBox(event, currency);
				setComposed(isComposing(event) ? event.currentTarget.value : null);
				handOn(entry);
			}}
			onCompositionEnd={(event) => {
				setComposed(null);
				handOn(regroupAmountBox(event, currency));
			}}
		/>
	);
}
