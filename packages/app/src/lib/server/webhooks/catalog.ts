// every event a webhook destination can subscribe to: the wire name its `type` carries, and the
// words a screen shows for it.
//
// **a closed set, and permanent.** a wire name is a `case` in some receiver's code and a row in
// `webhook_destination_event`, so a name is never renamed or dropped. a new kind of event is a new
// name, never a meaning stretched over an old one; its writer lands with it, and the docs tell a
// receiver to acknowledge a type it does not know and ignore it.
//
// names are `noun.past_tense`, lowercase `[a-z_]` either side of one full stop, the shape
// https://www.standardwebhooks.com/ recommends for an event type.
//
// imports nothing: ../db/schema.ts derives its checks from this list and may import only from
// leaves.

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

/** the wire names, in the order a screen lists them. */
export const WEBHOOK_EVENT_TYPES = Object.keys(WEBHOOK_EVENTS) as readonly WebhookEvent[];
