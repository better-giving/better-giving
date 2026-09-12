import { env } from 'cloudflare:test';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POSTING_ACCOUNTS, postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import type { PostableAccountId } from '../db/postable';
import { donation, entryGroup, ledgerEntry, lineItem, payment } from '../db/schema';
import type { EmailMessage, EmailProvider } from '../email/provider';
import { parseContact, type ParsedContact } from '../contacts/contact-input';
import type {
	PaymentEvent,
	PaymentFailureReason,
	PaymentProvider,
	PaymentResult,
	ProcessorName,
	Settlement,
	SettlementEvent
} from '../payments/provider';
import { recordDonation } from './record';
import type { SettleDeps, SettleOutcome } from './delivery';
import { failureIsNewsToTheDonor, settleDelivery } from './settle';

// the settlement half, against a real D1: what a verified delivery does to the payment row and to
// the books.
//
// the database is real because every claim here is about rows — a payment corrected, an entry
// group that sums to zero, a redelivery refused by a unique index. the two ports are injected,
// which is the seam ../payments/stripe.spec.ts takes one level lower: both are outbound HTTP, and a
// spec that reached either would pass or fail on somebody else's uptime.
//
// the pending row every case starts from is written by `recordDonation` rather than by hand, so
// what is being settled is the row the quote endpoint actually produces — including the quote-time
// claims this step exists to correct.

const FORM_ID = 'frm_settlepath00001';
/** the cause a gift in this file may be credited to. */
const PROGRAM_ID = '019fb800-0000-7000-8000-000000000001';

/**
 * a second fund, so that "the gift posts to the fund its line names" is a claim with two answers.
 *
 * 4120 is seeded in every fork and is not the fund the fixture gift's own line names, which is the
 * whole of what makes it usable here — any postable account that is not 4110 would do.
 */
const OTHER_FUND = postableId('donationsNonDeductible');

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
		'contact',
		'form',
		'program',
		'org_profile'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	// a cause a gift may be credited to. no migration seeds one.
	await env.DB.prepare(
		`insert into program (id, name, status, created_at, updated_at)
		 values (?, 'Clean water', 'active', 0, 0)`
	)
		.bind(PROGRAM_ID)
		.run();
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins,
		                   created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
	)
		.bind(FORM_ID, revenueAccountId)
		.run();
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, deductibility_statement, address_line1,
		                          city, country, notification_email, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', 'No goods or services were provided.',
		         '1 Main St', 'Springfield', 'US', 'ops@hope.example', 0, 0)`
	).run();
});

/** the fixture donor. `email: null` is the donor who gave one, which the form does not insist on. */
function donor(over: { email?: string | null } = {}): ParsedContact {
	const parsed = parseContact({
		kind: 'individual',
		first_name: 'Ada',
		last_name: 'Okafor',
		...(over.email === null ? {} : { primary_email: over.email ?? 'ada@example.org' })
	});
	if (!parsed.ok) throw new Error('the fixture donor did not parse');
	return parsed.value;
}

/** the pending gift a quote leaves behind, written by the module that writes it in production. */
async function pendingGift(
	over: {
		method?: 'card' | 'apple_pay' | 'ach' | 'paypal';
		/**
		 * which processor minted the intent, written onto the row exactly as ./record.ts writes it.
		 *
		 * it is half of `payment_provider_txn_idx`, which is the lookup the settlement path makes —
		 * so a fixture whose processor is not the answering provider's is a gift no delivery can
		 * find, and a case built on one silently tests the `unmatched` arm instead of its own.
		 */
		processor?: ProcessorName;
		providerTxnId?: string;
		/** `null` is a gift from a donor who left the address box empty. */
		donorEmail?: string | null;
		/** what the gift is made of. the total follows from it, the way `recordDonation` requires. */
		lines?: readonly { revenueAccountId: PostableAccountId; amountMinor: number }[];
		/** who the gift is given for, and who the donor asked us to tell about it. */
		tribute?: Parameters<typeof recordDonation>[1]['tribute'];
		/** the cause the gift is credited to, where it went to one. */
		programId?: string | null;
	} = {}
): Promise<{ donationId: string; paymentId: string }> {
	const donationId = crypto.randomUUID();
	const lines = (over.lines ?? [{ revenueAccountId, amountMinor: 10_000 }]).map((line) => ({
		label: 'Donation',
		...line
	}));
	const result = await recordDonation(db, {
		donationId,
		donor: donor(over.donorEmail === undefined ? {} : { email: over.donorEmail }),
		formId: FORM_ID,
		origin: 'https://acme.org',
		currency: 'USD',
		processor: over.processor ?? 'stripe',
		totalMinor: lines.reduce((total, line) => total + line.amountMinor, 0),
		feeMinor: 330,
		lines,
		method: over.method ?? 'card',
		providerTxnId: over.providerTxnId ?? 'pi_settle_1',
		occurredAt: new Date('2026-08-01T09:00:00.000Z'),
		consentedToContact: false,
		note: undefined,
		tribute: over.tribute ?? null,
		programId: over.programId ?? null
	});
	if (!result.ok) throw new Error(`the fixture gift was not recorded: ${result.detail}`);
	return { donationId, paymentId: result.value.paymentId };
}

/** what the processor says the transaction turned out to be. */
const settlement = (over: Partial<Settlement> = {}): Settlement => ({
	providerTxnId: 'pi_settle_1',
	status: 'succeeded',
	method: 'card',
	amountMinor: 10_000,
	currency: 'USD',
	feeMinor: 320,
	metadata: { donation_id: 'unused-by-the-lookup' },
	occurredAt: new Date('2026-08-03T12:00:00.000Z'),
	...over
});

const settledEvent = (over: Partial<SettlementEvent> = {}): PaymentEvent => ({
	id: 'evt_1',
	kind: 'settlement',
	type: 'payment_intent.succeeded',
	providerTxnId: 'pi_settle_1',
	occurredAt: new Date('2026-08-03T12:00:00.000Z'),
	...over
});

/** the payment port, answering from a script. */
function provider(
	verify: PaymentResult<PaymentEvent> = { ok: true, value: settledEvent() },
	read: PaymentResult<Settlement> = { ok: true, value: settlement() },
	processor: ProcessorName = 'stripe'
): PaymentProvider {
	return {
		processor,

		async createIntent() {
			throw new Error('createIntent is not part of the settlement path');
		},
		async verifyEvent() {
			return verify;
		},
		async readSettlement() {
			return read;
		},
		async readRecurringGift() {
			throw new Error('readRecurringGift is not part of the settlement path');
		},
		async readAccountChargeability() {
			throw new Error('readAccountChargeability is not part of the settlement path');
		},
		async prepareRecurringGifts() {
			throw new Error('prepareRecurringGifts is not part of the settlement path');
		},
		async readRecurringGiftProvision() {
			throw new Error('readRecurringGiftProvision is not part of the settlement path');
		},
		async createRecurringGift() {
			throw new Error('createRecurringGift is not part of the settlement path');
		},
		async cancelRecurringGift() {
			throw new Error('cancelRecurringGift is not part of the settlement path');
		},
		async readRailSwitchboard() {
			throw new Error('readRailSwitchboard is not part of the settlement path');
		},
		async listWebhookEndpoints() {
			throw new Error('listWebhookEndpoints is not part of the settlement path');
		},
		async registerWebhookEndpoint() {
			throw new Error('registerWebhookEndpoint is not part of the settlement path');
		},
		async resubscribeWebhookEndpoint() {
			throw new Error('resubscribeWebhookEndpoint is not part of the settlement path');
		},
		async replaceWebhookEndpoint() {
			throw new Error('replaceWebhookEndpoint is not part of the settlement path');
		},
		async listWalletDomains() {
			throw new Error('listWalletDomains is not part of the settlement path');
		},
		async registerWalletDomain() {
			throw new Error('registerWalletDomain is not part of the settlement path');
		}
	};
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

/**
 * a transport that throws on the messages a predicate picks, and records the rest.
 *
 * a throw rather than an `ok: false`, because they are different failures and only one of them is
 * modelled: `EmailProvider.send` promises a result, and what this stands in for is the binding
 * underneath it faulting — which is what escapes a send nobody wrapped.
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

const DELIVERY = { body: '{"id":"evt_1"}', headers: { 'stripe-signature': 't=1,v1=abc' } };

function deps(over: Partial<SettleDeps> = {}): SettleDeps {
	return { db, provider: provider(), email: mailer().port, ...over };
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

describe('settleDelivery() — a card that succeeded', () => {
	it('corrects the payment row the quote left behind', async () => {
		const gift = await pendingGift({ method: 'apple_pay' });

		const result = await settleDelivery(deps(), DELIVERY);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const [row] = await db.select().from(payment).where(eq(payment.id, gift.paymentId));
		// the wallet was the rail the donor was quoted on; the card is the rail that settled.
		expect(row).toMatchObject({
			status: 'succeeded',
			method: 'card',
			occurredAt: new Date('2026-08-03T12:00:00.000Z')
		});
	});

	it('leaves the gift’s own business date alone', async () => {
		const gift = await pendingGift();

		await settleDelivery(deps(), DELIVERY);

		// the day the donor gave, which is not the day the money moved.
		const [row] = await db.select().from(donation).where(eq(donation.id, gift.donationId));
		expect(row?.receivedAt).toEqual(new Date('2026-08-01T09:00:00.000Z'));
	});

	it('recognises the gift against undeposited funds, not the bank', async () => {
		const gift = await pendingGift();

		await settleDelivery(deps(), DELIVERY);

		const charge = await groupLines('payment', gift.paymentId);
		expect(charge?.lines).toHaveLength(2);
		// 4110 because the fixture gift's own line names it, not because this path has a default
		// fund — see the `settleDelivery() — the fund the gift lands in` block below.
		expect(charge?.lines.map((l) => [l.accountId, l.amountMinor]).sort()).toEqual(
			[
				[POSTING_ACCOUNTS.undepositedFunds.id, 10_000],
				[POSTING_ACCOUNTS.donationsDeductible.id, -10_000]
			].sort()
		);
		// a card charge is money the processor owes, so nothing reaches 1010 here.
		expect(charge?.lines.some((l) => l.accountId === POSTING_ACCOUNTS.bankCash.id)).toBe(false);
	});

	it('posts the processor’s own fee, never the figure the donor was quoted', async () => {
		const gift = await pendingGift();

		await settleDelivery(deps(), DELIVERY);

		const fee = await groupLines('fee', gift.paymentId);
		// the gift was quoted at 330 and the processor took 320.
		expect(fee?.lines.map((l) => [l.accountId, l.amountMinor]).sort()).toEqual(
			[
				[POSTING_ACCOUNTS.processorFees.id, 320],
				[POSTING_ACCOUNTS.undepositedFunds.id, -320]
			].sort()
		);
	});

	it('leaves both entry groups summing to exactly zero', async () => {
		await pendingGift();

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

	it('posts the business date the money moved on, not the date it was written', async () => {
		const gift = await pendingGift();

		await settleDelivery(deps(), DELIVERY);

		expect((await groupLines('payment', gift.paymentId))?.group.occurredAt).toEqual(
			new Date('2026-08-03T12:00:00.000Z')
		);
	});

	it('sends the donor a receipt and records that it went', async () => {
		const gift = await pendingGift();
		const mail = mailer();

		await settleDelivery(deps({ email: mail.port }), DELIVERY);

		expect(mail.sent.map((m) => m.to)).toContain('ada@example.org');
		const [row] = await db.select().from(donation).where(eq(donation.id, gift.donationId));
		expect(row?.receiptSentAt).not.toBeNull();
	});

	/**
	 * the cause reaches the receipt through the join `findTarget` takes, rather than through a read
	 * of its own — the whole path, off the gift's own `program_id`.
	 */
	it('states the cause the gift was credited to', async () => {
		await pendingGift({ programId: PROGRAM_ID });
		const mail = mailer();

		await settleDelivery(deps({ email: mail.port }), DELIVERY);

		const receipt = mail.sent.find((m) => m.to === 'ada@example.org');
		expect(receipt?.text).toContain('Clean water');
		expect(receipt?.html).toContain('Clean water');
	});

	it('states the dedication back to the donor, and never the person they asked us to tell', async () => {
		// the whole path, off the gift's own columns: the donor said who the gift is for and who to
		// tell, and only the first of those is a fact about their gift. the second is a third
		// party's name and address, and this document goes to the donor.
		await pendingGift({
			tribute: {
				kind: 'memory',
				honoree: 'Margaret Chen',
				notify: { name: 'Iris Chen', email: 'iris@example.org' }
			}
		});
		const mail = mailer();

		await settleDelivery(deps({ email: mail.port }), DELIVERY);

		const receipt = mail.sent.find((m) => m.to === 'ada@example.org');
		expect(receipt?.text).toContain('In memory of Margaret Chen');
		expect(receipt?.html).toContain('In memory of Margaret Chen');
		for (const arm of [receipt?.text ?? '', receipt?.html ?? '']) {
			expect(arm).not.toContain('Iris Chen');
			expect(arm).not.toContain('iris@example.org');
		}
	});
});

describe('settleDelivery() — the fund the gift lands in', () => {
	it('credits the fund the gift’s own line names', async () => {
		// the form points at 4110 and this gift's line does not, which is the whole claim: an
		// operator choosing a fund gets that fund, and the line is what carries the choice.
		const gift = await pendingGift({
			lines: [{ revenueAccountId: OTHER_FUND, amountMinor: 10_000 }]
		});

		await settleDelivery(deps(), DELIVERY);

		const charge = await groupLines('payment', gift.paymentId);
		expect(charge?.lines.map((l) => [l.accountId, l.amountMinor]).sort()).toEqual(
			[
				[POSTING_ACCOUNTS.undepositedFunds.id, 10_000],
				[POSTING_ACCOUNTS.donationsNonDeductible.id, -10_000]
			].sort()
		);
	});

	it('credits every fund a split gift names, each by its own line’s amount', async () => {
		const gift = await pendingGift({
			lines: [
				{ revenueAccountId, amountMinor: 6_000 },
				{ revenueAccountId: OTHER_FUND, amountMinor: 4_000 }
			]
		});

		await settleDelivery(deps(), DELIVERY);

		const charge = await groupLines('payment', gift.paymentId);
		// one debit for what moved, one credit per fund — never one credit for the total.
		expect(charge?.lines).toHaveLength(3);
		expect(charge?.lines.map((l) => [l.accountId, l.amountMinor]).sort()).toEqual(
			[
				[POSTING_ACCOUNTS.undepositedFunds.id, 10_000],
				[POSTING_ACCOUNTS.donationsDeductible.id, -6_000],
				[POSTING_ACCOUNTS.donationsNonDeductible.id, -4_000]
			].sort()
		);
		expect(charge?.lines.reduce((total, line) => total + line.amountMinor, 0)).toBe(0);
	});

	it('posts a split gift’s fee once, against undeposited funds', async () => {
		const gift = await pendingGift({
			lines: [
				{ revenueAccountId, amountMinor: 6_000 },
				{ revenueAccountId: OTHER_FUND, amountMinor: 4_000 }
			]
		});

		await settleDelivery(deps(), DELIVERY);

		// the fee is what the processor withheld and belongs to no fund, so splitting the gift
		// leaves it alone.
		expect(
			(await groupLines('fee', gift.paymentId))?.lines
				.map((l) => [l.accountId, l.amountMinor])
				.sort()
		).toEqual(
			[
				[POSTING_ACCOUNTS.processorFees.id, 320],
				[POSTING_ACCOUNTS.undepositedFunds.id, -320]
			].sort()
		);
	});
});

describe('settleDelivery() — a settlement the gift’s lines cannot account for', () => {
	it('posts nothing when the money that moved and the lines disagree', async () => {
		const gift = await pendingGift({
			lines: [
				{ revenueAccountId, amountMinor: 6_000 },
				{ revenueAccountId: OTHER_FUND, amountMinor: 4_000 }
			]
		});
		const mail = mailer();

		const result = await settleDelivery(
			deps({
				email: mail.port,
				// a partial capture: 60.00 moved against a gift itemized at 100.00.
				provider: provider(undefined, { ok: true, value: settlement({ amountMinor: 6_000 }) })
			}),
			DELIVERY
		);

		// no proportional allocation: which fund gave up the missing 40.00 is not something the
		// lines say, and a split nobody chose is worse than a gift a person posts by hand.
		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		expect(groups?.n).toBe(0);
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(mail.sent[0]?.text).toContain(gift.paymentId);
	});

	it('corrects the payment row it refused to post', async () => {
		const gift = await pendingGift();

		await settleDelivery(
			deps({
				provider: provider(undefined, { ok: true, value: settlement({ amountMinor: 6_000 }) })
			}),
			DELIVERY
		);

		// what the processor reports about the transaction is a fact whatever the books do with it,
		// and a row left `pending` would be a second thing for the operator to fix by hand.
		const [row] = await db.select().from(payment).where(eq(payment.id, gift.paymentId));
		expect(row).toMatchObject({
			status: 'succeeded',
			occurredAt: new Date('2026-08-03T12:00:00.000Z')
		});
	});

	it('refuses a gift carrying a line worth nothing', async () => {
		const gift = await pendingGift();
		// `line_item_line_total_minor_check` is `>= 0`, so this row is one a hand-written
		// `wrangler d1 execute` or an import can leave behind — and the lines still add up.
		await db.insert(lineItem).values({
			id: crypto.randomUUID(),
			donationId: gift.donationId,
			label: 'Donation',
			revenueAccountId: OTHER_FUND,
			unitPriceMinor: 0,
			lineTotalMinor: 0
		});

		const result = await settleDelivery(deps(), DELIVERY);

		// `post()` refuses a zero line by throwing, and a throw on this path is a 500 the processor
		// redelivers for three days against figures that answer identically every time.
		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		expect(groups?.n).toBe(0);
	});

	it('sends no receipt for a gift it did not post', async () => {
		const gift = await pendingGift();
		const mail = mailer();

		await settleDelivery(
			deps({
				email: mail.port,
				provider: provider(undefined, { ok: true, value: settlement({ amountMinor: 6_000 }) })
			}),
			DELIVERY
		);

		// the donor is receipted for a gift that is in the books, and this one is not. the null in
		// `receipt_sent_at` is the backlog that keeps it owed.
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		const [row] = await db.select().from(donation).where(eq(donation.id, gift.donationId));
		expect(row?.receiptSentAt).toBeNull();
	});
});

describe('settleDelivery() — a settlement the books cannot take', () => {
	// the gift's own lines are beyond reproach in every case here: what is wrong is the settlement,
	// which is the half `recognitionOf` has to refuse rather than let reach a `PostingError`.
	/** every figure `post()` refuses about the settlement itself, each otherwise a throw and a 500. */
	const unpostable: readonly [string, Partial<Settlement>][] = [
		['no money at all', { amountMinor: 0 }],
		['a negative amount', { amountMinor: -2500 }],
		['an amount that is not whole', { amountMinor: 25.5 }],
		['a currency the ledger will not hold', { currency: 'usd' }],
		['no time it happened', { occurredAt: new Date('nonsense') }],
		['a fee that is not whole', { feeMinor: 10.5 }]
	];

	it.each(unpostable)('answers a settlement with %s rather than throwing', async (_, over) => {
		const gift = await pendingGift();
		const mail = mailer();

		const result = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider(undefined, { ok: true, value: settlement(over) })
			}),
			DELIVERY
		);

		// answered rather than held open: a 500 is read by the processor as "deliver this again" for
		// three days, against a figure that would be refused identically every time.
		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		// the operator is told and the donor is not — the gift is not in the books to receipt.
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(await db.select().from(entryGroup)).toHaveLength(0);
		// and the row the quote left behind is still corrected, so `pending` is not a second thing
		// to fix by hand.
		const [row] = await db.select().from(payment).where(eq(payment.id, gift.paymentId));
		expect(row?.status).toBe('succeeded');
	});

	it('names the offending figure in what it sends the operator', async () => {
		await pendingGift();
		const mail = mailer();

		await settleDelivery(
			deps({
				email: mail.port,
				provider: provider(undefined, { ok: true, value: settlement({ currency: 'usd' }) })
			}),
			DELIVERY
		);

		// "this gift cannot be posted" is only actionable if it says which figure is wrong.
		expect(mail.sent[0]?.text).toContain('"usd"');
	});

	it('corrects the settled time on the row of a settlement it will not post', async () => {
		const gift = await pendingGift();

		await settleDelivery(
			deps({
				provider: provider(undefined, { ok: true, value: settlement({ currency: 'usd' }) })
			}),
			DELIVERY
		);

		// what the processor reports about the rail and the time is a fact whatever the books do
		// with it, so the whole correction runs even where nothing is posted.
		const [row] = await db.select().from(payment).where(eq(payment.id, gift.paymentId));
		expect(row?.occurredAt).toEqual(new Date('2026-08-03T12:00:00.000Z'));
	});

	it('leaves the quoted time standing where the processor reported none it can use', async () => {
		const gift = await pendingGift();

		await settleDelivery(
			deps({
				provider: provider(undefined, {
					ok: true,
					value: settlement({ occurredAt: new Date('nonsense') })
				})
			}),
			DELIVERY
		);

		// `payment.occurred_at` is NOT NULL and an Invalid Date binds NULL, so writing it would
		// take the correction down with the posting and hold the delivery open for three days.
		const [row] = await db.select().from(payment).where(eq(payment.id, gift.paymentId));
		expect(row?.occurredAt).toEqual(new Date('2026-08-01T09:00:00.000Z'));
	});
});

describe('settleDelivery() — a delivery that arrives twice', () => {
	it('answers the redelivery without posting a second time', async () => {
		await pendingGift();
		await settleDelivery(deps(), DELIVERY);

		const again = await settleDelivery(deps(), DELIVERY);

		// refused by `entry_group_source_idx`, which is where webhook idempotency lives.
		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		expect(groups?.n).toBe(2);
	});

	it('answers a redelivery of a gift split across funds the same way', async () => {
		await pendingGift({
			lines: [
				{ revenueAccountId, amountMinor: 6_000 },
				{ revenueAccountId: OTHER_FUND, amountMinor: 4_000 }
			]
		});
		await settleDelivery(deps(), DELIVERY);

		const again = await settleDelivery(deps(), DELIVERY);

		// the index is on `(source_type, source_id)` and the payment id is one whatever the gift is
		// made of, so more credit lines is not more ways in.
		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		const [lines] = await db.select({ n: sql<number>`count(*)` }).from(ledgerEntry);
		expect(lines?.n).toBe(5);
	});

	it('does not receipt the donor twice', async () => {
		await pendingGift();
		const mail = mailer();
		await settleDelivery(deps({ email: mail.port }), DELIVERY);
		const before = mail.sent.length;

		await settleDelivery(deps({ email: mail.port }), DELIVERY);

		// the whole point of not letting mail decide the answer: a redelivery re-runs a batch the
		// database refuses, and a donor must not get a second receipt out of it.
		expect(mail.sent).toHaveLength(before);
	});
});

describe('settleDelivery() — a transaction that did not settle', () => {
	it.each(['failed', 'cancelled', 'pending'] as const)(
		'records %s and posts nothing',
		async (status) => {
			const gift = await pendingGift();

			const result = await settleDelivery(
				deps({ provider: provider(undefined, { ok: true, value: settlement({ status }) }) }),
				DELIVERY
			);

			expect(result).toMatchObject({ ok: true, outcome: 'updated' });
			const [row] = await db.select().from(payment).where(eq(payment.id, gift.paymentId));
			expect(row?.status).toBe(status);
			const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
			expect(groups?.n).toBe(0);
		}
	);

	it('sends no receipt for a gift that did not settle', async () => {
		await pendingGift();
		const mail = mailer();

		await settleDelivery(
			deps({
				email: mail.port,
				provider: provider(undefined, { ok: true, value: settlement({ status: 'failed' }) })
			}),
			DELIVERY
		);

		expect(mail.sent).toHaveLength(0);
	});
});

describe('settleDelivery() — a gift that could not be collected', () => {
	/** a bank debit that failed days after the donor left the form. */
	const failedAch = (over: Partial<Settlement> = {}) =>
		provider(undefined, {
			ok: true,
			value: settlement({ status: 'failed', method: 'ach', ...over })
		});

	it('tells the donor nothing was collected', async () => {
		await pendingGift({ method: 'ach' });
		const mail = mailer();

		await settleDelivery(deps({ email: mail.port, provider: failedAch() }), DELIVERY);

		// an ACH failure arrives days later, so nothing was ever on screen and the donor is gone.
		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org']);
		expect(mail.sent[0]?.subject).toContain('did not go through');
	});

	it('says nothing to a donor whose card was declined', async () => {
		await pendingGift();
		const mail = mailer();

		await settleDelivery(
			deps({
				email: mail.port,
				provider: provider(undefined, { ok: true, value: settlement({ status: 'failed' }) })
			}),
			DELIVERY
		);

		// the decline was shown in the donor's browser as it happened, and a message arriving after
		// it would contradict the retry that succeeded.
		expect(mail.sent).toHaveLength(0);
	});

	it('says nothing about a bank debit still on its way', async () => {
		await pendingGift({ method: 'ach' });
		const mail = mailer();

		await settleDelivery(
			deps({ email: mail.port, provider: failedAch({ status: 'pending' }) }),
			DELIVERY
		);

		// nothing was posted, which is not the same fact as the attempt having ended: an ACH debit
		// in flight, a payment awaiting action and a payment being processed all land here, and
		// every one of them is a live gift.
		expect(mail.sent).toHaveLength(0);
	});

	it('tells the donor about a cancelled bank debit too', async () => {
		await pendingGift({ method: 'ach' });
		const mail = mailer();

		await settleDelivery(
			deps({ email: mail.port, provider: failedAch({ status: 'cancelled' }) }),
			DELIVERY
		);

		// `failed` and `cancelled` are the two terminal states of `PAYMENT_STATUSES`, and from the
		// donor's chair they are one fact: the gift was not collected.
		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org']);
	});

	it('tells the donor once, however many times the delivery arrives', async () => {
		await pendingGift({ method: 'ach' });
		const mail = mailer();
		await settleDelivery(deps({ email: mail.port, provider: failedAch() }), DELIVERY);

		const again = await settleDelivery(deps({ email: mail.port, provider: failedAch() }), DELIVERY);

		// nothing is posted on this path, so no unique index refuses the repeat the way it does for
		// a receipt — the row's own status before the write is what says the donor has been told.
		expect(again).toMatchObject({ ok: true, outcome: 'updated' });
		expect(mail.sent).toHaveLength(1);
	});

	it('says nothing when the donor has already given on this gift', async () => {
		const gift = await pendingGift({ method: 'ach' });
		// the retry that worked: a second attempt against the same gift, settled by another rail.
		await db.insert(payment).values({
			id: crypto.randomUUID(),
			donationId: gift.donationId,
			amountMinor: 10_000,
			currency: 'USD',
			direction: 'inbound',
			method: 'card',
			status: 'succeeded',
			provider: 'stripe',
			providerTxnId: 'pi_settle_retry',
			occurredAt: new Date('2026-08-02T09:00:00.000Z')
		});
		const mail = mailer();

		await settleDelivery(deps({ email: mail.port, provider: failedAch() }), DELIVERY);

		// a donor who gave must never be told their gift failed, whichever attempt the delivery is
		// about and whichever order the two arrive in.
		expect(mail.sent).toHaveLength(0);
	});

	it('falls back to the rail the row carries where the processor named none', async () => {
		await pendingGift({ method: 'ach' });
		const mail = mailer();

		await settleDelivery(
			deps({ email: mail.port, provider: failedAch({ method: null }) }),
			DELIVERY
		);

		// a failed attempt frequently reports no settled rail, and the quoted one is then the only
		// answer to "could the donor have seen this" there is.
		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org']);
	});
});

describe('settleDelivery() — what the donor’s message cannot do', () => {
	const failedAch = provider(undefined, {
		ok: true,
		value: settlement({ status: 'failed', method: 'ach' })
	});

	it('names the amount that was not collected', async () => {
		await pendingGift({ method: 'ach' });
		const mail = mailer();

		await settleDelivery(deps({ email: mail.port, provider: failedAch }), DELIVERY);

		// the attempt's own figure, off the payment row — the message is about a payment, not about
		// what the gift would have come to.
		expect(mail.sent[0]?.text).toContain('USD 100.00');
		expect(mail.sent[0]?.text).toContain('Hope Foundation');
	});

	it('tells an operator when the donor’s message does not send', async () => {
		await pendingGift({ method: 'ach' });
		const mail = mailer(false);

		const result = await settleDelivery(deps({ email: mail.port, provider: failedAch }), DELIVERY);

		// the delivery is answered exactly as it would have been: a non-200 would bring the whole
		// thing back for three days over a message, against a row that is already corrected.
		expect(result).toMatchObject({ ok: true, outcome: 'updated' });
		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org', 'ops@hope.example']);
	});

	it('answers the delivery when there is no organisation to write on behalf of', async () => {
		await pendingGift({ method: 'ach' });
		await env.DB.prepare(`delete from org_profile`).run();
		const mail = mailer();

		const result = await settleDelivery(deps({ email: mail.port, provider: failedAch }), DELIVERY);

		// nothing to sign the message with and nowhere to report that — the alert reaches the logs
		// and stops. what it must not do is throw on the money path.
		expect(result).toMatchObject({ ok: true, outcome: 'updated' });
		expect(mail.sent).toHaveLength(0);
	});
});

describe('failureIsNewsToTheDonor()', () => {
	// the whole of the rule, stated as the four rails rather than as the two answers: a rail added
	// to `PAYMENT_METHODS` is a decision somebody has to make here, and an `it.each` over the list
	// is where they will be made to make it.
	it.each([
		{ rail: 'ach', news: true, why: 'it fails days later, with the donor long gone' },
		{ rail: 'card', news: false, why: 'the decline was on screen in the donor’s browser' },
		{ rail: 'cash', news: false, why: 'staff entered it and no donor session existed' },
		{ rail: 'check', news: false, why: 'staff entered it and no donor session existed' }
	] as const)('is $news for $rail — $why', ({ rail, news }) => {
		expect(failureIsNewsToTheDonor(rail)).toBe(news);
	});
});

describe('settleDelivery() — a settlement with no gift behind it', () => {
	it('answers the delivery and tells an operator rather than asking for it again', async () => {
		// no `pendingGift`, so nothing in this deployment names that transaction.
		const mail = mailer();

		const result = await settleDelivery(deps({ email: mail.port }), DELIVERY);

		// nothing a redelivery does can make the row appear: a payment row is written when a quote
		// is minted or never.
		expect(result).toMatchObject({ ok: true, outcome: 'unmatched' });
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(mail.sent[0]?.text).toContain('pi_settle_1');
	});

	it('writes nothing at all', async () => {
		await settleDelivery(deps(), DELIVERY);

		const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		expect(groups?.n).toBe(0);
	});

	it('stays quiet where no notification address is saved', async () => {
		await env.DB.prepare(`update org_profile set notification_email = null`).run();
		const mail = mailer();

		const result = await settleDelivery(deps({ email: mail.port }), DELIVERY);

		// there is nowhere to send it, and an alert nobody configured must not become an exception
		// on the money path.
		expect(result.ok).toBe(true);
		expect(mail.sent).toHaveLength(0);
	});
});

describe('settleDelivery() — a delivery this app cannot act on', () => {
	it('refuses one whose signature did not check out, and asks for it again', async () => {
		const failed: PaymentResult<PaymentEvent> = {
			ok: false,
			reason: 'bad_signature',
			detail: 'the delivery did not verify'
		};

		const result = await settleDelivery(deps({ provider: provider(failed) }), DELIVERY);

		// a deployment holding the wrong signing secret has exactly one place this is visible, and
		// it is the processor's own delivery log.
		expect(result).toMatchObject({ ok: false, reason: 'unverified' });
	});

	it('sends no mail on an unverified delivery', async () => {
		const mail = mailer();

		await settleDelivery(
			deps({
				email: mail.port,
				provider: provider({ ok: false, reason: 'bad_signature', detail: 'nope' })
			}),
			DELIVERY
		);

		// this endpoint is public, so an unverified delivery is anyone's — mailing on one would be
		// a way to send mail from outside.
		expect(mail.sent).toHaveLength(0);
	});

	it.each(['rate_limited', 'unreachable', 'provider_error'] as const)(
		'asks for the delivery again when the read failed with %s',
		async (reason: PaymentFailureReason) => {
			await pendingGift();

			const result = await settleDelivery(
				deps({ provider: provider(undefined, { ok: false, reason, detail: 'no answer' }) }),
				DELIVERY
			);

			expect(result).toMatchObject({ ok: false, reason: 'incomplete' });
		}
	);

	/**
	 * a fee the processor has not computed yet holds the delivery open, and holds it open before
	 * anything is written.
	 *
	 * this is what makes the redelivery worth having rather than merely harmless: the charge and its
	 * fee are posted in one batch and the fee is resolved by the read that runs in front of it, so a
	 * refusal here leaves the books untouched and the next delivery posts both together. answered any
	 * other way it is the defect itself — a 200 stops the redeliveries and the fee is never posted;
	 * a posting first and a refusal after is a charge in the books that no redelivery can add the fee
	 * to, because `entry_group_source_idx` refuses the second write.
	 *
	 * nobody is told either. the operator's alert is for a fee that is not coming, and one sent here
	 * would be sent again on every redelivery of a gift that is about to post correctly.
	 */
	it('asks for the delivery again when the fee is not computed yet, and writes nothing', async () => {
		await pendingGift();
		const mail = mailer();

		const result = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider(undefined, {
					ok: false,
					reason: 'fee_not_ready',
					detail: 'the balance transaction has not been computed'
				})
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: false, reason: 'incomplete' });
		const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		expect(groups?.n).toBe(0);
		expect(mail.sent).toHaveLength(0);
	});

	it('answers a read that will fail identically, and tells an operator', async () => {
		await pendingGift();
		const mail = mailer();

		const result = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider(undefined, {
					ok: false,
					reason: 'not_found',
					detail: 'no such object on this account'
				})
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
	});

	it('answers an event it subscribes to nothing for, and writes nothing', async () => {
		await pendingGift();

		const result = await settleDelivery(
			deps({
				provider: provider({
					ok: true,
					value: {
						id: 'evt_1',
						kind: 'ignored',
						type: 'customer.created',
						occurredAt: new Date('2026-08-03T12:00:00.000Z')
					}
				})
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'ignored' });
		const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		expect(groups?.n).toBe(0);
	});
});

describe('settleDelivery() — what mail cannot do', () => {
	it('keeps the gift in the books when the receipt does not send', async () => {
		const gift = await pendingGift();
		const mail = mailer(false);

		const result = await settleDelivery(deps({ email: mail.port }), DELIVERY);

		// a non-200 here would make the processor redeliver, and a redelivery re-sends only the
		// mail — the posting is refused by the constraint.
		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		expect(groups?.n).toBe(2);
		const [row] = await db.select().from(donation).where(eq(donation.id, gift.donationId));
		// the unreceipted backlog, which is what a null in this column is for.
		expect(row?.receiptSentAt).toBeNull();
	});
});

describe('settleDelivery() — a send that faults after the delivery was dealt with', () => {
	/** a gift settled with no fee reported, which is the case that alerts before it receipts. */
	const noFee = () => provider(undefined, { ok: true, value: settlement({ feeMinor: null }) });

	/** a bank debit that failed days after the donor left the form, which writes to the donor. */
	const failedAch = () =>
		provider(undefined, { ok: true, value: settlement({ status: 'failed', method: 'ach' }) });

	it('keeps a banked gift banked when the operator’s alert throws', async () => {
		await pendingGift();
		const mail = brittleMailer((m) => m.subject.includes('no processor fee'));

		const result = await settleDelivery(deps({ email: mail.port, provider: noFee() }), DELIVERY);

		// the batch committed before any of this ran, and a throw out of it would be a 500 the
		// processor reads as "deliver this again" for three days — every retry refused by
		// `payment_provider_txn_idx`, with the gift banked and nobody told.
		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		expect(groups?.n).toBe(1);
		expect(mail.sent.some((m) => m.subject.includes('nobody could be told'))).toBe(true);
	});

	it('answers the delivery when the donor’s message throws', async () => {
		await pendingGift({ method: 'ach' });
		const mail = brittleMailer((m) => m.subject.includes('did not go through'));

		const result = await settleDelivery(
			deps({ email: mail.port, provider: failedAch() }),
			DELIVERY
		);

		// nothing was banked here, and the answer still matters: a 5xx puts a public endpoint into
		// the processor's failing state, which endangers the deliveries that can be handled.
		expect(result).toMatchObject({ ok: true, outcome: 'updated' });
		const [row] = await db.select().from(payment);
		expect(row?.status).toBe('failed');
		expect(mail.sent.some((m) => m.subject.includes('nobody could be told'))).toBe(true);
	});

	it('does not escape when the report itself throws too', async () => {
		await pendingGift();
		const mail = brittleMailer(() => true);

		const result = await settleDelivery(deps({ email: mail.port, provider: noFee() }), DELIVERY);

		// the report rides the transport that may be what faulted, so it is guarded in turn — the
		// sentence reaches the logs before it reaches the transport (./delivery.ts).
		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(mail.sent).toHaveLength(0);
		const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		expect(groups?.n).toBe(1);
	});

	it('does not escape when the report about the donor’s message throws too', async () => {
		await pendingGift({ method: 'ach' });
		const mail = brittleMailer(() => true);

		const result = await settleDelivery(
			deps({ email: mail.port, provider: failedAch() }),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'updated' });
		expect(mail.sent).toHaveLength(0);
	});
});

describe('settleDelivery() — a settled charge whose fee is unknown', () => {
	it('posts the gift, posts no fee, and says so', async () => {
		const gift = await pendingGift();
		const mail = mailer();

		const result = await settleDelivery(
			deps({
				email: mail.port,
				provider: provider(undefined, { ok: true, value: settlement({ feeMinor: null }) })
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await groupLines('payment', gift.paymentId)).not.toBeNull();
		// no number is invented for it: undeposited funds is overstated until somebody posts it.
		expect(await groupLines('fee', gift.paymentId)).toBeNull();
		expect(mail.sent.map((m) => m.to)).toContain('ops@hope.example');
	});
});

describe('settleDelivery() — the notice that a gift settled', () => {
	/** the operational mail, which is every message that went to the address the console names. */
	const noticesIn = (sent: readonly EmailMessage[]) =>
		sent.filter((m) => m.to === 'ops@hope.example');

	it('tells the organisation once that the gift is in the books', async () => {
		await pendingGift();
		const mail = mailer();

		const result = await settleDelivery(deps({ email: mail.port }), DELIVERY);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const notices = noticesIn(mail.sent);
		expect(notices).toHaveLength(1);
		// the thing that happened, amount included, because the subject line is the whole of what an
		// operator reads on a phone.
		expect(notices[0]?.subject).toContain('USD 100.00');
	});

	it('names the donor, the address it will be receipted at, and the form', async () => {
		await pendingGift();
		const mail = mailer();

		await settleDelivery(deps({ email: mail.port }), DELIVERY);

		const notice = noticesIn(mail.sent)[0];
		expect(notice?.text).toContain('Ada Okafor');
		expect(notice?.text).toContain('ada@example.org');
		// the name an operator gave the form, not the id they have never seen.
		expect(notice?.text).toContain('General Fund');
		// the screen the dashboard actually has. the rail calls it Gifts
		// (src/lib/admin/destinations.ts),
		// and an instruction naming a screen that is not there is worse than none.
		expect(notice?.text).toContain('Open Gifts in /admin');
		// nothing to do about a gift that worked, which is what `action: null` renders as.
		expect(notice?.text).not.toContain('What to do');
	});
	it('still goes for a donor who gave no address, and says no receipt went with it', async () => {
		await pendingGift({ donorEmail: null });
		const mail = mailer();

		const result = await settleDelivery(deps({ email: mail.port }), DELIVERY);

		// the case this message exists for: ./receipt.ts sends nothing to a donor with no address and
		// stamps nothing, so before the notice a gift like this reached the books in silence.
		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const notices = noticesIn(mail.sent);
		expect(notices).toHaveLength(1);
		expect(mail.sent).toHaveLength(1);
		expect(notices[0]?.text).toContain('no email address');
		expect(notices[0]?.text).toContain('no receipt was sent');
	});

	it('says nothing about a receipt when one is going out', async () => {
		await pendingGift();
		const mail = mailer();

		await settleDelivery(deps({ email: mail.port }), DELIVERY);

		// a receipt that could not be rendered or could not be sent alerts on its own (./receipt.ts),
		// so the only unreceipted case this message speaks about is the donor who gave no address.
		expect(noticesIn(mail.sent)[0]?.text).not.toContain('no receipt was sent');
	});

	it('stays quiet where no notification address is saved, and still says it in the logs', async () => {
		await pendingGift();
		await env.DB.prepare(`update org_profile set notification_email = null`).run();
		const mail = mailer();
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await settleDelivery(deps({ email: mail.port }), DELIVERY);

		// there is nowhere to send it, and a message nobody configured must not become an exception
		// on the money path. the sentence is logged before the transport is reached (./delivery.ts),
		// so a fresh deployment still has a record of the gift landing.
		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org']);
		expect(logged.mock.calls.flat().join(' ')).toContain('USD 100.00');
		logged.mockRestore();
	});

	it('answers the delivery the same way when the notice itself faults', async () => {
		const gift = await pendingGift();
		const mail = brittleMailer((m) => m.subject.includes('was received'));

		const result = await settleDelivery(deps({ email: mail.port }), DELIVERY);

		// a throw here is a 500 the processor reads as "deliver this again" for three days, against a
		// posting `entry_group_source_idx` refuses every time — the gift banked and the donor
		// receipted again on every retry.
		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await groupLines('payment', gift.paymentId)).not.toBeNull();
		// the receipt goes first and is unaffected by what happens after it.
		expect(mail.sent.map((m) => m.to)).toEqual(['ada@example.org']);
	});
});

describe('the processor an operator is sent to', () => {
	/**
	 * every path in ./settle.ts that writes an operator a sentence, each run against one processor.
	 *
	 * a table rather than four cases, because the claim is about the file and not about any one
	 * alert: a headline naming the wrong processor sends an operator to a dashboard the payment is
	 * not in, and the way that gets written is a sentence added beside three that already say the
	 * name. an arm added here is the same decision being made again on purpose.
	 *
	 * the outcome is on the table rather than left implied, and it is what keeps every case honest:
	 * the gift and the provider have to name the same processor for the lookup to find the row, and
	 * a case where they disagree reaches `unmatched` — which names a processor correctly while
	 * testing none of the paths below.
	 */
	const alerting: readonly [string, SettleOutcome, (p: ProcessorName) => PaymentProvider][] = [
		[
			'a transaction that could not be read',
			'unactionable',
			(p) =>
				provider(
					undefined,
					{ ok: false, reason: 'not_found', detail: 'no such object on this account' },
					p
				)
		],
		[
			'a settlement the books cannot take',
			'unactionable',
			(p) => provider(undefined, { ok: true, value: settlement({ currency: 'usd' }) }, p)
		],
		[
			'a settled charge whose fee is unknown',
			'posted',
			(p) => provider(undefined, { ok: true, value: settlement({ feeMinor: null }) }, p)
		]
	];

	/** every word this delivery put in front of a person, whichever message carried it. */
	const operatorProse = (sent: readonly EmailMessage[]) =>
		sent.map((m) => `${m.subject} ${m.text} ${m.html}`).join(' ');

	it.each(alerting)('names PayPal and never Stripe for %s', async (_, outcome, build) => {
		await pendingGift({ processor: 'paypal', method: 'paypal' });
		const mail = mailer();

		const result = await settleDelivery(
			deps({ email: mail.port, provider: build('paypal') }),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome });
		// somewhere in the operational mail, because not every message on a path has a processor to
		// name — the notice that a gift reached the books is about the books.
		expect(operatorProse(mail.sent)).toContain('PayPal');
		// and nowhere at all, donor mail included: an operator reading the wrong name goes to a
		// dashboard the payment is not in.
		expect(operatorProse(mail.sent)).not.toContain('Stripe');
	});

	it.each(alerting)('names Stripe and never PayPal for %s', async (_, outcome, build) => {
		await pendingGift();
		const mail = mailer();

		const result = await settleDelivery(
			deps({ email: mail.port, provider: build('stripe') }),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome });
		expect(operatorProse(mail.sent)).toContain('Stripe');
		expect(operatorProse(mail.sent)).not.toContain('PayPal');
	});

	/**
	 * the fourth path, which takes no `pendingGift` — it is the one reached precisely because this
	 * deployment has no payment row for the transaction, so it cannot share the table above.
	 */
	it('names the processor that settled against no gift here', async () => {
		const mail = mailer();

		const result = await settleDelivery(
			deps({ email: mail.port, provider: provider(undefined, undefined, 'paypal') }),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'unmatched' });
		expect(mail.sent[0]?.subject).toContain('PayPal');
		expect(`${mail.sent[0]?.subject} ${mail.sent[0]?.text}`).not.toContain('Stripe');
	});
});

describe('settleDelivery() — a gift settled on PayPal', () => {
	/** the one-off gift as PayPal's half opens it: an order id in the column, the PayPal rail. */
	const paypalGift = () =>
		pendingGift({ processor: 'paypal', method: 'paypal', providerTxnId: '5O190127TN364715T' });

	/** what the capture reports, which is PayPal's own gross and its own fee. */
	const captured = (over: Partial<Settlement> = {}) =>
		provider(
			{ ok: true, value: settledEvent({ providerTxnId: '5O190127TN364715T' }) },
			{
				ok: true,
				value: settlement({
					providerTxnId: '5O190127TN364715T',
					method: 'paypal',
					feeMinor: 319,
					...over
				})
			},
			'paypal'
		);

	it('posts the gift at PayPal’s gross, with PayPal’s own fee', async () => {
		const gift = await paypalGift();

		const result = await settleDelivery(deps({ provider: captured() }), DELIVERY);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const charge = await groupLines('payment', gift.paymentId);
		expect(charge?.lines.map((l) => l.amountMinor).sort()).toEqual([-10_000, 10_000]);
		// the figure the capture reported, never the 330 the donor was quoted and agreed to.
		const fee = await groupLines('fee', gift.paymentId);
		expect(fee?.lines.map((l) => l.amountMinor).sort()).toEqual([-319, 319]);
	});

	it('records the rail the capture settled on', async () => {
		const gift = await paypalGift();

		await settleDelivery(deps({ provider: captured() }), DELIVERY);

		const [row] = await db.select().from(payment).where(eq(payment.id, gift.paymentId));
		expect(row).toMatchObject({ status: 'succeeded', provider: 'paypal', method: 'paypal' });
	});

	it('posts nothing a second time when the delivery arrives again', async () => {
		const gift = await paypalGift();
		await settleDelivery(deps({ provider: captured() }), DELIVERY);

		const again = await settleDelivery(deps({ provider: captured() }), DELIVERY);

		// `entry_group_source_idx` refuses it, keyed on the payment row rather than on the event —
		// which is what makes PayPal's whole redelivery window a no-op rather than a second gift.
		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		expect(groups?.n).toBe(2);
		expect(await groupLines('payment', gift.paymentId)).not.toBeNull();
	});

	it('finds no gift for an order this deployment did not open on PayPal', async () => {
		// the same order id against a row Stripe wrote: `payment_provider_txn_idx` is on the pair,
		// so the processor is half the key and not decoration on it.
		await pendingGift({ providerTxnId: '5O190127TN364715T' });
		const mail = mailer();

		const result = await settleDelivery(deps({ email: mail.port, provider: captured() }), DELIVERY);

		expect(result).toMatchObject({ ok: true, outcome: 'unmatched' });
		const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		expect(groups?.n).toBe(0);
	});
});
