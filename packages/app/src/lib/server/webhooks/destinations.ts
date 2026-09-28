import { and, asc, eq, exists, isNotNull, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Db } from '../db/client';
import { webhookDestination, webhookDestinationEvent } from '../db/schema';
import { WEBHOOK_EVENT_TYPES, type WebhookEvent } from '../../webhooks/catalog';
import { countHeld, dropOwedStatement, requeueHeldStatement } from './deliver';

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

/** a destination as a list shows it: never its secret. */
export type ListedDestination = {
	readonly id: string;
	readonly url: string;
	readonly events: readonly WebhookEvent[];
	readonly paused: boolean;
};

/** every destination not deleted, in the order they were made. */
export async function listDestinations(db: Db): Promise<ListedDestination[]> {
	const [destinations, taken] = await db.batch([
		db
			.select({
				id: webhookDestination.id,
				url: webhookDestination.url,
				pausedAt: webhookDestination.pausedAt
			})
			.from(webhookDestination)
			.where(isNull(webhookDestination.archivedAt))
			.orderBy(asc(webhookDestination.createdAt), asc(webhookDestination.id)),
		db
			.select({
				destinationId: webhookDestinationEvent.destinationId,
				event: webhookDestinationEvent.event
			})
			.from(webhookDestinationEvent)
	]);
	return destinations.map((destination) => ({
		id: destination.id,
		url: destination.url,
		events: inCatalogOrder(
			taken.filter((row) => row.destinationId === destination.id).map((row) => row.event)
		),
		paused: destination.pausedAt !== null
	}));
}

/** `events` in the order the catalog lists them. */
function inCatalogOrder(events: readonly WebhookEvent[]): WebhookEvent[] {
	return WEBHOOK_EVENT_TYPES.filter((event) => events.includes(event));
}

/**
 * a destination as its own page shows it, secret and all: the one read that returns the secret,
 * for the one page a destination's owner copies it from. `held` is what a resume would send now.
 */
export type ReadDestination = ListedDestination & {
	readonly signingSecret: string;
	readonly held: number;
};

/** the destination `id`, or null where none has the id or it was deleted. */
export async function readDestination(db: Db, id: string): Promise<ReadDestination | null> {
	const [[destination], taken] = await db.batch([
		db
			.select({
				id: webhookDestination.id,
				url: webhookDestination.url,
				signingSecret: webhookDestination.signingSecret,
				pausedAt: webhookDestination.pausedAt
			})
			.from(webhookDestination)
			.where(and(eq(webhookDestination.id, id), isNull(webhookDestination.archivedAt))),
		db
			.select({ event: webhookDestinationEvent.event })
			.from(webhookDestinationEvent)
			.where(eq(webhookDestinationEvent.destinationId, id))
	]);
	if (destination === undefined) return null;
	return {
		id: destination.id,
		url: destination.url,
		events: inCatalogOrder(taken.map((row) => row.event)),
		paused: destination.pausedAt !== null,
		signingSecret: destination.signingSecret,
		held: destination.pausedAt === null ? 0 : await countHeld(db, id)
	};
}

/** a destination as it was made, with the secret its owner copies into the receiving system. */
export type CreatedDestination = {
	readonly id: string;
	readonly url: string;
	readonly events: readonly WebhookEvent[];
	readonly signingSecret: string;
};

/**
 * why an address was refused: `box` is what the URL box says under it, `detail` the sentence for a
 * reader who never saw the box.
 */
export type AddressRefusal = {
	readonly ok: false;
	readonly reason: 'not_https' | 'not_public';
	readonly box: string;
	readonly detail: string;
};

export type CreateDestinationResult =
	| { readonly ok: true; readonly destination: CreatedDestination }
	| AddressRefusal;

/**
 * a destination posting `events` to `url`, stored as the parsed address. an address that is not
 * https, or names a host the internet cannot reach (`destinationAddress`), is refused and nothing
 * is written.
 */
export async function createDestination(
	db: Db,
	input: { readonly url: string; readonly events: readonly WebhookEvent[] }
): Promise<CreateDestinationResult> {
	const url = destinationAddress(input.url);
	if (!url.ok) return url;

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

export type UpdateDestinationResult =
	| { readonly ok: true }
	| AddressRefusal
	| { readonly ok: false; readonly reason: 'not_found'; readonly detail: string };

/**
 * the destination `id` moved to `url` and set to take `events`, its signing secret kept. refused as
 * `createDestination` refuses an address, and as not found where no destination has the id or it
 * was deleted; nothing is written either way.
 *
 * **it reaches only events queued after it.** a row is queued for the destination when its event
 * happens (./events.ts), so rows already queued are sent whatever events it now takes, and each is
 * posted to the address the destination holds when that post is made (./deliver.ts).
 */
export async function updateDestination(
	db: Db,
	id: string,
	input: { readonly url: string; readonly events: readonly WebhookEvent[] }
): Promise<UpdateDestinationResult> {
	const url = destinationAddress(input.url);
	if (!url.ok) return url;

	const standing = and(eq(webhookDestination.id, id), isNull(webhookDestination.archivedAt));
	const [moved] = await db.batch([
		db
			.update(webhookDestination)
			.set({ url: url.href })
			.where(standing)
			.returning({ id: webhookDestination.id }),
		db
			.delete(webhookDestinationEvent)
			.where(
				and(
					eq(webhookDestinationEvent.destinationId, id),
					exists(db.select({ id: webhookDestination.id }).from(webhookDestination).where(standing))
				)
			),
		...[...new Set(input.events)].map((event) =>
			db.insert(webhookDestinationEvent).select(
				db
					.select({ destinationId: webhookDestination.id, event: sql`${event}`.as('event') })
					.from(webhookDestination)
					.where(standing)
			)
		)
	]);
	return moved.length > 0 ? { ok: true } : notFound(id);
}

export type DeleteDestinationResult =
	| { readonly ok: true; readonly url: string }
	| { readonly ok: false; readonly reason: 'not_found'; readonly detail: string };

/**
 * the destination `id` deleted at `now`, answered with the address it posted to: archived, owed
 * nothing new, and every row it was still owed dropped in the same batch (`dropOwedStatement` in
 * ./deliver.ts), so nothing waits on a destination nobody can resume. what it was sent is kept.
 */
export async function deleteDestination(
	db: Db,
	id: string,
	now: Date
): Promise<DeleteDestinationResult> {
	const [, [archived]] = await db.batch([
		dropOwedStatement(db, id, now),
		db
			.update(webhookDestination)
			.set({ archivedAt: now })
			.where(and(eq(webhookDestination.id, id), isNull(webhookDestination.archivedAt)))
			.returning({ url: webhookDestination.url })
	]);
	return archived === undefined ? notFound(id) : { ok: true, url: archived.url };
}

/** the refusal for an id no standing destination has. */
function notFound(id: string) {
	return { ok: false, reason: 'not_found', detail: `No destination has the id ${id}.` } as const;
}

/**
 * the address a destination is stored under, or why it may not be one. surrounding space is
 * dropped and an address typed with no scheme is taken as https.
 *
 * https only: every post carries donors' names and addresses. and a host the internet reaches: a
 * post goes out from this deployment's own network, so `localhost`, an IP literal in a loopback,
 * private, link-local or unique-local range, and a name under `.localhost`, `.local` or `.internal`
 * name either the machine sending or a network only it may see. an IP literal is read as the URL
 * parser normalizes it, so `0x7f000001` is refused as the 127.0.0.1 it is. a public name that
 * resolves to a private address is not caught here.
 */
function destinationAddress(
	typed: string
): { readonly ok: true; readonly href: string } | AddressRefusal {
	const trimmed = typed.trim();
	const url = URL.parse(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
	if (url === null || url.protocol !== 'https:' || url.hostname === '') {
		return {
			ok: false,
			reason: 'not_https',
			box: 'must start with https://',
			detail: `${typed} is not an https address. Give the full address the receiving system listens on, starting https://.`
		};
	}
	const why = unreachable(url.hostname);
	if (why !== null) {
		return {
			ok: false,
			reason: 'not_public',
			box: `must be reachable from the internet: ${why}`,
			detail: `${typed} is not an address this deployment may post to: ${why}. Give the address the receiving system answers on from the internet.`
		};
	}
	return { ok: true, href: url.href };
}

/** why `host` is one the internet cannot reach, as a clause naming it, or null for a public one. */
function unreachable(host: string): string | null {
	const name = host.endsWith('.') ? host.slice(0, -1) : host;
	if (name === 'localhost' || name.endsWith('.localhost')) {
		return `${host} names the machine the post is sent from`;
	}
	if (name.endsWith('.local')) return `${host} names a host on a local network`;
	if (name.endsWith('.internal')) return `${host} names a host on an internal network`;

	const range = host.startsWith('[') ? ipv6Range(host.slice(1, -1)) : ipv4Range(host);
	return range === null ? null : `${host} is ${range}`;
}

type Range =
	| 'a loopback address'
	| 'a private network address'
	| 'a link-local address'
	| 'a unique local address';

/** the reserved range a dotted-quad host is in; a name that is not four octets is in none. */
function ipv4Range(host: string): Range | null {
	const octets = host.split('.').map(Number);
	if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
		return null;
	}
	const [a = 0, b = 0] = octets;
	if (a === 127) return 'a loopback address';
	if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
		return 'a private network address';
	}
	if (a === 169 && b === 254) return 'a link-local address';
	return null;
}

/** the reserved range an IPv6 literal, as the URL parser compresses it, is in. */
function ipv6Range(literal: string): Range | null {
	const hextets = expandIpv6(literal);
	if (hextets === null) return null;
	if (hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1) return 'a loopback address';
	// ::ffff:a.b.c.d, the IPv4 address it maps.
	if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
		const [hi = 0, lo = 0] = hextets.slice(6);
		return ipv4Range(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
	}
	const first = hextets[0] ?? 0;
	if ((first & 0xffc0) === 0xfe80) return 'a link-local address';
	if ((first & 0xfe00) === 0xfc00) return 'a unique local address';
	return null;
}

/** the eight hextets of a compressed IPv6 literal with no embedded dotted quad. */
function expandIpv6(literal: string): number[] | null {
	const [head = '', tail, ...more] = literal.split('::');
	if (more.length > 0) return null;
	const part = (s: string) => (s === '' ? [] : s.split(':').map((h) => Number.parseInt(h, 16)));
	const front = part(head);
	const back = tail === undefined ? [] : part(tail);
	const gap = 8 - front.length - back.length;
	if (gap < 0 || (tail === undefined && gap !== 0)) return null;
	const all = [...front, ...Array<number>(gap).fill(0), ...back];
	return all.some(Number.isNaN) ? null : all;
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
 * resumes one re-queues and the other is refused. a deleted destination is not found: it is sent
 * nothing, so a row re-queued for it would wait forever.
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
			.where(
				and(
					eq(webhookDestination.id, id),
					isNotNull(webhookDestination.pausedAt),
					isNull(webhookDestination.archivedAt)
				)
			)
			.returning({ id: webhookDestination.id })
	]);
	if (resumed.length > 0) return { ok: true, requeued: requeued.length };

	const [found] = await db
		.select({ id: webhookDestination.id })
		.from(webhookDestination)
		.where(and(eq(webhookDestination.id, id), isNull(webhookDestination.archivedAt)));
	return found === undefined
		? notFound(id)
		: {
				ok: false,
				reason: 'not_paused',
				detail: `The destination ${id} is not paused, so there is nothing to resume.`
			};
}
