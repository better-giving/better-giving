import { CheckboxGroups } from '@better-giving/operator/components/forms/CheckboxGroups';

/*
 * one question answered from several named lists — the events a webhook destination is sent — in
 * the three states the destination form draws it: nothing ticked, the choices a saved destination
 * holds, and refused for having nothing ticked at all.
 *
 * the refusal is the question's and never a box's, so the refused specimen draws its sentence
 * once, under the last list, with every box looking as it was — each is marked refused and pointed
 * at the sentence in the tree alone, where a failed submit's focus lands. the two with no refusal
 * are drawn beside it so the step from the last list to the sentence reads against the step the
 * same list stands at with nothing under it.
 *
 * the groups are the webhook catalog's nine events in a fundraiser's words. at 375px each list
 * wraps inside itself, and Recurring gifts, the longest, is the one that shows it.
 */

type Ticked = ReadonlySet<string>;

function events(prefix: string, ticked: Ticked) {
	const box = (key: string, label: string) => ({
		id: `${prefix}-${key}`,
		label,
		value: key,
		defaultChecked: ticked.has(key)
	});
	return [
		{
			id: `${prefix}-gifts`,
			legend: 'Gifts',
			items: [
				box('gift.made', 'Made'),
				box('gift.refunded', 'Refunded'),
				box('gift.dispute_opened', 'Dispute opened')
			]
		},
		{
			id: `${prefix}-donors`,
			legend: 'Donors',
			items: [box('donor.added', 'Added'), box('donor.updated', 'Updated')]
		},
		{
			id: `${prefix}-recurring`,
			legend: 'Recurring gifts',
			items: [
				box('recurring_gift.started', 'Started'),
				box('recurring_gift.updated', 'Updated'),
				box('recurring_gift.charge_failed', 'Charge failed'),
				box('recurring_gift.ended', 'Ended')
			]
		}
	];
}

export default function FormsCheckboxGroupsPreview() {
	return (
		<div className="adm-stack">
			<CheckboxGroups
				id="forms-checkgroups-new"
				name="events"
				legend="Events"
				groups={events('forms-checkgroups-new', new Set())}
			/>
			<CheckboxGroups
				id="forms-checkgroups-saved"
				name="events"
				legend="Events"
				groups={events(
					'forms-checkgroups-saved',
					new Set(['gift.made', 'gift.refunded', 'donor.added', 'recurring_gift.started'])
				)}
			/>
			<CheckboxGroups
				id="forms-checkgroups-refused"
				name="events"
				legend="Events"
				error="choose at least one"
				groups={events('forms-checkgroups-refused', new Set())}
			/>
		</div>
	);
}
