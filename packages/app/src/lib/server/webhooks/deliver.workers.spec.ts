import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '../db/client';
import { contact, dispute, donation, payment } from '../db/schema';
import { parseContact } from '../contacts/contact-input';
import { commitDonor } from '../donations/donor';
import { readGiftPage, readGifts } from '../integrations/gift';
import type { WebhookEvent } from '../../webhooks/catalog';
import { sendDueWebhooks, WEBHOOK_RETRY_SCHEDULE_MS } from './deliver';
import { createDestination } from './destinations';
import { stopRecurringPlan } from '../recurring/queries';
import {
	disputeOpenedWebhookStatements,
	giftRefundedWebhookStatements,
	recurringGiftStartedWebhookStatements,
	webhookStatements
} from './events';

// the delivery run against a real D1, with each destination answered by a `fetch` written here.
//
// every gift is settled through `webhookStatements`, the statement the money path splices in, so
// the rows a run reads are the rows production writes. the clock is faked for `Date` alone: a run
// is handed its scheduled time the way the cron hands it `scheduledTime`, and the wall clock is set
// to the same moment, since the lease and the attempt's `webhook-timestamp` read it.
//
// a post is verified here by the Standard Webhooks algorithm as the spec states it
// (https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md,
// "Signature scheme" and "Verifying signatures"), written without ./sign.ts.

let db: Db;
beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	for (const table of [
		'webhook_delivery',
		'webhook_destination_event',
		'webhook_destination',
		'payment',
		'donation',
		'recurring_plan',
		'contact',
		'form'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(START);
});

afterEach(() => {
	vi.useRealTimers();
});

const START = new Date('2026-09-28T12:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** a run scheduled at `at`, with the wall clock there too. */
async function runAt(at: Date, fetch: typeof globalThis.fetch): Promise<void> {
	vi.setSystemTime(at);
	await sendDueWebhooks({ db, fetch }, at);
}

let made = 0;

async function destination() {
	made += 1;
	const created = await createDestination(db, {
		url: `https://crm.example.org/hooks/${made}`,
		events: ['gift.made']
	});
	if (!created.ok) throw new Error(created.detail);
	return created.destination;
}

/** a $50 gift from Ada Okafor, settled with its fan-out the way every caller commits one. */
async function settle(): Promise<string> {
	const contactId = uuidv7();
	const donationId = uuidv7();
	const paymentId = uuidv7();
	const at = new Date('2026-09-10T12:00:00.000Z');
	await db.batch([
		db.insert(contact).values({
			id: contactId,
			kind: 'individual',
			displayName: 'Ada Okafor',
			primaryEmail: 'ada@example.org'
		}),
		db
			.insert(donation)
			.values({ id: donationId, contactId, totalMinor: 5_000, currency: 'USD', receivedAt: at }),
		db.insert(payment).values({
			id: paymentId,
			donationId,
			amountMinor: 5_000,
			currency: 'USD',
			direction: 'inbound',
			method: 'check',
			status: 'succeeded',
			provider: 'manual',
			occurredAt: at
		}),
		...webhookStatements(db, { paymentId, contactId })
	]);
	return paymentId;
}

type Post = {
	readonly url: string;
	readonly headers: Headers;
	readonly body: string;
	readonly redirect: RequestRedirect | undefined;
	readonly signal: AbortSignal | null | undefined;
};

/** a `fetch` standing in for the receivers: each post recorded, and answered by `answer`. */
function receivers(answer: (post: Post) => Response | Error = () => new Response('ok')) {
	const posts: Post[] = [];
	const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const post = {
			url: String(input),
			headers: new Headers(init?.headers),
			body: String(init?.body),
			redirect: init?.redirect,
			signal: init?.signal
		};
		posts.push(post);
		const answered = answer(post);
		if (answered instanceof Error) throw answered;
		return answered;
	}) as typeof globalThis.fetch;
	return { fetch, posts };
}

/** the spec's verification, with its five-minute window around `now`. */
async function verifies(secret: string, post: Post, now: Date): Promise<boolean> {
	const id = post.headers.get('webhook-id');
	const timestamp = post.headers.get('webhook-timestamp');
	const signatures = post.headers.get('webhook-signature');
	if (id === null || timestamp === null || signatures === null) return false;
	if (Math.abs(now.getTime() / 1_000 - Number(timestamp)) > 5 * 60) return false;
	const keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
	const key = await crypto.subtle.importKey(
		'raw',
		keyBytes,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify']
	);
	for (const versioned of signatures.split(' ')) {
		const [version, signature] = versioned.split(',');
		if (version !== 'v1' || signature === undefined) continue;
		const mac = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
		const content = new TextEncoder().encode(`${id}.${timestamp}.${post.body}`);
		if (await crypto.subtle.verify('HMAC', key, mac, content)) return true;
	}
	return false;
}

async function rows() {
	const { results } = await env.DB.prepare(
		`select id, status, attempts, next_attempt_at, leased_until, last_status, last_error,
		        delivered_at
		 from webhook_delivery order by destination_id`
	).all<{
		id: string;
		status: string;
		attempts: number;
		next_attempt_at: number;
		leased_until: number | null;
		last_status: number | null;
		last_error: string | null;
		delivered_at: number | null;
	}>();
	return results;
}

describe('sendDueWebhooks() — a gift made', () => {
	it('posts it to the destination signed, and records it delivered with the status and time', async () => {
		const target = await destination();
		const paymentId = await settle();
		const [owed] = await rows();
		const receiving = receivers(() => new Response('thanks', { status: 202 }));

		await runAt(START, receiving.fetch);

		expect(receiving.posts).toHaveLength(1);
		const [post] = receiving.posts;
		if (post === undefined) return;
		expect(post.url).toBe(target.url);
		expect(post.headers.get('content-type')).toBe('application/json');
		expect(post.headers.get('webhook-id')).toBe(owed?.id);
		expect(post.headers.get('webhook-timestamp')).toBe(String(START.getTime() / 1_000));
		expect(await verifies(target.signingSecret, post, START)).toBe(true);
		expect(JSON.parse(post.body)).toEqual({
			type: 'gift.made',
			timestamp: START.toISOString(),
			data: expect.objectContaining({
				id: paymentId,
				amount: '50.00',
				donor_name: 'Ada Okafor',
				donor_email: 'ada@example.org',
				status: 'settled'
			})
		});
		expect(await rows()).toEqual([
			expect.objectContaining({
				status: 'delivered',
				attempts: 1,
				leased_until: null,
				last_status: 202,
				last_error: null,
				delivered_at: START.getTime()
			})
		]);
	});

	it('carries the gift exactly as the read API answers it', async () => {
		await destination();
		await settle();
		const receiving = receivers();

		await runAt(START, receiving.fetch);

		const {
			rows: [gift]
		} = await readGiftPage(db, { order: 'newest', limit: 1, after: null });
		expect(JSON.parse(receiving.posts[0]?.body ?? '{}').data).toEqual(gift);
	});

	it('does not verify against another destination’s secret', async () => {
		await destination();
		const other = await destination();
		await settle();
		const receiving = receivers();

		await runAt(START, receiving.fetch);

		const toFirst = receiving.posts.find((post) => post.url !== other.url);
		if (toFirst === undefined) throw new Error('nothing was posted to the first destination');
		expect(await verifies(other.signingSecret, toFirst, START)).toBe(false);
	});

	it('posts a delivered row no second time', async () => {
		await destination();
		await settle();
		const receiving = receivers();

		await runAt(START, receiving.fetch);
		await runAt(new Date(START.getTime() + 25 * HOUR), receiving.fetch);

		expect(receiving.posts).toHaveLength(1);
	});
});

describe('sendDueWebhooks() — a post that fails', () => {
	it('waits out the published schedule, one step per failed post, and gives up after the last', async () => {
		await destination();
		await settle();
		const receiving = receivers(() => new Response('down for maintenance', { status: 503 }));

		let at = START;
		const waits: number[] = [];
		for (;;) {
			await runAt(at, receiving.fetch);
			const [row] = await rows();
			if (row?.status !== 'pending') break;
			waits.push(row.next_attempt_at - at.getTime());
			at = new Date(row.next_attempt_at);
		}

		expect(waits).toEqual([
			MINUTE,
			5 * MINUTE,
			30 * MINUTE,
			2 * HOUR,
			5 * HOUR,
			10 * HOUR,
			10 * HOUR,
			24 * HOUR
		]);
		expect(WEBHOOK_RETRY_SCHEDULE_MS).toEqual(waits);
		expect(receiving.posts).toHaveLength(9);
		expect(await rows()).toEqual([
			expect.objectContaining({
				status: 'failed',
				attempts: 9,
				leased_until: null,
				last_status: 503,
				last_error: '503 Service Unavailable — down for maintenance',
				delivered_at: null
			})
		]);
	});

	it('posts nothing before the next step is due', async () => {
		await destination();
		await settle();
		const receiving = receivers(() => new Response('no', { status: 500 }));

		await runAt(START, receiving.fetch);
		await runAt(new Date(START.getTime() + MINUTE - 1_000), receiving.fetch);

		expect(receiving.posts).toHaveLength(1);
	});

	it('retries with the same webhook-id and a fresh timestamp and signature, each verifying', async () => {
		const target = await destination();
		await settle();
		let calls = 0;
		const receiving = receivers(() => {
			calls += 1;
			return new Response('', { status: calls === 1 ? 500 : 200 });
		});

		await runAt(START, receiving.fetch);
		const retryAt = new Date(START.getTime() + MINUTE);
		await runAt(retryAt, receiving.fetch);

		const [first, retry] = receiving.posts;
		if (first === undefined || retry === undefined) throw new Error('expected two posts');
		expect(retry.headers.get('webhook-id')).toBe(first.headers.get('webhook-id'));
		expect(retry.body).toBe(first.body);
		expect(retry.headers.get('webhook-timestamp')).toBe(String(retryAt.getTime() / 1_000));
		expect(retry.headers.get('webhook-signature')).not.toBe(first.headers.get('webhook-signature'));
		expect(await verifies(target.signingSecret, first, START)).toBe(true);
		expect(await verifies(target.signingSecret, retry, retryAt)).toBe(true);
		expect(await rows()).toEqual([
			expect.objectContaining({ status: 'delivered', attempts: 2, last_status: 200 })
		]);
	});

	// the stand-in never hangs; what bounds a receiver that does is the signal every post carries.
	it('hands every post a signal that ends it, so a receiver that never answers is a timeout', async () => {
		await destination();
		await settle();
		const receiving = receivers();

		await runAt(START, receiving.fetch);

		expect(receiving.posts[0]?.signal).toBeInstanceOf(AbortSignal);
	});

	it('keeps the status of a refusal whose body breaks off mid-read', async () => {
		await destination();
		await settle();
		let pulls = 0;
		const broken = () =>
			new Response(
				new ReadableStream<Uint8Array>({
					pull(controller) {
						pulls += 1;
						if (pulls === 1) controller.enqueue(new TextEncoder().encode('upstream'));
						else controller.error(new TypeError('Network connection lost.'));
					}
				}),
				{ status: 502 }
			);

		await runAt(START, receivers(broken).fetch);

		expect(await rows()).toEqual([
			expect.objectContaining({
				status: 'pending',
				last_status: 502,
				last_error: '502 Bad Gateway — upstream'
			})
		]);
	});

	it.each([
		['a network fault', new TypeError('Network connection lost.')],
		['a timeout', new DOMException('The operation was aborted due to timeout', 'TimeoutError')]
	])('counts %s as a failed post with no status', async (_, fault) => {
		await destination();
		await settle();

		await runAt(START, receivers(() => fault).fetch);

		expect(await rows()).toEqual([
			expect.objectContaining({
				status: 'pending',
				attempts: 1,
				next_attempt_at: START.getTime() + MINUTE,
				last_status: null,
				last_error: String(fault)
			})
		]);
	});

	// the stand-in answers the 307 itself; what the runtime's `fetch` would do with one is its
	// `redirect` mode, and `manual` hands the 307 back rather than following it.
	it('follows no redirect and counts it a failed post', async () => {
		await destination();
		await settle();
		const receiving = receivers(
			() => new Response(null, { status: 307, headers: { location: 'https://elsewhere.example/' } })
		);

		await runAt(START, receiving.fetch);

		expect(receiving.posts.map((post) => post.redirect)).toEqual(['manual']);
		expect(await rows()).toEqual([
			expect.objectContaining({ status: 'pending', last_status: 307 })
		]);
	});

	it('marks when the destination began failing, and clears it on the post it next takes', async () => {
		const target = await destination();
		await settle();
		let calls = 0;
		const receiving = receivers(() => {
			calls += 1;
			return new Response('', { status: calls === 1 ? 500 : 200 });
		});
		const failingSince = async () =>
			(
				await env.DB.prepare('select failing_since from webhook_destination where id = ?')
					.bind(target.id)
					.first<{ failing_since: number | null }>()
			)?.failing_since;

		await runAt(START, receiving.fetch);
		expect(await failingSince()).toBe(START.getTime());

		await runAt(new Date(START.getTime() + MINUTE), receiving.fetch);
		expect(await failingSince()).toBeNull();
	});
});

describe('sendDueWebhooks() — lanes', () => {
	it('posts to at most two destinations at once, and to every one of them', async () => {
		for (let made = 0; made < 7; made++) await destination();
		await settle();
		let inFlight = 0;
		let most = 0;
		const receiving = receivers(() => new Response('ok'));
		const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
			inFlight += 1;
			most = Math.max(most, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight -= 1;
			return receiving.fetch(input, init);
		}) as typeof fetch;

		await runAt(START, slow);

		expect(most).toBe(2);
		expect(new Set(receiving.posts.map((post) => post.url)).size).toBe(7);
	});
});

describe('sendDueWebhooks() — what is not sent', () => {
	it('sends a paused destination nothing, and leaves its rows owed', async () => {
		const target = await destination();
		await settle();
		await env.DB.prepare('update webhook_destination set paused_at = 1 where id = ?')
			.bind(target.id)
			.run();
		const receiving = receivers();

		await runAt(START, receiving.fetch);

		expect(receiving.posts).toEqual([]);
		expect(await rows()).toEqual([
			expect.objectContaining({ status: 'pending', attempts: 0, leased_until: null })
		]);
	});

	it('fails a row whose gift cannot be read, unposted, and says why', async () => {
		await destination();
		const paymentId = await settle();
		await env.DB.prepare(`update payment set status = 'failed' where id = ?`).bind(paymentId).run();
		const receiving = receivers();

		await runAt(START, receiving.fetch);

		expect(receiving.posts).toEqual([]);
		expect(await rows()).toEqual([
			expect.objectContaining({
				status: 'failed',
				attempts: 0,
				last_error: `The settled gift ${paymentId} this event was queued for could not be read.`
			})
		]);
	});
});

describe('sendDueWebhooks() — a gift refunded and a dispute opened', () => {
	afterEach(async () => {
		await env.DB.prepare('delete from dispute').run();
	});

	async function listening(events: readonly WebhookEvent[]) {
		const created = await createDestination(db, {
			url: `https://crm.example.org/hooks/${uuidv7()}`,
			events
		});
		if (!created.ok) throw new Error(created.detail);
		return created.destination;
	}

	const WITHDRAWN_AT = new Date('2026-09-15T08:00:00.000Z');
	const RESPOND_BY = new Date('2026-10-01T23:59:59.000Z');

	/**
	 * $20 of the settled gift `giftId` back, as a refund or as a dispute (`open` or `lost`), and what
	 * that owes each destination, in one batch the way ../books/writes.ts splices it.
	 */
	async function withdraw(
		giftId: string,
		as: { readonly dispute?: 'open' | 'lost' } = {}
	): Promise<string> {
		const [gift] = await db.select().from(payment).where(eq(payment.id, giftId));
		if (gift === undefined) throw new Error('no gift to withdraw from');
		const refundId = uuidv7();
		await db.batch([
			db.insert(payment).values({
				id: refundId,
				donationId: gift.donationId,
				amountMinor: 2_000,
				currency: 'USD',
				direction: 'refund',
				method: 'check',
				status: 'succeeded',
				provider: 'manual',
				occurredAt: WITHDRAWN_AT,
				parentPaymentId: giftId
			}),
			...(as.dispute === undefined
				? []
				: [
						db.insert(dispute).values({
							paymentId: refundId,
							respondBy: RESPOND_BY,
							reason: 'fraudulent',
							...(as.dispute === 'lost' ? { outcome: 'lost', closedAt: WITHDRAWN_AT } : {})
						})
					]),
			as.dispute === 'open'
				? disputeOpenedWebhookStatements(db, refundId)
				: giftRefundedWebhookStatements(db, refundId)
		]);
		return refundId;
	}

	it('posts a refund signed, as the refund and the gift as the read API answers it now', async () => {
		const target = await listening(['gift.refunded']);
		const giftId = await settle();
		const refundId = await withdraw(giftId);
		const receiving = receivers();

		await runAt(START, receiving.fetch);

		const gift = (await readGifts(db, [giftId])).get(giftId);
		expect(gift).toMatchObject({ status: 'partially_refunded', amount_refunded_minor: 2_000 });
		const [post] = receiving.posts;
		expect(post?.url).toBe(target.url);
		if (post === undefined) return;
		expect(await verifies(target.signingSecret, post, START)).toBe(true);
		expect(JSON.parse(post.body)).toEqual({
			type: 'gift.refunded',
			timestamp: START.toISOString(),
			data: {
				id: refundId,
				occurred_at: WITHDRAWN_AT.toISOString(),
				amount: '20.00',
				amount_minor: 2_000,
				currency: 'USD',
				source: 'refund',
				gift
			}
		});
		expect(await rows()).toEqual([expect.objectContaining({ status: 'delivered' })]);
	});

	it('names a lost dispute’s withdrawal as a dispute', async () => {
		await listening(['gift.refunded']);
		await withdraw(await settle(), { dispute: 'lost' });
		const receiving = receivers();

		await runAt(START, receiving.fetch);

		expect(JSON.parse(receiving.posts[0]?.body ?? '{}').data.source).toBe('dispute');
	});

	it('posts a dispute opened as its withdrawal, its respond-by, and the gift', async () => {
		const target = await listening(['gift.dispute_opened']);
		const giftId = await settle();
		const withdrawalId = await withdraw(giftId, { dispute: 'open' });
		const receiving = receivers();

		await runAt(START, receiving.fetch);

		const gift = (await readGifts(db, [giftId])).get(giftId);
		expect(gift).toMatchObject({ dispute_open: true });
		expect(receiving.posts.map((post) => post.url)).toEqual([target.url]);
		expect(JSON.parse(receiving.posts[0]?.body ?? '{}')).toEqual({
			type: 'gift.dispute_opened',
			timestamp: START.toISOString(),
			data: {
				id: withdrawalId,
				opened_at: WITHDRAWN_AT.toISOString(),
				amount: '20.00',
				amount_minor: 2_000,
				currency: 'USD',
				respond_by: RESPOND_BY.toISOString(),
				gift
			}
		});
	});

	it('answers a respond-by the processor never named with null', async () => {
		await listening(['gift.dispute_opened']);
		const withdrawalId = await withdraw(await settle(), { dispute: 'open' });
		await db.update(dispute).set({ respondBy: null }).where(eq(dispute.paymentId, withdrawalId));
		const receiving = receivers();

		await runAt(START, receiving.fetch);

		expect(JSON.parse(receiving.posts[0]?.body ?? '{}').data.respond_by).toBeNull();
	});

	it('fails a refund that stopped standing after it was queued, unposted, and says why', async () => {
		await listening(['gift.refunded']);
		const refundId = await withdraw(await settle());
		await db.update(payment).set({ status: 'cancelled' }).where(eq(payment.id, refundId));
		const receiving = receivers();

		await runAt(START, receiving.fetch);

		expect(receiving.posts).toEqual([]);
		expect(await rows()).toEqual([
			expect.objectContaining({
				status: 'failed',
				attempts: 0,
				last_status: null,
				last_error:
					'The refund this event was queued for no longer stands: it failed, or its dispute no longer reads as lost. It was not sent.'
			})
		]);
	});

	it('fails a row whose refund cannot be read, unposted, and says why', async () => {
		await listening(['gift.refunded']);
		const refundId = await withdraw(await settle());
		await db.delete(payment).where(eq(payment.id, refundId));
		const receiving = receivers();

		await runAt(START, receiving.fetch);

		expect(receiving.posts).toEqual([]);
		expect(await rows()).toEqual([
			expect.objectContaining({
				status: 'failed',
				last_error: `The refund ${refundId} this event was queued for could not be read.`
			})
		]);
	});
});

describe('sendDueWebhooks() — a donor added and a donor updated', () => {
	async function listening(events: readonly WebhookEvent[]) {
		const created = await createDestination(db, {
			url: `https://crm.example.org/hooks/${uuidv7()}`,
			events
		});
		if (!created.ok) throw new Error(created.detail);
		return created.destination;
	}

	async function donorOf(paymentId: string): Promise<string> {
		const [row] = await db
			.select({ contactId: donation.contactId })
			.from(donation)
			.innerJoin(payment, eq(payment.donationId, donation.id))
			.where(eq(payment.id, paymentId));
		if (row === undefined) throw new Error('no donor for that gift');
		return row.contactId;
	}

	it('posts a donor added signed, as the read API’s donor and their first gift', async () => {
		const target = await listening(['donor.added']);
		const giftId = await settle();
		const donorId = await donorOf(giftId);
		const receiving = receivers();

		await runAt(START, receiving.fetch);

		const [post] = receiving.posts;
		expect(receiving.posts.map((p) => p.url)).toEqual([target.url]);
		if (post === undefined) return;
		expect(await verifies(target.signingSecret, post, START)).toBe(true);
		expect(JSON.parse(post.body)).toEqual({
			type: 'donor.added',
			timestamp: START.toISOString(),
			data: {
				id: donorId,
				name: 'Ada Okafor',
				email: 'ada@example.org',
				consent: 'unasked',
				created_at: START.toISOString(),
				updated_at: START.toISOString(),
				first_gift: (await readGifts(db, [giftId])).get(giftId)
			}
		});
		expect(await rows()).toEqual([expect.objectContaining({ status: 'delivered' })]);
	});

	it('posts a donor updated signed, as the donor stands at send', async () => {
		const target = await listening(['donor.updated']);
		const donorId = await donorOf(await settle());
		const CHANGED = new Date(START.getTime() + MINUTE);
		vi.setSystemTime(CHANGED);
		const returning = parseContact({
			kind: 'individual',
			first_name: 'Ada',
			last_name: 'Okafor',
			primary_email: 'ada@example.org'
		});
		if (!returning.ok) throw new Error('the fixture donor does not parse');
		await commitDonor(db, returning.value, true);
		const receiving = receivers();

		await runAt(new Date(CHANGED.getTime() + MINUTE), receiving.fetch);

		const [post] = receiving.posts;
		expect(receiving.posts.map((p) => p.url)).toEqual([target.url]);
		if (post === undefined) return;
		expect(await verifies(target.signingSecret, post, new Date(CHANGED.getTime() + MINUTE))).toBe(
			true
		);
		expect(JSON.parse(post.body)).toEqual({
			type: 'donor.updated',
			timestamp: CHANGED.toISOString(),
			data: {
				id: donorId,
				name: 'Ada Okafor',
				email: 'ada@example.org',
				consent: 'agreed',
				created_at: START.toISOString(),
				updated_at: CHANGED.toISOString()
			}
		});
	});

	it('fails a donor row whose donor cannot be read, unposted, and says why', async () => {
		await listening(['donor.added']);
		const giftId = await settle();
		const donorId = await donorOf(giftId);
		await env.DB.prepare('update webhook_delivery set subject_id = ?').bind(uuidv7()).run();
		const receiving = receivers();

		await runAt(START, receiving.fetch);

		expect(receiving.posts).toEqual([]);
		const [row] = await rows();
		expect(row).toMatchObject({ status: 'failed', attempts: 0 });
		expect(row?.last_error).toMatch(
			/^The donor [0-9a-f-]{36} this event was queued for could not be read\.$/
		);
		expect(row?.last_error).not.toContain(donorId);
	});
});

describe('sendDueWebhooks() — a recurring gift started and a recurring gift ended', () => {
	const DONOR_ID = '019fb900-0000-7000-8000-000000000001';
	const PLAN_ID = '019fb900-0000-7000-8000-000000000002';

	async function listening(events: readonly WebhookEvent[]) {
		const created = await createDestination(db, {
			url: `https://crm.example.org/hooks/${uuidv7()}`,
			events
		});
		if (!created.ok) throw new Error(created.detail);
		return created.destination;
	}

	/** a $25 monthly commitment from Ada Okafor, opened with the rows it owes. */
	async function open(): Promise<void> {
		const account = await env.DB.prepare(
			`select id from account where is_postable = 1 and code = '4110'`
		).first<{ id: string }>();
		await env.DB.batch([
			env.DB.prepare(
				`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
				                   suggested_amounts, allowed_origins, created_at, updated_at)
				 values ('frm_webhookplan1', 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
			).bind(account?.id),
			env.DB.prepare(
				`insert into contact (id, kind, display_name, created_at, updated_at)
				 values (?, 'individual', 'Ada Okafor', 0, 0)`
			).bind(DONOR_ID)
		]);
		await env.DB.prepare(
			`insert into recurring_plan (id, contact_id, form_id, amount_minor, currency, interval,
			                             status, provider, provider_subscription_id,
			                             provider_customer_id, started_at, next_charge_at, ended_at,
			                             created_at, updated_at)
			 values (?, ?, 'frm_webhookplan1', 2500, 'USD', 'monthly', 'active', 'stripe',
			         'sub_webhook1', 'cus_webhook1', ?, ?, null, ?, ?)`
		)
			.bind(
				PLAN_ID,
				DONOR_ID,
				Date.parse('2026-09-03T12:00:00.000Z'),
				Date.parse('2026-10-03T12:00:00.000Z'),
				START.getTime(),
				START.getTime()
			)
			.run();
		await db.batch(recurringGiftStartedWebhookStatements(db, { id: PLAN_ID, status: 'active' }));
	}

	it('posts a recurring gift started signed, as the read API’s recurring gift', async () => {
		const target = await listening(['recurring_gift.started']);
		await open();
		const receiving = receivers();

		await runAt(START, receiving.fetch);

		const [post] = receiving.posts;
		expect(receiving.posts.map((p) => p.url)).toEqual([target.url]);
		if (post === undefined) return;
		expect(await verifies(target.signingSecret, post, START)).toBe(true);
		expect(JSON.parse(post.body)).toEqual({
			type: 'recurring_gift.started',
			timestamp: START.toISOString(),
			data: {
				id: PLAN_ID,
				donor_id: DONOR_ID,
				amount: '25.00',
				amount_minor: 2500,
				currency: 'USD',
				frequency: 'monthly',
				status: 'active',
				next_charge_at: '2026-10-03T12:00:00.000Z',
				started_at: '2026-09-03T12:00:00.000Z',
				updated_at: START.toISOString()
			}
		});
		expect(await rows()).toEqual([expect.objectContaining({ status: 'delivered' })]);
	});

	it('posts a recurring gift ended as the recurring gift stands at send', async () => {
		const target = await listening(['recurring_gift.ended']);
		await open();
		const STOPPED = new Date(START.getTime() + MINUTE);
		vi.setSystemTime(STOPPED);
		await stopRecurringPlan(db, PLAN_ID, STOPPED);
		const receiving = receivers();

		await runAt(new Date(STOPPED.getTime() + MINUTE), receiving.fetch);

		const [post] = receiving.posts;
		expect(receiving.posts.map((p) => p.url)).toEqual([target.url]);
		if (post === undefined) return;
		expect(JSON.parse(post.body)).toEqual({
			type: 'recurring_gift.ended',
			timestamp: STOPPED.toISOString(),
			data: expect.objectContaining({
				id: PLAN_ID,
				status: 'stopped',
				next_charge_at: null,
				updated_at: STOPPED.toISOString()
			})
		});
	});

	it('fails a row whose recurring gift cannot be read, unposted, and says why', async () => {
		await listening(['recurring_gift.started']);
		await open();
		await env.DB.prepare('update webhook_delivery set subject_id = ?').bind(uuidv7()).run();
		const receiving = receivers();

		await runAt(START, receiving.fetch);

		expect(receiving.posts).toEqual([]);
		const [row] = await rows();
		expect(row).toMatchObject({ status: 'failed', attempts: 0 });
		expect(row?.last_error).toMatch(
			/^The recurring gift [0-9a-f-]{36} this event was queued for could not be read\.$/
		);
	});
});
