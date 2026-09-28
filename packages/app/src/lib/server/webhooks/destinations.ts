import { uuidv7 } from 'uuidv7';
import type { Db } from '../db/client';
import { webhookDestination, webhookDestinationEvent } from '../db/schema';
import type { WebhookEvent } from './catalog';

// a destination: an https address the organisation's own system listens on, the events it takes,
// and the secret every post to it is signed with (./sign.ts).
//
// **the secret is minted here and stored retrievable** — `webhook_destination`'s header in
// ../db/schema.ts argues why. it is `whsec_` and the base64 of 32 bytes from the CSPRNG, the
// Standard Webhooks serialization (https://www.standardwebhooks.com/), so a receiver's library
// takes it as it is shown.

/** a destination as it was made, with the secret its owner copies into the receiving system. */
export type CreatedDestination = {
	readonly id: string;
	readonly url: string;
	readonly events: readonly WebhookEvent[];
	readonly signingSecret: string;
};

export type CreateDestinationResult =
	| { readonly ok: true; readonly destination: CreatedDestination }
	| { readonly ok: false; readonly reason: 'not_https'; readonly detail: string };

/**
 * a destination posting `events` to `url`, stored as the parsed address. an address that is not
 * absolute https is refused and nothing is written: every post carries donors' names and
 * addresses.
 */
export async function createDestination(
	db: Db,
	input: { readonly url: string; readonly events: readonly WebhookEvent[] }
): Promise<CreateDestinationResult> {
	const url = URL.parse(input.url);
	if (url === null || url.protocol !== 'https:') {
		return {
			ok: false,
			reason: 'not_https',
			detail: `${input.url} is not an https address. Give the full address the receiving system listens on, starting https://.`
		};
	}

	const id = uuidv7();
	const signingSecret = newSigningSecret();
	const events = [...new Set(input.events)];
	await db.batch([
		db.insert(webhookDestination).values({ id, url: url.href, signingSecret }),
		...events.map((event) =>
			db.insert(webhookDestinationEvent).values({ destinationId: id, event })
		)
	]);
	return { ok: true, destination: { id, url: url.href, events, signingSecret } };
}

function newSigningSecret(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return `whsec_${btoa(String.fromCharCode(...bytes))}`;
}
