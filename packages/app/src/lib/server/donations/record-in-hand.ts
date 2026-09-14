import type { BatchItem } from 'drizzle-orm/batch';
import { uuidv7 } from 'uuidv7';
import type { InHandMethod } from '../../donations/methods';
import { FORM_CURRENCY } from '../../forms/amounts';
import type { ParsedContact } from '../contacts/contact-input';
import { donationRevenueAccount } from '../db/accounts';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import {
	donation,
	lineItem,
	payment,
	type NewDonation,
	type NewLineItem,
	type NewPayment
} from '../db/schema';
import { postingStatements } from '../ledger/posting';
import { resolveDonor } from './donor';
import { receivedInHandEntry } from './entries';

// a gift an operator enters by hand — cash or a cheque that arrived in an envelope — written whole:
// the donor where they are new, the gift, its one line, a settled payment and its entry in the books,
// in one `batch()`.
//
// a sibling of ./record.ts rather than a caller of it. `recordDonation` writes what a processor has
// only promised — a form, a transaction id, a `pending` attempt, and nothing in the books — and every
// one of those is wrong here. this money is already in hand, so the payment is written `succeeded`
// and the gift posts in the same commit that records it.
//
// the payment row is what makes the gift true everywhere else. `projectStatus`, `readGiftsByMonth`
// (./queries.ts), `listContacts` and `readDonorSummary` (../contacts/queries.ts) each read a gift as
// given only through a succeeded inbound attempt, so one written `manual` with this gift's date is
// what puts it on the gifts list as completed, in the month it is dated, and on its donor's total —
// with no change to any of those reads.
//
// the entry is ./entries.ts's `receivedInHandEntry`, keyed to the payment id as a `payment` source,
// the grain the card path posts at. ../ledger/posting.ts stays the only module that inserts into the
// books: this splices the statements it hands up, as ./settle.ts does.
//
// the currency is not an input. v0 is USD-only by decision (`FORM_CURRENCY` in
// `$lib/forms/amounts.ts`), and ../ledger/correct.ts keeps its books in the same one.

/**
 * who the gift is filed under: a donor the operator picked, or one they are creating.
 *
 * a new donor goes through `resolveDonor` in ./donor.ts, so an address already on file files the gift
 * under that contact rather than minting a second — the same match the donation form makes. the
 * consent answer is `null`: nobody asked the donor, and a matched donor's own answer is left alone.
 */
export type InHandDonor =
	| { readonly kind: 'existing'; readonly contactId: string }
	| { readonly kind: 'new'; readonly contact: ParsedContact };

/** one gift in hand, as the screen's action has parsed it. */
export type GiftInHand = {
	/**
	 * the gift's id and its payment's, both minted by the caller's loader and carried in the form.
	 *
	 * they are the idempotency key. a second press presents the same pair, and the database refuses
	 * the second write on the gift's primary key — atomically, which a lookup first could not be.
	 */
	readonly donationId: string;
	readonly paymentId: string;
	readonly donor: InHandDonor;
	/** minor units, positive. */
	readonly amountMinor: number;
	/**
	 * business time: the day the donor gave, freely backdated.
	 *
	 * written as the gift's `received_at`, the payment's `occurred_at` and the entry group's
	 * `occurred_at`, so a gift dated into an earlier month counts, reports and posts in that month.
	 */
	readonly dated: Date;
	readonly method: InHandMethod;
	/** the cause the gift is credited to, or `null`. */
	readonly programId: string | null;
	/**
	 * how the gift came in, in the operator's words — `donation.source`.
	 *
	 * never `donation.note`: that column is what a donor typed, and the gifts list prints it as the
	 * donor's message.
	 */
	readonly source: string | null;
};

/**
 * what entering one gift did.
 *
 *   ok               — the gift is recorded and in the books, filed under `contactId`.
 *   already_recorded — these ids are already in the database: an earlier press landed, and this one
 *                      wrote nothing. the books are in the state the operator wanted.
 *   write_failed     — the write did not report success. it may have landed anyway, so presenting
 *                      the same ids again is safe and different ones are not; the cause is logged.
 */
export type GiftInHandResult =
	| { readonly ok: true; readonly contactId: string; readonly donorWasCreated: boolean }
	| { readonly ok: false; readonly reason: 'already_recorded' | 'write_failed' };

type Writes = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];

/**
 * record one gift received in hand, or report that its ids are already recorded.
 *
 * an amount that is not a positive whole number of minor units, or a date that is not a date, throws
 * before anything is read: both are a parse the caller skipped. the amount is checked here because
 * `post()` would balance a negative figure and post the gift the other way round.
 *
 * the receipt is not sent here. `sendReceipt` in ./receipt.ts runs after the commit, when the caller
 * decides to.
 */
export async function recordGiftInHand(db: Db, gift: GiftInHand): Promise<GiftInHandResult> {
	if (!Number.isSafeInteger(gift.amountMinor) || gift.amountMinor <= 0) {
		throw new Error(
			`a gift in hand is a positive whole number of minor units, and amountMinor is ${gift.amountMinor}. refuse the amount where it is parsed, before it reaches recordGiftInHand.`
		);
	}

	const revenueAccountId = donationRevenueAccount(true);
	// outside the `try`, so a date `post()` refuses surfaces as the `PostingError` it is rather than as
	// a write that failed.
	const posting = receivedInHandEntry({
		paymentId: gift.paymentId,
		donationId: gift.donationId,
		revenueAccountId,
		amountMinor: gift.amountMinor,
		currency: FORM_CURRENCY,
		dated: gift.dated
	});

	try {
		const donor =
			gift.donor.kind === 'existing'
				? { contactId: gift.donor.contactId, created: false, statement: null }
				: await resolveDonor(db, gift.donor.contact, null);

		const donationRow: NewDonation = {
			id: gift.donationId,
			contactId: donor.contactId,
			totalMinor: gift.amountMinor,
			currency: FORM_CURRENCY,
			receivedAt: gift.dated,
			formId: null,
			source: gift.source,
			programId: gift.programId
		};
		const lineRow: NewLineItem = {
			id: uuidv7(),
			donationId: gift.donationId,
			label: 'Donation',
			revenueAccountId,
			unitPriceMinor: gift.amountMinor,
			lineTotalMinor: gift.amountMinor
		};
		const paymentRow: NewPayment = {
			id: gift.paymentId,
			donationId: gift.donationId,
			amountMinor: gift.amountMinor,
			currency: FORM_CURRENCY,
			direction: 'inbound',
			method: gift.method,
			status: 'succeeded',
			// `manual` mints no transaction id, and `NON_PROCESSOR_PROVIDERS` in ../db/schema.ts is what
			// lets the column stay null for it.
			provider: 'manual',
			occurredAt: gift.dated
		};

		// foreign-key order: the donor, the gift, what names the gift, then the books.
		const rows: Writes = [
			db.insert(donation).values(donationRow),
			db.insert(lineItem).values(lineRow),
			db.insert(payment).values(paymentRow),
			...postingStatements(db, posting)
		];
		await db.batch(donor.statement === null ? rows : [donor.statement, ...rows]);

		return { ok: true, contactId: donor.contactId, donorWasCreated: donor.created };
	} catch (error) {
		// every key this batch can collide on is one of the caller's two ids — the gift's and the
		// payment's primary keys, and `entry_group_source_idx` over the payment id. the contact, line,
		// group and entry ids are uuidv7s minted in this call.
		const code = sqliteResultCode(error);
		if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
			return { ok: false, reason: 'already_recorded' };
		}
		// wrapped, for the reason `logProviderFault` in ../payments/provider.ts states: `console.error`
		// runs the thrower's own getters.
		try {
			console.error('recording a gift in hand failed:', error);
		} catch {
			// nothing to report it to.
		}
		return { ok: false, reason: 'write_failed' };
	}
}
