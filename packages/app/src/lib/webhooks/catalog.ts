// every event a webhook destination can subscribe to: the wire name its `type` carries, and the
// words a screen shows for it.
//
// **a closed set, and permanent.** a wire name is a `case` in some receiver's code and a row in
// `webhook_destination_event`, so a name is never renamed or dropped. a new kind of event is a new
// name, never a meaning stretched over an old one, and its writer lands with it.
//
// names are `noun.past_tense`, lowercase `[a-z_]` either side of one full stop: this repo's choice
// inside what https://www.standardwebhooks.com/ allows an event type, full-stop-delimited
// `[a-zA-Z0-9_]`.
//
// one `type` besides these reaches a destination, `WEBHOOK_TEST_TYPE` below, and it names no
// event.
//
// a leaf that imports nothing, so $lib/server/db/schema.ts can derive its checks from this list and
// a component can import the labels.

/** each event's wire name and its label for a screen. */
export const WEBHOOK_EVENTS = {
	'gift.made': 'Gift made',
	'gift.refunded': 'Gift refunded',
	'gift.dispute_opened': 'Dispute opened',
	'donor.added': 'Donor added',
	'donor.updated': 'Donor updated',
	'recurring_gift.started': 'Recurring gift started',
	'recurring_gift.updated': 'Recurring gift updated',
	'recurring_gift.charge_failed': 'Recurring charge failed',
	'recurring_gift.ended': 'Recurring gift ended'
} as const;

export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;

/**
 * the one `type` a destination receives that is not an event: the post a super admin sends from
 * the destination's page to check the receiving system, `data` being `{ test: true, message }`.
 * outside the catalog, so no destination subscribes to it and no delivery row carries it, and
 * permanent like the names above — a receiver's `switch` sets it aside by this name.
 */
export const WEBHOOK_TEST_TYPE = 'test';

/** the wire names, in the order a screen lists them. */
export const WEBHOOK_EVENT_TYPES = Object.keys(WEBHOOK_EVENTS) as readonly WebhookEvent[];

/**
 * the events as a screen asks for them: filed under the record each is about, each named for what
 * happened to that record, so `Gifts` over `Made` reads as the catalog's `Gift made`.
 */
export const WEBHOOK_EVENT_GROUPS = [
	{
		id: 'gifts',
		legend: 'Gifts',
		events: [
			['gift.made', 'Made'],
			['gift.refunded', 'Refunded'],
			['gift.dispute_opened', 'Dispute opened']
		]
	},
	{
		id: 'donors',
		legend: 'Donors',
		events: [
			['donor.added', 'Added'],
			['donor.updated', 'Updated']
		]
	},
	{
		id: 'recurring-gifts',
		legend: 'Recurring gifts',
		events: [
			['recurring_gift.started', 'Started'],
			['recurring_gift.updated', 'Updated'],
			['recurring_gift.charge_failed', 'Charge failed'],
			['recurring_gift.ended', 'Ended']
		]
	}
] as const satisfies readonly {
	readonly id: string;
	readonly legend: string;
	readonly events: readonly (readonly [WebhookEvent, string])[];
}[];
