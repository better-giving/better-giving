import { z } from 'zod';
import { WEBHOOK_EVENT_TYPES } from './catalog';

// the two boxes a webhook destination is added and edited with, stated once for both forms and for
// the browser's pass over them before a submit. what an address may be is decided by the write,
// `destinationAddress` in $lib/server/webhooks/destinations.ts, which every path to the table
// goes through; this states only that one was typed.

/** what an empty box and a box the request did not carry are both told. */
const MISSING = 'required';

/** a bound on what a box may hold, well past any address a receiving system listens on. */
const MAX_URL = 2048;

export const DESTINATION_INPUT = z.object({
	url: z
		.string({ error: MISSING })
		.trim()
		.min(1, { error: MISSING })
		.max(MAX_URL, { error: `must be at most ${MAX_URL} characters` }),
	// an unticked group submits no key, which conform reads as an empty list.
	events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1, { error: 'choose at least one' })
});
