import { env } from 'cloudflare:test';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import {
	contact,
	donation,
	form,
	payment,
	program,
	recurringPlan,
	type NewDonation,
	type NewPayment
} from '../db/schema';
import { donorEventOf, readGiftEvents, readSamples, SAMPLE_DONOR, SAMPLE_GIFT } from './payload';

// what a Zap is handed about a gift, rendered from the rows a real D1 holds.
//
// a workers spec because the render is a join across six tables and every nullable column in it
// is a key that must still arrive, as null — the thing a stand-in would decide for itself.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	for (const table of [
		'payment',
		'line_item',
		'donation',
		'recurring_plan',
		'contact',
		'form',
		'program'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
});

const FORM_ID = '019fb700-0000-7000-8000-000000000001';
const PROGRAM_ID = '019fb700-0000-7000-8000-000000000002';

async function seedFormAndProgram(): Promise<void> {
	await db.insert(program).values({ id: PROGRAM_ID, name: 'Clean water' });
	await db.insert(form).values({
		id: FORM_ID,
		name: 'General Fund',
		status: 'live',
		revenueAccountId: postableId('donationsDeductible'),
		currency: 'USD',
		minMinor: 500,
		maxMinor: 1_000_000
	});
}

async function seedDonor(
	over: { displayName?: string; primaryEmail?: string | null } = {}
): Promise<string> {
	const id = uuidv7();
	await db.insert(contact).values({
		id,
		kind: 'individual',
		displayName: over.displayName ?? 'Ada Okafor',
		primaryEmail: over.primaryEmail === undefined ? 'ada@example.org' : over.primaryEmail
	});
	return id;
}

/** one gift and its payment; whatever the case needs replaced on either row. */
async function seedGift(
	contactId: string,
	over: { donation?: Partial<NewDonation>; payment?: Partial<NewPayment> } = {}
): Promise<{ donationId: string; paymentId: string }> {
	const donationId = uuidv7();
	const paymentId = uuidv7();
	const at = new Date('2026-09-10T12:00:00.000Z');
	await db.insert(donation).values({
		id: donationId,
		contactId,
		totalMinor: 5_000,
		currency: 'USD',
		receivedAt: at,
		...over.donation
	});
	await db.insert(payment).values({
		id: paymentId,
		donationId,
		amountMinor: 5_000,
		currency: 'USD',
		direction: 'inbound',
		method: 'check',
		status: 'succeeded',
		provider: 'manual',
		occurredAt: at,
		...over.payment
	});
	return { donationId, paymentId };
}

describe('readGiftEvents()', () => {
	it('renders a one-off gift from a form, with everything the donor said', async () => {
		await seedFormAndProgram();
		const contactId = await seedDonor();
		const { donationId, paymentId } = await seedGift(contactId, {
			donation: {
				totalMinor: 5_150,
				feeMinor: 150,
				formId: FORM_ID,
				programId: PROGRAM_ID,
				note: 'for the new well',
				tributeKind: 'memory',
				tributeHonoree: 'Margaret Chen',
				tributeNotifyName: 'Iris Chen',
				tributeNotifyEmail: 'iris@example.org'
			},
			payment: {
				amountMinor: 5_150,
				method: 'card',
				provider: 'stripe',
				providerTxnId: 'pi_1',
				occurredAt: new Date('2026-09-10T12:34:56.000Z')
			}
		});

		const events = await readGiftEvents(db, [paymentId]);

		expect(events.get(paymentId)).toStrictEqual({
			id: paymentId,
			donation_id: donationId,
			occurred_at: '2026-09-10T12:34:56.000Z',
			amount: '51.50',
			amount_minor: 5_150,
			currency: 'USD',
			covered_fee_minor: 150,
			method: 'card',
			recurring: false,
			frequency: 'one_time',
			form_id: FORM_ID,
			form_name: 'General Fund',
			program_name: 'Clean water',
			dedication_kind: 'memory',
			dedication_honoree: 'Margaret Chen',
			note: 'for the new well',
			donor_id: contactId,
			donor_name: 'Ada Okafor',
			donor_email: 'ada@example.org',
			coin: null,
			coin_amount: null
		});
	});

	it('renders a charge under a commitment as recurring, at the commitment’s cadence', async () => {
		await seedFormAndProgram();
		const contactId = await seedDonor();
		const planId = uuidv7();
		await db.insert(recurringPlan).values({
			id: planId,
			contactId,
			formId: FORM_ID,
			amountMinor: 2_500,
			currency: 'USD',
			interval: 'yearly',
			status: 'active',
			provider: 'stripe',
			providerSubscriptionId: 'sub_1',
			providerCustomerId: 'cus_1',
			startedAt: new Date('2026-09-10T12:00:00.000Z')
		});
		const { paymentId } = await seedGift(contactId, {
			donation: { formId: FORM_ID, recurringId: planId },
			payment: { method: 'card', provider: 'stripe', providerTxnId: 'pi_2' }
		});

		const event = (await readGiftEvents(db, [paymentId])).get(paymentId);

		expect(event).toMatchObject({ recurring: true, frequency: 'yearly' });
	});

	it('renders a gift recorded by hand with every key present, null where it says nothing', async () => {
		const contactId = await seedDonor({ primaryEmail: null });
		const { paymentId } = await seedGift(contactId);

		const event = (await readGiftEvents(db, [paymentId])).get(paymentId);

		// through JSON, as the hook receives it: a key rendered `undefined` would not survive.
		expect(JSON.parse(JSON.stringify(event))).toMatchObject({
			method: 'check',
			recurring: false,
			frequency: 'one_time',
			covered_fee_minor: 0,
			form_id: null,
			form_name: null,
			program_name: null,
			dedication_kind: null,
			dedication_honoree: null,
			note: null,
			donor_email: null,
			coin: null,
			coin_amount: null
		});
	});

	it('renders a crypto gift with the coin and how much of it arrived', async () => {
		const contactId = await seedDonor();
		const { paymentId } = await seedGift(contactId, {
			payment: {
				amountMinor: 514,
				method: 'crypto',
				provider: 'nowpayments',
				providerTxnId: '5745460001',
				coin: 'xrp',
				coinNetwork: 'xrp',
				coinAmount: '4'
			}
		});

		const event = (await readGiftEvents(db, [paymentId])).get(paymentId);

		expect(event).toMatchObject({
			amount: '5.14',
			method: 'crypto',
			coin: 'xrp',
			coin_amount: '4'
		});
	});

	it('writes the amount in major units with no grouping, in the currency’s own digits', async () => {
		const contactId = await seedDonor();
		const dollars = await seedGift(contactId, { payment: { amountMinor: 123_456_78 } });
		const yen = await seedGift(contactId, { payment: { amountMinor: 250_000, currency: 'JPY' } });

		const events = await readGiftEvents(db, [dollars.paymentId, yen.paymentId]);

		expect(events.get(dollars.paymentId)?.amount).toBe('123456.78');
		expect(events.get(yen.paymentId)).toMatchObject({ amount: '250000', currency: 'JPY' });
	});

	it('reads more gifts than one query can bind', async () => {
		const contactId = await seedDonor();
		const seeded = [await seedGift(contactId), await seedGift(contactId)];
		const unknown = Array.from({ length: 150 }, () => uuidv7());
		const wanted = [...unknown, ...seeded.map((g) => g.paymentId)];

		const events = await readGiftEvents(db, wanted);

		expect([...events.keys()].sort()).toEqual(seeded.map((g) => g.paymentId).sort());
	});
});

describe('donorEventOf()', () => {
	it('names the donor from their first gift, and carries that gift whole', async () => {
		const contactId = await seedDonor({
			displayName: 'Grace Hopper',
			primaryEmail: 'grace@example.org'
		});
		const { paymentId } = await seedGift(contactId);
		const gift = (await readGiftEvents(db, [paymentId])).get(paymentId);
		if (gift === undefined) throw new Error('the fixture gift did not render');

		expect(donorEventOf(gift)).toStrictEqual({
			id: contactId,
			name: 'Grace Hopper',
			email: 'grace@example.org',
			first_gift: gift
		});
	});
});

/** a gift settled on `day` of September 2026. */
function onDay(day: number, status: NewPayment['status'] = 'succeeded') {
	const at = new Date(Date.UTC(2026, 8, day, 12));
	return { donation: { receivedAt: at }, payment: { occurredAt: at, status } };
}

describe('readSamples()', () => {
	it('hands a new-gift Zap the three latest settled gifts, newest first', async () => {
		const contactId = await seedDonor();
		await seedGift(contactId, onDay(1));
		const second = await seedGift(contactId, onDay(2));
		const third = await seedGift(contactId, onDay(3));
		const fourth = await seedGift(contactId, onDay(4));
		await seedGift(contactId, onDay(5, 'failed'));

		const samples = await readSamples(db, 'new_gift');

		expect(samples.map((event) => event.id)).toEqual([
			fourth.paymentId,
			third.paymentId,
			second.paymentId
		]);
	});

	it('hands a new-donor Zap the three latest donors, each by their first settled gift', async () => {
		const d = await seedDonor({ displayName: 'Dee' });
		await seedGift(d, onDay(1));
		const a = await seedDonor({ displayName: 'Ada' });
		const aFirst = await seedGift(a, onDay(2));
		await seedGift(a, onDay(6));
		const b = await seedDonor({ displayName: 'Bea' });
		const bFirst = await seedGift(b, onDay(3));
		const c = await seedDonor({ displayName: 'Cy' });
		await seedGift(c, onDay(2, 'failed'));
		const cFirst = await seedGift(c, onDay(4));

		const samples = await readSamples(db, 'new_donor');

		expect(samples.map((event) => [event.id, event.first_gift.id])).toEqual([
			[c, cFirst.paymentId],
			[b, bFirst.paymentId],
			[a, aFirst.paymentId]
		]);
	});

	it('hands a deployment with no gift yet the fixed sample, for either trigger', async () => {
		expect(await readSamples(db, 'new_gift')).toStrictEqual([SAMPLE_GIFT]);
		expect(await readSamples(db, 'new_donor')).toStrictEqual([SAMPLE_DONOR]);
	});
});

/** an event's keys as the hook receives it, nested ones by path. */
function wireKeys(event: unknown): string[] {
	const keys = (value: object, prefix: string): string[] =>
		Object.entries(value).flatMap(([key, inner]) =>
			inner !== null && typeof inner === 'object'
				? keys(inner, `${prefix}${key}.`)
				: [`${prefix}${key}`]
		);
	return keys(JSON.parse(JSON.stringify(event)), '').sort();
}

describe('a live event and its sample carry the same fields', () => {
	it('for a new gift and for a new donor, sparse gift or full', async () => {
		const sparse = await seedGift(await seedDonor({ primaryEmail: null }), onDay(1));

		const [live] = await readSamples(db, 'new_gift');
		const [liveDonor] = await readSamples(db, 'new_donor');

		expect(live?.id).toBe(sparse.paymentId);
		expect(wireKeys(live)).toEqual(wireKeys(SAMPLE_GIFT));
		expect(wireKeys(liveDonor)).toEqual(wireKeys(SAMPLE_DONOR));
	});
});
