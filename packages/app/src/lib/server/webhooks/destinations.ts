import { and, asc, eq, exists, isNotNull, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Db } from '../db/client';
import { webhookDestination, webhookDestinationEvent } from '../db/schema';
import { WEBHOOK_EVENT_TYPES, type WebhookEvent } from '../../webhooks/catalog';
import { NO_EVENTS } from '../../webhooks/destination-input';
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

/**
 * what a post to the destination `id` needs, its address and its secret, or null where none has
 * the id or it was deleted.
 */
export async function readPostTarget(
	db: Db,
	id: string
): Promise<{ readonly url: string; readonly signingSecret: string } | null> {
	const [target] = await db
		.select({ url: webhookDestination.url, signingSecret: webhookDestination.signingSecret })
		.from(webhookDestination)
		.where(and(eq(webhookDestination.id, id), isNull(webhookDestination.archivedAt)));
	return target ?? null;
}

/** a destination as it was made, with the secret its owner copies into the receiving system. */
export type CreatedDestination = {
	readonly id: string;
	readonly url: string;
	readonly events: readonly WebhookEvent[];
	readonly signingSecret: string;
};

/**
 * why a destination was refused: `field` is the box the refusal belongs under, and `box` what that
 * box says.
 */
export type DestinationRefusal = {
	readonly ok: false;
	readonly reason: 'not_an_address' | 'not_https' | 'not_public' | 'no_events';
	readonly field: 'url' | 'events';
	readonly box: string;
};

export type CreateDestinationResult =
	| { readonly ok: true; readonly destination: CreatedDestination }
	| DestinationRefusal;

/**
 * a destination posting `events` to `url`, stored as the parsed address. an address that is not
 * https, or names a host the internet cannot reach (`destinationAddress`), or no events, is
 * refused and nothing is written.
 */
export async function createDestination(
	db: Db,
	input: { readonly url: string; readonly events: readonly WebhookEvent[] }
): Promise<CreateDestinationResult> {
	const url = destinationAddress(input.url);
	if (!url.ok) return url;
	if (input.events.length === 0) return NO_EVENTS_REFUSAL;

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
	| DestinationRefusal
	| { readonly ok: false; readonly reason: 'not_found'; readonly detail: string };

/**
 * the destination `id` moved to `url` and set to take `events`, its signing secret kept. refused as
 * `createDestination` refuses an address or no events, and as not found where no destination has
 * the id or it was deleted; nothing is written either way.
 *
 * **it reaches only events queued after it.** a row is queued for the destination when its event
 * happens (./events.ts), so rows already queued are sent whatever events it now takes, and each is
 * posted to the address the destination holds when a delivery run claims it: a run already
 * holding rows posts them to the address it read (./deliver.ts's header).
 */
export async function updateDestination(
	db: Db,
	id: string,
	input: { readonly url: string; readonly events: readonly WebhookEvent[] }
): Promise<UpdateDestinationResult> {
	const url = destinationAddress(input.url);
	if (!url.ok) return url;
	if (input.events.length === 0) return NO_EVENTS_REFUSAL;

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
 * nothing new, and every row it was still owed that no delivery run holds dropped in the same batch
 * (`dropOwedStatement` in ./deliver.ts), so nothing waits on a destination nobody can resume. a
 * run already holding rows finishes their posts. what it was sent is kept.
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

const NO_EVENTS_REFUSAL = {
	ok: false,
	reason: 'no_events',
	field: 'events',
	box: NO_EVENTS
} as const satisfies DestinationRefusal;

/** the refusal for an id no standing destination has. */
function notFound(id: string) {
	return { ok: false, reason: 'not_found', detail: `No destination has the id ${id}.` } as const;
}

/**
 * the address a destination is stored under, or why it may not be one. surrounding space is
 * dropped, and an address typed with no scheme — nothing before a colon but a host, or a host and
 * its port — is taken as https.
 *
 * https only: every post carries donors' names and addresses. and a host the internet reaches: a
 * post goes out from this deployment's own network, so a name with no domain, `localhost`, a name
 * under `.localhost`, `.local`, `.internal` or `.home.arpa`, and an IP literal in any range that
 * is not a public unicast one (`ipv4Range`, `ipv6Range`) name either the machine sending or a
 * network only it may see. an IP literal is read as the URL parser normalizes it, so `0x7f000001`
 * is refused as the 127.0.0.1 it is. a public name that resolves to a private address is not caught
 * here.
 */
function destinationAddress(
	typed: string
): { readonly ok: true; readonly href: string } | DestinationRefusal {
	const trimmed = typed.trim();
	const url = URL.parse(/^[a-z][a-z\d+.-]*:(?!\d)/i.test(trimmed) ? trimmed : `https://${trimmed}`);
	if (url === null || url.hostname === '') {
		return {
			ok: false,
			reason: 'not_an_address',
			field: 'url',
			box: 'isn’t a web address: check it for a space or a stray character'
		};
	}
	if (url.protocol !== 'https:') {
		return { ok: false, reason: 'not_https', field: 'url', box: 'must start with https://' };
	}
	const why = unreachable(url.hostname);
	if (why !== null) {
		return {
			ok: false,
			reason: 'not_public',
			field: 'url',
			box: `must be reachable from the internet: ${why}`
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
	if (name.endsWith('.home.arpa')) return `${host} names a host on a home network`;

	if (host.startsWith('[')) {
		const range = ipv6Range(host.slice(1, -1));
		return range === null ? null : `${host} is ${range}`;
	}
	const range = ipv4Range(host);
	if (range !== null) return `${host} is ${range}`;
	if (!name.includes('.') && !isIpv4(host)) {
		return `${host} names no host on the internet: it has no domain`;
	}
	return null;
}

type Range =
	| 'an address on no network'
	| 'a loopback address'
	| 'a private network address'
	| 'a carrier-grade NAT address'
	| 'a link-local address'
	| 'a benchmarking address'
	| 'a multicast or reserved address'
	| 'a unique local address'
	| 'a site-local address'
	| 'an IPv4-compatible address'
	| 'an IPv4-translated address'
	| 'a NAT64 address'
	| 'a 6to4 address';

/** the four octets of a dotted-quad host, or null for a name that is not one. */
function octetsOf(host: string): number[] | null {
	const octets = host.split('.').map(Number);
	return octets.length === 4 && octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255)
		? octets
		: null;
}

const isIpv4 = (host: string) => octetsOf(host) !== null;

/** the range a dotted-quad host is in where it is no public unicast address; a name is in none. */
function ipv4Range(host: string): Range | null {
	const octets = octetsOf(host);
	if (octets === null) return null;
	const [a = 0, b = 0] = octets;
	if (a === 0) return 'an address on no network';
	if (a === 127) return 'a loopback address';
	if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
		return 'a private network address';
	}
	if (a === 100 && b >= 64 && b <= 127) return 'a carrier-grade NAT address';
	if (a === 169 && b === 254) return 'a link-local address';
	if (a === 198 && (b === 18 || b === 19)) return 'a benchmarking address';
	if (a >= 224) return 'a multicast or reserved address';
	return null;
}

/**
 * the range an IPv6 literal, as the URL parser compresses it, is in where it is no public unicast
 * address. the forms that carry an IPv4 address are refused whole, whatever the address they carry,
 * but for `::ffff:a.b.c.d`, which is read as the address it maps.
 */
function ipv6Range(literal: string): Range | null {
	const hextets = expandIpv6(literal);
	if (hextets === null) return null;
	const [first = 0, second = 0] = hextets;
	const zeroes = (from: number, to: number) => hextets.slice(from, to).every((h) => h === 0);
	if (zeroes(0, 8)) return 'an address on no network';
	if (zeroes(0, 7) && hextets[7] === 1) return 'a loopback address';
	if (zeroes(0, 6)) return 'an IPv4-compatible address';
	if (zeroes(0, 5) && hextets[5] === 0xffff) {
		const [hi = 0, lo = 0] = hextets.slice(6);
		return ipv4Range(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
	}
	if (zeroes(0, 4) && hextets[4] === 0xffff && hextets[5] === 0) {
		return 'an IPv4-translated address';
	}
	if (first === 0x64 && second === 0xff9b && zeroes(2, 6)) return 'a NAT64 address';
	if (first === 0x2002) return 'a 6to4 address';
	if ((first & 0xffc0) === 0xfe80) return 'a link-local address';
	if ((first & 0xffc0) === 0xfec0) return 'a site-local address';
	if ((first & 0xfe00) === 0xfc00) return 'a unique local address';
	if ((first & 0xff00) === 0xff00) return 'a multicast or reserved address';
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
