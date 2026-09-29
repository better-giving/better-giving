import { z } from 'zod';
import { WEBHOOK_EVENT_TYPES } from './catalog';

// the two boxes a webhook destination is added and edited with, stated once for both forms and for
// the browser's pass over them before a submit. what an address may be is decided by the write,
// `destinationAddress` in $lib/server/webhooks/destinations.ts, which every path to the table
// goes through; this states that one was typed, and that it carries no user name or password,
// which the write refuses by the same rule ({@link carriesCredentials}) before any other: the
// address is shown on the dashboard and in the mail a pause sends, so a credential in it would be
// shown there too. the write refuses no events too.

/** what a destination taking no events is told, here and by the write that refuses one. */
export const NO_EVENTS = 'choose at least one';

/** what an address carrying a user name or password is told, here and by the write. */
export const HAS_CREDENTIALS =
	'can’t carry a user name or password: remove everything up to and including the @';

/**
 * the address `typed` as the URL parser reads it, or null where it reads none: surrounding space
 * dropped, and an address typed with no scheme — nothing before a colon but a host, or a host and
 * its port — taken as https. the write stores what this reads.
 */
export function parseAddress(typed: string): URL | null {
	const trimmed = typed.trim();
	return URL.parse(/^[a-z][a-z\d+.-]*:(?!\d)/i.test(trimmed) ? trimmed : `https://${trimmed}`);
}

/**
 * whether the address `typed` names a user name or password: where {@link parseAddress} reads one
 * from it, however the text spells the separators, or where an `@` sits in its host part, the text
 * after any scheme's `//` up to the first `/`, `\`, `?` or `#` — which catches one the parser drops
 * as empty (`https://@host`) or reads as a scheme of its own (`user:secret@host`).
 */
export function carriesCredentials(typed: string): boolean {
	const url = parseAddress(typed);
	if (url !== null && (url.username !== '' || url.password !== '')) return true;
	const afterScheme = typed.trim().replace(/^[a-z][a-z\d+.-]*:\/\//i, '');
	const [host = ''] = afterScheme.split(/[/\\?#]/, 1);
	return host.includes('@');
}

/** what an empty box and a box the request did not carry are both told. */
const MISSING = 'required';

/** a bound on what a box may hold, well past any address a receiving system listens on. */
const MAX_URL = 2048;

export const DESTINATION_INPUT = z.object({
	url: z
		.string({ error: MISSING })
		.trim()
		.min(1, { error: MISSING })
		.max(MAX_URL, { error: `must be at most ${MAX_URL} characters` })
		.refine((url) => !carriesCredentials(url), { error: HAS_CREDENTIALS }),
	// with no box ticked the key is not submitted, which conform reads as an empty list.
	events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1, { error: NO_EVENTS })
});
