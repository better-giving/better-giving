import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseContact } from '../contacts/contact-input';
import { createDb, type Db } from '../db/client';
import type { PostableAccountId } from '../db/postable';
import type { EmailMessage, EmailProvider } from '../email/provider';
import type { PaymentEvent } from '../payments/provider';
import { soleProcessor } from '../payments/processors.testing';
import { createSponsorProvider, sponsorEvent } from '../payments/sponsor';
import { sendOwedRefundNotices } from './refund-notice';
import { recordDonation } from './record';
import { settleEvent } from './settle';
import { all, client, first, run, stmt } from '$lib/server/db/database.testing';

// a gift taken through the sponsor, settled and refunded against a real database: the sponsor is
// the donee, so the site records the gift and its refund and posts, queues and mails nothing of
// its own but the staff notice. the adapter is the real one, answering from a scripted `fetch`.

const FORM_ID = 'frm_sponsored000001';
const PAYMENT_ID = 'pay_1';
const OCCURRED_AT = '2026-11-27T10:00:00Z';

let db: Db;
let revenueAccountId: PostableAccountId;

beforeAll(async () => {
	db = createDb(client);
	const row = await first<{ id: string }>(
		stmt(`select id from account where is_postable = 1 and code = '4110'`)
	);
	if (!row) throw new Error('no 4110 account in the chart of accounts');
	revenueAccountId = row.id as PostableAccountId;
});

beforeEach(async () => {
	for (const table of [
		'quickbooks_sync',
		'quickbooks_connection',
		'ledger_entry',
		'entry_group',
		'dispute',
		'payment',
		'line_item',
		'gift_match',
		'donation',
		'contact',
		'form',
		'org_profile'
	]) {
		await run(stmt(`delete from ${table}`));
	}
	await run(
		stmt(
			`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
			                   suggested_amounts, allowed_origins, created_at, updated_at)
			 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`,
			FORM_ID,
			revenueAccountId
		)
	);
	await run(
		stmt(`insert into org_profile (id, legal_name, tax_id, deductibility_statement, address_line1,
		                          city, country, notification_email, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', 'No goods or services were provided.',
		         '1 Main St', 'Springfield', 'US', 'ops@hope.example', 0, 0)`)
	);
	// a QuickBooks company connected, so a queue row a posting owed would be written.
	await run(
		stmt(`insert into quickbooks_connection (id, realm_id, access_token, access_token_expires_at,
		                                    refresh_token, start_at, created_at, updated_at)
		 values ('quickbooks', '4620816365', 'access', 0, 'refresh', 0, 0, 0)`)
	);
});

/** the pending gift a sponsored quote leaves behind, with a dedication whose person asked to be told. */
async function pendingGift(): Promise<string> {
	const donationId = crypto.randomUUID();
	const donor = parseContact({
		kind: 'individual',
		first_name: 'Ada',
		last_name: 'Okafor',
		primary_email: 'ada@example.org'
	});
	if (!donor.ok) throw new Error('the fixture donor did not parse');
	const result = await recordDonation(db, {
		donationId,
		donor: donor.value,
		formId: FORM_ID,
		origin: 'https://acme.org',
		currency: 'USD',
		processor: 'sponsor',
		totalMinor: 10_000,
		feeMinor: 330,
		lines: [{ label: 'Donation', revenueAccountId, amountMinor: 10_000 }],
		method: 'card',
		providerTxnId: PAYMENT_ID,
		occurredAt: new Date('2026-11-27T09:00:00.000Z'),
		consentedToContact: false,
		note: undefined,
		tribute: {
			kind: 'memory',
			honoree: 'Margaret Chen',
			notify: { name: 'Iris Chen', email: 'iris@example.org' }
		},
		programId: null
	});
	if (!result.ok) throw new Error(`the fixture gift was not recorded: ${result.detail}`);
	return donationId;
}

/**
 * the sponsor's partner API, answering each read from what this case holds. `reversalKind` is what
 * the sponsor reads the reversal as now: its read is live, so every event naming a dispute reads
 * the dispute's current state.
 */
function sponsor(giftId: string, reversalKind: string) {
	const payment = {
		id: PAYMENT_ID,
		gift_id: giftId,
		status: 'succeeded',
		method: 'card',
		amount: { gift: 9_670, gift_fee_cover: 330, contribution: 1_500, contribution_fee_cover: 50 },
		currency: 'usd',
		fee: 412,
		occurred_at: OCCURRED_AT
	};
	const reversal = {
		id: 'rev_1',
		payment_id: PAYMENT_ID,
		gift_id: giftId,
		kind: reversalKind,
		amount: { gift: 9_670, gift_fee_cover: 330, contribution: 0, contribution_fee_cover: 0 },
		currency: 'usd',
		occurred_at: '2026-11-28T10:00:00Z'
	};
	const fetch: typeof globalThis.fetch = async (input) => {
		const path = new URL(new Request(input).url).pathname;
		if (path.endsWith(`/payments/${PAYMENT_ID}`)) return Response.json(payment);
		if (path.endsWith('/reversals/rev_1')) return Response.json(reversal);
		return Response.json({ code: 'not_found' }, { status: 404 });
	};
	return createSponsorProvider({ apiKey: 'spk_test', eventsSecret: 'whsec_AAAA', fetch });
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

function deps(giftId: string, email: EmailProvider, reversalKind = 'refund') {
	const provider = sponsor(giftId, reversalKind);
	return { db, provider, processors: soleProcessor(provider), email };
}

/** an envelope the pull hands over, read by the adapter as any trusted event is. */
function event(id: string, type: string, data: unknown): PaymentEvent {
	const read = sponsorEvent({ id, seq: 1, type, created_at: OCCURRED_AT, data });
	if (!read.ok) throw new Error(read.detail);
	return read.value;
}

const SETTLED = () => event('evt_1', 'payment.settled', { id: PAYMENT_ID });
const REFUNDED = () => event('evt_2', 'payment.refunded', { id: 'rev_1', payment_id: PAYMENT_ID });
const DISPUTED = () => event('evt_3', 'payment.disputed', { id: 'rev_1', payment_id: PAYMENT_ID });
const DISPUTE_CLOSED = () =>
	event('evt_4', 'payment.dispute_closed', { id: 'rev_1', payment_id: PAYMENT_ID });

async function counts() {
	const [row] = await all<{ groups: number; owed: number; refunds: number }>(
		stmt(`select (select count(*) from entry_group) as groups,
		             (select count(*) from quickbooks_sync) as owed,
		             (select count(*) from payment where direction = 'refund') as refunds`)
	);
	return { groups: row?.groups, owed: row?.owed, refunds: row?.refunds };
}

async function giftRow(donationId: string) {
	const row = await first<{ receipt_sent_at: number | null; tribute_notified_at: number | null }>(
		stmt('select receipt_sent_at, tribute_notified_at from donation where id = ?', donationId)
	);
	return { receiptSentAt: row?.receipt_sent_at, tributeNotifiedAt: row?.tribute_notified_at };
}

describe('settleEvent() — a gift the sponsor took', () => {
	it('settles the payment, posts and queues nothing, and tells staff alone', async () => {
		const giftId = await pendingGift();
		const mail = mailer();

		const result = await settleEvent(deps(giftId, mail.port), SETTLED());

		expect(result).toMatchObject({ ok: true, outcome: 'updated' });
		const row = await first<{ status: string; amount_minor: number }>(
			stmt('select status, amount_minor from payment where provider_txn_id = ?', PAYMENT_ID)
		);
		expect(row?.status).toBe('succeeded');
		expect(await counts()).toEqual({ groups: 0, owed: 0, refunds: 0 });
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(await giftRow(giftId)).toEqual({ receiptSentAt: null, tributeNotifiedAt: null });
	});

	it('changes nothing and tells nobody when the same settlement arrives again', async () => {
		const giftId = await pendingGift();
		await settleEvent(deps(giftId, mailer().port), SETTLED());
		const mail = mailer();

		const again = await settleEvent(deps(giftId, mail.port), SETTLED());

		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(mail.sent).toEqual([]);
		expect(await counts()).toEqual({ groups: 0, owed: 0, refunds: 0 });
	});
});

describe('settleEvent() — a refund of a gift the sponsor took', () => {
	it('records the refund with no notice owed, and posts and mails nothing', async () => {
		const giftId = await pendingGift();
		await settleEvent(deps(giftId, mailer().port), SETTLED());
		const mail = mailer();

		const result = await settleEvent(deps(giftId, mail.port), REFUNDED());

		expect(result).toMatchObject({ ok: true, outcome: 'updated' });
		const refund = await first<{
			provider: string;
			status: string;
			amount_minor: number;
			notice_owed_since: number | null;
		}>(
			stmt(`select provider, status, amount_minor, notice_owed_since from payment
			 where provider_txn_id = 'rev_1'`)
		);
		expect(refund).toMatchObject({
			provider: 'sponsor',
			status: 'succeeded',
			amount_minor: 10_000,
			notice_owed_since: null
		});
		expect(await counts()).toEqual({ groups: 0, owed: 0, refunds: 1 });
		expect(mail.sent).toEqual([]);

		const later = mailer();
		await sendOwedRefundNotices({ db, email: later.port }, new Date('2026-12-31T00:00:00Z'));
		expect(later.sent).toEqual([]);
	});

	it('changes nothing when the same refund arrives again', async () => {
		const giftId = await pendingGift();
		await settleEvent(deps(giftId, mailer().port), SETTLED());
		await settleEvent(deps(giftId, mailer().port), REFUNDED());
		const mail = mailer();

		const again = await settleEvent(deps(giftId, mail.port), REFUNDED());

		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(mail.sent).toEqual([]);
		expect(await counts()).toEqual({ groups: 0, owed: 0, refunds: 1 });
	});

	it('answers not_yet and writes nothing for a refund before its payment settled', async () => {
		const giftId = await pendingGift();

		const result = await settleEvent(deps(giftId, mailer().port), REFUNDED());

		expect(result).toMatchObject({ ok: true, outcome: 'not_yet' });
		expect(await counts()).toEqual({ groups: 0, owed: 0, refunds: 0 });
	});
});

describe('settleEvent() — a dispute of a gift the sponsor took', () => {
	it('writes nothing and tells nobody for a dispute won with no opening recorded', async () => {
		const giftId = await pendingGift();
		await settleEvent(deps(giftId, mailer().port), SETTLED());
		const mail = mailer();

		const result = await settleEvent(deps(giftId, mail.port, 'dispute_won'), DISPUTE_CLOSED());

		expect(result).toMatchObject({ ok: true, outcome: 'ignored' });
		expect(mail.sent).toEqual([]);
		expect(await counts()).toEqual({ groups: 0, owed: 0, refunds: 0 });
	});

	it('answers the opening the same once the dispute reads won, so the pull passes it', async () => {
		const giftId = await pendingGift();
		await settleEvent(deps(giftId, mailer().port), SETTLED());
		const mail = mailer();

		const result = await settleEvent(deps(giftId, mail.port, 'dispute_won'), DISPUTED());

		expect(result).toMatchObject({ ok: true, outcome: 'ignored' });
		expect(mail.sent).toEqual([]);
		expect(await counts()).toEqual({ groups: 0, owed: 0, refunds: 0 });
	});

	it('puts back a dispute won after its opening, posting nothing and mailing nobody', async () => {
		const giftId = await pendingGift();
		await settleEvent(deps(giftId, mailer().port), SETTLED());
		const opened = await settleEvent(deps(giftId, mailer().port, 'dispute_opened'), DISPUTED());
		expect(opened).toMatchObject({ ok: true, outcome: 'updated' });
		const mail = mailer();

		const result = await settleEvent(deps(giftId, mail.port, 'dispute_won'), DISPUTE_CLOSED());

		expect(result).toMatchObject({ ok: true, outcome: 'updated' });
		const row = await first<{ status: string; outcome: string | null }>(
			stmt(`select payment.status, dispute.outcome from payment
			 join dispute on dispute.payment_id = payment.id
			 where payment.provider_txn_id = 'rev_1'`)
		);
		expect(row).toEqual({ status: 'cancelled', outcome: 'won' });
		expect(await counts()).toEqual({ groups: 0, owed: 0, refunds: 1 });
		expect(mail.sent).toEqual([]);
	});
});
