import { CheckboxGroups } from '@better-giving/operator/components/forms/CheckboxGroups';
import { Field } from '@better-giving/operator/components/forms/Field';
import { WEBHOOK_EVENT_GROUPS } from '$lib/webhooks/catalog';
import { type Box, boxProps } from '../use-admin-form';

// a webhook destination's address and the events it takes: the two boxes the add screen and a
// destination's own page both submit, mounted by both
// (../../../routes/_app.admin.integrations.webhooks.new.tsx and .$id.tsx).
//
// the events are one question answered from three named lists, so a refusal is the question's and
// is drawn once under the last list (`CheckboxGroups`); every box submits under the one name, so a
// failed submit's focus move finds the first of them by it.

type EventsBox = {
	/** the question's id, which its refusal is named from. */
	readonly id: string;
	/** the name every box submits under. */
	readonly name: string;
	readonly errors?: string[] | undefined;
	/** the events the boxes start ticked, as the form's seed or its last submission holds them. */
	readonly ticked: readonly string[];
};

export type DestinationBoxes = {
	readonly url: Box;
	readonly events: EventsBox;
};

export function DestinationFields({
	boxes,
	revision
}: {
	readonly boxes: DestinationBoxes;
	/** changes once per answered submission, so a repeat refusal of the events is announced again. */
	readonly revision?: string | number | undefined;
}) {
	const { url, events } = boxes;
	return (
		<>
			<Field
				{...boxProps(url)}
				label="URL"
				code
				type="url"
				placeholder="https://"
				autoComplete="off"
				spellCheck={false}
			/>
			<CheckboxGroups
				id={events.id}
				name={events.name}
				legend="Events"
				error={events.errors?.[0]}
				revision={revision}
				groups={WEBHOOK_EVENT_GROUPS.map((group) => ({
					id: `${events.id}-${group.id}`,
					legend: group.legend,
					items: group.events.map(([event, label]) => ({
						id: `${events.id}-${event}`,
						label,
						value: event,
						defaultChecked: events.ticked.includes(event)
					}))
				}))}
			/>
		</>
	);
}

/** conform's metadata for the events list as `DestinationFields` takes it. */
export function eventsBox(field: {
	readonly id: string;
	readonly name: string;
	readonly errors?: string[] | undefined;
	readonly initialValue?: unknown;
}): EventsBox {
	const seeded = field.initialValue;
	return {
		id: field.id,
		name: field.name,
		errors: field.errors,
		ticked: Array.isArray(seeded)
			? seeded.filter((each): each is string => typeof each === 'string')
			: typeof seeded === 'string'
				? [seeded]
				: []
	};
}
