import { Field, type FieldProps } from '@better-giving/operator/components/forms/Field';
import { BRAND_COLOUR } from '@better-giving/operator/console/org-rules';
import { type ChangeEvent, useState } from 'react';

export type BrandColourFieldProps = Pick<
	FieldProps,
	| 'name'
	| 'label'
	| 'optional'
	| 'hint'
	| 'placeholder'
	| 'error'
	| 'aria-describedby'
	| 'aria-invalid'
> & {
	/** the box's id, which the well writes a picked colour into. */
	readonly id: string;
	/** what the box is drawn with: the stored colour, or empty. */
	readonly defaultValue: string;
};

/**
 * the brand colour's box with its well beside it, each following the other: a hex typed in the box
 * shows in the well, and a colour picked in the well is written into the box the way typing it
 * would be, so the form counts it and validates it as typed. the box is what posts; the well has no
 * name.
 *
 * a colour input always holds a colour, black where none was given, so an empty well draws no fill
 * (`.adm-swatch--well[data-empty]` in packages/operator/src/styles/adm.css) and is described as
 * empty in words the screen does not draw.
 */
export function BrandColourField({ defaultValue, ...box }: BrandColourFieldProps) {
	const [typed, setTyped] = useState(defaultValue);
	// a new seed — the save landed, the form was put back on it — is what the box holds again.
	const [seed, setSeed] = useState(defaultValue);
	if (seed !== defaultValue) {
		setSeed(defaultValue);
		setTyped(defaultValue);
	}
	const hex = BRAND_COLOUR.test(typed);
	const emptyId = `${box.id}-colour-empty`;

	const picked = (event: ChangeEvent<HTMLInputElement>) => {
		const field = event.currentTarget.ownerDocument.getElementById(box.id);
		if (!(field instanceof HTMLInputElement)) return;
		field.value = event.currentTarget.value;
		field.dispatchEvent(new Event('input', { bubbles: true }));
	};

	return (
		<Field
			{...box}
			defaultValue={defaultValue}
			spellCheck={false}
			onInput={(event) => setTyped(event.currentTarget.value)}
			beside={
				<>
					{/* the label carries the well's target (`.adm-wellwrap` in
					    packages/operator/src/styles/adm.css); the well's name is its own `aria-label`. */}
					<label className="adm-wellwrap">
						<input
							type="color"
							className="adm-swatch adm-swatch--well"
							aria-label="Pick the brand colour"
							aria-describedby={hex ? undefined : emptyId}
							value={hex ? typed.toLowerCase() : '#000000'}
							data-empty={hex ? undefined : true}
							onChange={picked}
						/>
					</label>
					{hex ? null : (
						<span id={emptyId} className="adm-vh">
							No colour set
						</span>
					)}
				</>
			}
		/>
	);
}
