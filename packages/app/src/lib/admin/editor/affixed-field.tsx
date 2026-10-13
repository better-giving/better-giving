import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import type {
	ChangeEvent,
	CompositionEventHandler,
	InputHTMLAttributes,
	KeyboardEventHandler,
	Ref
} from 'react';

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
// it. the input is named by the field's label or its `aria-label` alone, which keeps the affix
// out of its name.
//
// a box in a repeating row draws no label: the group's legend names the rows on the screen and the
// box is named by `aria-label`. the group's hint and refusal are its caller's to name in
// `aria-describedby`, after the box's own, and the group's refusal marks it through `aria-invalid`
// (packages/operator/src/components/forms/RepeatingRows.jsx).
//
// the box is the caller's to hold, with `value` and `onValueChange`, and posts under `name` where it
// has one — a money box that posts with a form (./money-field.tsx).

export type AffixedFieldProps = {
	readonly value: string;
	/** what is typed, and the change that typed it. */
	readonly onValueChange: (text: string, event: ChangeEvent<HTMLInputElement>) => void;
	readonly id: string;
	/** what the box posts under, for a box a form posts. */
	readonly name?: string | undefined;
	/** the label drawn over the box, or `aria-label` where the box is named by a group instead. */
	readonly label?: string | undefined;
	readonly 'aria-label'?: string | undefined;
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
	readonly placeholder?: string | undefined;
	readonly onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
	readonly onCompositionEnd?: CompositionEventHandler<HTMLInputElement>;
	/** blocks the caller draws that describe the box, read after the box's own. */
	readonly 'aria-describedby'?: string | undefined;
	/** refused by something larger than the box, which holds the sentence itself. */
	readonly 'aria-invalid'?: true | undefined;
	readonly disabled?: boolean | undefined;
};

export function AffixedField({
	id,
	name,
	label,
	'aria-label': named,
	optional = false,
	hint,
	affix,
	affixAt,
	error,
	inputRef,
	value,
	onValueChange,
	inputMode,
	placeholder,
	onKeyDown,
	onCompositionEnd,
	'aria-describedby': describedByStated,
	'aria-invalid': refusedFromOutside,
	disabled
}: AffixedFieldProps) {
	const labelId = `${id}-label`;
	const affixId = `${id}-affix`;
	const describedBy = [
		affixId,
		hint ? `${id}-hint` : null,
		error ? `${id}-err` : null,
		describedByStated
	]
		.filter(Boolean)
		.join(' ');
	const unit = (
		<span className="adm-affixed__unit" id={affixId}>
			{affix}
		</span>
	);
	return (
		<div className="adm-field">
			{label === undefined ? null : (
				<label className="adm-field__label" htmlFor={id} id={labelId}>
					{label}
					{optional ? <span className="adm-field__optional"> (optional)</span> : null}
				</label>
			)}
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
					name={name}
					className="adm-affixed__input"
					type="text"
					inputMode={inputMode}
					autoComplete="off"
					aria-labelledby={label === undefined ? undefined : labelId}
					aria-label={named}
					aria-invalid={error || refusedFromOutside ? 'true' : undefined}
					aria-describedby={describedBy}
					disabled={disabled}
					placeholder={placeholder}
					value={value}
					onKeyDown={onKeyDown}
					onCompositionEnd={onCompositionEnd}
					onChange={(event) => onValueChange(event.target.value, event)}
				/>
				{affixAt === 'end' ? unit : null}
			</label>
			{error ? <FieldMessage id={`${id}-err`}>{error}</FieldMessage> : null}
		</div>
	);
}
