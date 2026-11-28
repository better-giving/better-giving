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
// sponsored gift settles and refunds to is $lib/server/donations/sponsored.db.spec.ts's.
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
		'form',
		'org_profile'
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

type Envelope = { readonly seq: number; readonly payload: Record<string, unknown> };

/** a body the sponsor never pushed, with the sequence the feed gives it: `seq` on the body. */
function envelope(seq: number, payload: Record<string, unknown>): Envelope {
	return { seq, payload: { ...payload, seq } };
}

/** a feed answering each page from `events`, the way `readSponsorFeed` pages one. */
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

function deps(
	provider: ReturnType<typeof partnerApi>['provider'],
	sponsorFeed: Feed,
	email: EmailProvider = mailer().port
) {
	return {
		db: createDb(client),
		provider,
		processors: soleProcessor(provider),
		email,
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

function returned(returnId: string, seq: number): Envelope {
	const payload = {
		id: `evt_${returnId}`,
		created_at: '2026-11-27T10:30:00Z',
		type: 'payout.returned',
		data: {
			return_id: returnId,
			payout_id: 'po_returned_of',
			amount: 2_000,
			currency: 'usd',
			returned_at: '2026-11-27T09:30:00Z'
		}
	};
	return { seq, payload };
}

/** a payout the ledger refuses: `data` is the settled body with `refused` laid over it. */
function refusedPayout(payoutId: string, seq: number, refused: Record<string, unknown>): Envelope {
	const { payload } = settled(payoutId, seq);
	return { seq, payload: { ...payload, data: { ...(payload.data as object), ...refused } } };
}

/** `payment.settled` for `pay_unsettled`, the one payment the specs below hold back. */
function settlementOfHeld(seq: number): Envelope {
	return envelope(seq, {
		id: `evt_settled_held_${seq}`,
		created_at: '2026-11-27T10:00:00Z',
		type: 'payment.settled',
		data: { id: 'pay_unsettled' }
	});
}

/** the sponsor's `GET /payments/pay_unsettled`, in the `status` it reads now. */
function heldPayment(giftId: string, status: 'pending' | 'succeeded') {
	return {
		id: 'pay_unsettled',
		gift_id: giftId,
		status,
		method: 'card',
		amount: { gift: 9_670, gift_fee_cover: 330, contribution: 0, contribution_fee_cover: 0 },
		currency: 'usd',
		occurred_at: '2026-11-27T09:00:00Z'
	};
}

async function payoutGroups(): Promise<number> {
	const row = await first<{ groups: number }>(
		stmt(`select count(*) as groups from entry_group where source_type = 'payout'`)
	);
	return row?.groups ?? -1;
}

async function paymentStatus(providerTxnId: string): Promise<unknown> {
	return (
		await first(stmt(`select status from payment where provider_txn_id = ?`, providerTxnId))
	)?.status;
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
		// a settlement this app never saw pushed, of a payment the sponsor still reads as pending.
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

	it('applies nothing after an event held back, and carries on from it once the sponsor reads it settled', async () => {
		const giftId = crypto.randomUUID();
		await pendingGift(giftId, 'frm_pull_held', 'pay_unsettled');
		const events = [settled('po_held_1', 1), settlementOfHeld(2), settled('po_held_3', 3)];

		await pullSponsorEvents(
			deps(partnerApi([heldPayment(giftId, 'pending')]).provider, feed(events, 5).sponsorFeed),
			NOW
		);

		expect(await cursor()).toBe(1);
		expect(await payoutLines('settled:po_held_1')).toHaveLength(2);
		expect(await payoutLines('settled:po_held_3')).toEqual([]);
		expect(await paymentStatus('pay_unsettled')).toBe('pending');

		const resumed = feed(events, 5);
		await pullSponsorEvents(
			deps(partnerApi([heldPayment(giftId, 'succeeded')]).provider, resumed.sponsorFeed),
			NOW
		);

		expect(resumed.asked).toEqual([1]);
		expect(await cursor()).toBe(3);
		expect(await paymentStatus('pay_unsettled')).toBe('succeeded');
		expect(await payoutLines('settled:po_held_1')).toHaveLength(2);
		expect(await payoutLines('settled:po_held_3')).toHaveLength(2);
	});

	it('holds the cursor at an event whose settlement the sponsor could not be asked for, and resumes there', async () => {
		const giftId = crypto.randomUUID();
		await pendingGift(giftId, 'frm_pull_down', 'pay_unsettled');
		const events = [settled('po_down_1', 1), settlementOfHeld(2), settled('po_down_3', 3)];
		const down = createSponsorProvider({
			apiKey: 'spk_test',
			eventsSecret: SECRET,
			fetch: async () => Response.json({ code: 'provider_error' }, { status: 502 })
		});

		await pullSponsorEvents(deps(down, feed(events, 5).sponsorFeed), NOW);

		expect(await cursor()).toBe(1);
		expect(await payoutLines('settled:po_down_3')).toEqual([]);
		expect(await paymentStatus('pay_unsettled')).toBe('pending');

		await pullSponsorEvents(
			deps(partnerApi([heldPayment(giftId, 'succeeded')]).provider, feed(events, 5).sponsorFeed),
			NOW
		);

		expect(await cursor()).toBe(3);
		expect(await paymentStatus('pay_unsettled')).toBe('succeeded');
		expect(await payoutLines('settled:po_down_3')).toHaveLength(2);
	});

	it('pages through a feed of five events, asking after the last sequence of each page', async () => {
		const events = [1, 2, 3, 4, 5].map((seq) => settled(`po_page_${seq}`, seq));
		const { sponsorFeed, asked } = feed(events, 2);

		await pullSponsorEvents(deps(partnerApi().provider, sponsorFeed), NOW);

		expect(asked).toEqual([0, 2, 4]);
		expect(await cursor()).toBe(5);
		expect(await payoutLines('settled:po_page_5')).toHaveLength(2);
	});

	it('stops after ten pages of a backlog and reads the rest on the next run', async () => {
		const events = Array.from({ length: 11 }, (_, at) => settled(`po_backlog_${at + 1}`, at + 1));
		const firstRun = feed(events, 1);

		await pullSponsorEvents(deps(partnerApi().provider, firstRun.sponsorFeed), NOW);

		expect(firstRun.asked).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(await cursor()).toBe(10);
		expect(await payoutLines('settled:po_backlog_11')).toEqual([]);

		const nextRun = feed(events, 1);
		await pullSponsorEvents(deps(partnerApi().provider, nextRun.sponsorFeed), NOW);

		expect(nextRun.asked).toEqual([10]);
		expect(await cursor()).toBe(11);
		expect(await payoutLines('settled:po_backlog_11')).toHaveLength(2);
	});

	it('books a returned payout under its return id, and a pull of it again changes nothing', async () => {
		const event = returned('ret_pull_1', 1);

		await pullSponsorEvents(deps(partnerApi().provider, feed([event]).sponsorFeed), NOW);
		await run(stmt(`delete from sponsor_event_cursor`));
		await pullSponsorEvents(deps(partnerApi().provider, feed([event]).sponsorFeed), NOW);

		const lines = await payoutLines('returned:ret_pull_1');
		expect(lines).toHaveLength(2);
		expect(lines).toEqual(
			expect.arrayContaining([
				{ account_id: postableId('grantIncome'), amount_minor: 2_000 },
				{ account_id: postableId('bankCash'), amount_minor: -2_000 }
			])
		);
		expect(await cursor()).toBe(1);
	});

	it.each([
		['a currency the ledger refuses', { currency: 'us' }, 'bad_currency'],
		['an amount of nothing', { amount: 0 }, 'zero_amount']
	])(
		'tells staff of a payout with %s, posts nothing, and passes it in the pull',
		async (_, refused, code) => {
			await run(
				stmt(`insert into org_profile (id, legal_name, notification_email, created_at, updated_at)
				 values ('default', 'Hope Foundation', 'ops@hope.example', 0, 0)`)
			);
			const mail = mailer();
			const events = [refusedPayout('po_refused', 1, refused), settled('po_after_refused', 2)];

			await pullSponsorEvents(
				deps(partnerApi().provider, feed(events, 5).sponsorFeed, mail.port),
				NOW
			);

			expect(await payoutLines('settled:po_refused')).toEqual([]);
			expect(await payoutGroups()).toBe(1);
			expect(await cursor()).toBe(2);
			expect(await payoutLines('settled:po_after_refused')).toHaveLength(2);
			expect(mail.sent.map((message) => message.to)).toEqual(['ops@hope.example']);
			expect(mail.sent[0]?.text).toContain(code);
		}
	);

	it('changes nothing when the pull returns an event a delivery already applied', async () => {
		const event = settled('po_pushed', 1);
		const { provider } = partnerApi();
		const read = sponsorEvent(event.payload);
		if (!read.ok) throw new Error(read.detail);
		await settleEvent(deps(provider, feed([]).sponsorFeed), read.value);
		// a delivery never moves the cursor; it stands at 1 here as a run that already passed this
		// event would leave it, and the sponsor hands the event back.
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
		// only the pull moves the cursor, from the feed's own sequence.
		expect(await cursor()).toBeNull();
	});

	it('books a returned payout under its return id, and the same delivery sent again changes nothing', async () => {
		const body = JSON.stringify(returned('ret_delivered', 1).payload);
		const once = await deliver(body);
		const again = await deliver(body, SECRET, Math.floor(Date.now() / 1000) + 1);

		expect(once.status).toBe(200);
		expect(again.status).toBe(200);
		expect((await again.json()) as Record<string, unknown>).toMatchObject({
			outcome: 'already_posted'
		});
		const lines = await payoutLines('returned:ret_delivered');
		expect(lines).toHaveLength(2);
		expect(lines).toEqual(
			expect.arrayContaining([
				{ account_id: postableId('grantIncome'), amount_minor: 2_000 },
				{ account_id: postableId('bankCash'), amount_minor: -2_000 }
			])
		);
	});

	it('answers 200 unactionable and posts nothing for a payout the ledger refuses', async () => {
		const response = await deliver(
			JSON.stringify(refusedPayout('po_refused_route', 1, { currency: 'us' }).payload)
		);

		expect(response.status).toBe(200);
		expect((await response.json()) as Record<string, unknown>).toMatchObject({
			outcome: 'unactionable',
			message: expect.stringContaining('bad_currency')
		});
		expect(await payoutGroups()).toBe(0);
	});

	it.each([
		['pretty-printed', (payload: object) => JSON.stringify(payload, null, 2)],
		[
			'key-reordered',
			(payload: object) => JSON.stringify(Object.fromEntries(Object.entries(payload).reverse()))
		],
		[
			'\\u-escaped',
			(payload: object) => JSON.stringify(payload).replace('payout.settled', 'payout\\u002esettled')
		]
	] as const)('accepts a %s body signed exactly as it was sent', async (name, write) => {
		const payoutId = `po_shape_${name.replace(/\W/g, '')}`;
		const payload = settled(payoutId, 1).payload;
		const body = write(payload);
		expect(body).not.toBe(JSON.stringify(payload));

		const response = await deliver(body);

		expect(response.status).toBe(200);
		expect(await payoutLines(`settled:${payoutId}`)).toHaveLength(2);
	});

	it('refuses a body other than the one that was signed, and posts neither', async () => {
		const signed = JSON.stringify(settled('po_signed_a', 1).payload);
		const sent = JSON.stringify(settled('po_sent_b', 1).payload);
		const headers = new Headers(deliveryHeaders(SECRET, signed, Math.floor(Date.now() / 1000)));

		const response = await route(
			new Request(ADDRESS, { method: 'POST', headers, body: sent }),
			{ env: configured() }
		);

		expect(response.status).toBe(400);
		expect(await payoutLines('settled:po_sent_b')).toEqual([]);
		expect(await payoutLines('settled:po_signed_a')).toEqual([]);
	});

	it.each(['webhook-id', 'webhook-timestamp', 'webhook-signature'])(
		'refuses a delivery with no %s header, and posts nothing',
		async (missing) => {
			const body = JSON.stringify(settled('po_headerless', 1).payload);
			const headers = new Headers(deliveryHeaders(SECRET, body, Math.floor(Date.now() / 1000)));
			headers.delete(missing);

			const response = await route(new Request(ADDRESS, { method: 'POST', headers, body }), {
				env: configured()
			});

			expect(response.status).toBe(400);
			expect((await response.json()) as Record<string, unknown>).toMatchObject({
				message: expect.stringContaining('carried no')
			});
			expect(await payoutLines('settled:po_headerless')).toEqual([]);
		}
	);

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
		// the route builds its provider from the environment over the global `fetch`, so the
		// payment read is scripted there.
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
		expect(await cursor()).toBeNull();
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
		expect(await cursor()).toBeNull();
	});
});
