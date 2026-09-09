import { AnchoredNote } from '@better-giving/operator/behaviour/AnchoredCard';
import { RepeatingRows } from '@better-giving/operator/components/forms/RepeatingRows';
import type { RowControl } from '@better-giving/operator/components/forms/RepeatingRows';

/*
 * a list of boxes and the controls that add and drop one, at every length it can be.
 *
 * the two empty groups are the pair worth the lines: with an `emptyNote` the group says why it is
 * blank, and without one it is a legend, a hint and an Add button standing over nothing — which is
 * what a screen forgetting the note actually ships, and it looks deliberate.
 *
 * the list of one is here because a group that has to keep one row is a rule this component does not
 * hold: the caller states no Remove for that row and the trailing track is left empty.
 *
 * a row carrying its own message and the group carrying one are two different states and both are
 * here. a row's sentence is about the address in that box; the group's is about the list — how many
 * rows there may be — and it marks every row that has nothing else said about it, because either of
 * them fixes it. the group with both is what says which of the two a row draws when it could draw
 * either.
 *
 * the closed group is the whole group and not its boxes: Add and every Remove change the list the
 * boxes are showing, so a group that greyed only its rows would still offer a press that changes it.
 *
 * `legend` is what each row's accessible name is built from and is stated on every group, so a
 * screen wanting no mark on the page reaches for `legendHidden` rather than dropping it: the same
 * names, drawn to a reader only, and on the screen the two are indistinguishable.
 *
 * the group with a fixed row is the one state a screen cannot draw for itself: the locked row
 * stands in the list's own geometry, holds a value nobody may edit and carries no name, so what a
 * press posts is the rows under it and nothing else. what stands where its Remove would is a mark
 * and a word the caller hands over bare, and it is a status rather than a control: the group is
 * what stands the two of them in the trailing track as one item, on the presses' own step.
 *
 * both presses are the caller's and are stated here as a form layer's list intents would arrive.
 * nothing on this page is inside a form, so no press does anything — what a group draws is the
 * whole of what a preview can show about them.
 */

/** the intent a form layer mints for the control that puts an empty row at the end. */
const add: RowControl = { name: '__intent__', value: 'insert', formNoValidate: true };

/** the same for the control that drops one row, which every row states for itself. */
const drop = (at: number): RowControl => ({
	name: '__intent__',
	value: `remove:${at}`,
	formNoValidate: true
});

export default function FormsRepeatingRowsPreview() {
	return (
		<div className="adm-stack">
			<RepeatingRows
				id="forms-rows-origins"
				name="origins"
				legend="Allowed origin"
				hint="The scheme and host of every page the form is pasted into."
				add={add}
				code
				placeholder="https://example.org"
				rows={[
					{
						id: 'forms-rows-origins-1',
						key: 'origins-1',
						defaultValue: 'https://riverside-shelter.org',
						remove: drop(0)
					},
					{
						id: 'forms-rows-origins-2',
						key: 'origins-2',
						defaultValue: 'https://www.riverside-shelter.org',
						remove: drop(1)
					},
					{
						id: 'forms-rows-origins-3',
						key: 'origins-3',
						defaultValue: 'https://give.riverside-shelter.org',
						remove: drop(2)
					}
				]}
			/>
			<RepeatingRows
				id="forms-rows-one"
				name="amounts"
				legend="Suggested amount"
				addLabel="Add another amount"
				add={add}
				rows={[{ id: 'forms-rows-one-1', key: 'one-1', defaultValue: '25' }]}
			/>
			<RepeatingRows
				id="forms-rows-closed"
				name="origins-closed"
				legend="Allowed origin"
				hint="The group while the page is writing."
				add={add}
				code
				disabled
				rows={[
					{
						id: 'forms-rows-closed-1',
						key: 'closed-1',
						defaultValue: 'https://riverside-shelter.org',
						remove: drop(0)
					},
					{
						id: 'forms-rows-closed-2',
						key: 'closed-2',
						defaultValue: 'https://give.riverside-shelter.org',
						remove: drop(1)
					}
				]}
			/>
			<RepeatingRows
				id="forms-rows-empty"
				name="origins-empty"
				legend="Allowed origin"
				add={add}
				hint="The scheme and host of every page the form is pasted into."
				emptyNote="No origins yet. Until one is added the form is refused on every site."
				addLabel="Add an origin"
			/>
			<RepeatingRows
				id="forms-rows-bare"
				name="origins-bare"
				legend="Allowed origin"
				add={add}
				hint="The same group with no empty note."
				addLabel="Add an origin"
			/>
			<RepeatingRows
				id="forms-rows-row-error"
				name="origins-row-error"
				legend="Allowed origin"
				add={add}
				code
				rows={[
					{
						id: 'forms-rows-row-error-1',
						key: 'row-error-1',
						defaultValue: 'riverside-shelter.org',
						error: 'This one is missing the https:// in front of it.',
						remove: drop(0)
					},
					{
						id: 'forms-rows-row-error-2',
						key: 'row-error-2',
						defaultValue: 'https://give.riverside-shelter.org',
						remove: drop(1)
					}
				]}
			/>
			<RepeatingRows
				id="forms-rows-error"
				name="amounts-error"
				legend="Suggested amount"
				error="That is more amounts than a form may offer."
				add={add}
				rows={[
					{ id: 'forms-rows-error-1', key: 'error-1', defaultValue: '25', remove: drop(0) },
					{ id: 'forms-rows-error-2', key: 'error-2', defaultValue: '50', remove: drop(1) },
					{ id: 'forms-rows-error-3', key: 'error-3', defaultValue: '100', remove: drop(2) }
				]}
			/>
			<RepeatingRows
				id="forms-rows-both"
				name="origins-both"
				legend="Allowed origin"
				hint="The scheme and host of every page the form is pasted into."
				error="That is more sites than may be stored."
				code
				add={add}
				rows={[
					{
						id: 'forms-rows-both-1',
						key: 'both-1',
						defaultValue: 'https://riverside-shelter.org/donate',
						error: 'This one has a page on the end of it.',
						remove: drop(0)
					},
					{
						id: 'forms-rows-both-2',
						key: 'both-2',
						defaultValue: 'https://riverside-shelter.org',
						remove: drop(1)
					}
				]}
			/>
			<RepeatingRows
				id="forms-rows-hidden-legend"
				name="hidden-legend"
				legend="Site"
				legendHidden
				hint="The legend is stated and not drawn."
				add={add}
				code
				placeholder="https://example.org"
				rows={[
					{
						id: 'forms-rows-hidden-legend-1',
						key: 'hidden-1',
						defaultValue: 'https://riverside-shelter.org',
						remove: drop(0)
					}
				]}
			/>
			<RepeatingRows
				id="forms-rows-fixed"
				name="sites"
				legend="Site"
				legendHidden
				hint="The first row is the list's own and cannot be edited or removed."
				add={add}
				code
				placeholder="https://example.org"
				fixed={{
					id: 'forms-rows-fixed-locked',
					label: 'Your donation page',
					value: 'https://better-giving-donate.workers.dev',
					aside: (
						<>
							<AnchoredNote mark="info" label="Why this row is always listed">
								<p>
									The deployment puts this page up itself, and it is served whatever else is listed.
								</p>
							</AnchoredNote>
							Default
						</>
					)
				}}
				rows={[
					{
						id: 'forms-rows-fixed-1',
						key: 'fixed-1',
						defaultValue: 'https://riverside-shelter.org',
						remove: drop(0)
					}
				]}
			/>
			<RepeatingRows
				id="forms-rows-long"
				name="long"
				legend="Allowed origin"
				code
				add={add}
				rows={[
					{
						id: 'forms-rows-long-1',
						key: 'long-1',
						defaultValue:
							'https://donate.riverside-shelter-and-community-kitchen.example.org.uk:8443',
						remove: drop(0)
					},
					{ id: 'forms-rows-long-2', key: 'long-2', defaultValue: '', remove: drop(1) }
				]}
			/>
		</div>
	);
}
