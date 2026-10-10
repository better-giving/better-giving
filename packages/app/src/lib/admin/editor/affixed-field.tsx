import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import type { InputHTMLAttributes, KeyboardEventHandler, Ref } from 'react';

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
// the box is the caller's to hold, with `value` and `onValueChange`; a money box that posts with a
// form holds its own and posts it from a hidden box (./money-field.tsx).

export type AffixedFieldProps = {
	readonly value: string;
	/** what is typed, and the box it is typed in. */
	readonly onValueChange: (text: string, box: HTMLInputElement) => void;
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
	readonly onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
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
	inputMode,
	onKeyDown
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
					value={value}
					onKeyDown={onKeyDown}
					onChange={(event) => onValueChange(event.target.value, event.target)}
				/>
				{affixAt === 'end' ? unit : null}
			</label>
			{error ? <FieldMessage id={`${id}-err`}>{error}</FieldMessage> : null}
		</div>
	);
}
