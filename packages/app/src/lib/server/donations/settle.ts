import { and, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { projectTribute } from '../../donations/tributes';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import {
	contact,
	donation,
	form,
	lineItem,
	payment,
	program,
	type Donation,
	type Payment,
	type PaymentMethod
} from '../db/schema';
import { renderUncollectedNotice } from '../email/uncollected';
import { postingStatements } from '../ledger/posting';
import { readOrgProfile } from '../org/queries';
import {
	DONATION_METADATA_KEY,
	isRetryable,
	PROVIDER_NAME,
	type Settlement,
	type WebhookDelivery
} from '../payments/provider';
import { collectRecurringGift } from './collect';
import { alert, type SettleDeps, type SettleResult } from './delivery';
import { chargeEntry, feeEntry, unpostable, type GiftRevenue, type RevenueShare } from './entries';
import { sendReceipt } from './receipt';
import { sendSettledNotice } from './settled-notice';
import { sendTributeNotice } from './tribute-notice';

// what a verified Stripe delivery does to this deployment's records: it corrects the payment row
// and, where money actually moved, puts the gift in the books.
//
// ---------------------------------------------------------------------------
// this step is an UPDATE plus a posting, and the update is not a footnote.
//
// three columns on `payment` are quote-time claims rather than facts, and ../db/schema.ts says so
// on each of them. `status` is `pending` because nothing had settled; `method` is the rail the
// donor was quoted on, which is a claim about a settlement that had not happened; `occurred_at` is
// when the attempt was opened rather than when money moved. `Settlement` in
// ../payments/provider.ts is emphatic that the settled rail is read from the processor and never
// copied from the donor's pre-selection — so a donor quoted on a wallet and settling on a card
// leaves a row that is wrong until this runs.
//
// `donation.received_at` is deliberately not corrected here, and that is the same reasoning
// reaching the opposite answer: it is the business date of the gift, which is the day the donor
// gave. an ACH debit initiated on Monday and cleared on Thursday is a Monday gift whose money
// moved on Thursday, so the donation keeps Monday and the payment takes Thursday.
//
// ---------------------------------------------------------------------------
// the idempotency key is `payment.id`, and it is the schema's decision rather than this module's.
//
// `entry_group_source_idx` in ../db/schema.ts pins what `source_id` holds per `source_type`, and
// pins it for `payment` and `fee` to the settlement's own `payment.id`. that is what makes "revenue
// for this payment is recognised exactly once" the thing the database enforces.
//
// keying on the delivery's event id instead would enforce something weaker and wrong: every one of
// `SETTLEMENT_EVENT_TYPES` in ../payments/stripe.ts re-reads the transaction rather than trusting
// what arrived, precisely because deliveries carry no ordering guarantee — so two different events
// about one charge can both read `succeeded`, and under distinct event ids both would post. the
// gift would be in the books twice, with every row reading clean.
//
// a redelivery therefore surfaces as a UNIQUE violation on insert, which CLAUDE.md names as the
// correct and only reliable answer, and `alreadyPosted` below is what turns it back into a 200.
// the whole batch rolls back with it, the update included — which costs nothing, because the update
// writes what the previous delivery already wrote.
//
// ---------------------------------------------------------------------------
// nothing is settled here that the intent does not name, and that rule is what keeps a repeating
// gift out of these books twice.
//
// `payment_intent.succeeded` fires for a collection under a commitment exactly as it fires for a
// one-off gift, because a collection is paid by a PaymentIntent like anything else. the two are
// told apart by what they carry: this app writes the gift's id onto every intent it mints
// (`DONATION_METADATA_KEY` in ../payments/provider.ts, written by ./quote.ts), and the processor
// mints a collection's intent itself and copies nothing onto it. so a settled transaction whose
// intent names no gift is not one this app opened a payment row for, and it is answered `unnamed`
// before any lookup happens.
//
// that is a refusal to act rather than a lookup that finds nothing, and the difference is the whole
// point. ./collect.ts writes a `payment` row for a collection carrying that collection's own
// transaction id, so a lookup by transaction id *would* find it — and posting against it would put
// every repeating gift in the books twice, both times reading clean. the database refuses the
// second posting as well (`entry_group_source_idx`, keyed on that payment row's id), so this is
// belt and braces rather than the only guard; what it buys over the constraint alone is that the
// order the two deliveries arrive in stops mattering.
//
// ---------------------------------------------------------------------------
// the fund a gift lands in is the one its own lines name, and no other.
//
// an operator chooses a fund per form; ./quote.ts copies that onto every `line_item` the gift is
// made of, and `problemWith` in ./record.ts refuses a gift whose lines do not add up to what the
// donor is charged, in those words: "the lines are what the settlement posts revenue from". this is
// the settlement, and the lines are what it reads. a gift itemized across two funds credits both,
// each by its own line's amount, against one debit for the settled total.
//
// reading them is one extra query per settled delivery, spent only where money moved. it is a read
// the write depends on and it is deliberately not a gate: nothing about the answer is checked and
// then relied on to still be true when the batch runs. a one-off gift's lines are written once, in
// the one `batch()` that writes the gift (./record.ts), and nothing updates or deletes one
// afterwards — the single arm that ever rewrites a line is the charge that opens a repeating
// commitment (`claimWrites` in ./collect.ts), which no delivery reaching this function is. and what
// makes a redelivery safe is `entry_group_source_idx` refusing the second posting rather than
// anything read here, which is the shape CLAUDE.md's ban on read-then-write asks for.
//
// what happens when the lines and the money disagree: nothing is posted, the payment row is still
// corrected, and an operator is told. a partial capture is what parts them, and no allocation is
// invented to close the gap — spreading a short settlement across funds by ratio is a split nobody
// chose, and it needs a rounding rule to place a residual no fund has a claim to. the gift is
// therefore left for a person to record, which is the same answer `unmatched` below reaches for a
// settlement with no gift behind it and the same one ./collect.ts reaches for a collection the
// ledger cannot hold. no fee is posted with it either: `feeEntry` credits `1020` for what the
// processor withheld, and `1020` was never debited.
//
// ---------------------------------------------------------------------------
// nothing on this path throws, and that is one rule behind two doors.
//
// `post()` refuses an entry group by throwing, and a throw here is a 500 the processor reads as
// "deliver this again" for three days against figures that answer identically every time. so
// everything it would refuse is decided before an entry is built, in two places because there are
// two kinds of defect: `unpostable` in ./entries.ts for what the settlement itself carries — an
// amount that is not a positive whole number of minor units, a currency that is not three uppercase
// letters, a time that is not a time, a fee that is not whole — and `recognitionOf` below for the
// one only a gift itemized across funds can have. ./collect.ts asks the first of them the same way,
// which is why it lives beside the entries both halves build rather than in whichever half needed
// it first.
//
// ---------------------------------------------------------------------------
// email is downstream of the books and can never change the answer.
//
// the batch is the commit. the receipt, the donor's "we could not collect your gift" and the alert
// are all sent after it, and their failure is reported rather than raised, because a non-200 makes
// Stripe redeliver and a redelivery whose posting is refused by the constraint above would re-send
// only the mail — a donor receipted twice for one gift. an unsent receipt leaves
// `donation.receipt_sent_at` null, which is exactly the backlog ../email/receipt.ts describes.
//
// "reported rather than raised" covers a transport that faults outright as well as one that answers
// `ok: false`, and the two sends below the commit are wrapped for it: `tellingFault` reports what
// could not be said and is guarded in turn, because it rides the transport that may be what
// faulted. an unwrapped send is a 500 against a gift already banked, retried for three days, with
// no alert firing because the throw happened in the thing that alerts.
//
// the receipt itself is ./receipt.ts's, and it is the one sender: ./collect.ts ends at the same
// function for a collection under a standing commitment, which is why the step is a module rather
// than a private function here.
//
// the second of those messages is sent under a guard rather than on every settlement that posted
// nothing, and each half of it is written at the line that asks it: the attempt has to have ended
// (`failed` or `cancelled`, never a payment still in flight), the rail has to be one whose failure
// the donor could not already have seen (`failureIsNewsToTheDonor` below), the row has to not have
// been terminal already (a redelivery is not a second donor to tell), and no attempt on the gift
// may have succeeded. nothing records that it went: there is no column for it and this path adds
// none — the row's own status is what a repeat is read off, and the message is worth exactly one
// read of it.
// ---------------------------------------------------------------------------

/**
 * deals with one delivery: verify, re-read, correct, post, then tell people.
 *
 * never throws. both ports are sealed by their factories and every write is a result, so the only
 * way out is a `SettleResult` — an exception here is a 500, and Stripe reads a 500 as "deliver this
 * again" for three days.
 */
export async function settleDelivery(
	deps: SettleDeps,
	delivery: WebhookDelivery
): Promise<SettleResult> {
	// the signature first, and the body is not read before it. anyone can post JSON to a public
	// endpoint, so a handler that parsed first would be a way to grant yourself a donation record.
	const verified = await deps.provider.verifyEvent(delivery);
	if (!verified.ok) {
		// a delivery that did not verify is answered non-2xx rather than 200, and that is a
		// departure from the terminal-means-2xx rule `isRetryable` states — taken because of what
		// the two answers do to the one operator who can act. the processor treats every non-2xx as
		// a failed delivery and shows it as one, so a deployment holding the wrong
		// STRIPE_WEBHOOK_SECRET sees a dashboard full of failures. answered 200, the same
		// deployment reads as healthy while every settlement is silently dropped, and nothing
		// anywhere reports it. no alert goes with it: this endpoint is public, so an unverified
		// delivery is anyone's, and mailing on one is a way to send mail from outside.
		if (verified.reason === 'bad_signature') {
			return { ok: false, reason: 'unverified', detail: verified.detail };
		}
		return isRetryable(verified.reason)
			? { ok: false, reason: 'incomplete', detail: verified.detail }
			: { ok: true, outcome: 'unactionable', detail: verified.detail };
	}
	const event = verified.value;

	// a delivery about a repeating gift is somebody else's write: this module settles one
	// transaction against the payment row a quote minted, and a collection under a commitment has
	// neither, so it is an insert of both plus a posting rather than an update. ./collect.ts owns
	// it, and the two halves answer in the vocabulary ./delivery.ts states.
	if (event.kind === 'recurring') return collectRecurringGift(deps, event);

	if (event.kind === 'ignored') {
		return {
			ok: true,
			outcome: 'ignored',
			detail: `event ${event.id} (${event.type}) is not one this app acts on.`
		};
	}

	// the transaction re-read rather than reconstructed from what arrived. deliveries carry no
	// ordering guarantee, so a handler that rebuilt state from the sequence it happened to receive
	// would be wrong for any donor whose bank was slow.
	const read = await deps.provider.readSettlement(event.providerTxnId);
	if (!read.ok) {
		if (isRetryable(read.reason)) return { ok: false, reason: 'incomplete', detail: read.detail };
		await alert(deps, {
			headline: 'A Stripe delivery could not be read and was not acted on',
			body:
				'The delivery verified and the transaction behind it could not be read. Nothing was ' +
				'written. Repeating the call answers the same way, so this needs a person.',
			facts: [
				{ label: 'Event', value: event.id },
				{ label: 'Event type', value: event.type },
				{ label: 'Transaction', value: event.providerTxnId },
				{ label: 'Reason', value: read.detail }
			],
			action: 'Find the payment in the Stripe dashboard and reconcile it by hand.'
		});
		return { ok: true, outcome: 'unactionable', detail: read.detail };
	}
	const settlement = read.value;

	// the gift this transaction is for, as the intent itself names it. absent means this app did
	// not mint the intent, which every collection under a repeating gift is — see the metadata
	// paragraph in the header, which is where the reason this refuses rather than looks lives.
	const named = settlement.metadata[DONATION_METADATA_KEY];
	if (named === undefined || named.trim() === '') {
		return {
			ok: true,
			outcome: 'unnamed',
			detail: `transaction ${settlement.providerTxnId} names no gift in this deployment; no row was looked up and nothing was written.`
		};
	}

	const target = await findTarget(deps.db, settlement.providerTxnId);
	if (target === null) return unmatched(deps, event.id, settlement);

	// what the gift's own lines say this money is for — read only where money moved, since a
	// settlement that did not succeed posts nothing and its read would be a query spent on nothing.
	const recognition =
		settlement.status === 'succeeded'
			? await recognitionOf(deps.db, target.donation.id, settlement)
			: null;
	const credits = recognition?.ok ? recognition.credits : null;

	const written = await write(deps.db, target.payment, settlement, credits);
	if (written === 'already_posted') {
		return {
			ok: true,
			outcome: 'already_posted',
			detail: `payment ${target.payment.id} is already in the books; this delivery changed nothing.`
		};
	}
	if (written === 'failed') {
		// the database refused for a reason that is not a redelivery. the money may well have moved,
		// so this is worth a redelivery: the next one runs the identical batch, and the constraint
		// that refuses a duplicate is what makes repeating it safe.
		return {
			ok: false,
			reason: 'incomplete',
			detail: `the settlement of payment ${target.payment.id} could not be written.`
		};
	}

	if (recognition === null) {
		try {
			await tellDonorNothingWasCollected(deps, target, settlement);
		} catch (error) {
			await tellingFault(
				deps,
				target,
				'the message telling the donor nothing was collected',
				error
			);
		}
		return {
			ok: true,
			outcome: 'updated',
			detail: `payment ${target.payment.id} is ${settlement.status}; nothing was posted.`
		};
	}

	// the row is corrected and the books are not, which is the one outcome here that leaves a
	// person something to do. the alert goes after the batch for the same reason the receipt does.
	if (!recognition.ok) return unrecognisable(deps, target, settlement, recognition.problem);

	try {
		await tellPeople(deps, target, settlement);
	} catch (error) {
		await tellingFault(deps, target, 'the donor’s receipt and the alert that goes with it', error);
	}
	return {
		ok: true,
		outcome: 'posted',
		detail: `payment ${target.payment.id} settled and posted.`
	};
}

/**
 * a step that ran after the batch and faulted rather than answering, reported and gone no further.
 *
 * the pattern ./receipt.ts and `receiptFault` in ./collect.ts already use, here for the reason both
 * of them state it: everything below the commit rides transports that can fault, and a throw out of
 * one of them is a 500 the processor reads as "deliver this again" for three days. against a gift
 * already banked every retry answers identically, no alert fires because the throw happened in the
 * thing that alerts, and a consistently failing endpoint is one the processor eventually stops
 * delivering to — which costs the deliveries that could have been handled.
 *
 * the alert is guarded in turn because it goes out over the same transport that may be what
 * faulted. it logs its headline and facts before it reaches that transport (./delivery.ts), so the
 * sentence is in the logs either way.
 *
 * nothing here changes what the delivery answered. what was written is written and what was posted
 * is posted; a message nobody could send is the whole of what is missing, and `what` is which one.
 */
async function tellingFault(
	deps: SettleDeps,
	target: Target,
	what: string,
	error: unknown
): Promise<void> {
	try {
		await alert(deps, {
			headline: 'A delivery was dealt with and nobody could be told about it',
			body:
				'A settlement was recorded and the step that writes to people failed outright. What was ' +
				'written and what was posted are unaffected. The message is what is missing, and the ' +
				'donor may be owed a receipt.',
			facts: [
				{ label: 'Payment', value: target.payment.id },
				{ label: 'Donation', value: target.donation.id },
				{ label: 'What could not be sent', value: what },
				{ label: 'Reason', value: error instanceof Error ? error.message : String(error) }
			],
			action:
				'Check the SMTP settings on the console (`better-giving open`) and send a test message. The ' +
				'cause is in this deployment’s logs (the Cloudflare dashboard, or `pnpm run logs` from a ' +
				'checkout).'
		});
	} catch {
		// nothing to report it to, and nothing on this path may throw.
	}
}

/** the gift a settlement belongs to, read once. */
type Target = {
	readonly payment: Payment;
	readonly donation: Donation;
	readonly donorName: string | null;
	readonly donorEmail: string | null;
	/** what an operator calls the form this came in on. null where the gift names no form. */
	readonly formName: string | null;
	/** what the cause the gift was credited to is called. null where it went to none. */
	readonly programName: string | null;
};

/**
 * the payment row a transaction names, with the gift, the donor and the form behind it.
 *
 * looked up by `(provider, provider_txn_id)`, which is `payment_provider_txn_idx` — a unique index,
 * so this is one row or none rather than a query with an ordering in it. the donation id the intent
 * carries in its metadata is not what resolves this: it is the same one row either way, and the
 * index is the lookup the database is built for.
 *
 * the form is joined rather than read afterwards, and left-joined because `donation.form_id` is
 * nullable — a gift recorded by hand belongs to no form. `form.name` and not the fund it points at:
 * the name is what an operator typed and the only thing on this path they would recognise
 * (./settled-notice.ts). it costs no round trip.
 *
 * the cause is joined the same way and for the same saving, and left-joined for the same reason —
 * `donation.program_id` is nullable, and a gift given to no cause is the ordinary one. its name is
 * what the receipt states (`ReceiptTarget.program` in ./receipt.ts).
 */
async function findTarget(db: Db, providerTxnId: string): Promise<Target | null> {
	const [row] = await db
		.select({
			payment,
			donation,
			donorName: contact.displayName,
			donorEmail: contact.primaryEmail,
			formName: form.name,
			programName: program.name
		})
		.from(payment)
		.innerJoin(donation, eq(payment.donationId, donation.id))
		.innerJoin(contact, eq(donation.contactId, contact.id))
		.leftJoin(form, eq(donation.formId, form.id))
		.leftJoin(program, eq(donation.programId, program.id))
		.where(and(eq(payment.provider, PROVIDER_NAME), eq(payment.providerTxnId, providerTxnId)))
		.limit(1);

	return row ?? null;
}

/**
 * what a settled gift credits, or the sentence saying why the books cannot take it.
 *
 * a sentence rather than a null on the refusing side, for the reason `attribution` in ./collect.ts
 * gives: it is what reaches an operator, and "this gift cannot be posted" is only actionable if it
 * says which figure is wrong.
 */
type Recognition =
	| { readonly ok: true; readonly credits: GiftRevenue }
	| { readonly ok: false; readonly problem: string };

/**
 * the funds a gift's own lines name, in the order they were written.
 *
 * `line_total_minor` and not `quantity * unit_price_minor`: the schema declines to hold the two in
 * agreement with a `CHECK` (see `line_item` in ../db/schema.ts, where the reason is discounts and
 * rounding residuals), so the total column is the one that is authoritative about what a line came
 * to. one row per line and no coalescing of two lines that name one fund — the entry group reads
 * back against the lines it was made from, and two credits to one account is what the gift says.
 *
 * `revenue_account_id` carries `PostableAccountId` off the column itself (../db/postable.ts), so
 * this is the brand arriving intact rather than a fourth way to mint one.
 */
async function readGiftFunds(db: Db, donationId: string): Promise<RevenueShare[]> {
	return db
		.select({ accountId: lineItem.revenueAccountId, amountMinor: lineItem.lineTotalMinor })
		.from(lineItem)
		.where(eq(lineItem.donationId, donationId))
		.orderBy(lineItem.id);
}

/**
 * the credits this settlement posts, or why it posts none.
 *
 * two questions, and the settlement's own is asked first. `unpostable` (./entries.ts) names what
 * the settlement carries that the ledger will not take whatever the gift is itemized as — a currency
 * that is not three uppercase letters, a time that is not a time — and ./collect.ts asks it the same
 * way, which is what keeps one rule from being stated twice and drifting. what follows it is the
 * half only this path can fail: a gift itemized across funds whose own lines cannot account for the
 * money that moved.
 *
 * every rule on both sides is one `post()` would otherwise reach by throwing — a line worth nothing,
 * a line that is not a whole number of minor units, an entry that does not balance — and a throw on
 * this path is a 500, which the processor reads as "deliver this again" for three days against
 * figures that answer identically every time. so it is decided at the door and the sentence is what
 * an operator gets.
 *
 * the wording mirrors `problemWith` in ./record.ts and `post()`'s: minor units spelled out, the
 * offending index named. a gift refused here was very likely written by a path that is not this
 * app — `line_item_line_total_minor_check` is `>= 0`, so a zero line stores clean — and the two
 * ends reading the same way is what lets somebody match them up.
 */
async function recognitionOf(
	db: Db,
	donationId: string,
	settlement: Settlement
): Promise<Recognition> {
	const refused = unpostable(settlement);
	// before the lines are read, not only before they are built: a settlement the books cannot take
	// posts nothing whichever funds it names, so the query would be spent to reach the same answer.
	if (refused !== null) return { ok: false, problem: refused };

	const funds = await readGiftFunds(db, donationId);

	const [first, ...rest] = funds;
	if (first === undefined) {
		return {
			ok: false,
			problem: `donation ${donationId} has no line items, and a line is what says which fund a gift posts to.`
		};
	}

	let sum = 0;
	for (const [i, share] of funds.entries()) {
		if (!Number.isSafeInteger(share.amountMinor) || share.amountMinor <= 0) {
			return {
				ok: false,
				problem: `lines[${i}] is worth ${share.amountMinor}, which is not a positive whole number of minor units. a line records a positive part of the gift.`
			};
		}
		sum += share.amountMinor;
	}

	if (sum !== settlement.amountMinor) {
		return {
			ok: false,
			problem: `the gift's lines add up to ${sum} and ${settlement.amountMinor} was settled (minor units), so the lines do not say which fund gave up the difference.`
		};
	}

	return { ok: true, credits: [first, ...rest] };
}

/**
 * the correction and the postings, in one `batch()`.
 *
 * one statement per row and never a multi-row `INSERT` — D1 caps a query at 100 bound parameters
 * (CLAUDE.md) — and one commit, because a payment corrected without its posting, or a posting
 * without its correction, is a state nothing in the schema detects.
 *
 * `credits` is null where nothing is posted at all: a transaction that did not succeed, a settled
 * one carrying figures the ledger will not take, and a settled one whose lines cannot account for
 * it. the correction still runs, alone — what the processor reports about the rail and the time is
 * a fact whatever the books do with it, and a row left saying `pending` is a second thing for an
 * operator to fix by hand. it runs on exactly what was reported, though, which is why two of the
 * three columns below are conditional: a column the processor said nothing usable about is left
 * standing rather than written with a guess or with a value the table will not hold.
 */
async function write(
	db: Db,
	row: Payment,
	settlement: Settlement,
	credits: GiftRevenue | null
): Promise<'written' | 'already_posted' | 'failed'> {
	const writes: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
		db
			.update(payment)
			.set({
				status: settlement.status,
				// only where the processor named a rail. `payment.method` is NOT NULL, and a settled
				// rail this schema does not model reads null on the port rather than being coerced —
				// so the quoted rail is left standing rather than overwritten with a guess.
				...(settlement.method === null ? {} : { method: settlement.method }),
				// and only where the time it reported is one. `payment.occurred_at` is NOT NULL and
				// the column is `timestamp_ms`, so an Invalid Date is written as `getTime()`'s NaN,
				// binds NULL and D1 refuses the whole batch with SQLITE_CONSTRAINT_NOTNULL — which
				// would fail the one answer such a settlement has left and hold the delivery open for
				// three days. `unpostable` in ./entries.ts is what tells an operator there is no time
				// to post it under; here the quoted one is simply left standing.
				...(Number.isNaN(settlement.occurredAt.getTime())
					? {}
					: { occurredAt: settlement.occurredAt })
			})
			.where(eq(payment.id, row.id))
	];

	if (credits !== null) {
		const gift = { paymentId: row.id, donationId: row.donationId, revenue: credits };
		writes.push(...postingStatements(db, chargeEntry(gift, settlement)));
		const fee = feeEntry(gift, settlement);
		if (fee !== null) writes.push(...postingStatements(db, fee));
	}

	try {
		await db.batch(writes);
		return 'written';
	} catch (error) {
		if (sqliteResultCode(error) === 'SQLITE_CONSTRAINT_UNIQUE') return 'already_posted';
		try {
			console.error('settling a payment failed:', error);
		} catch {
			// nothing to report it to, and nothing this function may throw.
		}
		return 'failed';
	}
}

/**
 * a settled gift the books could not take, whichever half of the door refused it.
 *
 * two things reach it and they are one event from an operator's chair: a settlement carrying figures
 * the ledger will not hold (`unpostable` in ./entries.ts) and a gift whose own lines cannot account
 * for the money that moved (`recognitionOf` above). both mean money moved, nothing was posted, and a
 * sentence naming the offending figure is the whole of what a person has to go on — so they are told
 * and answered alike, and the `Problem` fact is what tells them apart.
 *
 * answered 200 with an alert rather than held open, on the same reasoning `unmatched` below is
 * written from: the same figures arrive on every redelivery, so a 5xx is three days of retries
 * ending exactly here and it puts this endpoint into the processor's failing state, which endangers
 * the deliveries that can be handled.
 *
 * the payment row is corrected before this runs, and that is deliberate rather than incidental:
 * what the processor reports about the rail and the state is a fact whatever the books do with it,
 * and a row still saying `pending` against money that moved is a second thing for the same person to
 * fix by hand. `write` above states which columns a settlement this defective can actually correct.
 *
 * `unactionable` rather than an outcome of its own, because it is the word the other half already
 * answers this with — a collection whose figures the ledger will not take is `unactionable` in
 * ./collect.ts — and the two halves answering one vocabulary is what ./delivery.ts exists for.
 *
 * no receipt goes with it. the donor is receipted for a gift that is in the books and this one is
 * not, so `donation.receipt_sent_at` stays null and the gift stays on the unreceipted list, which
 * is exactly the backlog ../email/receipt.ts describes.
 */
async function unrecognisable(
	deps: SettleDeps,
	target: Target,
	settlement: Settlement,
	problem: string
): Promise<SettleResult> {
	await alert(deps, {
		headline: 'A gift settled and the books could not take it',
		body:
			'A payment succeeded and nothing was posted, so the books do not have it: either what ' +
			'Stripe reported about the payment is not something the ledger can hold, or what the gift ' +
			'is itemized as does not account for the money that moved. The payment record was ' +
			'corrected with everything Stripe did report. Nothing was guessed at, and sending the ' +
			'delivery again reaches the same figures.',
		facts: [
			{ label: 'Payment', value: target.payment.id },
			{ label: 'Donation', value: target.donation.id },
			{ label: 'Transaction', value: settlement.providerTxnId },
			{ label: 'Amount', value: `${settlement.amountMinor} ${settlement.currency} (minor units)` },
			{ label: 'Problem', value: problem }
		],
		action:
			'Open the gift in /admin, check it against the payment in the Stripe dashboard, and post ' +
			'it by hand.'
	});

	return {
		ok: true,
		outcome: 'unactionable',
		detail: `payment ${target.payment.id} settled and was not posted: ${problem}`
	};
}

/**
 * whether any attempt on this gift has succeeded.
 *
 * a read that only ever decides whether to send a message — never what is posted, never what is
 * written — which is why it is a plain read-then-decide rather than the atomic read-then-write
 * CLAUDE.md bans. the worst a lost race costs is a message a donor did not need, or one they
 * needed and did not get, and the same read is what a later delivery repeats.
 *
 * every row on the gift, not this settlement's: a donor who retried is the case it exists for.
 */
async function somethingWasCollected(db: Db, donationId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: payment.id })
		.from(payment)
		.where(and(eq(payment.donationId, donationId), eq(payment.status, 'succeeded')))
		.limit(1);

	return row !== undefined;
}

/**
 * whether a donor could have learned this failure any way other than by being written to.
 *
 * the rail is what answers it, and the answer is a property of when the rail fails rather than of
 * how it fails:
 *
 *   ach   — the debit is refused days after the donor closed the tab. nothing was ever on screen
 *           and there is nobody left to show it to, so a message is the only way they find out.
 *   card  — the decline happens while the donor is watching, and the form shows it. a message
 *           arriving afterwards contradicts the retry that succeeded, and tells somebody who
 *           already gave that they did not.
 *   cash,
 *   check — staff entry: there is no donor session, no processor and no attempt the donor made.
 *           a failure here is a correction to a record, and the person who typed it is the person
 *           who fixes it.
 *
 * a rail added to `PAYMENT_METHODS` in ../db/schema.ts lands on the `default`-free switch below
 * and stops the type check, which is the point of writing it as one: whether a new rail's failure
 * reaches the donor on screen is a decision, not something to inherit by falling through.
 */
export function failureIsNewsToTheDonor(rail: PaymentMethod): boolean {
	switch (rail) {
		case 'ach':
			return true;
		case 'card':
		case 'cash':
		case 'check':
			return false;
	}
}

/**
 * the donor's "we could not collect your gift", where the donor could not have learned it any
 * other way.
 *
 * after the batch, like the receipt, and its failure is reported rather than raised — the header's
 * rule about mail never changing the answer to a delivery covers this message exactly as it covers
 * that one.
 */
async function tellDonorNothingWasCollected(
	deps: SettleDeps,
	target: Target,
	settlement: Settlement
): Promise<void> {
	// the settled status, never `recognition === null`. that arm is "nothing was posted", which is
	// also every live payment — an ACH debit on its way, one awaiting the donor's action, one still
	// being processed — and a donor told a gift failed while their bank is still working on it has
	// been told something untrue.
	if (settlement.status !== 'failed' && settlement.status !== 'cancelled') return;
	if (!failureIsNewsToTheDonor(settlement.method ?? target.payment.method)) return;
	// whether this delivery is the one that ended the attempt, read off the row as it stood before
	// the correction above. deliveries repeat for three days and nothing is posted on this path, so
	// the unique index that makes a second receipt impossible has nothing to refuse here — a row
	// already terminal is a donor already written to.
	if (target.payment.status === 'failed' || target.payment.status === 'cancelled') return;
	if (target.donorEmail === null) return;
	// last, because it is the only question here that costs a query. a donor who retried and gave
	// must never be told the gift failed, and the two attempts arrive in whatever order the
	// processor sends them — so this is asked of the rows as they stand now rather than of the one
	// this delivery is about.
	if (await somethingWasCollected(deps.db, target.donation.id)) return;

	const rendered = await renderUncollectedNotice({
		org: await readOrgProfile(deps.db),
		donorName: target.donorName,
		// the attempt's own amount, not the gift's total: it is the payment that failed, and it is
		// the figure the donor agreed to and was not charged.
		amountMinor: target.payment.amountMinor,
		currency: target.payment.currency
	});

	if (!rendered.ok) {
		await alert(deps, {
			headline: 'A donor could not be told their gift was not collected',
			body:
				'A payment ended without collecting anything and the donor has not been told. Nothing ' +
				'was charged and nothing was posted, so no money is unaccounted for. The donor is ' +
				'simply left thinking the gift went through.',
			facts: [
				{ label: 'Payment', value: target.payment.id },
				{ label: 'Donation', value: target.donation.id },
				{ label: 'Reason', value: rendered.detail }
			],
			action:
				'Open the console (`better-giving open`) and fill in the organisation’s details under Organisation.'
		});
		return;
	}

	const sent = await deps.email.send({ to: target.donorEmail, ...rendered.message });
	if (!sent.ok) {
		await alert(deps, {
			headline: 'A donor was not told their gift was not collected',
			body:
				'A payment ended without collecting anything and the message to the donor did not ' +
				'send. Nothing was charged and nothing was posted, so the books are unaffected; the ' +
				'donor is left thinking the gift went through.',
			facts: [
				{ label: 'Payment', value: target.payment.id },
				{ label: 'Donation', value: target.donation.id },
				{ label: 'Reason', value: sent.reason },
				{ label: 'Detail', value: sent.detail },
				{ label: 'May have sent anyway', value: sent.indeterminate ? 'yes' : 'no' }
			],
			action:
				'Check the SMTP settings on the console (`better-giving open`) and send a test message.'
		});
	}
}

/**
 * a verified settlement this deployment has no payment row for.
 *
 * answered 200 rather than 5xx, and the reasoning is what makes it a decision rather than a shrug.
 * nothing a redelivery does can make the row appear: on this path a `payment` row is written when
 * the quote is minted or never, and no delivery reaching here fills one in later. so a 5xx is three
 * days of retries ending exactly here, and it also puts this endpoint into the processor's failing
 * state — which endangers the deliveries that can be handled.
 *
 * the alert is therefore the whole answer, and it names the transaction so a person can find it in
 * the processor's own dashboard. it carries the donation id the intent was minted with, which is
 * what `DONATION_METADATA_KEY` in ../payments/provider.ts buys here — and by the time this is
 * reached the intent is known to carry one, because a transaction naming no gift is answered
 * `unnamed` above and never looked up at all.
 */
async function unmatched(
	deps: SettleDeps,
	eventId: string,
	settlement: Settlement
): Promise<SettleResult> {
	const named = settlement.metadata[DONATION_METADATA_KEY] ?? '';
	await alert(deps, {
		headline: 'A Stripe payment settled against no gift in this deployment',
		body:
			'A delivery verified and named a transaction with no payment row here, so nothing was ' +
			'written and nothing was posted. If it succeeded, money moved and the books do not have ' +
			'it. Sending the delivery again cannot fix this: a payment row is written when a quote ' +
			'is minted or not at all.',
		facts: [
			{ label: 'Event', value: eventId },
			{ label: 'Transaction', value: settlement.providerTxnId },
			{ label: 'Status', value: settlement.status },
			{ label: 'Amount', value: `${settlement.amountMinor} ${settlement.currency} (minor units)` },
			{ label: 'Donation named by the intent', value: named }
		],
		action: 'Find this transaction in the Stripe dashboard and record the gift by hand.'
	});

	return {
		ok: true,
		outcome: 'unmatched',
		detail: `no payment row for ${settlement.providerTxnId}; an alert was sent.`
	};
}

/**
 * the receipt, the organisation's notice, and — where something needs saying — the alert, after the
 * books are committed.
 *
 * every failure here is reported and none of them changes the answer to the delivery. see the
 * header: a redelivery driven by a mail fault re-sends the mail and posts nothing, because the
 * posting is refused by the constraint — which is a donor receipted twice for one gift.
 *
 * the receipt is first and the notice second, which is the order they matter in: the donor is
 * waiting for a document and the organisation is being told something it has to act on nothing
 * about. neither is sent twice for one gift, and no guard here is what stops it — a second delivery
 * is refused by `entry_group_source_idx` and answered `already_posted` above, before this runs.
 */
async function tellPeople(deps: SettleDeps, target: Target, settlement: Settlement): Promise<void> {
	if (settlement.feeMinor === null) {
		// the fee is waited for rather than read once — `readSettlement` in ../payments/stripe.ts
		// asks again inside the delivery and refuses it while the figure is still coming, so a gift
		// reaching here is one where waiting is over rather than one that raced Stripe and lost.
		await alert(deps, {
			headline: 'A settled gift was posted with no processor fee',
			body:
				'The charge is in the books at face value and the fee it was taken out of is not. ' +
				'Undeposited funds is overstated by that amount until an entry is posted for it. Stripe ' +
				'published no fee for this payment in the currency the gift was charged in, which is ' +
				'the only currency the entry could be posted in.',
			facts: [
				{ label: 'Payment', value: target.payment.id },
				{ label: 'Donation', value: target.donation.id },
				{ label: 'Transaction', value: settlement.providerTxnId }
			],
			// what an operator can actually do, and no more. the figure has to come from Stripe
			// because this app could not read it, and nothing in the dashboard posts a correcting
			// entry — `post` in ../ledger/posting.ts is reached from the settlement path alone — so
			// handing over the figure is the whole of what this alert can do with it.
			action:
				'Find this payment in the Stripe dashboard and keep the fee it states, in the currency ' +
				'the gift was charged in. Keep only a figure Stripe states for this payment: a fee ' +
				'reported in another currency is not one to convert, because Stripe publishes no fee ' +
				'in the currency a donor was charged in. This deployment records nothing for it, so ' +
				'carry that figure into the books your organisation keeps outside it.'
		});
	}

	const receipt = await sendReceipt(deps, {
		donationId: target.donation.id,
		donorName: target.donorName,
		donorEmail: target.donorEmail,
		contribution: {
			totalMinor: target.donation.totalMinor,
			nonDeductibleMinor: target.donation.nonDeductibleMinor,
			// the fee the donor was quoted and agreed to, off the gift's own row — never
			// `settlement.feeMinor`, which is what the processor took and reaches this file a few
			// lines above. the receipt states what the donor pressed; ./entries.ts is where the two
			// figures are kept apart on the ledger's side.
			coveredFeeMinor: target.donation.feeMinor,
			currency: target.donation.currency,
			receivedAt: target.donation.receivedAt
		},
		// off the gift's own two columns, narrowed rather than passed through: `tribute_kind` has no
		// CHECK and cannot be given one, so `projectTribute` (../../donations/tributes.ts) is what
		// decides whether what is stored is a dedication at all. the two columns naming who to tell
		// stay where they are — this document goes to the donor.
		tribute: projectTribute(target.donation.tributeKind, target.donation.tributeHonoree),
		// the cause's name, joined with the gift rather than looked up here: a receipt is
		// reproducible from what is on it, and a pointer is not something a donor reads.
		program: target.programName
	});

	// the person the donor asked us to tell, after the donor's own receipt and before the
	// organisation's notice. it decides for itself whether there is anybody to tell and stamps its
	// own column; what it answers is not read, because nothing here has anything to add to it.
	await sendTributeNotice(deps, {
		donationId: target.donation.id,
		donorName: target.donorName,
		tributeKind: target.donation.tributeKind,
		tributeHonoree: target.donation.tributeHonoree,
		notifyName: target.donation.tributeNotifyName,
		notifyEmail: target.donation.tributeNotifyEmail
	});

	await sendSettledNotice(deps, {
		// what settled, not what the gift's row says it came to: this message is about money that
		// moved, and a partial capture that reached here is one the lines already accounted for.
		amountMinor: settlement.amountMinor,
		currency: settlement.currency,
		donorName: target.donorName,
		donorEmail: target.donorEmail,
		formName: target.formName,
		// a one-off gift. a commitment's collections are ./collect.ts's, and only the one that opens
		// it is announced.
		repeating: 'none',
		// what the receipt above actually did, so the notice states it rather than working it out
		// from the same address a second time.
		receipt,
		note: target.donation.note,
		// the same narrowing the receipt is handed, off the same two columns.
		tribute: projectTribute(target.donation.tributeKind, target.donation.tributeHonoree)
	});
}
