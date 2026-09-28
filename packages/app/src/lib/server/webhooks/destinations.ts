import { and, eq, isNotNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Db } from '../db/client';
import { webhookDestination, webhookDestinationEvent } from '../db/schema';
import type { WebhookEvent } from '../../webhooks/catalog';
import { requeueHeldStatement } from './deliver';

// a destination: an https address the organisation's own system listens on, the events it takes,
// and the secret every post to it is signed with (./sign.ts).
//
// **the secret is minted here and stored retrievable** — `webhook_destination`'s header in
// ../db/schema.ts argues why. it is `whsec_` and the base64 of 32 bytes from the CSPRNG, the
// Standard Webhooks serialization (https://www.standardwebhooks.com/), so a receiver's library
// takes it as it is shown.
//
// **a paused destination is resumed with what it missed** (`resumeDestination`): every row it is
// still owed, and every row that failed while it was failing, sent again under the `webhook-id` it
// was queued with, so a receiver that did take one dedupes it.

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

export type ResumeDestinationResult =
	| { readonly ok: true; readonly requeued: number }
	| { readonly ok: false; readonly reason: 'not_found' | 'not_paused'; readonly detail: string };

/**
 * the destination `id` resumed at `now`, its held window due at once (`requeueHeldStatement` in
 * ./deliver.ts says which rows) and answered with how many rows that re-queued. the pause and the
 * failing mark are cleared in the same batch, and only while the destination is paused, so of two
 * resumes one re-queues and the other is refused.
 */
export async function resumeDestination(
	db: Db,
	id: string,
	now: Date
): Promise<ResumeDestinationResult> {
	const [requeued, resumed] = await db.batch([
		requeueHeldStatement(db, id, now),
		db
			.update(webhookDestination)
			.set({ pausedAt: null, failingSince: null })
			.where(and(eq(webhookDestination.id, id), isNotNull(webhookDestination.pausedAt)))
			.returning({ id: webhookDestination.id })
	]);
	if (resumed.length > 0) return { ok: true, requeued: requeued.length };

	const [found] = await db
		.select({ id: webhookDestination.id })
		.from(webhookDestination)
		.where(eq(webhookDestination.id, id));
	return found === undefined
		? {
				ok: false,
				reason: 'not_found',
				detail: `No destination has the id ${id}.`
			}
		: {
				ok: false,
				reason: 'not_paused',
				detail: `The destination ${id} is not paused, so there is nothing to resume.`
			};
}
