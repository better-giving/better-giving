import { Field } from '@better-giving/operator/components/forms/Field';
import { PairedFieldset } from '@better-giving/operator/components/forms/PairedFieldset';

/*
 * two boxes that are one decision, in every shape the pair takes.
 *
 * the refused pair is what the component exists for: the message sits after both boxes and both
 * are marked from out here with `aria-invalid`, because either box fixes the pair and neither one
 * is the wrong one. each box's own `aria-describedby` points at `${id}-err`, the name the fieldset
 * gives its message — a field marked from outside draws the border and holds no sentence, so
 * without that the boxes are refused by nothing a reader can find.
 *
 * `side` turns the pair into two columns, and only above the width
 * packages/operator/src/styles/adm.css states the query at — narrow the window and it stacks.
 * the pair below it is the same shape with one field carrying a hint and the other not, which is
 * the case the side-by-side grid exists for: the boxes stay on one line whatever the hint runs to.
 */
export default function FormsPairedFieldsetPreview() {
	return (
		<div className="adm-stack">
			<PairedFieldset
				id="forms-pair-bounds"
				legend="Gift bounds"
				hint="The smallest and largest single gift the form will take."
			>
				<Field id="forms-pair-bounds-min" label="Minimum" defaultValue="5" />
				<Field id="forms-pair-bounds-max" label="Maximum" defaultValue="10000" />
			</PairedFieldset>
			<PairedFieldset
				id="forms-pair-refused"
				legend="Gift bounds"
				error="The minimum cannot be larger than the maximum."
			>
				<Field
					id="forms-pair-refused-min"
					label="Minimum"
					defaultValue="500"
					aria-invalid="true"
					aria-describedby="forms-pair-refused-err"
				/>
				<Field
					id="forms-pair-refused-max"
					label="Maximum"
					defaultValue="100"
					aria-invalid="true"
					aria-describedby="forms-pair-refused-err"
				/>
			</PairedFieldset>
			<PairedFieldset id="forms-pair-side" legend="Gift bounds, side by side" side>
				<Field id="forms-pair-side-min" label="Minimum" defaultValue="5" />
				<Field id="forms-pair-side-max" label="Maximum" defaultValue="10000" />
			</PairedFieldset>
			<PairedFieldset
				id="forms-pair-uneven"
				legend="Side by side, one hint"
				side
				hint="A hint on one field and none on the other."
			>
				<Field
					id="forms-pair-uneven-from"
					label="First gift on"
					type="date"
					hint="The day the first charge is attempted, in the organisation’s own timezone."
				/>
				<Field id="forms-pair-uneven-until" label="Last gift on" type="date" optional />
			</PairedFieldset>
			<PairedFieldset id="forms-pair-unlegended">
				<Field id="forms-pair-unlegended-a" label="No legend: named by the section above it" />
				<Field id="forms-pair-unlegended-b" label="So no legend element is drawn" />
			</PairedFieldset>
		</div>
	);
}
