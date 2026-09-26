import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseContact } from '../contacts/contact-input';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { recordAuthorizedGift, recordDonation } from '../donations/record';
import { recordReversal } from '../donations/reverse';
import { settleDelivery, settleTransaction } from '../donations/settle';
import type { SettleDeps } from '../donations/delivery';
import type { EmailProvider } from '../email/provider';
import { soleProcessor } from '../payments/processors.testing';
import {
	DONATION_METADATA_KEY,
	FEE_COVERED_METADATA_KEY,
	GIFT_MINOR_METADATA_KEY,
	INTERVAL_METADATA_KEY,
	refusing,
	type Reversal,
	type Settlement
} from '../payments/provider';
import { connectQuickbooks, disconnectQuickbooks, saveQuickbooksAccounts } from './connection';
import { sendDueEntries } from './deliver';
import { createAccountingProvider } from './factory';
import { moveQuickbooksStartAt, previewQuickbooksStartAt, queueOwedReversals } from './outbox';
import { QUICKBOOKS_SANDBOX_URL } from './quickbooks';

// what a refund or a dispute owes QuickBooks, against a real D1, from the gift it reverses.
//
// every row here is written the way production writes it: the gift by the settlement path, the
// reversal through `recordReversal` in ../donations/reverse.ts — the seam below the processor's
// read — so what is queued is what the writer's own batch queues. the rule under test is the one
// ./outbox.ts states: a reversal is owed exactly when the group it answers holds a queue row,
// whatever its own date. what is sent is read through the delivery and the QuickBooks adapter
// together, with Intuit faked at `fetch`, because what a reversal is sent as is the adapter's
// body and when it is sent is the delivery's order.
//
// ../../../../vitest.workers.config.ts sets `unstubGlobals`, so the stubbed `fetch` is taken back
// before the next case.

const FORM_ID = 'frm_reversalqueue0001';
const SETTLED_AT = new Date('2026-08-03T12:00:00.000Z');
const REFUNDED_AT = new Date('2026-08-20T15:00:00.000Z');

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	for (const table of [
		'dispute',
		'zapier_delivery',
		'quickbooks_sync',
		'quickbooks_connection',
		'ledger_entry',
		'entry_group',
		'payment',
		'line_item',
		'donation',
		'recurring_plan',
		'contact',
		'form',
		'org_profile'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins, created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
	)
		.bind(FORM_ID, postableId('donationsDeductible'))
		.run();
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, deductibility_statement, address_line1,
		                          city, country, notification_email, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', 'No goods or services were provided.',
		         '1 Main St', 'Springfield', 'US', 'ops@hope.example', 0, 0)`
	).run();
});

const quietMail: EmailProvider = { send: async () => ({ ok: true }) };

/** the deps a delivery arrives with, reading `settlement` back where one is given. */
function deps(settlement: Settlement | null = null): SettleDeps {
	const base = refusing('stripe', 'unsupported', 'not part of the reversal path');
	const provider =
		settlement === null
			? base
			: { ...base, readSettlement: async () => ({ ok: true as const, value: settlement }) };
	return { db, provider, processors: soleProcessor(provider), email: quietMail };
}

/** a company connected, sending from `startAt`. */
async function connect(startAt: Date): Promise<void> {
	await connectQuickbooks(db, {
		realmId: '4620816365',
		tokens: {
			accessToken: 'access-one',
			accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
			refreshToken: 'refresh-one',
			refreshTokenExpiresAt: new Date(Date.now() + 8_640_000_000)
		},
		startAt
	});
}

/** a 100.00 USD gift on `pi_1` the settlement path put in the books, 3.20 of it the processor's. */
async function settledGift(): Promise<void> {
	const donationId = crypto.randomUUID();
	const donor = parseContact({
		kind: 'individual',
		first_name: 'Ada',
		last_name: 'Okafor',
		primary_email: 'ada@example.org'
	});
	if (!donor.ok) throw new Error('the fixture donor did not parse');
	const recorded = await recordDonation(db, {
		donationId,
		donor: donor.value,
		formId: FORM_ID,
		origin: 'https://acme.org',
		currency: 'USD',
		processor: 'stripe',
		totalMinor: 10_000,
		feeMinor: 0,
		lines: [
			{
				label: 'Donation',
				revenueAccountId: postableId('donationsDeductible'),
				amountMinor: 10_000
			}
		],
		method: 'card',
		providerTxnId: 'pi_1',
		occurredAt: new Date('2026-08-01T09:00:00.000Z'),
		consentedToContact: false,
		note: undefined,
		tribute: null,
		programId: null
	});
	if (!recorded.ok) throw new Error(`the fixture gift was not recorded: ${recorded.detail}`);
	const settled = await settleTransaction(
		deps({
			providerTxnId: 'pi_1',
			status: 'succeeded',
			method: 'card',
			amountMinor: 10_000,
			currency: 'USD',
			feeMinor: 320,
			metadata: { donation_id: donationId },
			occurredAt: SETTLED_AT,
			arrival: null
		}),
		{ providerTxnId: 'pi_1', eventId: 'evt_settle' }
	);
	if (!settled.ok || settled.outcome !== 'posted') {
		throw new Error(`the fixture gift did not settle: ${settled.detail}`);
	}
}

/** a refund of `pi_1` the processor has read back, 40.00 unless told otherwise. */
function refund(over: Partial<Extract<Reversal, { kind: 'refund' }>> = {}): Reversal {
	return {
		kind: 'refund',
		reversedTxnId: 'pi_1',
		providerReversalId: 're_1',
		amountMinor: 4_000,
		currency: 'USD',
		occurredAt: REFUNDED_AT,
		reversedMetadata: {},
		feeReturnedMinor: null,
		...over
	};
}

/** a dispute over the whole of `pi_1`, 15.00 of dispute fee at its opening unless told otherwise. */
function dispute(
	kind: 'dispute_opened' | 'dispute_lost',
	over: { readonly feeMinor?: number | null; readonly occurredAt?: Date } = {}
): Reversal {
	const facts = {
		reversedTxnId: 'pi_1',
		providerReversalId: 'dp_1',
		amountMinor: 10_000,
		currency: 'USD',
		occurredAt: over.occurredAt ?? REFUNDED_AT,
		reversedMetadata: {},
		feeMinor: over.feeMinor === undefined ? 1_500 : over.feeMinor,
		reason: 'fraudulent',
		dashboardUrl: null
	};
	return kind === 'dispute_opened' ? { ...facts, kind, respondBy: null } : { ...facts, kind };
}

/** `dp_1` won on 2026-09-15, naming no fee given back, and none kept unless told otherwise. */
function won(over: { readonly feeKeptMinor?: number | null } = {}): Reversal {
	return {
		kind: 'dispute_won',
		reversedTxnId: 'pi_1',
		providerReversalId: 'dp_1',
		occurredAt: new Date('2026-09-15T00:00:00.000Z'),
		reversedMetadata: {},
		feeReturnedMinor: null,
		...over
	};
}

/** a reversal written through the writer's own seam, refusing to go on where it did not post. */
async function reversed(reversal: Reversal): Promise<void> {
	const result = await recordReversal(deps(), reversal, `evt_${reversal.providerReversalId}`);
	if (!result.ok) throw new Error(`the fixture reversal was not written: ${result.detail}`);
}

/** every queue row, each with the group it is for, oldest group first. */
async function queued() {
	const { results } = await env.DB.prepare(
		`select g.source_type, p.direction, q.status
		 from quickbooks_sync q
		 join entry_group g on g.id = q.entry_group_id
		 join payment p on p.id = g.source_id
		 order by g.occurred_at, g.source_type`
	).all<{ source_type: string; direction: string; status: string }>();
	return results;
}

describe('a refund', () => {
	it('is queued where its gift holds a queue row, though it is dated before the start date', async () => {
		await connect(new Date('2026-01-01T00:00:00.000Z'));
		await settledGift();
		// the gift went over, and the operator then moved the start date past the refund's day.
		await env.DB.prepare(
			`update quickbooks_sync set status = 'sent', attempts = 1, remote_id = '42', realm_id = '4620816365'`
		).run();
		await env.DB.prepare(`update quickbooks_connection set start_at = ?`)
			.bind(new Date('2026-09-01T00:00:00.000Z').getTime())
			.run();

		await reversed(refund());

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'sent' },
			{ source_type: 'refund', direction: 'refund', status: 'pending' }
		]);
	});

	it('queues nothing where its gift was dated before the start date, though it is dated after', async () => {
		await connect(new Date('2026-08-10T00:00:00.000Z'));
		await settledGift();

		await reversed(refund());

		expect(await queued()).toEqual([]);
	});

	it('queues nothing where its gift settled before any company was connected', async () => {
		await settledGift();
		await connect(new Date('2026-01-01T00:00:00.000Z'));

		await reversed(refund());

		// the gift's own date is after the start date; it holds no row because nothing was
		// connected when it settled, and a move is what would queue it.
		expect(await queued()).toEqual([]);
	});
});

describe('a refund of a monthly collection', () => {
	/** one collection under a monthly commitment, on `pi_collect_1`, settled through the path production takes. */
	async function collected(): Promise<void> {
		const contactId = crypto.randomUUID();
		await env.DB.prepare(
			`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
			 values (?, 'individual', 'Ada Okafor', 'ada@example.org', 0, 0)`
		)
			.bind(contactId)
			.run();
		const donationId = crypto.randomUUID();
		const authorized = await recordAuthorizedGift(db, {
			donationId,
			contactId,
			formId: FORM_ID,
			origin: 'https://acme.org',
			currency: 'USD',
			totalMinor: 2_500,
			feeMinor: 0,
			lines: [
				{
					label: 'Donation',
					revenueAccountId: postableId('donationsDeductible'),
					amountMinor: 2_500
				}
			],
			note: undefined,
			tribute: null,
			programId: null,
			occurredAt: new Date('2026-08-01T09:00:00.000Z')
		});
		if (!authorized.ok)
			throw new Error(`the fixture gift was not authorized: ${authorized.detail}`);
		const provider = {
			...refusing('stripe', 'unsupported', 'not part of the collection path'),
			verifyEvent: async () => ({
				ok: true as const,
				value: {
					id: 'evt_collect_1',
					kind: 'recurring' as const,
					type: 'invoice.paid',
					providerNoticeId: 'in_collect_1',
					occurredAt: SETTLED_AT
				}
			}),
			readRecurringGift: async () => ({
				ok: true as const,
				value: {
					about: 'collection' as const,
					providerGiftId: 'sub_collect_1',
					providerCustomerId: 'cus_collect_1',
					state: 'active' as const,
					interval: 'monthly' as const,
					providerTxnId: 'pi_collect_1',
					endedAt: null,
					nextChargeAt: new Date('2026-09-03T12:00:00.000Z'),
					metadata: {
						[DONATION_METADATA_KEY]: donationId,
						[INTERVAL_METADATA_KEY]: 'monthly',
						[GIFT_MINOR_METADATA_KEY]: '2500',
						[FEE_COVERED_METADATA_KEY]: 'false'
					}
				}
			}),
			readSettlement: async () => ({
				ok: true as const,
				value: {
					providerTxnId: 'pi_collect_1',
					status: 'succeeded' as const,
					method: 'card' as const,
					amountMinor: 2_500,
					currency: 'USD',
					feeMinor: 103,
					metadata: {},
					occurredAt: SETTLED_AT,
					arrival: null
				}
			})
		};
		const settled = await settleDelivery(
			{ db, provider, processors: soleProcessor(provider), email: quietMail },
			{ body: '{"id":"evt_collect_1"}', headers: { 'stripe-signature': 't=1,v1=abc' } }
		);
		if (!settled.ok || settled.outcome !== 'posted') {
			throw new Error(`the fixture collection did not settle: ${settled.detail}`);
		}
	}

	it('is queued behind the collection it refunds', async () => {
		await connect(new Date('2026-01-01T00:00:00.000Z'));
		await collected();

		await reversed(refund({ reversedTxnId: 'pi_collect_1', amountMinor: 2_500 }));

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'pending' },
			{ source_type: 'refund', direction: 'refund', status: 'pending' }
		]);
	});
});

describe('a dispute', () => {
	const CLOSED_AT = new Date('2026-09-10T00:00:00.000Z');

	it('queues its withdrawal where its gift holds a queue row', async () => {
		await connect(new Date('2026-01-01T00:00:00.000Z'));
		await settledGift();

		await reversed(dispute('dispute_opened'));

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'pending' },
			{ source_type: 'refund', direction: 'refund', status: 'pending' }
		]);
	});

	it('queues nothing where its gift holds none', async () => {
		await connect(new Date('2026-08-10T00:00:00.000Z'));
		await settledGift();

		await reversed(dispute('dispute_opened'));

		expect(await queued()).toEqual([]);
	});

	it('queues nothing further when it is lost with nothing left to settle', async () => {
		await connect(new Date('2026-01-01T00:00:00.000Z'));
		await settledGift();
		await reversed(dispute('dispute_opened'));

		await reversed(dispute('dispute_lost', { occurredAt: CLOSED_AT }));

		expect(await queued()).toHaveLength(2);
	});

	it('queues a lost close’s settle-up where its withdrawal holds a queue row', async () => {
		await connect(new Date('2026-01-01T00:00:00.000Z'));
		await settledGift();
		await reversed(dispute('dispute_opened', { feeMinor: null }));

		await reversed(dispute('dispute_lost', { feeMinor: 1_500, occurredAt: CLOSED_AT }));

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'pending' },
			{ source_type: 'refund', direction: 'refund', status: 'pending' },
			{ source_type: 'adjustment', direction: 'refund', status: 'pending' }
		]);
	});

	it('queues a won close’s settle-up of the fee kept where its withdrawal holds a queue row', async () => {
		await connect(new Date('2026-01-01T00:00:00.000Z'));
		await settledGift();
		await reversed(dispute('dispute_opened', { feeMinor: null }));

		await reversed(won({ feeKeptMinor: 1_500 }));

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'pending' },
			{ source_type: 'refund', direction: 'refund', status: 'pending' },
			{ source_type: 'adjustment', direction: 'refund', status: 'pending' },
			{ source_type: 'payment', direction: 'refund', status: 'pending' }
		]);
	});

	it('queues a won close’s settle-up of the fee kept where the gift holds a queue row, though no opening was heard', async () => {
		await connect(new Date('2026-01-01T00:00:00.000Z'));
		await settledGift();

		await reversed(won({ feeKeptMinor: 1_500 }));

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'pending' },
			{ source_type: 'adjustment', direction: 'inbound', status: 'pending' }
		]);
	});

	it('queues no settle-up of the fee kept where no opening was heard and the gift holds no queue row', async () => {
		await connect(new Date('2026-08-10T00:00:00.000Z'));
		await settledGift();

		await reversed(won({ feeKeptMinor: 1_500 }));

		// the close is dated after the start date, and a correction dated there would be queued.
		expect(await queued()).toEqual([]);
	});

	it('queues no settle-up of a withdrawal QuickBooks never got', async () => {
		await connect(new Date('2026-08-10T00:00:00.000Z'));
		await settledGift();
		await reversed(dispute('dispute_opened', { feeMinor: null }));

		await reversed(dispute('dispute_lost', { feeMinor: 1_500, occurredAt: CLOSED_AT }));

		// the close is dated after the start date, and a correction dated there would be queued.
		expect(await queued()).toEqual([]);
	});
});

describe('a withdrawal that did not stand', () => {
	const PUT_BACK_AT = new Date('2026-09-15T00:00:00.000Z');

	it('queues a failed refund’s mirror where the refund holds a queue row', async () => {
		await connect(new Date('2026-01-01T00:00:00.000Z'));
		await settledGift();
		await reversed(refund());

		await reversed({ ...facts('re_1'), kind: 'refund_failed' });

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'pending' },
			{ source_type: 'refund', direction: 'refund', status: 'pending' },
			{ source_type: 'payment', direction: 'refund', status: 'pending' }
		]);
	});

	it('queues no won dispute’s mirror where the withdrawal holds none', async () => {
		await connect(new Date('2026-08-10T00:00:00.000Z'));
		await settledGift();
		await reversed(dispute('dispute_opened'));

		await reversed({ ...facts('dp_1'), kind: 'dispute_won', feeReturnedMinor: 1_500 });

		// dated after the start date, and a gift dated there would be queued.
		expect(await queued()).toEqual([]);
	});

	function facts(providerReversalId: string) {
		return {
			reversedTxnId: 'pi_1',
			providerReversalId,
			occurredAt: PUT_BACK_AT,
			reversedMetadata: {}
		};
	}
});

describe('moving the start date', () => {
	const NOW = new Date('2026-10-01T00:00:00.000Z');
	const BEFORE_THE_GIFT = new Date('2026-07-01T00:00:00.000Z');
	const AFTER_THE_GIFT = new Date('2026-08-10T00:00:00.000Z');

	/** a gift, refunded, the refund then failing: three groups, each answering the one before. */
	async function refundedAndPutBack(): Promise<void> {
		await settledGift();
		await reversed(refund());
		await reversed({
			kind: 'refund_failed',
			reversedTxnId: 'pi_1',
			providerReversalId: 're_1',
			occurredAt: new Date('2026-09-15T00:00:00.000Z'),
			reversedMetadata: {}
		});
	}

	it('earlier, queues a gift together with its refund and the refund put back', async () => {
		await connect(AFTER_THE_GIFT);
		await refundedAndPutBack();

		const preview = await previewQuickbooksStartAt(db, BEFORE_THE_GIFT, NOW);
		await moveQuickbooksStartAt(db, BEFORE_THE_GIFT, NOW);

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'pending' },
			{ source_type: 'refund', direction: 'refund', status: 'pending' },
			{ source_type: 'payment', direction: 'refund', status: 'pending' }
		]);
		expect(preview.queues).toMatchObject({ gifts: 1, corrections: 0, reversals: 2 });
		// the dates the preview names are the gifts' own: the refund put back is weeks after it.
		expect(preview.queues).toMatchObject({ earliest: SETTLED_AT, latest: SETTLED_AT });
	});

	it('later, drops an unsent gift together with its unsent refund and the refund put back', async () => {
		await connect(BEFORE_THE_GIFT);
		await refundedAndPutBack();

		const preview = await previewQuickbooksStartAt(db, AFTER_THE_GIFT, NOW);
		await moveQuickbooksStartAt(db, AFTER_THE_GIFT, NOW);

		// the refund and its mirror are dated after the new date; they go because their gift does.
		expect(await queued()).toEqual([]);
		expect(preview.drops).toMatchObject({ gifts: 1, corrections: 0, reversals: 2 });
		expect(preview.drops).toMatchObject({ earliest: SETTLED_AT, latest: SETTLED_AT });
	});

	it('later, keeps the refund and the refund put back of a gift already sent', async () => {
		await connect(BEFORE_THE_GIFT);
		await refundedAndPutBack();
		await env.DB.prepare(
			`update quickbooks_sync set status = 'sent', attempts = 1, remote_id = '42', realm_id = '4620816365'
			 where entry_group_id = (select id from entry_group where source_type = 'payment'
			                         and source_id in (select id from payment where direction = 'inbound'))`
		).run();
		const pastEverything = new Date('2026-10-01T00:00:00.000Z');

		const preview = await previewQuickbooksStartAt(db, pastEverything, NOW);
		await moveQuickbooksStartAt(db, pastEverything, NOW);

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'sent' },
			{ source_type: 'refund', direction: 'refund', status: 'pending' },
			{ source_type: 'payment', direction: 'refund', status: 'pending' }
		]);
		expect(preview.drops).toMatchObject({ gifts: 0, reversals: 0 });
	});

	it('earlier, queues a gift together with its won close’s settle-up where no opening was heard', async () => {
		await connect(AFTER_THE_GIFT);
		await settledGift();
		await reversed(won({ feeKeptMinor: 1_500 }));

		const preview = await previewQuickbooksStartAt(db, BEFORE_THE_GIFT, NOW);
		await moveQuickbooksStartAt(db, BEFORE_THE_GIFT, NOW);

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'pending' },
			{ source_type: 'adjustment', direction: 'inbound', status: 'pending' }
		]);
		expect(preview.queues).toMatchObject({
			gifts: 1,
			corrections: 0,
			reversals: 1,
			earliest: SETTLED_AT,
			latest: SETTLED_AT
		});
	});

	it('later, drops an unsent gift together with its won close’s settle-up where no opening was heard', async () => {
		await connect(BEFORE_THE_GIFT);
		await settledGift();
		await reversed(won({ feeKeptMinor: 1_500 }));

		const preview = await previewQuickbooksStartAt(db, AFTER_THE_GIFT, NOW);
		await moveQuickbooksStartAt(db, AFTER_THE_GIFT, NOW);

		// the settle-up is dated after the new date; it goes because its gift does.
		expect(await queued()).toEqual([]);
		expect(preview.drops).toMatchObject({ gifts: 1, corrections: 0, reversals: 1 });
	});

	it('never queues a refund put back as a new gift, where the gift it answers stays unqueued', async () => {
		await connect(new Date('2026-09-20T00:00:00.000Z'));
		await refundedAndPutBack();
		// between the refund and the refund put back: a date rule would queue the mirror alone.
		const betweenThem = new Date('2026-09-01T00:00:00.000Z');

		const preview = await previewQuickbooksStartAt(db, betweenThem, NOW);
		await moveQuickbooksStartAt(db, betweenThem, NOW);

		expect(await queued()).toEqual([]);
		expect(preview.queues).toMatchObject({ gifts: 0, reversals: 0 });
	});
});

describe('sending a reversal', () => {
	const CONFIGURED = {
		QUICKBOOKS_CLIENT_ID: 'notarealclientid',
		QUICKBOOKS_CLIENT_SECRET: 'notarealclientsecret',
		QUICKBOOKS_API_URL: QUICKBOOKS_SANDBOX_URL
	};
	const INCOME = '79';
	const FEES = '80';
	const STRIPE = '140';
	const DONOR = '77';

	beforeEach(async () => {
		await connect(new Date('2026-01-01T00:00:00.000Z'));
		await saveQuickbooksAccounts(db, {
			income: { id: INCOME, name: 'Contributions' },
			fee: { id: FEES, name: 'Processing fees' },
			stripeBalance: { id: STRIPE, name: 'Stripe balance' },
			paypalBalance: null,
			chariotBalance: null,
			nowpaymentsBalance: null,
			undepositedFunds: null
		});
	});

	/**
	 * a company that knows the donor as `donor.customer` (77 unless a case moves it), takes every
	 * journal entry posted to it, and reads each one back by its id as it was posted.
	 */
	function intuit(donor = { customer: DONOR }): Record<string, unknown>[] {
		const posted: Record<string, unknown>[] = [];
		vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(String(input), init);
			const url = new URL(request.url);
			const body = await request.text();
			if (url.pathname.endsWith('/query')) {
				if (body.startsWith('select * from Preferences')) {
					return Response.json({
						QueryResponse: {
							Preferences: [{ CurrencyPrefs: { HomeCurrency: { value: 'USD' } } }]
						}
					});
				}
				if (body.startsWith('select * from Customer')) {
					return Response.json({ QueryResponse: { Customer: [{ Id: donor.customer }] } });
				}
				const byId = /^select \* from JournalEntry where Id = '(\d+)'$/.exec(body);
				const entry = byId === null ? undefined : posted[Number(byId[1]) - 1201];
				if (entry !== undefined) {
					return Response.json({ QueryResponse: { JournalEntry: [{ ...entry, Id: byId?.[1] }] } });
				}
				return Response.json({ QueryResponse: {} });
			}
			if (url.pathname.endsWith('/journalentry')) {
				posted.push(JSON.parse(body));
				return Response.json({ JournalEntry: { Id: String(1200 + posted.length) } });
			}
			throw new Error(`unscripted request: ${request.method} ${url}`);
		});
		return posted;
	}

	/** one delivery run, a minute from now so every row queued so far is due. */
	async function run(): Promise<void> {
		await sendDueEntries(
			{ db, provider: createAccountingProvider(CONFIGURED, db), email: quietMail },
			new Date(Date.now() + 60_000)
		);
	}

	/** a posted entry's lines as account, side, amount and customer, in a stable order. */
	function sides(entry: Record<string, unknown> | undefined) {
		const lines = (entry?.Line ?? []) as {
			Amount: number;
			JournalEntryLineDetail: {
				PostingType: string;
				AccountRef: { value: string };
				Entity?: { EntityRef: { value: string } };
			};
		}[];
		return lines
			.map(({ Amount, JournalEntryLineDetail: detail }) => [
				detail.AccountRef.value,
				detail.PostingType,
				Amount,
				detail.Entity?.EntityRef.value ?? null
			])
			.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	}

	it('sends a dispute’s withdrawal after its gift, as a journal entry reversing the gift with the dispute fee', async () => {
		await settledGift();
		await reversed(dispute('dispute_opened'));
		const posted = intuit();

		await run();
		await run();

		expect(posted.map((entry) => entry.TxnDate)).toEqual(['2026-08-03', '2026-08-20']);
		expect(sides(posted[1])).toEqual([
			[STRIPE, 'Credit', 100, DONOR],
			[STRIPE, 'Credit', 15, DONOR],
			[INCOME, 'Debit', 100, DONOR],
			[FEES, 'Debit', 15, null]
		]);
	});

	it('sends a partial refund with a returned fee as a balanced journal entry taking its share back', async () => {
		await settledGift();
		await reversed(refund({ amountMinor: 4_000, feeReturnedMinor: 128 }));
		const posted = intuit();

		await run();
		await run();

		expect(posted.map((entry) => entry.TxnDate)).toEqual(['2026-08-03', '2026-08-20']);
		// 40.00 of the 100.00 back out of income and the holding, and the 1.28 of fee the processor
		// gave back out of fees and into the holding.
		const refunded = sides(posted[1]);
		expect(refunded).toEqual([
			[STRIPE, 'Credit', 40, DONOR],
			[STRIPE, 'Debit', 1.28, DONOR],
			[INCOME, 'Debit', 40, DONOR],
			[FEES, 'Credit', 1.28, null]
		]);
		const total = (side: string) =>
			refunded
				.filter(([, posting]) => posting === side)
				.reduce((sum, [, , amount]) => sum + Number(amount), 0);
		expect(total('Debit')).toBeCloseTo(total('Credit'), 10);
	});

	it('sends a refund against the customer its gift was posted to, whoever the donor matches now', async () => {
		await settledGift();
		await reversed(refund());
		const donor = { customer: DONOR };
		const posted = intuit(donor);
		await run();
		// the donor's email changed, or the bookkeeper merged customers: a lookup now finds another.
		donor.customer = '88';

		await run();

		expect(posted.map((entry) => entry.TxnDate)).toEqual(['2026-08-03', '2026-08-20']);
		expect(sides(posted[1]).map(([, , , customer]) => customer)).toEqual([DONOR, DONOR]);
	});

	/** the connection moved to another company, and that company's accounts picked. */
	async function movedToAnotherCompany(): Promise<void> {
		await connectQuickbooks(db, {
			realmId: '9130357184',
			tokens: {
				accessToken: 'access-two',
				accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
				refreshToken: 'refresh-two',
				refreshTokenExpiresAt: new Date(Date.now() + 8_640_000_000)
			},
			startAt: new Date('2026-01-01T00:00:00.000Z')
		});
		await saveQuickbooksAccounts(db, {
			income: { id: '11', name: 'Contributions' },
			fee: { id: '12', name: 'Processing fees' },
			stripeBalance: { id: '13', name: 'Stripe balance' },
			paypalBalance: null,
			chariotBalance: null,
			nowpaymentsBalance: null,
			undepositedFunds: null
		});
	}

	/** each queue row's source type and the company it names, gift first. */
	async function realms() {
		const { results } = await env.DB.prepare(
			`select g.source_type, q.realm_id from quickbooks_sync q
			 join entry_group g on g.id = q.entry_group_id order by g.occurred_at`
		).all<{ source_type: string; realm_id: string | null }>();
		return results;
	}

	it('writes the company a row was sent to as it is sent, and none on a row still waiting', async () => {
		await settledGift();
		await reversed(refund());
		intuit();

		await run();

		expect(await realms()).toEqual([
			{ source_type: 'payment', realm_id: '4620816365' },
			{ source_type: 'refund', realm_id: null }
		]);
	});

	it('queues a refund of a gift sent to the company still connected', async () => {
		await settledGift();
		intuit();
		await run();

		await reversed(refund());

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'sent' },
			{ source_type: 'refund', direction: 'refund', status: 'pending' }
		]);
	});

	it('queues nothing for a refund of a gift sent to a company no longer connected', async () => {
		await settledGift();
		intuit();
		await run();
		await movedToAnotherCompany();

		await reversed(refund());

		// the gift is in the other company's books; this one never took it, so it has none to reverse.
		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'sent' }
		]);
	});

	it('queues nothing for a refund of a gift sent to a company nobody recorded', async () => {
		await settledGift();
		intuit();
		await run();
		// what migrations/0011_quickbooks_sync_realm.sql leaves on a row sent before the connection moved.
		await env.DB.prepare(`update quickbooks_sync set realm_id = null`).run();

		await reversed(refund());

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'sent' }
		]);
	});

	it('never queues on a start-date move a refund of a gift sent to a company nobody recorded', async () => {
		await settledGift();
		intuit();
		await run();
		await env.DB.prepare(`update quickbooks_sync set realm_id = null`).run();
		await reversed(refund());
		const earlier = new Date('2025-10-01T00:00:00.000Z');

		const preview = await previewQuickbooksStartAt(db, earlier, new Date());
		await moveQuickbooksStartAt(db, earlier, new Date());

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'sent' }
		]);
		expect(preview.queues).toMatchObject({ reversals: 0 });
	});

	it('never sends a queued refund once its gift’s company is no longer connected', async () => {
		await settledGift();
		await reversed(refund());
		const posted = intuit();
		await run();
		await movedToAnotherCompany();

		await run();

		expect(posted.map((entry) => entry.TxnDate)).toEqual(['2026-08-03']);
		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'sent' },
			{ source_type: 'refund', direction: 'refund', status: 'pending' }
		]);
	});

	it('never queues on a start-date move a refund of a gift sent to a company no longer connected', async () => {
		await settledGift();
		intuit();
		await run();
		await movedToAnotherCompany();
		await reversed(refund());
		const earlier = new Date('2025-10-01T00:00:00.000Z');

		const preview = await previewQuickbooksStartAt(db, earlier, new Date());
		await moveQuickbooksStartAt(db, earlier, new Date());

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'sent' }
		]);
		expect(preview.queues).toMatchObject({ reversals: 0 });
	});

	it('queues on a connect to the same company every reversal made while it was disconnected', async () => {
		await settledGift();
		intuit();
		await run();
		await disconnectQuickbooks(db);
		await reversed(refund());
		await reversed({
			kind: 'refund_failed',
			reversedTxnId: 'pi_1',
			providerReversalId: 're_1',
			occurredAt: new Date('2026-09-15T00:00:00.000Z'),
			reversedMetadata: {}
		});
		await connect(new Date());

		await queueOwedReversals(db, new Date());

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'sent' },
			{ source_type: 'refund', direction: 'refund', status: 'pending' },
			{ source_type: 'payment', direction: 'refund', status: 'pending' }
		]);
	});

	it('queues on a connect to the same company a won close’s settle-up made while it was disconnected, where no opening was heard', async () => {
		await settledGift();
		intuit();
		await run();
		await disconnectQuickbooks(db);
		await reversed(won({ feeKeptMinor: 1_500 }));
		await connect(new Date());

		await queueOwedReversals(db, new Date());

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'sent' },
			{ source_type: 'adjustment', direction: 'inbound', status: 'pending' }
		]);
	});

	it('queues on a connect to another company nothing reversing a gift the first one holds', async () => {
		await settledGift();
		intuit();
		await run();
		await disconnectQuickbooks(db);
		await reversed(refund());
		await movedToAnotherCompany();

		await queueOwedReversals(db, new Date());

		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'sent' }
		]);
	});

	it('holds a withdrawal back while its gift’s row is unsent, and leaves it untried', async () => {
		await settledGift();
		await reversed(refund());
		// the gift given up on: it reaches QuickBooks only when somebody retries it.
		await env.DB.prepare(
			`update quickbooks_sync set status = 'failed', attempts = 1
			 where entry_group_id = (select id from entry_group where source_type = 'payment')`
		).run();
		const posted = intuit();

		await run();

		expect(posted).toEqual([]);
		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'failed' },
			{ source_type: 'refund', direction: 'refund', status: 'pending' }
		]);
		const { results } = await env.DB.prepare(
			`select attempts from quickbooks_sync
			 where entry_group_id = (select id from entry_group where source_type = 'refund')`
		).all<{ attempts: number }>();
		expect(results).toEqual([{ attempts: 0 }]);
	});

	it('sends a won dispute’s mirror after its withdrawal, as the withdrawal put back and not as a new gift', async () => {
		await settledGift();
		await reversed(dispute('dispute_opened'));
		await reversed({
			kind: 'dispute_won',
			reversedTxnId: 'pi_1',
			providerReversalId: 'dp_1',
			occurredAt: new Date('2026-09-15T00:00:00.000Z'),
			reversedMetadata: {},
			feeReturnedMinor: 1_500
		});
		const posted = intuit();

		await run();
		await run();
		await run();

		expect(posted.map((entry) => entry.TxnDate)).toEqual([
			'2026-08-03',
			'2026-08-20',
			'2026-09-15'
		]);
		// a new gift would debit the holding the gift less its fee; this puts back exactly what the
		// withdrawal took, the dispute fee returned with it.
		expect(sides(posted[2])).toEqual([
			[STRIPE, 'Debit', 100, DONOR],
			[STRIPE, 'Debit', 15, DONOR],
			[INCOME, 'Credit', 100, DONOR],
			[FEES, 'Credit', 15, null]
		]);
	});

	it('sends a won close’s settle-up of the fee kept after its withdrawal, as a reversal against the gift’s customer', async () => {
		await settledGift();
		await reversed(dispute('dispute_opened', { feeMinor: null }));
		await reversed(won({ feeKeptMinor: 1_500 }));
		const posted = intuit();

		await run();
		await run();
		await run();

		expect(posted.map((entry) => entry.TxnDate)).toEqual([
			'2026-08-03',
			'2026-08-20',
			'2026-09-15',
			'2026-09-15'
		]);
		expect(posted.slice(2).map(sides)).toContainEqual([
			[STRIPE, 'Credit', 15, DONOR],
			[FEES, 'Debit', 15, null]
		]);
		expect((await queued()).map((row) => row.status)).toEqual(['sent', 'sent', 'sent', 'sent']);
	});

	it('sends a won close’s settle-up of the fee kept after its gift where no opening was heard, as a reversal against the gift’s customer', async () => {
		await settledGift();
		await reversed(won({ feeKeptMinor: 1_500 }));
		const posted = intuit();

		await run();
		await run();

		expect(posted.map((entry) => entry.TxnDate)).toEqual(['2026-08-03', '2026-09-15']);
		expect(sides(posted[1])).toEqual([
			[STRIPE, 'Credit', 15, DONOR],
			[FEES, 'Debit', 15, null]
		]);
		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'sent' },
			{ source_type: 'adjustment', direction: 'inbound', status: 'sent' }
		]);
	});

	it('holds a won close’s settle-up where no opening was heard back while its gift’s row is unsent', async () => {
		await settledGift();
		await reversed(won({ feeKeptMinor: 1_500 }));
		await env.DB.prepare(
			`update quickbooks_sync set status = 'failed', attempts = 1
			 where entry_group_id = (select id from entry_group where source_type = 'payment')`
		).run();
		const posted = intuit();

		await run();

		expect(posted).toEqual([]);
		expect(await queued()).toEqual([
			{ source_type: 'payment', direction: 'inbound', status: 'failed' },
			{ source_type: 'adjustment', direction: 'inbound', status: 'pending' }
		]);
	});

	it('sends a lost close’s settle-up after its withdrawal, in the processor’s holding', async () => {
		await settledGift();
		await reversed(dispute('dispute_opened', { feeMinor: null }));
		await reversed(
			dispute('dispute_lost', { feeMinor: 1_500, occurredAt: new Date('2026-09-10T00:00:00.000Z') })
		);
		const posted = intuit();

		await run();
		await run();
		await run();

		expect(posted.map((entry) => entry.TxnDate)).toEqual([
			'2026-08-03',
			'2026-08-20',
			'2026-09-10'
		]);
		expect(sides(posted[2])).toEqual([
			[STRIPE, 'Credit', 15, DONOR],
			[FEES, 'Debit', 15, null]
		]);
	});
});
