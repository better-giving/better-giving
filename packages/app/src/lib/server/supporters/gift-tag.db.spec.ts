import { count, eq, isNull } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseContact } from '../contacts/contact-input';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { client } from '$lib/server/db/database.testing';
import { donation, lineItem, payment, supporterPage } from '$lib/server/db/schema';
import type { SettleDeps } from '$lib/server/donations/delivery';
import { recordDonation } from '$lib/server/donations/record';
import { settleDelivery, settleTransaction } from '$lib/server/donations/settle';
import { readRaisedByFormWithin } from '$lib/server/ledger/queries';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { repeatingGift, repeatingSeries } from '$lib/server/pages/settled-gifts.testing';
import { type PaymentProvider, refusing, type Settlement } from '$lib/server/payments/provider';
import { soleProcessor } from '$lib/server/payments/processors.testing';
import { emptySupporterTables, pendingPage, STARTED_AT } from './fundraiser.testing';
import { hideFundraiser, showFundraiser } from './admin';
import { signInWithLink } from './links';
import { endOwnFundraiser, fundraiserRaised } from './pages';

// every path that writes a gift row tags it with the fundraiser its form belongs to, so the page's
// total counts it: a repeating gift's later charge, a second crypto deposit, and a gift authorized
// while the page was live and settled after it ended. a later charge or deposit is tagged only while
// the page was neither ended nor hidden when the money moved, and stays in the organisation's books
// either way.

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	await emptySupporterTables();
	await writeOrgRow(client, {
		tax_id: '12-3456789',
		deductibility_statement: 'No goods or services were provided.'
	});
});

const LIVE_AT = new Date(STARTED_AT.getTime() + 60_000);

async function livePage() {
	const { pageId, token } = await pendingPage(db);
	await signInWithLink(db, new Request('https://give.example/f/link'), token, LIVE_AT);
	const [row] = await db
		.select({ formId: supporterPage.formId, supporterId: supporterPage.supporterId })
		.from(supporterPage)
		.where(eq(supporterPage.id, pageId));
	if (!row) throw new Error(`page ${pageId} was not written`);
	return { pageId, ...row };
}

/** the page each gift row names, in the order the money moved. */
const taggedWith = async () =>
	(
		await db.select({ page: donation.supporterPageId }).from(donation).orderBy(donation.receivedAt)
	).map((row) => row.page);

const donor = () => {
	const parsed = parseContact({
		kind: 'individual',
		first_name: 'Ada',
		last_name: 'Okafor',
		primary_email: 'ada@example.org'
	});
	if (!parsed.ok) throw new Error('the fixture donor did not parse');
	return parsed.value;
};

/** a gift to `formId` recorded as the donation endpoint records it, waiting for its processor. */
async function authorize(
	formId: string,
	over: { method: 'card' | 'crypto'; processor: 'stripe' | 'nowpayments'; txn: string }
) {
	const donationId = crypto.randomUUID();
	const recorded = await recordDonation(db, {
		donationId,
		donor: donor(),
		formId,
		origin: null,
		currency: 'USD',
		processor: over.processor,
		totalMinor: 10_000,
		feeMinor: 0,
		lines: [
			{
				label: 'Donation',
				revenueAccountId: postableId('donationsDeductible'),
				amountMinor: 10_000
			}
		],
		method: over.method,
		providerTxnId: over.txn,
		...(over.method === 'crypto'
			? {
					deposit: {
						coin: 'xrp',
						network: 'xrp',
						validUntil: new Date('2026-11-30T00:00:00.000Z')
					}
				}
			: {}),
		occurredAt: new Date('2026-11-11T12:30:00.000Z'),
		consentedToContact: false,
		note: undefined,
		tribute: null,
		programId: null
	});
	if (!recorded.ok) throw new Error(`the fixture gift was not recorded: ${recorded.detail}`);
	return donationId;
}

const settlementOf = (over: Partial<Settlement>): Settlement => ({
	providerTxnId: 'unset',
	status: 'succeeded',
	method: 'card',
	amountMinor: 10_000,
	currency: 'USD',
	feeMinor: null,
	metadata: {},
	occurredAt: new Date('2026-11-12T12:00:00.000Z'),
	arrival: null,
	...over
});

function answering(
	processor: 'stripe' | 'nowpayments',
	read: Settlement,
	eventTxn: string
): SettleDeps {
	const provider: PaymentProvider = {
		...refusing(processor, 'unsupported', 'not part of the settlement path'),
		verifyEvent: async () => ({
			ok: true,
			value: {
				id: `evt_${eventTxn}`,
				kind: 'settlement',
				type: 'finished',
				providerTxnId: eventTxn,
				occurredAt: read.occurredAt
			}
		}),
		readSettlement: async () => ({ ok: true, value: read })
	};
	return {
		db,
		provider,
		processors: soleProcessor(provider),
		email: { send: async () => ({ ok: true }) }
	};
}

const DELIVERY = { body: '{"id":"evt"}', headers: { 'stripe-signature': 't=1,v1=abc' } };

describe('a gift row on a fundraiser carries its page', () => {
	it('on every charge of a repeating gift, the later ones included', async () => {
		const { pageId, formId } = await livePage();
		await repeatingGift(db, formId, 2_500, 3);
		expect(await taggedWith()).toEqual([pageId, pageId, pageId]);
		expect(await fundraiserRaised(db, pageId)).toEqual({ raisedMinor: 7_500, gifts: 3 });
	});

	it('on a second deposit to a crypto gift’s address', async () => {
		const { pageId, formId } = await livePage();
		await authorize(formId, { method: 'crypto', processor: 'nowpayments', txn: '5745459419' });
		const arrival = { coin: 'xrp', coinAmount: '19.3', valuedBy: 'arrival_rate' as const };
		const first = await settleDelivery(
			answering(
				'nowpayments',
				settlementOf({
					providerTxnId: '5745459419',
					method: 'crypto',
					arrival: { ...arrival, repeatOf: null }
				}),
				'5745459419'
			),
			DELIVERY
		);
		expect(first).toMatchObject({ ok: true, outcome: 'posted' });
		const second = await settleDelivery(
			answering(
				'nowpayments',
				settlementOf({
					providerTxnId: '5745460001',
					method: 'crypto',
					amountMinor: 514,
					arrival: { ...arrival, repeatOf: '5745459419' }
				}),
				'5745460001'
			),
			DELIVERY
		);
		expect(second).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await taggedWith()).toEqual([pageId, pageId]);
		expect(await fundraiserRaised(db, pageId)).toEqual({ raisedMinor: 10_514, gifts: 2 });
	});

	it('when authorized before the page ended and settled after', async () => {
		const { pageId, formId } = await livePage();
		const donationId = await authorize(formId, {
			method: 'card',
			processor: 'stripe',
			txn: 'pi_before_end'
		});
		await db
			.update(supporterPage)
			.set({ status: 'ended', endedAt: LIVE_AT })
			.where(eq(supporterPage.id, pageId));
		const settled = await settleTransaction(
			answering(
				'stripe',
				settlementOf({
					providerTxnId: 'pi_before_end',
					feeMinor: 150,
					metadata: { donation_id: donationId }
				}),
				'pi_before_end'
			),
			{ providerTxnId: 'pi_before_end', eventId: 'evt_before_end' }
		);
		expect(settled).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await taggedWith()).toEqual([pageId]);
		expect(await fundraiserRaised(db, pageId)).toEqual({ raisedMinor: 10_000, gifts: 1 });
	});
});

const OPENED_AT = new Date('2026-11-12T12:00:00.000Z');
const BEFORE_HIDE = new Date('2026-11-15T12:00:00.000Z');
const HIDDEN_AT = new Date('2026-11-20T12:00:00.000Z');
const ENDED_AT = HIDDEN_AT;
const LATER_AT = new Date('2026-11-25T12:00:00.000Z');
const AFTER_SHOWN = new Date('2026-12-03T12:00:00.000Z');
const LATER_MINOR = 2_500;

/** a gift opened through `formId` and settled at `OPENED_AT`: its figure, and its next charge at `at`. */
type Rail = (
	formId: string
) => Promise<{ openedMinor: number; charge: (at: Date) => Promise<void> }>;

const repeating: Rail = async (formId) => {
	const collect = await repeatingSeries(db, formId, LATER_MINOR);
	await collect(OPENED_AT);
	return { openedMinor: LATER_MINOR, charge: collect };
};

const cryptoDeposits: Rail = async (formId) => {
	const firstTxn = '5745459419';
	await authorize(formId, { method: 'crypto', processor: 'nowpayments', txn: firstTxn });
	const arrival = { coin: 'xrp', coinAmount: '19.3', valuedBy: 'arrival_rate' as const };
	const deposit = async (txn: string, over: Partial<Settlement>) => {
		const read = settlementOf({ providerTxnId: txn, method: 'crypto', ...over });
		const settled = await settleDelivery(answering('nowpayments', read, txn), DELIVERY);
		if (!settled.ok || settled.outcome !== 'posted') {
			throw new Error(`deposit ${txn} did not post: ${settled.detail}`);
		}
	};
	await deposit(firstTxn, { occurredAt: OPENED_AT, arrival: { ...arrival, repeatOf: null } });
	let repeats = 0;
	return {
		openedMinor: 10_000,
		charge: async (at) => {
			repeats += 1;
			await deposit(`57454600${repeats}`, {
				amountMinor: LATER_MINOR,
				occurredAt: at,
				arrival: { ...arrival, repeatOf: firstTxn }
			});
		}
	};
};

/**
 * every gift row has its line and its payment, the untagged rows keep `formId`, and the
 * organisation's total is `totalMinor`.
 */
async function inTheBooks(formId: string, totalMinor: number) {
	const untagged = await db
		.select({ formId: donation.formId })
		.from(donation)
		.where(isNull(donation.supporterPageId));
	expect(untagged).toEqual([{ formId }]);
	const [gifts] = await db.select({ n: count() }).from(donation);
	const [lines] = await db.select({ n: count() }).from(lineItem);
	const [payments] = await db.select({ n: count() }).from(payment);
	expect(lines?.n).toBe(gifts?.n);
	expect(payments?.n).toBe(gifts?.n);
	const byForm = await readRaisedByFormWithin(db, { from: null, before: null });
	expect(byForm.reduce((sum, row) => sum + row.raisedMinor, 0)).toBe(totalMinor);
}

describe.each([
	['a repeating gift’s later charge', repeating],
	['a later deposit to a crypto gift’s address', cryptoDeposits]
] as const)('%s, against its page as it stood when the money moved', (_, rail) => {
	it('counts while the page is live and shown', async () => {
		const { pageId, formId } = await livePage();
		const { openedMinor, charge } = await rail(formId);
		await charge(LATER_AT);
		expect(await taggedWith()).toEqual([pageId, pageId]);
		expect(await fundraiserRaised(db, pageId)).toEqual({
			raisedMinor: openedMinor + LATER_MINOR,
			gifts: 2
		});
	});

	it('does not count once staff have hidden the page, and stays in the books', async () => {
		const { pageId, formId } = await livePage();
		const { openedMinor, charge } = await rail(formId);
		expect(await hideFundraiser(db, pageId, null, HIDDEN_AT)).toBe('hidden');
		await charge(LATER_AT);
		expect(await taggedWith()).toEqual([pageId, null]);
		expect(await fundraiserRaised(db, pageId)).toEqual({ raisedMinor: openedMinor, gifts: 1 });
		await inTheBooks(formId, openedMinor + LATER_MINOR);
	});

	it('does not count when made the moment the page was hidden', async () => {
		const { pageId, formId } = await livePage();
		const { charge } = await rail(formId);
		await hideFundraiser(db, pageId, null, HIDDEN_AT);
		await charge(HIDDEN_AT);
		expect(await taggedWith()).toEqual([pageId, null]);
	});

	it('does not count once the supporter has ended the page, and stays in the books', async () => {
		const { pageId, formId, supporterId } = await livePage();
		const { openedMinor, charge } = await rail(formId);
		expect(await endOwnFundraiser(db, supporterId, pageId, ENDED_AT)).toBe('ended');
		await charge(LATER_AT);
		expect(await taggedWith()).toEqual([pageId, null]);
		expect(await fundraiserRaised(db, pageId)).toEqual({ raisedMinor: openedMinor, gifts: 1 });
		await inTheBooks(formId, openedMinor + LATER_MINOR);
	});

	it('does not count when made the moment the page was ended', async () => {
		const { pageId, formId, supporterId } = await livePage();
		const { charge } = await rail(formId);
		await endOwnFundraiser(db, supporterId, pageId, ENDED_AT);
		await charge(ENDED_AT);
		expect(await taggedWith()).toEqual([pageId, null]);
	});

	it('counts when made just before the page was ended', async () => {
		const { pageId, formId, supporterId } = await livePage();
		const { openedMinor, charge } = await rail(formId);
		await endOwnFundraiser(db, supporterId, pageId, ENDED_AT);
		await charge(new Date(ENDED_AT.getTime() - 1));
		expect(await taggedWith()).toEqual([pageId, pageId]);
		expect(await fundraiserRaised(db, pageId)).toEqual({
			raisedMinor: openedMinor + LATER_MINOR,
			gifts: 2
		});
	});

	it('counts when made before the end and recorded after it', async () => {
		const { pageId, formId, supporterId } = await livePage();
		const { openedMinor, charge } = await rail(formId);
		await endOwnFundraiser(db, supporterId, pageId, ENDED_AT);
		await charge(BEFORE_HIDE);
		expect(await taggedWith()).toEqual([pageId, pageId]);
		expect(await fundraiserRaised(db, pageId)).toEqual({
			raisedMinor: openedMinor + LATER_MINOR,
			gifts: 2
		});
	});

	it('counts when made before the hide and recorded after it', async () => {
		const { pageId, formId } = await livePage();
		const { openedMinor, charge } = await rail(formId);
		await hideFundraiser(db, pageId, null, HIDDEN_AT);
		await charge(BEFORE_HIDE);
		expect(await taggedWith()).toEqual([pageId, pageId]);
		expect(await fundraiserRaised(db, pageId)).toEqual({
			raisedMinor: openedMinor + LATER_MINOR,
			gifts: 2
		});
	});

	it('counts again once the page is shown, but not for what came while it was hidden', async () => {
		const { pageId, formId } = await livePage();
		const { openedMinor, charge } = await rail(formId);
		await hideFundraiser(db, pageId, null, HIDDEN_AT);
		await charge(LATER_AT);
		expect(await showFundraiser(db, pageId)).toBe('shown');
		await charge(AFTER_SHOWN);
		expect(await taggedWith()).toEqual([pageId, null, pageId]);
		expect(await fundraiserRaised(db, pageId)).toEqual({
			raisedMinor: openedMinor + LATER_MINOR,
			gifts: 2
		});
		await inTheBooks(formId, openedMinor + 2 * LATER_MINOR);
	});
});
