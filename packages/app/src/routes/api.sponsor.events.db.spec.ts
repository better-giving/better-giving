import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseContact } from '$lib/server/contacts/contact-input';
import { postableId } from '$lib/server/db/accounts';
import { createDb } from '$lib/server/db/client';
import { all, client, first, run, stmt } from '$lib/server/db/database.testing';
import { recordDonation } from '$lib/server/donations/record';
import { settleEvent } from '$lib/server/donations/settle';
import type { EmailMessage, EmailProvider } from '$lib/server/email/provider';
import { pullSponsorEvents } from '$lib/server/payouts/pull';
import { soleProcessor } from '$lib/server/payments/processors.testing';
import { refusing, type PaymentResult, type SponsorFeed } from '$lib/server/payments/provider';
import { createSponsorProvider, sponsorEvent } from '$lib/server/payments/sponsor';
import { readEnv } from '$lib/server/runtime/env';
import { specRateLimiters } from '$lib/server/runtime/rate-limiter.testing';
import { mountRoutes } from '../route-request.testing';
import * as sponsorEvents from './api.sponsor.events';

// the hourly pull of a hosted site's sponsor events and the delivery route they also arrive on, at
// exactly `/api/sponsor/events`: what the pull applies, the cursor it keeps, and that an event —
// a settlement or a payout — is applied once however many ways it reaches this deployment. what a
// sponsored gift settles and refunds to is them here.
//
// the route runs through react router (../route-request.testing.ts), so the raw body reaches the
// handler unread and the real verifier in ../payments/sponsor.ts is the one that checks it.

const SECRET_BYTES = new Uint8Array(32).map((_, at) => at + 1);
const SECRET = `whsec_${Buffer.from(SECRET_BYTES).toString('base64')}`;
const NOW = new Date('2026-11-27T11:00:00Z');

// storage is per file, not per test ($lib/server/db/database.testing.ts), so each case starts from
// no cursor and no money in the books. foreign keys are off across the deletes and back on after,
// in the order the migration leaves them.
beforeEach(async () => {
	await run(stmt('pragma foreign_keys = off'));
	for (const table of [
		'ledger_entry',
		'entry_group',
		'sponsor_event_cursor',
		'quickbooks_sync',
		'pledge',
		'line_item',
		'payment',
		'donation',
		'contact',
		'form'
	]) {
		await run(stmt(`delete from ${table}`));
	}
	await run(stmt('pragma foreign_keys = on'));
});

/** the headers the sponsor sends with `body`, signed with `secret` at `at` (unix seconds). */
function deliveryHeaders(
	secret: string,
	body: string,
	at: number,
	id = 'msg_test'
): Record<string, string> {
	const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
	const signature = createHmac('sha256', key).update(`${id}.${at}.${body}`).digest('base64');
	return {
		'content-type': 'application/json',
		'webhook-id': id,
		'webhook-timestamp': String(at),
		'webhook-signature': `v1,${signature}`
	};
}

function mailer() {
	const sent: EmailMessage[] = [];
	const port: EmailProvider = {
		async send(message) {
			sent.push(message);
			return { ok: true };
		}
	};
	return { port, sent };
}

/** the partner API: `payments` and `reversals` answered by id, and anything else a 404. */
function partnerApi(payments: readonly unknown[] = [], reversals: readonly unknown[] = []) {
	const fetch: typeof globalThis.fetch = async (input) => {
		const path = new URL(new Request(input).url).pathname;
		const id = path.slice(path.lastIndexOf('/') + 1);
		const found =
			(path.includes('/reversals/') ? reversals : payments).find(
				(one) => (one as { id: string }).id === id
			) ?? null;
		return found === null
			? Response.json({ code: 'not_found' }, { status: 404 })
			: Response.json(found);
	};
	return {
		fetch,
		provider: createSponsorProvider({ apiKey: 'spk_test', eventsSecret: SECRET, fetch })
	};
}

/** a feed answering each page from `events`, the way `readSponsorFeed` pages one. */
type Envelope = { readonly seq: number; readonly payload: Record<string, unknown> };

/** a body the sponsor never pushed, with the sequence the feed gives it: `seq` on the body. */
function envelope(seq: number, payload: Record<string, unknown>): Envelope {
	return { seq, payload: { ...payload, seq } };
}

function feed(events: readonly Envelope[], pageSize = 2) {
	const asked: number[] = [];
	const sponsorFeed: Feed = async (after) => {
		asked.push(after);
		const rest = events.filter((one) => one.seq > after);
		const page = rest.slice(0, pageSize);
		const last = page.at(-1)?.seq ?? after;
		const more = rest.length > page.length;
		const envelopes = page.map(({ seq, payload }) => ({ ...payload, seq }));
		return { ok: true as const, value: { events: envelopes, next: last, more } };
	};
	return { sponsorFeed, asked };
}

type Feed = (after: number) => Promise<PaymentResult<SponsorFeed>>;

function deps(provider: ReturnType<typeof partnerApi>['provider'], sponsorFeed: Feed) {
	return {
		db: createDb(client),
		provider,
		processors: soleProcessor(provider),
		email: mailer().port,
		sponsorFeed
	};
}

async function cursor(): Promise<number | null> {
	const row = await first<{ seq: number }>(stmt(`select seq from sponsor_event_cursor`));
	return row?.seq ?? null;
}

async function payoutLines(key: string) {
	return all<{ account_id: string; amount_minor: number }>(
		stmt(
			`select e.account_id, e.amount_minor from ledger_entry e
			 join entry_group g on g.id = e.entry_group_id
			 where g.source_type = 'payout' and g.source_id = ?`,
			key
		)
	);
}

function settled(payoutId: string, seq: number): Envelope {
	const payload = {
		id: `evt_${payoutId}`,
		created_at: '2026-11-27T10:00:00Z',
		type: 'payout.settled',
		data: {
			payout_id: payoutId,
			amount: 50_000,
			currency: 'usd',
			settled_at: '2026-11-27T09:00:00Z',
			payment_ids: []
		}
	};
	return { seq, payload };
}

/** a gift recorded at authorization, its payment row `pending` under `providerTxnId`. */
async function pendingGift(giftId: string, formId: string, providerTxnId: string) {
	await run(
		stmt(
			`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
			                   suggested_amounts, allowed_origins, created_at, updated_at)
			 values (?, 'Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`,
			formId,
			postableId('donationsDeductible')
		)
	);
	const donor = parseContact({
		kind: 'individual',
		first_name: 'Ada',
		primary_email: `${giftId}@example.org`
	});
	if (!donor.ok) throw new Error('the fixture donor did not parse');
	const recorded = await recordDonation(createDb(client), {
		donationId: giftId,
		donor: donor.value,
		formId,
		origin: 'https://acme.org',
		currency: 'USD',
		processor: 'sponsor',
		totalMinor: 10_000,
		feeMinor: 330,
		lines: [
			{
				label: 'Donation',
				revenueAccountId: postableId('donationsDeductible'),
				amountMinor: 10_000
			}
		],
		method: 'card',
		providerTxnId,
		occurredAt: new Date('2026-11-27T09:00:00Z'),
		consentedToContact: false,
		note: undefined,
		tribute: null,
		programId: null
	});
	if (!recorded.ok) throw new Error(recorded.detail);
}

describe('pullSponsorEvents()', () => {
	it('applies every event past the cursor and keeps the last sequence applied through', async () => {
		const { sponsorFeed } = feed([settled('po_pull_1', 1), settled('po_pull_2', 2)]);

		await pullSponsorEvents(deps(partnerApi().provider, sponsorFeed), NOW);

		expect(await cursor()).toBe(2);
		expect(await payoutLines('settled:po_pull_1')).toHaveLength(2);
		expect(await payoutLines('settled:po_pull_2')).toHaveLength(2);
	});

	it('asks after the cursor it kept, so a restart resumes where it stopped', async () => {
		const first = feed([settled('po_resume_1', 1), settled('po_resume_2', 2)]);
		await pullSponsorEvents(deps(partnerApi().provider, first.sponsorFeed), NOW);

		const second = feed([
			settled('po_resume_1', 1),
			settled('po_resume_2', 2),
			settled('po_resume_3', 3)
		]);
		await pullSponsorEvents(deps(partnerApi().provider, second.sponsorFeed), NOW);

		expect(second.asked).toEqual([2]);
		expect(await cursor()).toBe(3);
		expect(await payoutLines('settled:po_resume_3')).toHaveLength(2);
	});

	it('applies a payout once when it arrives by delivery and again through the pull', async () => {
		const event = settled('po_replay_1', 1);
		const { provider } = partnerApi();
		const read = sponsorEvent(event.payload);
		if (!read.ok) throw new Error(read.detail);
		await settleEvent(deps(provider, feed([]).sponsorFeed), read.value);

		await pullSponsorEvents(deps(provider, feed([event]).sponsorFeed), NOW);

		expect(await payoutLines('settled:po_replay_1')).toEqual([
			{ account_id: postableId('bankCash'), amount_minor: 50_000 },
			{ account_id: postableId('grantIncome'), amount_minor: -50_000 }
		]);
		expect(await cursor()).toBe(1);
	});

	it('stops at an event worth sending again, keeping the cursor at the event applied', async () => {
		const giftId = crypto.randomUUID();
		await pendingGift(giftId, 'frm_pull_refund', 'pay_unsettled');
		// a body this app never saw pushed, and the reversal it names.
		const { sponsorFeed } = feed([
			settled('po_before', 1),
			envelope(2, {
				id: 'evt_settled_early',
				created_at: '2026-11-27T10:00:00Z',
				type: 'payment.settled',
				data: { id: 'pay_unsettled' }
			})
		]);

		const { provider } = partnerApi([
			{
				id: 'pay_unsettled',
				gift_id: giftId,
				status: 'pending',
				method: 'card',
				amount: {
					gift: 10_000,
					gift_fee_cover: 330,
					contribution: 0,
					contribution_fee_cover: 0
				},
				currency: 'usd',
				occurred_at: '2026-11-27T09:00:00Z'
			}
		]);
		await pullSponsorEvents(deps(provider, sponsorFeed), NOW);

		expect(await cursor()).toBe(1);
		expect(await payoutLines('settled:po_before')).toHaveLength(2);
		expect(
			(await first(stmt(`select status from payment where provider_txn_id = 'pay_unsettled'`)))
				?.status
		).toBe('pending');
	});

	it('changes nothing when the pull returns an event a delivery already applied', async () => {
		const event = settled('po_pushed', 1);
		const { provider } = partnerApi();
		const read = sponsorEvent(event.payload);
		if (!read.ok) throw new Error(read.detail);
		await settleEvent(deps(provider, feed([]).sponsorFeed), read.value);
		// the delivery moved the cursor; this run begins there and the sponsor hands the event back.
		await run(
			stmt(`insert into sponsor_event_cursor (id, seq, updated_at) values ('sponsor', 1, 0)`)
		);

		await pullSponsorEvents(deps(provider, feed([event]).sponsorFeed), NOW);

		expect(await payoutLines('settled:po_pushed')).toHaveLength(2);
		expect(await cursor()).toBe(1);
	});

	it('leaves the cursor where it was when the feed cannot be read', async () => {
		const unreadable: Feed = async () => ({
			ok: false as const,
			reason: 'unreachable' as const,
			detail: 'no answer'
		});

		await pullSponsorEvents(deps(partnerApi().provider, unreadable), NOW);

		expect(await cursor()).toBeNull();
	});

	it('does nothing where this deployment holds no sponsor', async () => {
		const stripe = refusing('stripe', 'not_configured', 'no Stripe key in this spec.');
		const asked: number[] = [];
		await pullSponsorEvents(
			{
				db: createDb(client),
				provider: stripe,
				processors: soleProcessor(stripe),
				email: mailer().port,
				sponsorFeed: async (after: number) => {
					asked.push(after);
					return { ok: true, value: { events: [], next: after, more: false } };
				}
			},
			NOW
		);
		expect(asked).toEqual([]);
	});
});

/** the delivery route as the deployment mounts it: no layout, and the spec env with the sponsor set. */
const route = mountRoutes([{ path: 'api/sponsor/events', module: sponsorEvents }]);
const ADDRESS = 'https://give.example.org/api/sponsor/events';
const env = readEnv({}, specRateLimiters());

function configured(): Env {
	return { ...env, SPONSOR_API_KEY: 'spk_test', SPONSOR_EVENTS_SECRET: SECRET } as Env;
}

/** one delivery of `body`, signed with `secret`, stamped `at`. */
function deliver(body: string, secret = SECRET, at = Math.floor(Date.now() / 1000)) {
	const headers = new Headers(deliveryHeaders(secret, body, at));
	return route(new Request(ADDRESS, { method: 'POST', headers, body }), { env: configured() });
}

describe('POST /api/sponsor/events', () => {
	it('books a settled payout as grant income off bank cash', async () => {
		const response = await deliver(JSON.stringify(settled('po_delivered', 1).payload));

		expect(response.status).toBe(200);
		expect((await response.json()) as Record<string, unknown>).toMatchObject({
			outcome: 'updated'
		});
		expect(await payoutLines('settled:po_delivered')).toEqual([
			{ account_id: postableId('bankCash'), amount_minor: 50_000 },
			{ account_id: postableId('grantIncome'), amount_minor: -50_000 }
		]);
	});

	it('books the same payout once when the same delivery is sent again', async () => {
		const body = JSON.stringify(settled('po_twice', 1).payload);
		const once = await deliver(body);
		const again = await deliver(body, SECRET, Math.floor(Date.now() / 1000) + 1);

		expect(once.status).toBe(200);
		expect(again.status).toBe(200);
		expect((await again.json()) as Record<string, unknown>).toMatchObject({
			outcome: 'already_posted'
		});
		expect(await payoutLines('settled:po_twice')).toHaveLength(2);
	});

	it('refuses a body no signature under the configured secret verifies', async () => {
		const body = JSON.stringify(settled('po_unsigned', 1).payload);
		const other = `whsec_${Buffer.alloc(32, 9).toString('base64')}`;
		const response = await deliver(body, other);

		expect(response.status).toBe(400);
		expect((await response.json()) as Record<string, unknown>).toMatchObject({
			message: expect.stringContaining('SPONSOR_EVENTS_SECRET')
		});
	});

	it('refuses a delivery stamped more than five minutes ago, signed or not', async () => {
		const body = JSON.stringify(settled('po_stale', 1).payload);
		const response = await deliver(body, SECRET, Math.floor(Date.now() / 1000) - 301);

		expect(response.status).toBe(400);
	});

	it('answers 405 to a GET, with Allow: POST', async () => {
		const response = await route(new Request(ADDRESS), { env: configured() });

		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('POST');
	});
});

describe('POST /api/sponsor/events — a gift the sponsor took', () => {
	it('answers 409 not_yet and writes nothing for a payment the sponsor still holds', async () => {
		const giftId = crypto.randomUUID();
		await pendingGift(giftId, 'frm_sponsorheld1', 'pay_held');
		const body = JSON.stringify({
			id: 'evt_held_route',
			seq: 1,
			created_at: '2026-11-27T10:00:00Z',
			type: 'payment.settled',
			data: { id: 'pay_held' }
		});
		const held = partnerApi([
			{
				id: 'pay_held',
				gift_id: giftId,
				status: 'pending',
				method: 'card',
				amount: { gift: 10_000, gift_fee_cover: 330, contribution: 0, contribution_fee_cover: 0 },
				currency: 'usd',
				occurred_at: '2026-11-27T09:00:00Z'
			}
		]);
		// the route builds its own provider from the environment, so it is the one read it makes.
		const original = globalThis.fetch;
		globalThis.fetch = held.fetch;
		let response: Response;
		try {
			response = await deliver(body);
		} finally {
			globalThis.fetch = original;
		}

		expect(response.status).toBe(409);
		expect((await response.json()) as Record<string, unknown>).toMatchObject({
			outcome: 'not_yet'
		});
		expect(
			(await first(stmt(`select status from payment where provider_txn_id = 'pay_held'`)))?.status
		).toBe('pending');
	});

	it('settles a sponsored gift on its delivery and posts no income of its own', async () => {
		const giftId = crypto.randomUUID();
		await pendingGift(giftId, 'frm_sponsorroute1', 'pay_route');
		const body = JSON.stringify({
			id: 'evt_settled_route',
			seq: 1,
			created_at: '2026-11-27T10:00:00Z',
			type: 'payment.settled',
			data: { id: 'pay_route' }
		});

		// the sponsor's `GET /payments/{id}`, the one read a settlement takes.
		const original = globalThis.fetch;
		globalThis.fetch = (async () =>
			Response.json({
				id: 'pay_route',
				gift_id: giftId,
				status: 'succeeded',
				method: 'card',
				amount: { gift: 9_670, gift_fee_cover: 330, contribution: 0, contribution_fee_cover: 0 },
				currency: 'usd',
				occurred_at: '2026-11-27T10:00:00Z'
			})) as typeof globalThis.fetch;
		let response: Response;
		try {
			response = await deliver(body);
		} finally {
			globalThis.fetch = original;
		}

		expect(response.status).toBe(200);
		expect(
			(await first(stmt(`select status from payment where provider_txn_id = 'pay_route'`)))?.status
		).toBe('succeeded');
		const posted = await first<{ groups: number }>(
			stmt(`select count(*) as groups from entry_group where source_type <> 'payout'`)
		);
		expect(posted?.groups).toBe(0);
	});
});
