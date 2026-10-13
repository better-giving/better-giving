import { env } from 'cloudflare:test';
import { parseContact } from '../contacts/contact-input';
import { postableId } from '../db/accounts';
import type { Db } from '../db/client';
import type { SettleDeps } from '../donations/delivery';
import { recordAuthorizedGift, recordDonation } from '../donations/record';
import { recordReversal } from '../donations/reverse';
import { settleDelivery, settleTransaction } from '../donations/settle';
import type { EmailProvider } from '../email/provider';
import {
	DONATION_METADATA_KEY,
	FEE_COVERED_METADATA_KEY,
	GIFT_MINOR_METADATA_KEY,
	INTERVAL_METADATA_KEY,
	type PaymentProvider,
	refusing,
	type Settlement
} from '../payments/provider';
import { soleProcessor } from '../payments/processors.testing';

// gifts through a form, put in the books by the path production writes them by — quoted by
// `recordDonation`, settled by `settleTransaction`, refunded by `recordReversal`, collected by
// `settleDelivery` — for a spec that reads what those writers post. every gift is in USD and needs
// an `org_profile` row, which its receipt reads. not a spec itself: no pool's `include` matches
// this name.

const SETTLED_AT = new Date('2026-09-10T12:00:00.000Z');

const quiet: EmailProvider = { send: async () => ({ ok: true }) };

/** the deps a delivery arrives with, on a deployment holding `provider` alone. */
function through(db: Db, provider: PaymentProvider): SettleDeps {
	return { db, provider, processors: soleProcessor(provider), email: quiet };
}

/** the same, over a port whose one read is `settlement`. */
function settling(db: Db, settlement: Settlement): SettleDeps {
	return through(db, {
		...refusing('stripe', 'unsupported', 'not part of the settlement path'),
		readSettlement: async () => ({ ok: true, value: settlement })
	});
}

let sequence = 0;

/** a single gift quoted through `formId`, left pending unless `settles`; its transaction id. */
export async function gift(
	db: Db,
	formId: string,
	amountMinor: number,
	settles = true
): Promise<string> {
	sequence += 1;
	const txn = `pi_goal_${sequence}`;
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
		formId,
		origin: null,
		currency: 'USD',
		processor: 'stripe',
		totalMinor: amountMinor,
		feeMinor: 0,
		lines: [
			{ label: 'Donation', revenueAccountId: postableId('donationsDeductible'), amountMinor }
		],
		method: 'card',
		providerTxnId: txn,
		occurredAt: new Date('2026-09-10T11:00:00.000Z'),
		consentedToContact: false,
		note: undefined,
		tribute: null,
		programId: null
	});
	if (!recorded.ok) throw new Error(`the fixture gift was not recorded: ${recorded.detail}`);
	if (!settles) return txn;
	const settled = await settleTransaction(
		settling(db, {
			providerTxnId: txn,
			status: 'succeeded',
			method: 'card',
			amountMinor,
			currency: 'USD',
			feeMinor: 150,
			metadata: { donation_id: donationId },
			occurredAt: SETTLED_AT,
			arrival: null
		}),
		{ providerTxnId: txn, eventId: `evt_${txn}` }
	);
	if (!settled.ok || settled.outcome !== 'posted') {
		throw new Error(`the fixture gift did not settle: ${settled.detail}`);
	}
	return txn;
}

/** part or all of the charge on `txn` refunded, as the processor reads the refund back. */
export async function refund(db: Db, txn: string, amountMinor: number): Promise<void> {
	sequence += 1;
	const refunded = await recordReversal(
		through(db, refusing('stripe', 'unsupported', 'not part of the refund path')),
		{
			kind: 'refund',
			reversedTxnId: txn,
			providerReversalId: `re_goal_${sequence}`,
			amountMinor,
			currency: 'USD',
			occurredAt: new Date('2026-09-20T12:00:00.000Z'),
			reversedMetadata: {},
			feeReturnedMinor: null
		},
		`evt_re_goal_${sequence}`
	);
	if (!refunded.ok || refunded.outcome !== 'posted') {
		throw new Error(`the fixture refund was not posted: ${refunded.detail}`);
	}
}

/**
 * a monthly commitment of `amountMinor` authorized through `formId`, and its first `charges`
 * collections, each delivered and settled as the processor reports it.
 */
export async function repeatingGift(
	db: Db,
	formId: string,
	amountMinor: number,
	charges: number
): Promise<void> {
	sequence += 1;
	const contactId = crypto.randomUUID();
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
		 values (?, 'individual', 'Ada Okafor', 'ada@example.org', 0, 0)`
	)
		.bind(contactId)
		.run();
	const authorized = crypto.randomUUID();
	const written = await recordAuthorizedGift(db, {
		donationId: authorized,
		contactId,
		formId,
		origin: null,
		currency: 'USD',
		totalMinor: amountMinor,
		feeMinor: 0,
		lines: [
			{ label: 'Donation', revenueAccountId: postableId('donationsDeductible'), amountMinor }
		],
		note: undefined,
		tribute: null,
		programId: null,
		occurredAt: new Date('2026-08-01T09:00:00.000Z')
	});
	if (!written.ok) throw new Error(`the authorized gift was not written: ${written.detail}`);

	const subscription = `sub_goal_${sequence}`;
	for (let charge = 1; charge <= charges; charge += 1) {
		const txn = `${subscription}_pi_${charge}`;
		const at = new Date(Date.UTC(2026, 7 + charge, 3, 12));
		const provider = {
			...refusing('stripe', 'unsupported', 'not part of the collection path'),
			verifyEvent: async () => ({
				ok: true as const,
				value: {
					id: `evt_${txn}`,
					kind: 'recurring' as const,
					type: 'invoice.paid',
					providerNoticeId: `in_${txn}`,
					occurredAt: at
				}
			}),
			readRecurringGift: async () => ({
				ok: true as const,
				value: {
					about: 'collection' as const,
					providerGiftId: subscription,
					providerCustomerId: `cus_${subscription}`,
					state: 'active' as const,
					interval: 'monthly' as const,
					providerTxnId: txn,
					endedAt: null,
					nextChargeAt: new Date(Date.UTC(2026, 8 + charge, 3, 12)),
					metadata: {
						[DONATION_METADATA_KEY]: authorized,
						[INTERVAL_METADATA_KEY]: 'monthly',
						[GIFT_MINOR_METADATA_KEY]: String(amountMinor),
						[FEE_COVERED_METADATA_KEY]: 'false'
					}
				}
			}),
			readSettlement: async () => ({
				ok: true as const,
				value: {
					providerTxnId: txn,
					status: 'succeeded' as const,
					method: 'card' as const,
					amountMinor,
					currency: 'USD',
					feeMinor: 103,
					metadata: {},
					occurredAt: at,
					arrival: null
				}
			})
		};
		const collected = await settleDelivery(through(db, provider), {
			body: `{"id":"evt_${txn}"}`,
			headers: { 'stripe-signature': 't=1,v1=abc' }
		});
		if (!collected.ok || collected.outcome !== 'posted') {
			throw new Error(`collection ${charge} did not post: ${collected.detail}`);
		}
	}
}
