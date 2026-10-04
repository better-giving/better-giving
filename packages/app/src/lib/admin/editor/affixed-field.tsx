import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import type { InputHTMLAttributes, Ref } from 'react';

// a box whose unit or address prefix is stated on the box itself — the goal's currency, a campaign
// address's host. the rows are packages/operator/src/components/forms/Field.jsx's own (label, hint,
// box, refusal), and the box is `.adm-affixed`, which draws the field's border, ring and refusal
// round the input and the affix together.
//
// the affix is read with the box: the input is described by it, so a screen reader hears "USD" or
// the host along with the label.
//
// the whole drawn frame takes a press, the affix and the padding round the input included: the
// frame is a second `<label>` of the input, so the platform puts the caret in the box from any of
// it. the input is named by the field's label alone, which keeps the affix out of its name.
//
// the box is the caller's to hold, with `value` and `onValueChange`, or the form's, with `name` and
// `defaultValue`, posted with the rest of the form's boxes — a block's tier amounts
// (./block-edit.tsx).

/** who holds what is typed: the caller, or the form the box posts with. */
type Entry =
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

type AffixedFieldProps = Entry & {
	readonly id: string;
	readonly label: string;
	readonly optional?: boolean;
	readonly hint?: string | undefined;
	/** what stands in the box beside what is typed. */
	readonly affix: string;
	/** which end of the box the affix stands at. */
	readonly affixAt: 'start' | 'end';
	/** the predicate the last check or apply refused the box with. */
	readonly error?: string | null | undefined;
	readonly inputRef?: Ref<HTMLInputElement>;
	readonly inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
};

export function AffixedField({
	id,
	label,
	optional = false,
	hint,
	affix,
	affixAt,
	error,
	inputRef,
	value,
	onValueChange,
	name,
	defaultValue,
	inputMode
}: AffixedFieldProps) {
	const labelId = `${id}-label`;
	const affixId = `${id}-affix`;
	const describedBy = [affixId, hint ? `${id}-hint` : null, error ? `${id}-err` : null]
		.filter(Boolean)
		.join(' ');
	const unit = (
		<span className="adm-affixed__unit" id={affixId}>
			{affix}
		</span>
	);
	return (
		<div className="adm-field">
			<label className="adm-field__label" htmlFor={id} id={labelId}>
				{label}
				{optional ? <span className="adm-field__optional"> (optional)</span> : null}
			</label>
			{hint ? (
				<p className="adm-hint" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			<label className="adm-affixed">
				{affixAt === 'start' ? unit : null}
				<input
					ref={inputRef}
					id={id}
					className="adm-affixed__input"
					type="text"
					inputMode={inputMode}
					autoComplete="off"
					aria-labelledby={labelId}
					aria-invalid={error ? 'true' : undefined}
					aria-describedby={describedBy}
					name={name}
					value={value}
					defaultValue={defaultValue}
					onChange={
						onValueChange === undefined ? undefined : (event) => onValueChange(event.target.value)
					}
				/>
				{affixAt === 'end' ? unit : null}
			</label>
			{error ? <FieldMessage id={`${id}-err`}>{error}</FieldMessage> : null}
		</div>
	);
}
