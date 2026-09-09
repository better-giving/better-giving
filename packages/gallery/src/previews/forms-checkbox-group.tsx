import { CheckboxGroup } from '@better-giving/operator/components/forms/CheckboxGroup';

/*
 * the group in both types, both shapes, both second lines, and every state it can be in.
 *
 * the list of one earns its line twice over: a bare group of one box reads as a box that should
 * have been a single checkbox, and a boxed group of one is a bordered row with nothing to be
 * bordered against. the group holding no items at all is what a picker draws before anything has
 * been claimed, and it draws an empty grid — this group has no empty note of its own, unlike
 * RepeatingRows.
 *
 * `note` and `sub` are the two second lines and they are not interchangeable: `note` is
 * attention-toned and `sub` is neutral, and the pair below is the only place the difference is
 * visible side by side.
 *
 * the pointer states are pinned per item. `focus` lands on the box and `hover` on the row, which is
 * why the focused specimen is the boxed one — packages/operator/src/styles/adm.css takes the ring
 * off the input and puts it on the box. hover is drawn on a boxed row and on no other, so the bare
 * hovered row below sits at rest and the pair of rows is what says so. an unavailable choice is the
 * real `disabled` attribute, which the group passes through to the box, and it is pinned nowhere: a
 * page that wants it sets it. the boxed pair below is where the ground and the edge of that state
 * are read, taken and untaken, and the bare one is where the note keeping its tone is.
 */
export default function FormsCheckboxGroupPreview() {
	return (
		<div className="adm-stack">
			<CheckboxGroup
				id="forms-check-cadences"
				name="cadences"
				legend="Cadences donors may choose"
				hint="A cadence you turn off here is not offered on the form."
				items={[
					{ id: 'forms-check-cadences-once', label: 'One-off', defaultChecked: true },
					{ id: 'forms-check-cadences-monthly', label: 'Monthly', defaultChecked: true },
					{ id: 'forms-check-cadences-yearly', label: 'Yearly' }
				]}
			/>
			<CheckboxGroup
				id="forms-check-error"
				name="methods"
				legend="Payment methods"
				error="Choose at least one payment method."
				items={[
					{ id: 'forms-check-error-card', label: 'Card' },
					{ id: 'forms-check-error-bank', label: 'Bank transfer' }
				]}
			/>
			<CheckboxGroup
				id="forms-check-both"
				name="receipts"
				legend="Receipts"
				hint="Sent from the address on the organisation screen."
				error="A receipt cannot be sent until a sender address is set."
				items={[
					{ id: 'forms-check-both-donor', label: 'Email the donor' },
					{ id: 'forms-check-both-staff', label: 'Copy the staff address' }
				]}
			/>
			<CheckboxGroup
				id="forms-check-notes"
				name="cadences-blocked"
				legend="Cadences"
				items={[
					{
						id: 'forms-check-notes-monthly',
						label: 'Monthly',
						note: 'This deployment cannot charge a repeating gift yet.'
					},
					{
						id: 'forms-check-notes-yearly',
						label: 'Yearly',
						sub: 'Charged on the anniversary of the first gift.'
					}
				]}
			/>
			<CheckboxGroup
				id="forms-check-radio"
				name="account"
				type="radio"
				legend="Cloudflare account"
				boxed
				items={[
					{
						id: 'forms-check-radio-a',
						label: 'Riverside Shelter',
						sub: '3f9c1a7b2e5d48c6a0b93f71e2c84d15',
						defaultChecked: true
					},
					{
						id: 'forms-check-radio-b',
						label: 'Riverside Shelter (Trading)',
						sub: '8d02e64f9a1b4c73b5e0217c6fa39d84'
					}
				]}
			/>
			<CheckboxGroup
				id="forms-check-one"
				name="single"
				legend="A list of one"
				items={[{ id: 'forms-check-one-only', label: 'Send a copy to the staff address' }]}
			/>
			<CheckboxGroup
				id="forms-check-one-boxed"
				name="single-boxed"
				type="radio"
				legend="A boxed list of one"
				boxed
				items={[
					{
						id: 'forms-check-one-boxed-only',
						label: 'Riverside Shelter',
						sub: '3f9c1a7b2e5d48c6a0b93f71e2c84d15',
						defaultChecked: true
					}
				]}
			/>
			<CheckboxGroup id="forms-check-none" legend="No items" hint="Nothing to choose from yet." />
			<CheckboxGroup
				id="forms-check-unlegended"
				name="unlegended"
				items={[
					{ id: 'forms-check-unlegended-a', label: 'No legend: named by where it sits' },
					{ id: 'forms-check-unlegended-b', label: 'So no fieldset is drawn around it' }
				]}
			/>
			<CheckboxGroup
				id="forms-check-states"
				name="states"
				legend="Pointer states, pinned"
				items={[
					{ id: 'forms-check-states-hover', label: 'hover', state: 'hover' },
					{ id: 'forms-check-states-focus', label: 'focus', state: 'focus' },
					{ id: 'forms-check-states-really', label: 'disabled attribute', disabled: true },
					{
						id: 'forms-check-states-disabled-note',
						label: 'disabled, with a note',
						note: 'The reason a row cannot be taken keeps its tone.',
						disabled: true
					},
					{
						id: 'forms-check-states-disabled-sub',
						label: 'disabled, with a second line',
						sub: '3f9c1a7b2e5d48c6a0b93f71e2c84d15',
						disabled: true
					}
				]}
			/>
			<CheckboxGroup
				id="forms-check-states-boxed"
				name="states-boxed"
				type="radio"
				legend="Pointer states, boxed"
				boxed
				items={[
					{ id: 'forms-check-states-boxed-hover', label: 'hover', state: 'hover' },
					{ id: 'forms-check-states-boxed-focus', label: 'focus', state: 'focus' },
					{
						id: 'forms-check-states-boxed-taken',
						label: 'taken',
						defaultChecked: true
					}
				]}
			/>
			{/* a group of its own: the taken row has to be taken to be read, and a second checked radio
			    in the group above would take the state off the specimen already standing there. */}
			<CheckboxGroup
				id="forms-check-states-off"
				name="states-off"
				type="radio"
				legend="Boxed, unavailable"
				boxed
				items={[
					{
						id: 'forms-check-states-off-taken',
						label: 'disabled and taken',
						sub: '5b71c0e3d8a94f26b1c7e0348a9df62c',
						defaultChecked: true,
						disabled: true
					},
					{
						id: 'forms-check-states-off-free',
						label: 'disabled',
						sub: '8d02e64f9a1b4c73b5e0217c6fa39d84',
						disabled: true
					}
				]}
			/>
			<CheckboxGroup
				id="forms-check-long"
				name="long"
				legend="A choice whose label runs past one line"
				items={[
					{
						id: 'forms-check-long-a',
						label:
							'Include the organisation’s registered address on every receipt, even where the donor has asked for a plain acknowledgement',
						note: 'Removing it can make a claim refusable in some jurisdictions.'
					}
				]}
			/>
		</div>
	);
}
