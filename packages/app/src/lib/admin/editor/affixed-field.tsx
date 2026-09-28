import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import type { InputHTMLAttributes, Ref } from 'react';

// a box whose unit or address prefix is stated on the box itself — the goal's currency, a campaign
// address's host — rather than in a sentence under the label. the rows are
// packages/operator/src/components/forms/Field.jsx's own (label, hint, box, refusal), and the box is
// `.adm-affixed`, which draws the field's border, ring and refusal round the input and the affix
// together.
//
// the affix is read with the box: the input is described by it, so a screen reader hears "USD" or
// the host along with the label.

type AffixedFieldProps = {
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
	readonly value: string;
	readonly onValueChange: (text: string) => void;
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
	inputMode
}: AffixedFieldProps) {
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
			<label className="adm-field__label" htmlFor={id}>
				{label}
				{optional ? <span className="adm-field__optional"> (optional)</span> : null}
			</label>
			{hint ? (
				<p className="adm-hint" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			<div className="adm-affixed">
				{affixAt === 'start' ? unit : null}
				<input
					ref={inputRef}
					id={id}
					className="adm-affixed__input"
					type="text"
					inputMode={inputMode}
					autoComplete="off"
					aria-invalid={error ? 'true' : undefined}
					aria-describedby={describedBy}
					value={value}
					onChange={(event) => onValueChange(event.target.value)}
				/>
				{affixAt === 'end' ? unit : null}
			</div>
			{error ? <FieldMessage id={`${id}-err`}>{error}</FieldMessage> : null}
		</div>
	);
}
