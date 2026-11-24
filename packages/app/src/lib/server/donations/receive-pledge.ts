import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { sharesPhrase } from '../../donations/pledged';
import { projectTribute } from '../../donations/tributes';
import { FORM_CURRENCY } from '../../forms/amounts';
import { readContactSummaries } from '../contacts/queries';
import { donationRevenueAccount } from '../db/accounts';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import type { PledgeReceived } from '../email/receipt';
import { donation, type NewDonation, type Pledge, pledge } from '../db/schema';
import { readProgram } from '../programs/queries';
import { supporterPageCountingOf } from '../supporters/gifts';
import { receivedInHandEntry } from './entries';
import { type ReceiptDeps, type ReceiptOutcome, sendReceipt } from './receipt';
import { inHandWrites } from './record-in-hand';
import { sendTributeNotice } from './tribute-notice';

// Mark received on the Gifts screen: a stock or IRA (QCD) pledge (`pledge` in ../db/schema.ts)
// written as the gift it became, whole, in one `batch()` — the gift copying what the donor said on
// the form, at the value and on the day staff entered, then its line, a `succeeded` `manual`
// payment on the pledge's rail, its employer match row and its entry with no fee
// (`inHandWrites` in ./record-in-hand.ts), and the pledge's `donation_id` stamped.
//
// the gift's id is the pledge's own. that is what makes a second press, or two at once, record
// nothing: the second batch's `donation` insert meets the first's primary key and the whole batch is
// refused, atomically, where a guard on `donation_id is null` alone would let a second gift commit
// beside a stamp that matched no row. the guard stays on the stamp all the same, and
// `pledge_donation_id_idx` keeps a gift to one pledge.
//
// the receipt is not sent here. `sendReceivedPledgeMail` below runs after the commit, when the
// caller hands it to the deferred-work tracker. a press that finds the gift already recorded
// answers it too, as that gift was recorded, so the caller sends the mail an earlier press never
// got to: `sendReceipt`'s claim on `receipt_sent_at` (./receipt.ts) keeps it to one receipt.

/** one Mark received press, as the action parsed it. */
export type PledgeArrival = {
	readonly pledgeId: string;
	/** minor units of `FORM_CURRENCY`, positive: what the shares or the check were worth. */
	readonly amountMinor: number;
	/** the day it arrived, as its UTC midnight (`readAccountingDate` in $lib/ledger/input-schema.ts). */
	readonly dated: Date;
};

/** what the receipt and the tribute notice for a received pledge are written from. */
export type ReceivedPledge = {
	readonly donationId: string;
	readonly amountMinor: number;
	readonly dated: Date;
	readonly donorName: string | null;
	readonly donorEmail: string | null;
	readonly program: string | null;
	/** the rail the pledge was on, and on a stock gift the shares, for the receipt. */
	readonly pledge: PledgeReceived;
	readonly tributeKind: string | null;
	readonly tributeHonoree: string | null;
	readonly tributeNotifyName: string | null;
	readonly tributeNotifyEmail: string | null;
};

/**
 *   ok               — the gift is recorded and in the books, and the pledge left the waiting card.
 *   not_found        — no pledge has this id.
 *   already_received — an earlier press recorded it, and this one wrote nothing. `gift` is the gift
 *                      as that press recorded it, for the mail it may not have sent.
 *   write_failed     — the pledge or an earlier press's gift could not be read, the write did not
 *                      report success, or it did and the gift's donor or cause could not be read
 *                      for its mail; the cause is logged. it may have landed, and pressing again is
 *                      safe: the gift's id is the pledge's.
 */
export type ReceivePledgeResult =
	| { readonly ok: true; readonly gift: ReceivedPledge }
	| { readonly ok: false; readonly reason: 'already_received'; readonly gift: ReceivedPledge }
	| { readonly ok: false; readonly reason: 'not_found' | 'write_failed' };

/**
 * record one pledge as received. an amount that is not a positive whole number of minor units
 * throws before anything is read, for `recordGiftInHand`'s reason: `post()` would balance a
 * negative figure and post the gift the other way round.
 */
export async function receivePledge(db: Db, arrival: PledgeArrival): Promise<ReceivePledgeResult> {
	if (!Number.isSafeInteger(arrival.amountMinor) || arrival.amountMinor <= 0) {
		throw new Error(
			`a received pledge is a positive whole number of minor units, and amountMinor is ${arrival.amountMinor}. refuse the value where it is parsed, before it reaches receivePledge.`
		);
	}

	let row: Pledge | undefined;
	try {
		[row] = await db.select().from(pledge).where(eq(pledge.id, arrival.pledgeId)).limit(1);
	} catch (error) {
		return failed(error);
	}
	if (row === undefined) return { ok: false, reason: 'not_found' };
	// an early answer for the press that plainly comes second. what refuses it is the batch below.
	if (row.donationId !== null) return alreadyReceived(db, row);

	const donationId = row.id;
	const paymentId = uuidv7();
	const revenueAccountId = donationRevenueAccount(true);
	// outside the `try`, so a date `post()` refuses surfaces as the `PostingError` it is.
	const posting = receivedInHandEntry({
		paymentId,
		donationId,
		revenueAccountId,
		amountMinor: arrival.amountMinor,
		currency: FORM_CURRENCY,
		dated: arrival.dated
	});

	// what the donor said on the form, copied across column for column (the header of `pledge`), but
	// for the fundraiser: that is bound in the insert below.
	const donationRow: Omit<NewDonation, 'supporterPageId'> = {
		id: donationId,
		contactId: row.contactId,
		totalMinor: arrival.amountMinor,
		currency: FORM_CURRENCY,
		receivedAt: arrival.dated,
		formId: row.formId,
		origin: row.origin,
		programId: row.programId,
		source: null,
		note: row.note,
		notePublic: row.notePublic,
		noteAnonymous: row.noteAnonymous,
		noteShownName: row.noteShownName,
		tributeKind: row.tributeKind,
		tributeHonoree: row.tributeHonoree,
		tributeNotifyName: row.tributeNotifyName,
		tributeNotifyEmail: row.tributeNotifyEmail
	};

	try {
		await db.batch([
			// the page owning the pledge's form, unless it was ended or hidden at or before the UTC
			// midnight that `dated` is: a page ended later on the arrival day still counts the gift
			// (`supporterPageCountingOf` in ../supporters/gifts.ts).
			db.insert(donation).values({
				...donationRow,
				supporterPageId: supporterPageCountingOf(row.formId, arrival.dated)
			}),
			...inHandWrites(db, {
				donationId,
				paymentId,
				contactId: row.contactId,
				amountMinor: arrival.amountMinor,
				dated: arrival.dated,
				method: row.method,
				revenueAccountId,
				posting
			}),
			db
				.update(pledge)
				.set({ donationId })
				.where(and(eq(pledge.id, row.id), isNull(pledge.donationId)))
		]);
	} catch (error) {
		const code = sqliteResultCode(error);
		if (
			(code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE') &&
			(await stampedWith(db, row.id))
		) {
			return alreadyReceived(db, row);
		}
		// a refusal the pledge's own stamp does not answer. `savePledge` (./pledges.ts) refuses a
		// pledge id a gift already holds, so this is a fault: logged, and never told as received.
		return failed(error);
	}

	try {
		return { ok: true, gift: await receivedOf(db, row, arrival) };
	} catch (error) {
		// the gift is in the books but its donor or cause could not be read for its mail, so the press
		// is answered as failed: pressing again finds the gift recorded and sends its mail
		// (`alreadyReceived`).
		return failed(error);
	}
}

/** the gift an earlier press recorded, read back at that press's value and day for its mail. */
async function alreadyReceived(db: Db, row: Pledge): Promise<ReceivePledgeResult> {
	try {
		const [recorded] = await db
			.select({ amountMinor: donation.totalMinor, dated: donation.receivedAt })
			.from(donation)
			.where(eq(donation.id, row.id))
			.limit(1);
		if (recorded === undefined) {
			throw new Error(`pledge ${row.id} is stamped received and no gift has its id`);
		}
		return { ok: false, reason: 'already_received', gift: await receivedOf(db, row, recorded) };
	} catch (error) {
		return failed(error);
	}
}

function giftOf(row: Pledge, recorded: Recorded): Omit<ReceivedPledge, 'donorName' | 'donorEmail'> {
	return {
		donationId: row.id,
		amountMinor: recorded.amountMinor,
		dated: recorded.dated,
		program: null,
		pledge:
			row.method === 'stock' && row.ticker !== null && row.sharesMillionths !== null
				? {
						method: 'stock',
						shares: sharesPhrase({ ticker: row.ticker, sharesMillionths: row.sharesMillionths })
					}
				: { method: 'ira_qcd' },
		tributeKind: row.tributeKind,
		tributeHonoree: row.tributeHonoree,
		tributeNotifyName: row.tributeNotifyName,
		tributeNotifyEmail: row.tributeNotifyEmail
	};
}

/** the value and day a gift was recorded at. */
type Recorded = Pick<PledgeArrival, 'amountMinor' | 'dated'>;

async function receivedOf(db: Db, row: Pledge, recorded: Recorded): Promise<ReceivedPledge> {
	const [donors, cause] = await Promise.all([
		readContactSummaries(db, [row.contactId]),
		row.programId === null ? null : readProgram(db, row.programId)
	]);
	const donor = donors.get(row.contactId);
	return {
		...giftOf(row, recorded),
		donorName: donor?.displayName ?? null,
		donorEmail: donor?.primaryEmail ?? null,
		program: cause?.name ?? null
	};
}

/** whether the pledge is stamped as the gift of its own id: an earlier press's batch landed. */
async function stampedWith(db: Db, pledgeId: string): Promise<boolean> {
	try {
		const [held] = await db
			.select({ donationId: pledge.donationId })
			.from(pledge)
			.where(eq(pledge.id, pledgeId))
			.limit(1);
		return held?.donationId === pledgeId;
	} catch {
		return false;
	}
}

function failed(error: unknown): ReceivePledgeResult {
	// wrapped, for the reason `logProviderFault` in ../payments/provider.ts states.
	try {
		console.error('recording a received pledge failed:', error);
	} catch {
		// nothing to report it to.
	}
	return { ok: false, reason: 'write_failed' };
}

/**
 * the donor's receipt for a received pledge — the shares on a stock gift and never the value staff
 * entered, the amount on an IRA (QCD) gift (`PledgeReceived` in the emails package's receipt) —
 * and then the notice to the person they asked us to tell, where they named one. both claim their
 * own stamp on the gift before they send and hand it back when the send fails, so a second call
 * sends only what the first did not; neither throws.
 */
export async function sendReceivedPledgeMail(
	deps: ReceiptDeps,
	gift: ReceivedPledge
): Promise<ReceiptOutcome> {
	const receipt = await sendReceipt(deps, {
		donationId: gift.donationId,
		donorName: gift.donorName,
		donorEmail: gift.donorEmail,
		contribution: {
			totalMinor: gift.amountMinor,
			// no processor and so no fee, and nothing given in exchange.
			nonDeductibleMinor: 0,
			coveredFeeMinor: 0,
			currency: FORM_CURRENCY,
			receivedAt: gift.dated
		},
		tribute: projectTribute(gift.tributeKind, gift.tributeHonoree),
		program: gift.program,
		crypto: null,
		pledge: gift.pledge
	});
	await sendTributeNotice(deps, {
		donationId: gift.donationId,
		donorName: gift.donorName,
		tributeKind: gift.tributeKind,
		tributeHonoree: gift.tributeHonoree,
		notifyName: gift.tributeNotifyName,
		notifyEmail: gift.tributeNotifyEmail
	});
	return receipt;
}
