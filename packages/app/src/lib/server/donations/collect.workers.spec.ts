import { env } from 'cloudflare:test';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POSTING_ACCOUNTS } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import type { PostableAccountId } from '../db/postable';
import { donation, entryGroup, ledgerEntry, lineItem, payment, recurringPlan } from '../db/schema';
import type { EmailMessage, EmailProvider } from '../email/provider';
import {
	DONATION_METADATA_KEY,
	FEE_COVERED_METADATA_KEY,
	GIFT_MINOR_METADATA_KEY,
	INTERVAL_METADATA_KEY,
	type PaymentEvent,
	type PaymentProvider,
	type PaymentResult,
	type ProcessorName,
	type RecurringEvent,
	type RecurringGiftNotice,
	type Settlement
} from '../payments/provider';
import type { SettleDeps, SettleOutcome } from './delivery';
import { recordAuthorizedGift, type AuthorizedGiftInput } from './record';
import { settleDelivery } from './settle';

// the books for a gift that repeats, against a real D1: what a collection under a commitment
// writes, and what a second delivery about the same money does not.
//
// the database is real because every claim here is about rows, and about which constraint refuses
// a duplicate — `recurring_plan_provider_subscription_idx` for a commitment,
// `payment_provider_txn_idx` for a charge. a hand-rolled adapter would only prove the adapter
// (CLAUDE.md).
//
// nothing here is written by a fixture that a production path would not write. a commitment is
// created by the first collection settling, which is the rule `recurring_plan`'s header states, so
// the "later charge" cases run a first collection through `settleDelivery` before they run their
// own — the row under test is the row the webhook actually produces.

const FORM_ID = 'frm_collectpath0001';
const CONTACT_ID = '019fb300-0000-7000-8000-000000000001';
/** the causes a gift in this file may be credited to. no migration seeds one. */
const CLEAN_WATER = '019fb700-0000-7000-8000-000000000001';
const SCHOOL_MEALS = '019fb700-0000-7000-8000-000000000002';
const GIFT_ID = 'sub_collect_1';
const CUSTOMER_ID = 'cus_collect_1';
/** the gift a donor authorized, which every commitment in this file names and claims. */
const AUTHORIZED_ID = '019fb301-0000-7000-8000-000000000001';

let db: Db;
let revenueAccountId: PostableAccountId;

beforeAll(async () => {
	db = createDb(env.DB);
	const row = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	if (!row)
		throw new Error(
			'no 4110 account — has the chart of accounts in migrations/0000_initial_schema.sql moved?'
		);
	revenueAccountId = row.id as PostableAccountId;
});

beforeEach(async () => {
	for (const table of [
		'ledger_entry',
		'entry_group',
		'payment',
		'line_item',
		'donation',
		'recurring_plan',
		'contact',
		'form',
		'program',
		'org_profile'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	// two causes, so a gift credited to one is credited to a row rather than to whatever is there.
	await env.DB.prepare(
		`insert into program (id, name, status, created_at, updated_at)
		 values (?, 'Clean water', 'active', 0, 0), (?, 'School meals', 'active', 0, 0)`
	)
		.bind(CLEAN_WATER, SCHOOL_MEALS)
		.run();
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins,
		                   created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
	)
		.bind(FORM_ID, revenueAccountId)
		.run();
	// the donor's record, which the commitment names. it exists before the first collection
	// because the browser that made the commitment is what creates it — see the metadata contract
	// in ../payments/provider.ts.
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
		 values (?, 'individual', 'Ada Okafor', 'ada@example.org', 0, 0)`
	)
		.bind(CONTACT_ID)
		.run();
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, deductibility_statement, address_line1,
		                          city, country, notification_email, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', 'No goods or services were provided.',
		         '1 Main St', 'Springfield', 'US', 'ops@hope.example', 0, 0)`
	).run();
});

/**
 * what the commitment carries on the processor's copy of itself — the four values
 * `commitmentMetadata` in ../payments/provider.ts assembles, exactly as `mintCommitment` in
 * ./quote.ts sends them.
 *
 * written out rather than built through that function, because half of what is under test here is a
 * map it cannot produce: a blank pointer, a cadence this app does not spell, a commitment made
 * before a key shipped.
 */
const commitmentMetadata = (over: Record<string, string> = {}) => ({
	[DONATION_METADATA_KEY]: AUTHORIZED_ID,
	[INTERVAL_METADATA_KEY]: 'monthly',
	[GIFT_MINOR_METADATA_KEY]: '2500',
	[FEE_COVERED_METADATA_KEY]: 'false',
	...over
});

/** a delivery about one collection under a commitment. */
const collectionEvent = (over: Partial<RecurringEvent> = {}): PaymentEvent => ({
	id: 'evt_collect_1',
	kind: 'recurring',
	type: 'invoice.paid',
	providerNoticeId: 'in_collect_1',
	occurredAt: new Date('2026-08-03T12:00:00.000Z'),
	...over
});

/** what the processor says the commitment behind a collection is. */
const notice = (over: Partial<RecurringGiftNotice> = {}): RecurringGiftNotice => ({
	about: 'collection',
	providerGiftId: GIFT_ID,
	providerCustomerId: CUSTOMER_ID,
	state: 'active',
	interval: 'monthly',
	providerTxnId: 'pi_collect_1',
	endedAt: null,
	nextChargeAt: new Date('2026-09-03T12:00:00.000Z'),
	metadata: commitmentMetadata(),
	...over
});

/** the same, for a delivery about the commitment's own standing, which names no collection. */
const standingNotice = (over: Partial<RecurringGiftNotice> = {}): RecurringGiftNotice =>
	notice({ about: 'commitment', providerTxnId: null, ...over });

/** what the processor says the transaction that collection was attempted on turned out to be. */
const settlement = (over: Partial<Settlement> = {}): Settlement => ({
	providerTxnId: 'pi_collect_1',
	status: 'succeeded',
	method: 'card',
	amountMinor: 2500,
	currency: 'USD',
	feeMinor: 103,
	// a collection's intent is minted by the processor and carries nothing of ours, which is what
	// keeps the `payment_intent.succeeded` that accompanies it out of the books.
	metadata: {},
	occurredAt: new Date('2026-08-03T12:00:00.000Z'),
	...over
});

/** the payment port, answering from a script. */
function provider(
	script: {
		verify?: PaymentResult<PaymentEvent>;
		gift?: PaymentResult<RecurringGiftNotice>;
		settled?: PaymentResult<Settlement>;
	},
	processor: ProcessorName = 'stripe'
): PaymentProvider {
	const refuse = (name: string) => async () => {
		throw new Error(`${name} is not part of the collection path`);
	};
	return {
		processor,
		createIntent: refuse('createIntent'),
		async verifyEvent() {
			return script.verify ?? { ok: true, value: collectionEvent() };
		},
		async readSettlement() {
			return script.settled ?? { ok: true, value: settlement() };
		},
		async readRecurringGift() {
			return script.gift ?? { ok: true, value: notice() };
		},
		readAccountChargeability: refuse('readAccountChargeability'),
		prepareRecurringGifts: refuse('prepareRecurringGifts'),
		readRecurringGiftProvision: refuse('readRecurringGiftProvision'),
		createRecurringGift: refuse('createRecurringGift'),
		cancelRecurringGift: refuse('cancelRecurringGift'),
		readRailSwitchboard: refuse('readRailSwitchboard'),
		listWebhookEndpoints: refuse('listWebhookEndpoints'),
		registerWebhookEndpoint: refuse('registerWebhookEndpoint'),
		resubscribeWebhookEndpoint: refuse('resubscribeWebhookEndpoint'),
		replaceWebhookEndpoint: refuse('replaceWebhookEndpoint'),
		listWalletDomains: refuse('listWalletDomains'),
		registerWalletDomain: refuse('registerWalletDomain')
	} as PaymentProvider;
}

/** the mail transport, recording what it was handed. */
function mailer(ok = true) {
	const sent: EmailMessage[] = [];
	const port: EmailProvider = {
		async send(message) {
			sent.push(message);
			return ok
				? { ok: true }
				: { ok: false, reason: 'connect_failed', detail: 'no route to host', indeterminate: false };
		}
	};
	return { port, sent };
}

const DELIVERY = { body: '{"id":"evt_collect_1"}', headers: { 'stripe-signature': 't=1,v1=abc' } };

function deps(over: Partial<SettleDeps> = {}): SettleDeps {
	return { db, provider: provider({}), email: mailer().port, ...over };
}

/** every ledger line of one entry group, by source. */
async function groupLines(sourceType: string, sourceId: string) {
	const [group] = await db
		.select()
		.from(entryGroup)
		.where(sql`${entryGroup.sourceType} = ${sourceType} and ${entryGroup.sourceId} = ${sourceId}`);
	if (!group) return null;
	const lines = await db.select().from(ledgerEntry).where(eq(ledgerEntry.entryGroupId, group.id));
	return { group, lines };
}

describe('settleDelivery() — the first collection under a commitment', () => {
	// the gift the donor authorized when they set the commitment up, which every commitment here
	// names: the donor and the fund are on that row and on the commitment not at all.
	beforeEach(async () => {
		await authorizeGift();
	});

	it('opens the commitment the charge was made under', async () => {
		const result = await settleDelivery(deps(), DELIVERY);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const [plan] = await db.select().from(recurringPlan);
		// a commitment exists from its first successful charge and never before it, which is the
		// rule `recurring_plan`'s header states.
		expect(plan).toMatchObject({
			contactId: CONTACT_ID,
			formId: FORM_ID,
			amountMinor: 2500,
			currency: 'USD',
			interval: 'monthly',
			status: 'active',
			provider: 'stripe',
			providerSubscriptionId: GIFT_ID,
			providerCustomerId: CUSTOMER_ID,
			endedAt: null
		});
	});

	it('records the charge as an ordinary gift pointing back at the commitment', async () => {
		await settleDelivery(deps(), DELIVERY);

		const [plan] = await db.select().from(recurringPlan);
		const [gift] = await db.select().from(donation);
		expect(gift).toMatchObject({
			contactId: CONTACT_ID,
			formId: FORM_ID,
			totalMinor: 2500,
			currency: 'USD',
			recurringId: plan?.id,
			// the day the donor gave, which the claim leaves standing: somebody was at a browser for
			// this charge, unlike every later collection in the series.
			receivedAt: new Date('2026-08-01T09:00:00.000Z')
		});
		const [line] = await db.select().from(lineItem).where(eq(lineItem.donationId, gift!.id));
		expect(line).toMatchObject({ revenueAccountId, lineTotalMinor: 2500 });
	});

	it('records the settlement attempt as settled, since nothing opened one before it', async () => {
		await settleDelivery(deps(), DELIVERY);

		const [row] = await db.select().from(payment);
		// no quote minted this row, so it is written in its settled state rather than corrected
		// from `pending` — which is the whole difference between this path and ./settle.ts's.
		expect(row).toMatchObject({
			status: 'succeeded',
			method: 'card',
			provider: 'stripe',
			providerTxnId: 'pi_collect_1',
			amountMinor: 2500,
			occurredAt: new Date('2026-08-03T12:00:00.000Z')
		});
	});

	it('puts the gift and the processor’s fee in the books', async () => {
		await settleDelivery(deps(), DELIVERY);

		const [row] = await db.select().from(payment);
		const charge = await groupLines('payment', row!.id);
		expect(charge?.lines.map((l) => [l.accountId, l.amountMinor]).sort()).toEqual(
			[
				[POSTING_ACCOUNTS.undepositedFunds.id, 2500],
				[revenueAccountId, -2500]
			].sort()
		);
		const fee = await groupLines('fee', row!.id);
		expect(fee?.lines.map((l) => [l.accountId, l.amountMinor]).sort()).toEqual(
			[
				[POSTING_ACCOUNTS.processorFees.id, 103],
				[POSTING_ACCOUNTS.undepositedFunds.id, -103]
			].sort()
		);
	});

	it('leaves every entry group summing to exactly zero', async () => {
		await settleDelivery(deps(), DELIVERY);

		const groups = await db.select().from(entryGroup);
		expect(groups).toHaveLength(2);
		for (const group of groups) {
			const lines = await db
				.select()
				.from(ledgerEntry)
				.where(eq(ledgerEntry.entryGroupId, group.id));
			expect(lines.reduce((total, line) => total + line.amountMinor, 0)).toBe(0);
		}
	});

	it('records when the rail expects to collect next', async () => {
		await settleDelivery(deps(), DELIVERY);

		const [plan] = await db.select().from(recurringPlan);
		expect(plan?.nextChargeAt).toEqual(new Date('2026-09-03T12:00:00.000Z'));
	});
});

/** the same commitment collecting again a month later, on its own transaction. */
const secondCollection = {
	event: collectionEvent({ id: 'evt_collect_2', providerNoticeId: 'in_collect_2' }),
	notice: notice({
		providerTxnId: 'pi_collect_2',
		nextChargeAt: new Date('2026-10-03T12:00:00.000Z')
	}),
	settlement: settlement({
		providerTxnId: 'pi_collect_2',
		feeMinor: 103,
		occurredAt: new Date('2026-09-03T12:00:00.000Z')
	})
};

describe('settleDelivery() — a later collection under a commitment already open', () => {
	beforeEach(async () => {
		await authorizeGift();
		const first = await settleDelivery(deps(), DELIVERY);
		expect(first).toMatchObject({ ok: true, outcome: 'posted' });
	});

	it('opens no second commitment for the same subscription', async () => {
		const result = await settleDelivery(
			deps({
				provider: provider({
					verify: { ok: true, value: secondCollection.event },
					gift: { ok: true, value: secondCollection.notice },
					settled: { ok: true, value: secondCollection.settlement }
				})
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const plans = await db.select().from(recurringPlan);
		expect(plans).toHaveLength(1);
	});

	it('records a gift of its own against the same commitment', async () => {
		await settleDelivery(
			deps({
				provider: provider({
					verify: { ok: true, value: secondCollection.event },
					gift: { ok: true, value: secondCollection.notice },
					settled: { ok: true, value: secondCollection.settlement }
				})
			}),
			DELIVERY
		);

		const [plan] = await db.select().from(recurringPlan);
		const gifts = await db.select().from(donation);
		expect(gifts).toHaveLength(2);
		// every charge in a series is its own donation pointing back at the commitment: there is no
		// sequence number and no first-charge flag, because both are read off this column.
		expect(gifts.every((row) => row.recurringId === plan?.id)).toBe(true);
		// the opening charge keeps the day the donor gave, and a later one is dated by the day its
		// money moved — nobody was at a browser for it.
		expect(gifts.map((row) => row.receivedAt.toISOString()).sort()).toEqual([
			'2026-08-01T09:00:00.000Z',
			'2026-09-03T12:00:00.000Z'
		]);
	});

	it('posts it as entries of its own, keyed to its own payment', async () => {
		await settleDelivery(
			deps({
				provider: provider({
					verify: { ok: true, value: secondCollection.event },
					gift: { ok: true, value: secondCollection.notice },
					settled: { ok: true, value: secondCollection.settlement }
				})
			}),
			DELIVERY
		);

		const rows = await db.select().from(payment);
		expect(rows.map((row) => row.providerTxnId).sort()).toEqual(['pi_collect_1', 'pi_collect_2']);
		// four groups, two per charge: nothing is merged and nothing is netted.
		const groups = await db.select().from(entryGroup);
		expect(groups).toHaveLength(4);
		for (const row of rows) {
			expect(await groupLines('payment', row.id)).not.toBeNull();
			expect(await groupLines('fee', row.id)).not.toBeNull();
		}
	});

	it('moves the expected next charge on', async () => {
		await settleDelivery(
			deps({
				provider: provider({
					verify: { ok: true, value: secondCollection.event },
					gift: { ok: true, value: secondCollection.notice },
					settled: { ok: true, value: secondCollection.settlement }
				})
			}),
			DELIVERY
		);

		const [plan] = await db.select().from(recurringPlan);
		expect(plan?.nextChargeAt).toEqual(new Date('2026-10-03T12:00:00.000Z'));
	});

	it('posts a later charge to the fund the form names now, not the one it named then', async () => {
		const moved = await env.DB.prepare(
			`select id from account where is_postable = 1 and code = '4120'`
		).first<{ id: string }>();
		await env.DB.prepare(`update form set revenue_account_id = ? where id = ?`)
			.bind(moved!.id, FORM_ID)
			.run();

		await settleDelivery(
			deps({
				provider: provider({
					verify: { ok: true, value: secondCollection.event },
					gift: { ok: true, value: secondCollection.notice },
					settled: { ok: true, value: secondCollection.settlement }
				})
			}),
			DELIVERY
		);

		// `recurring_plan.form_id` is NOT NULL so that the fund is reachable for every later charge,
		// and the commitment freezes no account: the gifts before the move stay where they were
		// posted and the ones after it follow the form.
		const [later] = await db
			.select()
			.from(payment)
			.where(eq(payment.providerTxnId, 'pi_collect_2'));
		const charge = await groupLines('payment', later!.id);
		expect(charge?.lines.some((l) => l.accountId === moved!.id)).toBe(true);
	});
});

describe('settleDelivery() — the receipt for a collection', () => {
	// the gift the donor authorized, which the commitment names and the first collection claims.
	beforeEach(async () => {
		await authorizeGift();
	});

	/** the second collection, delivered exactly as the rail sends it. */
	const collectAgain = (email: EmailProvider) =>
		settleDelivery(
			deps({
				email,
				provider: provider({
					verify: { ok: true, value: secondCollection.event },
					gift: { ok: true, value: secondCollection.notice },
					settled: { ok: true, value: secondCollection.settlement }
				})
			}),
			DELIVERY
		);

	/** the gifts this commitment has collected, oldest first. */
	const collected = () => db.select().from(donation).orderBy(donation.receivedAt);

	it('receipts a later collection and stamps that charge’s own row', async () => {
		await settleDelivery(deps(), DELIVERY);
		const mail = mailer();

		const result = await collectAgain(mail.port);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(mail.sent.map((m) => m.to)).toContain('ada@example.org');
		// the stamp lands on the charge that was collected, never on the commitment and never on the
		// charge that opened it: every collection is its own donation row (../db/schema.ts).
		const gifts = await collected();
		expect(gifts).toHaveLength(2);
		expect(gifts[1]?.receiptSentAt).not.toBeNull();
	});

	it('receipts the charge that opens a commitment exactly once', async () => {
		const mail = mailer();

		await settleDelivery(deps({ email: mail.port }), DELIVERY);

		// opening a commitment and collecting under one already open end at the same sender, so this
		// is the case that would send twice if either half sent for itself.
		expect(mail.sent.filter((m) => m.to === 'ada@example.org')).toHaveLength(1);
		const [gift] = await collected();
		expect(gift?.receiptSentAt).not.toBeNull();
	});

	it('sends no second receipt when the first collection is delivered again', async () => {
		await settleDelivery(deps(), DELIVERY);
		const [first] = await collected();
		const mail = mailer();

		const again = await settleDelivery(deps({ email: mail.port }), DELIVERY);

		// the batch is refused by `payment_provider_txn_idx`, and the send is behind the batch — so
		// the constraint that keeps the money out of the books twice keeps the receipt out too.
		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(mail.sent).toHaveLength(0);
		const [after] = await collected();
		expect(after?.receiptSentAt).toEqual(first?.receiptSentAt);
	});

	it('keeps the collection when the receipt does not send', async () => {
		await settleDelivery(deps(), DELIVERY);

		const result = await collectAgain(mailer(false).port);

		// the money moved before any of this ran, so a mail fault cannot walk it back: the answer
		// stays 200, the books keep both charges, and the commitment keeps collecting.
		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const gifts = await collected();
		expect(gifts).toHaveLength(2);
		// null is the unreceipted backlog rather than a lost gift — the donor is owed one and the
		// column is what says so.
		expect(gifts[1]?.receiptSentAt).toBeNull();
		expect(await db.select().from(entryGroup)).toHaveLength(4);
		const [plan] = await db.select().from(recurringPlan);
		expect(plan).toMatchObject({
			status: 'active',
			nextChargeAt: new Date('2026-10-03T12:00:00.000Z')
		});
	});

	it('keeps the collection when the receipt step faults outright', async () => {
		await settleDelivery(deps(), DELIVERY);
		/** a transport that throws rather than answering, which nothing on this path may pass on. */
		const broken: EmailProvider = {
			async send() {
				throw new Error('the socket went away');
			}
		};

		const result = await collectAgain(broken);

		// the money moved before the receipt step ran, so a fault in it must not answer non-2xx: the
		// processor would redeliver a collection the constraint refuses for three days, with the gift
		// banked and nobody told.
		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const gifts = await collected();
		expect(gifts).toHaveLength(2);
		expect(gifts[1]?.receiptSentAt).toBeNull();
		expect(await db.select().from(entryGroup)).toHaveLength(4);
	});

	it('states each charge’s own figures, not the commitment’s and not the first charge’s', async () => {
		await settleDelivery(deps(), DELIVERY);
		const mail = mailer();

		await settleDelivery(
			deps({
				email: mail.port,
				provider: provider({
					verify: { ok: true, value: secondCollection.event },
					gift: { ok: true, value: secondCollection.notice },
					// a commitment's own amount is frozen at the first charge, so a collection worth
					// something else is what tells the two apart on the document the donor files.
					settled: {
						ok: true,
						value: settlement({ ...secondCollection.settlement, amountMinor: 4200 })
					}
				})
			}),
			DELIVERY
		);

		const receipt = mail.sent.find((m) => m.to === 'ada@example.org');
		expect(receipt?.text).toContain('USD 42.00');
		expect(receipt?.text).toContain('September 3, 2026');
		expect(receipt?.text).not.toContain('USD 25.00');
		expect(receipt?.text).not.toContain('August 3, 2026');
	});
});

/**
 * the gift `mintCommitment` in ./quote.ts records when a donor authorizes a commitment, written
 * through the same function that path calls rather than seeded in SQL — the row a collection claims
 * is the row the donation endpoint actually writes.
 */
async function authorizeGift(over: Partial<AuthorizedGiftInput> = {}): Promise<string> {
	const donationId = over.donationId ?? AUTHORIZED_ID;
	const written = await recordAuthorizedGift(db, {
		donationId,
		contactId: CONTACT_ID,
		formId: FORM_ID,
		origin: 'https://acme.org',
		currency: 'USD',
		totalMinor: 2500,
		feeMinor: 0,
		lines: [{ label: 'Donation', revenueAccountId, amountMinor: 2500 }],
		note: undefined,
		tribute: null,
		programId: null,
		occurredAt: new Date('2026-08-01T09:00:00.000Z'),
		...over
	});
	if (!written.ok) throw new Error(`the authorized gift was not written: ${written.detail}`);
	return donationId;
}

describe('settleDelivery() — a first collection claiming the gift the donor authorized', () => {
	it('claims that row rather than opening a second gift for the same money', async () => {
		const authorized = await authorizeGift();

		const result = await settleDelivery(
			deps({
				provider: provider({
					gift: {
						ok: true,
						value: notice({
							metadata: commitmentMetadata({ [DONATION_METADATA_KEY]: authorized })
						})
					}
				})
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		// the opening month counted twice is the failure this whole shape exists to prevent: the
		// unclaimed intent row would sit on the gifts list beside the collection that paid it.
		const gifts = await db.select().from(donation);
		expect(gifts).toHaveLength(1);
		const [plan] = await db.select().from(recurringPlan);
		expect(gifts[0]).toMatchObject({
			id: authorized,
			recurringId: plan?.id,
			totalMinor: 2500,
			currency: 'USD',
			// the day the donor gave, kept rather than moved to the day the money cleared — the same
			// call ./settle.ts makes about a one-off gift, and now available here because somebody
			// was at a browser for this charge.
			receivedAt: new Date('2026-08-01T09:00:00.000Z'),
			origin: 'https://acme.org'
		});
	});

	it('leaves that gift one line, worth what was collected', async () => {
		const authorized = await authorizeGift();

		await settleDelivery(
			deps({
				provider: provider({
					gift: {
						ok: true,
						value: notice({
							metadata: commitmentMetadata({ [DONATION_METADATA_KEY]: authorized })
						})
					}
				})
			}),
			DELIVERY
		);

		// the lines are what the posting credits, so a line left at the quoted figure against a
		// settlement of another would put the gift's own record and the books at odds.
		const lines = await db.select().from(lineItem).where(eq(lineItem.donationId, authorized));
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ revenueAccountId, lineTotalMinor: 2500 });
	});

	it('writes one settled payment against it and posts it once', async () => {
		const authorized = await authorizeGift();

		await settleDelivery(
			deps({
				provider: provider({
					gift: {
						ok: true,
						value: notice({
							metadata: commitmentMetadata({ [DONATION_METADATA_KEY]: authorized })
						})
					}
				})
			}),
			DELIVERY
		);

		const payments = await db.select().from(payment);
		expect(payments).toHaveLength(1);
		expect(payments[0]).toMatchObject({
			donationId: authorized,
			status: 'succeeded',
			providerTxnId: 'pi_collect_1'
		});
		const groups = await db.select().from(entryGroup);
		expect(groups).toHaveLength(2);
	});

	it('leaves one gift and one payment when the delivery is sent again', async () => {
		const authorized = await authorizeGift();
		const port = () =>
			provider({
				gift: {
					ok: true,
					value: notice({
						metadata: commitmentMetadata({ [DONATION_METADATA_KEY]: authorized })
					})
				}
			});

		const first = await settleDelivery(deps({ provider: port() }), DELIVERY);
		const second = await settleDelivery(deps({ provider: port() }), DELIVERY);

		// the second delivery finds the commitment already open, so it takes the later-collection
		// arm — where `payment_provider_txn_idx` refuses the charge it is really about.
		expect(first).toMatchObject({ ok: true, outcome: 'posted' });
		expect(second).toMatchObject({ ok: true, outcome: 'already_posted' });
		const gifts = await db.select().from(donation);
		const payments = await db.select().from(payment);
		const plans = await db.select().from(recurringPlan);
		expect(gifts).toHaveLength(1);
		expect(payments).toHaveLength(1);
		expect(plans).toHaveLength(1);
	});

	it('leaves the gift unclaimed by a first collection that collected nothing', async () => {
		const authorized = await authorizeGift();
		const metadata = commitmentMetadata({ [DONATION_METADATA_KEY]: authorized });

		const refused = await settleDelivery(
			deps({
				provider: provider({
					gift: { ok: true, value: notice({ metadata }) },
					settled: { ok: true, value: settlement({ status: 'failed' }) }
				})
			}),
			DELIVERY
		);
		// the rail's own retry schedule is what tries again, so the gift stays where it was: nothing
		// was collected and there is no commitment for it to belong to.
		expect(refused).toMatchObject({ ok: true, outcome: 'uncollected' });
		const [pending] = await db.select().from(donation);
		expect(pending).toMatchObject({ id: authorized, recurringId: null });
		expect(await db.select().from(payment)).toEqual([]);

		const collected = await settleDelivery(
			deps({
				provider: provider({
					verify: { ok: true, value: secondCollection.event },
					gift: { ok: true, value: { ...secondCollection.notice, metadata } },
					settled: { ok: true, value: secondCollection.settlement }
				})
			}),
			DELIVERY
		);

		// the retry that succeeds is still the charge that opens the commitment, so it claims the
		// gift rather than leaving the donor's abandoned-looking row beside a second one.
		expect(collected).toMatchObject({ ok: true, outcome: 'posted' });
		const gifts = await db.select().from(donation);
		expect(gifts).toHaveLength(1);
		expect(gifts[0]?.id).toBe(authorized);
	});

	it('opens the commitment under the donor and the form that gift names', async () => {
		// a second of each, so that the row the commitment opens can only have come from the gift: the
		// commitment itself carries neither, and one donor and one form would agree by coincidence.
		const otherDonor = '019fb300-0000-7000-8000-0000000000aa';
		const otherForm = 'frm_collectpath0002';
		const otherFund = await env.DB.prepare(
			`select id from account where is_postable = 1 and code = '4120'`
		).first<{ id: string }>();
		await env.DB.prepare(
			`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
			 values (?, 'individual', 'Bea Nwosu', 'bea@example.org', 0, 0)`
		)
			.bind(otherDonor)
			.run();
		await env.DB.prepare(
			`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
			                   suggested_amounts, allowed_origins, created_at, updated_at)
			 values (?, 'Winter Appeal', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
		)
			.bind(otherForm, otherFund!.id)
			.run();
		await authorizeGift({ contactId: otherDonor, formId: otherForm });

		const result = await settleDelivery(deps(), DELIVERY);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const [plan] = await db.select().from(recurringPlan);
		expect(plan).toMatchObject({ contactId: otherDonor, formId: otherForm });
		const [row] = await db.select().from(payment);
		const charge = await groupLines('payment', row!.id);
		expect(charge?.lines.some((l) => l.accountId === otherFund!.id)).toBe(true);
	});

	it('claims nothing twice when a second commitment names the same gift', async () => {
		const authorized = await authorizeGift();
		const claimed = await settleDelivery(deps(), DELIVERY);
		expect(claimed).toMatchObject({ ok: true, outcome: 'posted' });

		// a second subscription carrying the same pointer, which is what a retried create that lost
		// its answer produces. the row is spoken for, so this collection is told rather than written
		// onto a gift another commitment already collects.
		const result = await settleDelivery(
			deps({
				provider: provider({
					gift: { ok: true, value: notice({ providerGiftId: 'sub_collect_2' }) }
				})
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'unmatched' });
		const [gift] = await db.select().from(donation);
		expect(gift?.id).toBe(authorized);
		expect(await db.select().from(recurringPlan)).toHaveLength(1);
		expect(await db.select().from(payment)).toHaveLength(1);
	});
});

describe('settleDelivery() — a dedication a donor made on a repeating gift', () => {
	/** the dedication a donor makes on the gift they authorize, with somebody to tell. */
	const DEDICATION = {
		kind: 'memory',
		honoree: 'Grace Hopper',
		notify: { name: 'Mary Hopper', email: 'mary@example.org' }
	} as const;

	/** the first collection, and then the second a month later, both under that commitment. */
	async function collectTwice(metadata: Record<string, string>, mail = mailer()) {
		const first = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider({ gift: { ok: true, value: notice({ metadata }) } })
			}),
			DELIVERY
		);
		expect(first).toMatchObject({ ok: true, outcome: 'posted' });

		const second = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider({
					verify: { ok: true, value: secondCollection.event },
					gift: { ok: true, value: { ...secondCollection.notice, metadata } },
					settled: { ok: true, value: secondCollection.settlement }
				})
			}),
			DELIVERY
		);
		expect(second).toMatchObject({ ok: true, outcome: 'posted' });

		const gifts = await db.select().from(donation).orderBy(donation.receivedAt);
		return { gifts, mail };
	}

	/** a donor who dedicated the gift they authorized, and the commitment naming that gift. */
	async function dedicated(tribute: AuthorizedGiftInput['tribute'] = DEDICATION) {
		const authorized = await authorizeGift({ tribute });
		return commitmentMetadata({ [DONATION_METADATA_KEY]: authorized });
	}

	it('keeps it on the charge that opens the commitment', async () => {
		const { gifts } = await collectTwice(await dedicated());

		expect(gifts[0]).toMatchObject({ tributeKind: 'memory', tributeHonoree: 'Grace Hopper' });
	});

	it('records it on every later collection in the series', async () => {
		const { gifts } = await collectTwice(await dedicated());

		// a donor dedicates the gift rather than January's instalment, and a report of what was
		// given in one person's memory is wrong without this. it is read off the charge that opened
		// the series, which is the only place it is written — nothing about the dedication is
		// exported to the processor.
		expect(gifts).toHaveLength(2);
		expect(gifts[1]).toMatchObject({ tributeKind: 'memory', tributeHonoree: 'Grace Hopper' });
	});

	it('names the person to tell on the opening gift and on no other', async () => {
		const { gifts } = await collectTwice(await dedicated());

		// telling a family is one act, and a family emailed every month for a year is the worst
		// failure this feature has (../db/schema.ts). the opening gift is the one row of the series
		// that names anybody, so there is nothing for a later collection to find.
		expect(gifts[0]).toMatchObject({
			tributeNotifyName: 'Mary Hopper',
			tributeNotifyEmail: 'mary@example.org'
		});
		expect(gifts[1]).toMatchObject({ tributeNotifyName: null, tributeNotifyEmail: null });
	});

	it('tells that person once across the whole series', async () => {
		const { gifts, mail } = await collectTwice(await dedicated());

		// two collections, one notice: the second finds no name on its own row and answers without a
		// query (./tribute-notice.ts). the stamp is on the opening gift and there is no second row
		// for one to land on.
		expect(mail.sent.filter((m) => m.to === 'mary@example.org')).toHaveLength(1);
		expect(gifts[0]?.tributeNotifiedAt).not.toBeNull();
		expect(gifts[1]?.tributeNotifiedAt).toBeNull();
	});

	it('states it on the receipt for a later collection', async () => {
		const { mail } = await collectTwice(await dedicated());

		const receipts = mail.sent.filter((m) => m.to === 'ada@example.org');
		expect(receipts).toHaveLength(2);
		expect(receipts[1]?.text).toContain('In memory of Grace Hopper');
	});

	it('records none where the opening gift was dedicated to nobody', async () => {
		const { gifts } = await collectTwice(await dedicated(null));

		expect(gifts.map((g) => [g.tributeKind, g.tributeHonoree])).toEqual([
			[null, null],
			[null, null]
		]);
	});

	it('narrows what the opening gift stores rather than believing it', async () => {
		// `donation.tribute_kind` carries no CHECK and cannot be given one, so a kind outside the
		// vocabulary reaches a later collection through the one narrowing every surface shares.
		const authorized = await authorizeGift();
		await env.DB.prepare(
			`update donation set tribute_kind = 'remembrance', tribute_honoree = 'Grace Hopper' where id = ?`
		)
			.bind(authorized)
			.run();

		const { gifts } = await collectTwice(
			commitmentMetadata({ [DONATION_METADATA_KEY]: authorized })
		);

		expect(gifts[1]).toMatchObject({ tributeKind: null, tributeHonoree: null });
	});
});

describe('settleDelivery() — the cause a repeating gift is credited to', () => {
	/** the first collection and the second, both under one commitment. */
	async function collectTwice(metadata: Record<string, string>, mail = mailer()) {
		const first = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider({ gift: { ok: true, value: notice({ metadata }) } })
			}),
			DELIVERY
		);
		expect(first).toMatchObject({ ok: true, outcome: 'posted' });

		const second = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider({
					verify: { ok: true, value: secondCollection.event },
					gift: { ok: true, value: { ...secondCollection.notice, metadata } },
					settled: { ok: true, value: secondCollection.settlement }
				})
			}),
			DELIVERY
		);
		expect(second).toMatchObject({ ok: true, outcome: 'posted' });

		return { gifts: await db.select().from(donation).orderBy(donation.receivedAt), mail };
	}

	/**
	 * a donor dedicates a series to a cause rather than to January's instalment, so every later
	 * charge copies it off the charge that opened the series — the same rule the dedication is
	 * under, and read in the same query.
	 */
	it('carries the opening gift’s cause onto every later collection', async () => {
		const authorized = await authorizeGift({ programId: CLEAN_WATER });

		const { gifts } = await collectTwice(
			commitmentMetadata({ [DONATION_METADATA_KEY]: authorized })
		);

		expect(gifts.map((g) => g.programId)).toEqual([CLEAN_WATER, CLEAN_WATER]);
	});

	it('carries none where the series was opened against no cause', async () => {
		const authorized = await authorizeGift();

		const { gifts } = await collectTwice(
			commitmentMetadata({ [DONATION_METADATA_KEY]: authorized })
		);

		expect(gifts.map((g) => g.programId)).toEqual([null, null]);
	});

	it('states the cause on the receipt for every collection in the series', async () => {
		const authorized = await authorizeGift({ programId: CLEAN_WATER });

		const { mail } = await collectTwice(
			commitmentMetadata({ [DONATION_METADATA_KEY]: authorized })
		);

		const receipts = mail.sent.filter((m) => m.to === 'ada@example.org');
		expect(receipts).toHaveLength(2);
		expect(receipts[0]?.text).toContain('Clean water');
		expect(receipts[1]?.text).toContain('Clean water');
	});
});

describe('settleDelivery() — a collection the donor covered the fee on', () => {
	// the gift the donor authorized, which the commitment names and the first collection claims.
	beforeEach(async () => {
		await authorizeGift();
	});

	/**
	 * the commitment a donor who elected to cover the fee leaves behind: 25.00 chosen, 26.00 charged
	 * every interval, and 1.03 of it kept by the processor.
	 *
	 * the two fees are deliberately different figures. `donation.fee_minor` is the one the donor was
	 * quoted and pressed; `settlement.feeMinor` is what Stripe withheld and posts through `feeEntry`
	 * (./entries.ts). a fixture where they agreed would pass with either one written.
	 */
	const covering = {
		notice: notice({ metadata: commitmentMetadata({ [FEE_COVERED_METADATA_KEY]: 'true' }) }),
		settlement: settlement({ amountMinor: 2600 })
	};

	/** one collection under that commitment, delivered as the rail sends it. */
	const collectCovering = (
		email: EmailProvider,
		over: {
			event?: PaymentEvent;
			notice?: RecurringGiftNotice;
			settlement?: Settlement;
		} = {}
	) =>
		settleDelivery(
			deps({
				email,
				provider: provider({
					verify: { ok: true, value: over.event ?? collectionEvent() },
					gift: { ok: true, value: over.notice ?? covering.notice },
					settled: { ok: true, value: over.settlement ?? covering.settlement }
				})
			}),
			DELIVERY
		);

	it('records the fee the donor added, never the one the processor took', async () => {
		const result = await collectCovering(mailer().port);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const [gift] = await db.select().from(donation);
		expect(gift).toMatchObject({ totalMinor: 2600, feeMinor: 100 });
	});

	it('records it on every later charge too, not only the one that opened the commitment', async () => {
		await collectCovering(mailer().port);

		await collectCovering(mailer().port, {
			event: secondCollection.event,
			notice: notice({ ...covering.notice, providerTxnId: 'pi_collect_2' }),
			settlement: settlement({
				...covering.settlement,
				providerTxnId: 'pi_collect_2',
				occurredAt: new Date('2026-09-03T12:00:00.000Z')
			})
		});

		// a commitment collects for years, so the split has to survive the charge that opened it —
		// which is the charge whose metadata is the only one anybody ever looked at.
		const gifts = await db.select().from(donation).orderBy(donation.receivedAt);
		expect(gifts.map((g) => g.feeMinor)).toEqual([100, 100]);
	});

	it('receipts the donor for the whole charge, the part they added included', async () => {
		const mail = mailer();

		await collectCovering(mail.port);

		// the money that left the donor's account is the figure on the document, and the split
		// behind it is a column and a ledger entry rather than a line on a receipt (see
		// packages/emails/src/templates/receipt.tsx), so neither figure it was made of appears.
		const receipt = mail.sent.find((m) => m.to === 'ada@example.org');
		expect(receipt?.text).toContain('USD 26.00');
		expect(receipt?.text).not.toContain('USD 25.00');
		expect(receipt?.text).not.toContain('USD 1.00');
	});

	it('records no fee where the organisation absorbed it', async () => {
		const mail = mailer();

		await settleDelivery(deps({ email: mail.port }), DELIVERY);

		const [gift] = await db.select().from(donation);
		expect(gift?.feeMinor).toBe(0);
		// and the receipt reads the same either way: it states the total charged and never how that
		// total was made up (packages/emails/src/templates/receipt.tsx), so who absorbed the fee is
		// not a question the document raises.
		const receipt = mail.sent.find((m) => m.to === 'ada@example.org');
		expect(receipt?.text.toLowerCase()).not.toContain('fee');
	});

	it('records no fee where the commitment does not say what the split was', async () => {
		const mail = mailer();

		await collectCovering(mail.port, {
			notice: notice({
				metadata: {
					[DONATION_METADATA_KEY]: AUTHORIZED_ID,
					[INTERVAL_METADATA_KEY]: 'monthly'
				}
			})
		});

		// the money is recorded whatever the metadata left out: a split is a label on a charge that
		// has already been collected, and refusing the gift over it is the worse trade — the same one
		// `attribution` makes for the cadence.
		const [gift] = await db.select().from(donation);
		expect(gift).toMatchObject({ totalMinor: 2600, feeMinor: 0 });
		// and the donor is still receipted for everything they were charged, which is the one figure
		// the document carries either way.
		const receipt = mail.sent.find((m) => m.to === 'ada@example.org');
		expect(receipt?.text).toContain('USD 26.00');
	});
});

describe('settleDelivery() — a collection delivered twice', () => {
	// the gift the donor authorized, which the commitment names and the first collection claims.
	beforeEach(async () => {
		await authorizeGift();
	});

	it('answers a redelivered first collection without opening a second commitment', async () => {
		await settleDelivery(deps(), DELIVERY);

		const again = await settleDelivery(deps(), DELIVERY);

		// refused by `payment_provider_txn_idx` on the charge, and by
		// `recurring_plan_provider_subscription_idx` on the commitment — either alone rolls the
		// whole batch back.
		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(await db.select().from(recurringPlan)).toHaveLength(1);
		expect(await db.select().from(donation)).toHaveLength(1);
		expect(await db.select().from(entryGroup)).toHaveLength(2);
	});

	it('answers a redelivered later collection without posting it again', async () => {
		await settleDelivery(deps(), DELIVERY);
		const later = deps({
			provider: provider({
				verify: { ok: true, value: secondCollection.event },
				gift: { ok: true, value: secondCollection.notice },
				settled: { ok: true, value: secondCollection.settlement }
			})
		});
		await settleDelivery(later, DELIVERY);

		const again = await settleDelivery(later, DELIVERY);

		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(await db.select().from(donation)).toHaveLength(2);
		expect(await db.select().from(entryGroup)).toHaveLength(4);
	});

	it('records one gift when the same first collection arrives twice at once', async () => {
		const [first, second] = await Promise.all([
			settleDelivery(deps(), DELIVERY),
			settleDelivery(deps(), DELIVERY)
		]);

		// whichever of them lost the race, no invariant depends on which: a commitment is opened
		// once because the unique index says so, and the loser carries on to the charge it was
		// about rather than abandoning it.
		expect(first?.ok).toBe(true);
		expect(second?.ok).toBe(true);
		expect(await db.select().from(recurringPlan)).toHaveLength(1);
		expect(await db.select().from(donation)).toHaveLength(1);
		expect(await db.select().from(payment)).toHaveLength(1);
		expect(await db.select().from(entryGroup)).toHaveLength(2);
	});
});

/**
 * the PaymentIntent delivery that accompanies every collection.
 *
 * Stripe sends `payment_intent.succeeded` for a collection's own intent exactly as it does for a
 * one-off gift, so this is the delivery that would double-post every repeating gift. the rule that
 * refuses it lives in ./settle.ts — a settled transaction is posted only where the intent names a
 * gift, and the processor mints a collection's intent carrying nothing of ours.
 */
const collectionIntentEvent = (): PaymentEvent => ({
	id: 'evt_intent_1',
	kind: 'settlement',
	type: 'payment_intent.succeeded',
	providerTxnId: 'pi_collect_1',
	occurredAt: new Date('2026-08-03T12:00:00.000Z')
});

describe('settleDelivery() — the PaymentIntent behind a collection', () => {
	// the gift the donor authorized, which the commitment names and the first collection claims.
	beforeEach(async () => {
		await authorizeGift();
	});

	it('posts nothing when it arrives after the collection was recorded', async () => {
		await settleDelivery(deps(), DELIVERY);

		const result = await settleDelivery(
			deps({ provider: provider({ verify: { ok: true, value: collectionIntentEvent() } }) }),
			DELIVERY
		);

		// the payment row this collection wrote carries that very transaction id, so a lookup by
		// transaction would find it — posting against it is what would put every repeating gift in
		// the books twice, both times reading clean.
		expect(result).toMatchObject({ ok: true, outcome: 'unnamed' });
		expect(await db.select().from(entryGroup)).toHaveLength(2);
		expect(await db.select().from(donation)).toHaveLength(1);
	});

	it('writes nothing and tells nobody when it arrives before the collection does', async () => {
		const mail = mailer();

		const result = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider({ verify: { ok: true, value: collectionIntentEvent() } })
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'unnamed' });
		expect(await db.select().from(entryGroup)).toHaveLength(0);
		// no alert: this is not a gift gone missing, it is a delivery about money the invoice
		// delivery records. an operator mailed about every collection would stop reading them.
		expect(mail.sent).toHaveLength(0);
	});

	it('leaves the collection’s own payment row exactly as the collection wrote it', async () => {
		await settleDelivery(deps(), DELIVERY);
		const [before] = await db.select().from(payment);

		await settleDelivery(
			deps({
				provider: provider({
					verify: { ok: true, value: collectionIntentEvent() },
					settled: { ok: true, value: settlement({ method: 'ach', status: 'pending' }) }
				})
			}),
			DELIVERY
		);

		const [after] = await db.select().from(payment);
		expect(after).toEqual(before);
	});
});

describe('settleDelivery() — a collection this deployment cannot attribute', () => {
	/**
	 * every way a commitment can fail to say which gift it is collecting.
	 *
	 * the donor and the form are not among them and cannot be: they are columns on the gift this
	 * pointer names, both of them foreign keys, so a gift that is there names a donor that is there.
	 * the pointer is the whole of what can be missing.
	 */
	const unattributable: readonly [string, Record<string, string>][] = [
		['no gift named', commitmentMetadata({ [DONATION_METADATA_KEY]: '' })],
		[
			'a gift that is not in this database',
			commitmentMetadata({ [DONATION_METADATA_KEY]: '019fb399-0000-7000-8000-000000000099' })
		]
	];

	it.each(unattributable)(
		'answers a commitment with %s, and tells an operator',
		async (_, metadata) => {
			const mail = mailer();

			const result = await settleDelivery(
				deps({
					email: mail.port,
					provider: provider({ gift: { ok: true, value: notice({ metadata }) } })
				}),
				DELIVERY
			);

			// answered rather than held open: what is missing is on the commitment at Stripe, and a
			// redelivery arrives at the same missing thing three days running.
			expect(result).toMatchObject({ ok: true, outcome: 'unmatched' });
			expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
			expect(mail.sent[0]?.text).toContain(GIFT_ID);
		}
	);

	it.each(unattributable)('writes nothing at all for a commitment with %s', async (_, metadata) => {
		await settleDelivery(
			deps({ provider: provider({ gift: { ok: true, value: notice({ metadata }) } }) }),
			DELIVERY
		);

		expect(await db.select().from(recurringPlan)).toHaveLength(0);
		expect(await db.select().from(donation)).toHaveLength(0);
		expect(await db.select().from(payment)).toHaveLength(0);
		expect(await db.select().from(entryGroup)).toHaveLength(0);
	});

	it('answers a commitment whose gift names no form, and writes nothing', async () => {
		// `donation.form_id` is nullable — a staff-entered gift names none — and the fund every
		// charge in a series posts to is read off the form, so there is nowhere to put this money.
		const authorized = await authorizeGift();
		await env.DB.prepare(`update donation set form_id = null where id = ?`).bind(authorized).run();
		const mail = mailer();

		const result = await settleDelivery(deps({ email: mail.port }), DELIVERY);

		expect(result).toMatchObject({ ok: true, outcome: 'unmatched' });
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(await db.select().from(recurringPlan)).toHaveLength(0);
		expect(await db.select().from(payment)).toHaveLength(0);
		expect(await db.select().from(entryGroup)).toHaveLength(0);
	});
});

describe('settleDelivery() — a collection that did not succeed', () => {
	// the gift the donor authorized, which the commitment names and the first collection claims.
	beforeEach(async () => {
		await authorizeGift();
	});

	it.each(['failed', 'cancelled', 'pending'] as const)(
		'records nothing for a %s attempt',
		async (status) => {
			const mail = mailer();

			const result = await settleDelivery(
				deps({
					email: mail.port,
					provider: provider({
						verify: { ok: true, value: collectionEvent({ type: 'invoice.payment_failed' }) },
						settled: { ok: true, value: settlement({ status }) }
					})
				}),
				DELIVERY
			);

			// nothing was collected, so the gift the donor authorized stays where it is and no
			// commitment opens over it. the rail's own retry schedule is what tries again.
			expect(result).toMatchObject({ ok: true, outcome: 'uncollected' });
			expect(await db.select().from(recurringPlan)).toHaveLength(0);
			expect(await db.select().from(payment)).toHaveLength(0);
			expect(await db.select().from(entryGroup)).toHaveLength(0);
			const [authorized] = await db.select().from(donation);
			expect(authorized).toMatchObject({ id: AUTHORIZED_ID, recurringId: null });
			// no mail to anyone: a donor whose card is merely expiring is not an incident, and this is
			// the delivery a deployment would otherwise mail about every month.
			expect(mail.sent).toHaveLength(0);
		}
	);

	it('marks a commitment the rail has given up on', async () => {
		await settleDelivery(deps(), DELIVERY);

		const result = await settleDelivery(
			deps({
				provider: provider({
					verify: { ok: true, value: collectionEvent({ type: 'invoice.payment_failed' }) },
					gift: { ok: true, value: notice({ state: 'lapsed', endedAt: null }) },
					settled: { ok: true, value: settlement({ status: 'failed' }) }
				})
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'stopped' });
		const [plan] = await db.select().from(recurringPlan);
		expect(plan).toMatchObject({ status: 'lapsed', nextChargeAt: null });
		// a commitment that lapsed rather than being cancelled reports no end date of its own, so
		// the delivery's own time is what says when this deployment learned of it.
		expect(plan?.endedAt).toEqual(new Date('2026-08-03T12:00:00.000Z'));
	});
});

/** a delivery about the commitment's own standing, which names no collection at all. */
const standingEvent = (over: Partial<RecurringEvent> = {}): PaymentEvent => ({
	id: 'evt_standing_1',
	kind: 'recurring',
	type: 'customer.subscription.deleted',
	providerNoticeId: GIFT_ID,
	occurredAt: new Date('2026-11-03T12:00:00.000Z'),
	...over
});

describe('settleDelivery() — a commitment that has stopped', () => {
	// the gift the donor authorized, which the commitment names and the first collection claims.
	beforeEach(async () => {
		await authorizeGift();
	});

	const ended = {
		verify: { ok: true as const, value: standingEvent() },
		gift: {
			ok: true as const,
			value: standingNotice({
				state: 'ended',
				endedAt: new Date('2026-11-01T09:00:00.000Z'),
				nextChargeAt: null
			})
		}
	};

	it('records the ending on the commitment it belongs to', async () => {
		await settleDelivery(deps(), DELIVERY);

		const result = await settleDelivery(deps({ provider: provider(ended) }), DELIVERY);

		expect(result).toMatchObject({ ok: true, outcome: 'stopped' });
		const [plan] = await db.select().from(recurringPlan);
		expect(plan).toMatchObject({
			status: 'cancelled',
			endedAt: new Date('2026-11-01T09:00:00.000Z'),
			// null is "none expected", which covers a commitment that has ended.
			nextChargeAt: null
		});
	});

	it('leaves the gifts it already collected alone', async () => {
		await settleDelivery(deps(), DELIVERY);

		await settleDelivery(deps({ provider: provider(ended) }), DELIVERY);

		// ending a commitment is not a reversal: what it collected stays collected and stays posted.
		expect(await db.select().from(donation)).toHaveLength(1);
		expect(await db.select().from(entryGroup)).toHaveLength(2);
	});

	it('keeps the first ending when the delivery arrives again', async () => {
		await settleDelivery(deps(), DELIVERY);
		await settleDelivery(deps({ provider: provider(ended) }), DELIVERY);

		const again = await settleDelivery(
			deps({
				provider: provider({
					verify: { ok: true, value: standingEvent({ id: 'evt_standing_2' }) },
					gift: {
						ok: true,
						value: standingNotice({
							state: 'ended',
							endedAt: new Date('2026-12-25T00:00:00.000Z'),
							nextChargeAt: null
						})
					}
				})
			}),
			DELIVERY
		);

		// a commitment stops once, so the first ending recorded is the one that stands.
		expect(again).toMatchObject({ ok: true, outcome: 'ignored' });
		const [plan] = await db.select().from(recurringPlan);
		expect(plan?.endedAt).toEqual(new Date('2026-11-01T09:00:00.000Z'));
	});

	it('answers a commitment this deployment holds no record of, and writes nothing', async () => {
		const mail = mailer();

		const result = await settleDelivery(
			deps({ email: mail.port, provider: provider(ended) }),
			DELIVERY
		);

		// a gift whose first collection never succeeded has no row here by design, and a
		// subscription made outside this app on the same account has none either.
		expect(result).toMatchObject({ ok: true, outcome: 'ignored' });
		expect(await db.select().from(recurringPlan)).toHaveLength(0);
		expect(mail.sent).toHaveLength(0);
	});

	it('changes nothing on a commitment that is merely collecting', async () => {
		await settleDelivery(deps(), DELIVERY);
		const [before] = await db.select().from(recurringPlan);

		const result = await settleDelivery(
			deps({
				provider: provider({
					verify: { ok: true, value: standingEvent({ type: 'customer.subscription.updated' }) },
					gift: { ok: true, value: standingNotice() }
				})
			}),
			DELIVERY
		);

		// an update fires on every renewal too, which is the cost of subscribing to it.
		expect(result).toMatchObject({ ok: true, outcome: 'ignored' });
		const [after] = await db.select().from(recurringPlan);
		expect(after).toEqual(before);
	});
});

describe('settleDelivery() — a commitment that starts collecting again', () => {
	// the gift the donor authorized, which the commitment names and the first collection claims.
	beforeEach(async () => {
		await authorizeGift();
	});

	/** the delivery that lapsed it: the rail gave up while the donor's card was refusing. */
	const lapse = async () => {
		await settleDelivery(
			deps({
				provider: provider({
					verify: { ok: true, value: standingEvent({ type: 'customer.subscription.updated' }) },
					gift: { ok: true, value: standingNotice({ state: 'lapsed' }) }
				})
			}),
			DELIVERY
		);
		const [plan] = await db.select().from(recurringPlan);
		expect(plan?.status).toBe('lapsed');
	};

	it('restores a lapsed commitment the rail reports as collecting', async () => {
		await settleDelivery(deps(), DELIVERY);
		await lapse();

		const result = await settleDelivery(
			deps({
				provider: provider({
					verify: { ok: true, value: standingEvent({ type: 'customer.subscription.updated' }) },
					gift: {
						ok: true,
						value: standingNotice({
							state: 'active',
							nextChargeAt: new Date('2026-12-03T12:00:00.000Z')
						})
					}
				})
			}),
			DELIVERY
		);

		// the rail's `unpaid` is this app's `lapsed`, and a donor who pays the outstanding invoice
		// puts it back to collecting — so a row that could not come back would read "stopped" while
		// the gift charged every month.
		expect(result).toMatchObject({ ok: true, outcome: 'updated' });
		const [plan] = await db.select().from(recurringPlan);
		expect(plan).toMatchObject({
			status: 'active',
			endedAt: null,
			nextChargeAt: new Date('2026-12-03T12:00:00.000Z')
		});
	});

	it('restores it when the collection itself is what says so', async () => {
		await settleDelivery(deps(), DELIVERY);
		await lapse();

		const result = await settleDelivery(
			deps({
				provider: provider({
					verify: { ok: true, value: secondCollection.event },
					gift: { ok: true, value: secondCollection.notice },
					settled: { ok: true, value: secondCollection.settlement }
				})
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const [plan] = await db.select().from(recurringPlan);
		expect(plan).toMatchObject({ status: 'active', endedAt: null });
	});

	it('never revives a commitment somebody cancelled', async () => {
		await settleDelivery(deps(), DELIVERY);
		await settleDelivery(
			deps({
				provider: provider({
					verify: { ok: true, value: standingEvent() },
					gift: {
						ok: true,
						value: standingNotice({
							state: 'ended',
							endedAt: new Date('2026-11-01T09:00:00.000Z')
						})
					}
				})
			}),
			DELIVERY
		);

		const result = await settleDelivery(
			deps({
				provider: provider({
					verify: { ok: true, value: standingEvent({ type: 'customer.subscription.updated' }) },
					gift: { ok: true, value: standingNotice({ state: 'active' }) }
				})
			}),
			DELIVERY
		);

		// cancelling is this app's own act and it is permanent: giving again is a new commitment,
		// which is what keeps a cancellation something an operator can rely on.
		expect(result).toMatchObject({ ok: true, outcome: 'ignored' });
		const [plan] = await db.select().from(recurringPlan);
		expect(plan).toMatchObject({
			status: 'cancelled',
			endedAt: new Date('2026-11-01T09:00:00.000Z')
		});
	});
});

describe('settleDelivery() — a collection that carries no transaction', () => {
	it('tells an operator rather than reading it as the commitment’s standing', async () => {
		const mail = mailer();

		const result = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider({ gift: { ok: true, value: notice({ providerTxnId: null }) } })
			}),
			DELIVERY
		);

		// an invoice marked paid out of band has no attempt to read, and `invoice.paid` is
		// subscribed to precisely because it covers that case — so this is money received. the
		// amount and the fee are not there to read, so nothing is synthesised for it.
		expect(result).toMatchObject({ ok: true, outcome: 'unmatched' });
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(await db.select().from(donation)).toHaveLength(0);
		expect(await db.select().from(entryGroup)).toHaveLength(0);
	});
});

describe('settleDelivery() — a repeating gift that could not be read', () => {
	it('stays quiet about an invoice no repeating gift raised', async () => {
		const mail = mailer();

		const result = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider({
					gift: { ok: false, reason: 'not_found', detail: 'raised by no subscription' }
				})
			}),
			DELIVERY
		);

		// an invoice raised by hand on the same account arrives here exactly as a repeating gift's
		// does, and only the second is a gift this app keeps books for.
		expect(result).toMatchObject({ ok: true, outcome: 'ignored' });
		expect(mail.sent).toHaveLength(0);
	});

	it.each(['internal_error', 'invalid_request'] as const)(
		'tells an operator when the read failed with %s',
		async (reason) => {
			const mail = mailer();

			const result = await settleDelivery(
				deps({
					email: mail.port,
					provider: provider({ gift: { ok: false, reason, detail: 'the adapter threw' } })
				}),
				DELIVERY
			);

			// terminal but nobody's fault but ours: an `invoice.paid` dropped here is money already
			// collected, and answering 200 with nothing said loses it silently.
			expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
			expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		}
	);

	/**
	 * a collection whose fee the processor has not computed yet is held open, exactly as a one-off
	 * gift's is.
	 *
	 * the same read answers both paths (`readSettlement` in ../payments/stripe.ts), so a commitment
	 * gets the wait and the redelivery for nothing — and it is the path that needs them most, because
	 * a fee missed here is missed again on every collection for as long as the gift repeats.
	 */
	it('asks for a collection again when its fee is not computed yet, and writes nothing', async () => {
		const mail = mailer();

		const result = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider({
					settled: {
						ok: false,
						reason: 'fee_not_ready',
						detail: 'the balance transaction has not been computed'
					}
				})
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: false, reason: 'incomplete' });
		expect(await db.select().from(recurringPlan)).toHaveLength(0);
		expect(mail.sent).toHaveLength(0);
	});
});

describe('settleDelivery() — a collection the books cannot take', () => {
	/** every figure `post()` refuses, each of which would otherwise be a throw and a 500. */
	const unpostable: readonly [string, Partial<Settlement>][] = [
		['no money at all', { amountMinor: 0 }],
		['a negative amount', { amountMinor: -2500 }],
		['an amount that is not whole', { amountMinor: 25.5 }],
		['a currency the ledger will not hold', { currency: 'usd' }],
		['no time it happened', { occurredAt: new Date('nonsense') }],
		['a fee that is not whole', { feeMinor: 10.5 }]
	];

	it.each(unpostable)('answers a collection with %s rather than throwing', async (_, over) => {
		const mail = mailer();

		const result = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider({ settled: { ok: true, value: settlement(over) } })
			}),
			DELIVERY
		);

		// a 500 here is read by the processor as "deliver this again" for three days, and the same
		// figure would be refused every time.
		expect(result.ok).toBe(true);
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(await db.select().from(recurringPlan)).toHaveLength(0);
		expect(await db.select().from(donation)).toHaveLength(0);
		expect(await db.select().from(entryGroup)).toHaveLength(0);
	});

	it('answers a commitment the table itself refuses', async () => {
		const mail = mailer();

		const result = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider({ gift: { ok: true, value: notice({ providerCustomerId: '' }) } })
			}),
			DELIVERY
		);

		// `recurring_plan_provider_customer_id_not_blank_check` refuses it, and refuses it
		// identically on every redelivery — so it is answered rather than held open for three days.
		expect(result).toMatchObject({ ok: true, outcome: 'unmatched' });
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(await db.select().from(donation)).toHaveLength(0);
	});
});

describe('settleDelivery() — a collection whose fee is unknown', () => {
	// the gift the donor authorized, which the commitment names and the first collection claims.
	beforeEach(async () => {
		await authorizeGift();
	});

	it('posts the gift, posts no fee, and says so', async () => {
		const mail = mailer();

		const result = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider({ settled: { ok: true, value: settlement({ feeMinor: null }) } })
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const [row] = await db.select().from(payment);
		expect(await groupLines('payment', row!.id)).not.toBeNull();
		// no number is invented for it: undeposited funds stays overstated until somebody posts it,
		// and on a repeating gift that happens again every month until it is noticed.
		expect(await groupLines('fee', row!.id)).toBeNull();
		// two messages to the operator and no more: the fee, once, and the notice that a repeating
		// gift started — a different message about a different thing. the donor's own receipt goes on
		// the same collection and says nothing about a fee (see `feeMinor` in ./collect.ts).
		expect(mail.sent.filter((m) => m.to === 'ops@hope.example').map((m) => m.subject)).toEqual([
			'A collection under a repeating gift was posted with no processor fee',
			'A gift of USD 25.00 was received'
		]);
	});

	/**
	 * a transport that throws on the messages a predicate picks, and records the rest.
	 *
	 * a throw rather than an `ok: false`: `EmailProvider.send` promises a result, and what this
	 * stands in for is the binding underneath it faulting — which is what escapes a send nobody
	 * wrapped.
	 */
	function brittleMailer(faultsOn: (message: EmailMessage) => boolean) {
		const sent: EmailMessage[] = [];
		const port: EmailProvider = {
			async send(message) {
				if (faultsOn(message)) throw new Error('the socket went away');
				sent.push(message);
				return { ok: true };
			}
		};
		return { port, sent };
	}

	const feeUnknown = () =>
		provider({ settled: { ok: true, value: settlement({ feeMinor: null }) } });

	it('keeps a banked collection banked when that alert throws', async () => {
		const mail = brittleMailer((m) => m.subject.includes('no processor fee'));

		const result = await settleDelivery(
			deps({ email: mail.port, provider: feeUnknown() }),
			DELIVERY
		);

		// the money is in the books before this alert is composed, so a throw out of it would be a
		// 500 the processor reads as "deliver this again" for three days — every retry refused by
		// `payment_provider_txn_idx`, and no alert firing because the throw is in the thing that
		// alerts.
		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const [gift] = await db.select().from(donation);
		expect(gift?.totalMinor).toBe(2500);
		expect(mail.sent.some((m) => m.subject.includes('could not be attempted'))).toBe(true);
	});

	it('does not escape when the report about it throws too', async () => {
		const mail = brittleMailer(() => true);

		const result = await settleDelivery(
			deps({ email: mail.port, provider: feeUnknown() }),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(mail.sent).toHaveLength(0);
		expect(await db.select().from(donation)).toHaveLength(1);
	});
});

describe('settleDelivery() — a commitment whose cadence the metadata does not spell', () => {
	// the gift the donor authorized, which the commitment names and the first collection claims.
	beforeEach(async () => {
		await authorizeGift();
	});

	it.each(['', 'weekly'] as const)(
		'falls back to the rail’s own schedule when it is %s',
		async (spelling) => {
			const result = await settleDelivery(
				deps({
					provider: provider({
						gift: {
							ok: true,
							value: notice({
								metadata: commitmentMetadata({ [INTERVAL_METADATA_KEY]: spelling }),
								interval: 'yearly'
							})
						}
					})
				}),
				DELIVERY
			);

			// the schedule is the processor's own answer rather than a guess, so money reaches the books
			// over this app's preferred spelling of a cadence.
			expect(result).toMatchObject({ ok: true, outcome: 'posted' });
			const [plan] = await db.select().from(recurringPlan);
			expect(plan?.interval).toBe('yearly');
		}
	);

	it('keeps the metadata authoritative where it says something this app spells', async () => {
		await settleDelivery(
			deps({
				provider: provider({
					gift: { ok: true, value: notice({ interval: 'yearly' }) }
				})
			}),
			DELIVERY
		);

		const [plan] = await db.select().from(recurringPlan);
		expect(plan?.interval).toBe('monthly');
	});

	it('refuses only when neither the metadata nor the schedule can say', async () => {
		const mail = mailer();

		const result = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider({
					gift: {
						ok: true,
						value: notice({
							metadata: commitmentMetadata({ [INTERVAL_METADATA_KEY]: 'weekly' }),
							interval: null
						})
					}
				})
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'unmatched' });
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
	});
});

describe('settleDelivery() — the notice that a repeating gift started', () => {
	// the gift the donor authorized, which the commitment names and the first collection claims.
	beforeEach(async () => {
		await authorizeGift();
	});

	/** the operational mail, which is every message that went to the address the console names. */
	const noticesIn = (sent: readonly EmailMessage[]) =>
		sent.filter((m) => m.to === 'ops@hope.example');

	/** the second collection, delivered exactly as the rail sends it. */
	const collectAgain = (email: EmailProvider) =>
		settleDelivery(
			deps({
				email,
				provider: provider({
					verify: { ok: true, value: secondCollection.event },
					gift: { ok: true, value: secondCollection.notice },
					settled: { ok: true, value: secondCollection.settlement }
				})
			}),
			DELIVERY
		);

	it('tells the organisation once on the charge that opens the commitment', async () => {
		const mail = mailer();

		const result = await settleDelivery(deps({ email: mail.port }), DELIVERY);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const notices = noticesIn(mail.sent);
		expect(notices).toHaveLength(1);
		expect(notices[0]?.subject).toContain('USD 25.00');
		expect(notices[0]?.text).toContain('Ada Okafor');
		expect(notices[0]?.text).toContain('General Fund');
		// the fact that makes it a different piece of news from a one-off gift of the same size.
		expect(notices[0]?.text).toContain('first collection');
	});

	it('tells them nothing about a later collection, and receipts the donor anyway', async () => {
		await settleDelivery(deps(), DELIVERY);
		const mail = mailer();

		const result = await collectAgain(mail.port);

		// a commitment collects every month for years. announcing each one is how an operational
		// address stops being read; the donor's own receipt is what every collection still gets.
		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(noticesIn(mail.sent)).toHaveLength(0);
		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org']);
	});

	it('still goes for a donor who gave no address, and says no receipt went with it', async () => {
		await env.DB.prepare(`update contact set primary_email = null where id = ?`)
			.bind(CONTACT_ID)
			.run();
		const mail = mailer();

		const result = await settleDelivery(deps({ email: mail.port }), DELIVERY);

		// the same silence the one-off path had: ./receipt.ts sends nothing and stamps nothing for a
		// donor with no address, so without this message a commitment could start in total silence.
		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(mail.sent[0]?.text).toContain('no receipt was sent');
		expect(mail.sent[0]?.text).toContain('first collection');
	});

	it('answers the delivery the same way when the notice itself faults', async () => {
		/** a transport that throws on the notice alone, which is the binding under it faulting. */
		const sent: EmailMessage[] = [];
		const brittle: EmailProvider = {
			async send(message) {
				if (message.subject.includes('was received')) throw new Error('the socket went away');
				sent.push(message);
				return { ok: true };
			}
		};

		const result = await settleDelivery(deps({ email: brittle }), DELIVERY);

		// the collection is banked before any of this runs, so a throw would be a 500 the processor
		// reads as "deliver this again" for three days against a batch `payment_provider_txn_idx`
		// refuses every time. the notice swallows its own fault, so the receipt's failure path is not
		// dragged in to report a receipt that went perfectly well.
		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await db.select().from(entryGroup)).toHaveLength(2);
		expect(sent.map((m) => m.to)).toEqual(['ada@example.org']);
		expect(sent.some((m) => m.subject.includes('could not be attempted'))).toBe(false);
		const [gift] = await db.select().from(donation);
		expect(gift?.receiptSentAt).not.toBeNull();
	});

	it('sends no second notice when the first collection is delivered again', async () => {
		await settleDelivery(deps(), DELIVERY);
		const mail = mailer();

		const again = await settleDelivery(deps({ email: mail.port }), DELIVERY);

		// the batch is refused by `payment_provider_txn_idx` and every message is behind the batch, so
		// the constraint that keeps the money out of the books twice keeps this out too.
		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(mail.sent).toHaveLength(0);
	});
});

describe('the processor an operator is sent to', () => {
	/**
	 * every path in ./collect.ts that writes an operator a sentence, each run against one processor.
	 *
	 * a table rather than nine cases, because the claim is about the file and not about any one
	 * alert: eight of these end at the same instruction — find the commitment and record the gift by
	 * hand — so the way a wrong name gets written is a sentence added beside eight that already say
	 * the right one, and an arm added here is the same decision being made again on purpose.
	 *
	 * the outcome is on the table rather than left implied, and it is what keeps every case honest:
	 * an arm that stopped reaching its alert would still pass a "does not say Stripe" assertion.
	 */
	const alerting: readonly [
		string,
		SettleOutcome,
		{
			readonly script: Parameters<typeof provider>[0];
			readonly prepare?: () => Promise<unknown>;
		}
	][] = [
		[
			'a repeating gift that could not be read',
			'unactionable',
			{
				script: { gift: { ok: false, reason: 'invalid_request', detail: 'the call was malformed' } }
			}
		],
		[
			'a collection that carries no transaction',
			'unmatched',
			{ script: { gift: { ok: true, value: notice({ providerTxnId: null }) } } }
		],
		[
			'a transaction that could not be read',
			'unactionable',
			{
				script: { settled: { ok: false, reason: 'not_found', detail: 'no such object' } },
				prepare: authorizeGift
			}
		],
		[
			'a settlement the books cannot take',
			'unactionable',
			{
				script: { settled: { ok: true, value: settlement({ currency: 'usd' }) } },
				prepare: authorizeGift
			}
		],
		[
			'a commitment that names no gift',
			'unmatched',
			{
				script: {
					gift: {
						ok: true,
						value: notice({ metadata: commitmentMetadata({ [DONATION_METADATA_KEY]: '' }) })
					}
				}
			}
		],
		// no `prepare`, so the gift the commitment names was never authorized.
		['a gift the commitment names that is not here', 'unmatched', { script: {} }],
		[
			'a commitment whose gift names no form',
			'unmatched',
			{
				script: {},
				prepare: async () => {
					const authorized = await authorizeGift();
					await env.DB.prepare(`update donation set form_id = null where id = ?`)
						.bind(authorized)
						.run();
				}
			}
		],
		[
			'a commitment these tables will not hold',
			'unmatched',
			{
				script: { gift: { ok: true, value: notice({ providerCustomerId: '' }) } },
				prepare: authorizeGift
			}
		],
		[
			'a collection whose fee is unknown',
			'posted',
			{
				script: { settled: { ok: true, value: settlement({ feeMinor: null }) } },
				prepare: authorizeGift
			}
		]
	];

	/** every word this delivery put in front of a person, whichever message carried it. */
	const operatorProse = (sent: readonly EmailMessage[]) =>
		sent.map((m) => `${m.subject} ${m.text} ${m.html}`).join(' ');

	it.each(alerting)('names PayPal and never Stripe for %s', async (_, outcome, arm) => {
		await arm.prepare?.();
		const mail = mailer();

		const result = await settleDelivery(
			deps({ email: mail.port, provider: provider(arm.script, 'paypal') }),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome });
		// somewhere in the operational mail, because not every message on a path has a processor to
		// name — the receipt a donor is sent is about their gift.
		expect(operatorProse(mail.sent)).toContain('PayPal');
		// and nowhere at all, donor mail included: an operator reading the wrong name goes to a
		// dashboard the collection is not in.
		expect(operatorProse(mail.sent)).not.toContain('Stripe');
	});

	it.each(alerting)('names Stripe and never PayPal for %s', async (_, outcome, arm) => {
		await arm.prepare?.();
		const mail = mailer();

		const result = await settleDelivery(
			deps({ email: mail.port, provider: provider(arm.script, 'stripe') }),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome });
		expect(operatorProse(mail.sent)).toContain('Stripe');
		expect(operatorProse(mail.sent)).not.toContain('PayPal');
	});
});
