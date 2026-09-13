import type { TributeKind } from '@better-giving/form/v1';
import type { BatchItem } from 'drizzle-orm/batch';
import { uuidv7 } from 'uuidv7';
import type { ParsedContact } from '../contacts/contact-input';
import type { Db } from '../db/client';
import type { PostableAccountId } from '../db/postable';
import { sqliteResultCode } from '../db/rejection';
import {
	donation,
	lineItem,
	payment,
	type NewDonation,
	type NewLineItem,
	type NewPayment,
	type PaymentMethod as SettledRail
} from '../db/schema';
import type { ProcessorName } from '../payments/provider';
import type { QuotedRail } from '../payments/provider';
import { resolveDonor } from './donor';
import type { Tribute } from './quote-input';

// the write a gift makes at quote time: a donor, a donation, its lines and — where an attempt has
// actually been opened — the settlement attempt, all of it in one `batch()`.
//
// ---------------------------------------------------------------------------
// two writers, because there are two kinds of quote and only one of them opens an attempt.
//
// `recordDonation` is a single gift: the processor has minted an intent, so a `payment` row is
// opened `pending` against its transaction id and the settlement half corrects it.
// `recordAuthorizedGift` is the gift a repeating commitment was authorized for, and it writes no
// `payment` row — nothing has been attempted from this side. the donor confirms the commitment's
// first collection in their own browser and the rail reports the charge afterwards, so the row
// that records that charge is minted by ./collect.ts when the money settles, against this gift.
//
// both leave the donation reading `pending`, which is what puts an unfinished repeating gift on the
// gifts list beside an unfinished single one: the projection `donation`'s header states counts "no
// `payment` row yet" and "the latest inbound attempt is `pending`" as the same state.
//
// ---------------------------------------------------------------------------
// what this does not write, and why that is the whole shape of the module.
//
// it puts nothing in the ledger. these rows are written when the donor presses the button and the
// processor has minted an intent, which is before any money has moved: an `entry_group` posted
// here would be a gift in the books that nothing has collected, and every balance in this app is
// a `SUM` over `ledger_entry` at read time (CLAUDE.md), so it would be counted immediately and
// forever. the gift reaches the books when the settlement does, from the webhook, and
// ../ledger/posting.ts is the only module that may put it there.
//
// so the writer is two halves that meet on `payment`. this half opens the row —
// `status = 'pending'`, carrying the processor's transaction id — and the settlement half reads
// the transaction back, corrects what it now knows, and posts.
//
// ---------------------------------------------------------------------------
// why this executes its own `batch()` when ../contacts/queries.ts and ../ledger/posting.ts refuse
// to.
//
// both of those hand statements up rather than committing, precisely so a call site can make one
// atomic write out of several tables. this is that call site. there is nothing above it left to be
// atomic with — the ledger is deliberately absent, by the paragraph above — so this is where the
// single commit belongs. the donor's own statement is decided by `resolveDonor` in ./donor.ts,
// which uses those two modules exactly as their headers describe — the id is minted so the donation
// can name it while statements are still being built, and the row becomes a statement without this
// module ever naming the `contact` table. that decision lives there rather than here because the
// repeating-gift path needs the same answer and cannot take a statement: see that file.
//
// the file is `record.ts` rather than `queries.ts`, unlike its neighbours in ../contacts and
// ../forms. those own one table each and every read and write of it; this owns no table and
// composes four, and calling it `queries.ts` would promise that `donation` is read here, which it
// is not.
// ---------------------------------------------------------------------------

/** what `db.batch()` takes: non-empty, because a batch of nothing is not a write. */
type Writes = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];

/**
 * one itemized part of a gift.
 *
 * `amountMinor` writes both `unit_price_minor` and `line_total_minor`, because `quantity` is left
 * to its column default of 1 and at that quantity the two columns are the same number. the day
 * something with a quantity is sold — a table of seats — this type grows the field and the two
 * stop being derived from one input; the schema already models it (see `line_item` in
 * ../db/schema.ts), which is why nothing has to change there.
 *
 * `taxMinor` is left to its default of 0 for the same reason: the deductibility and tax split is
 * a receipting decision v0 defers, and the columns are already there for it.
 */
export type DonationLine = {
	/** what the donor is told this part of the gift is. never a schema word — CLAUDE.md. */
	readonly label: string;
	/** the fund this part posts to, branded so a reporting rollup cannot be named. */
	readonly revenueAccountId: PostableAccountId;
	/** minor units, positive. */
	readonly amountMinor: number;
};

/**
 * one gift, as the endpoint that minted its intent knows it.
 *
 * every figure here is the server's own. an amount that arrived from a browser is an input to look
 * up against the form record, never a figure to write — `/api/v1` is public, unauthenticated and
 * payment-initiating (CLAUDE.md).
 */
export type RecordDonationInput = {
	/**
	 * the gift's id, minted by the caller before the processor was called.
	 *
	 * it is an argument rather than something minted here, and that is the same split
	 * `newContactRow` in ../contacts/queries.ts argues one table over: the id has to be readable
	 * before the row is written, because the processor is told it first. `IntentRequest.metadata`
	 * in ../payments/provider.ts is where it goes, and that field exists because a settlement
	 * event can reach the webhook before this write is readable — so the intent is the only thing
	 * that knows which gift it was. reading the id back off `.returning()` afterwards would be a
	 * second round trip, which is a second commit, and the intent would already be live.
	 *
	 * a UUIDv7 generated app-side, like every id in this schema except `form.id`.
	 */
	readonly donationId: string;
	/**
	 * the payer, already parsed.
	 *
	 * a `ParsedContact` rather than raw submitted values, so the `display_name` promise cannot be
	 * bypassed by a caller that skipped `parseContact` — the type is branded, so an object literal
	 * of the same shape is a compile error here.
	 */
	readonly donor: ParsedContact;
	/** the form the gift came through. */
	readonly formId: string;
	/** the validated `Origin` header, or null. the attribution key, since one form serves many sites. */
	readonly origin: string | null;
	/** ISO-4217, uppercase, as the `donation` and `payment` currency columns hold it. */
	readonly currency: string;
	/** minor units — what the donor is charged, fee included where they chose to cover it. */
	readonly totalMinor: number;
	/**
	 * the fee this app quoted, in the same minor units.
	 *
	 * what the donor agreed to, which is why it is stored on the gift. it is not what the
	 * processor ends up taking — that figure reconciles against a bank statement and belongs to
	 * the settlement (see `Settlement.feeMinor` in ../payments/provider.ts).
	 */
	readonly feeMinor: number;
	/** at least one. what the gift is made of, and what the settlement half posts revenue from. */
	readonly lines: readonly DonationLine[];
	/**
	 * the donor's own answer about being written to, filed on their contact — or `null` where they
	 * were never asked.
	 *
	 * an answer overwrites the one that contact already held, because a returning donor is matched
	 * to the row they already have and this is the most recent thing they have said. `null` is not
	 * an answer and overwrites nothing: it says the question was not put, which is no reason to
	 * discard what the donor said the last time it was. see `resolveDonor` in ./donor.ts, which is
	 * where the three cases meet.
	 */
	readonly consentedToContact: boolean | null;
	/** what the donor wrote for the organisation, or absent. stored on the gift, never parsed. */
	readonly note: string | undefined;
	/**
	 * the person this gift honors or remembers, or `null` where the donor marked none.
	 *
	 * required rather than optional, and that is the point of it: the four columns behind it are
	 * nullable, so `NewDonation` makes every one of them optional and a caller that quietly stopped
	 * passing a tribute would compile and store nulls. a required key makes the omission a type error
	 * at `mintQuote` in ./quote.ts, which is the only caller that has one.
	 */
	readonly tribute: Tribute | null;
	/**
	 * the cause this gift is credited to, or `null` where it went to none.
	 *
	 * required rather than optional, for the reason `tribute` above is: `NewDonation` types the
	 * column as optional because it is nullable, so a caller that quietly stopped passing it would
	 * compile and credit every gift to nothing.
	 *
	 * a pointer decided by the caller and never by anything on the wire. `mintQuote` in ./quote.ts
	 * writes the form's own pin on a pinned form and the donor's pick on a form that offered one —
	 * `Program` in packages/form/src/v1.ts says why a pinned form's id never travels.
	 */
	readonly programId: string | null;
	/** the rail the donor was quoted on, in the form's vocabulary. */
	readonly method: QuotedRail;
	/**
	 * which processor minted the intent, off the provider that answered.
	 *
	 * taken from `PaymentProvider.processor` in ../payments/provider.ts and never derived from the
	 * id beside it: `payment_provider_txn_idx` is keyed on the pair, so a row whose processor was
	 * guessed from an id's shape is a row the settlement path looks for under the wrong name and a
	 * gift that never posts.
	 */
	readonly processor: ProcessorName;
	/** the processor's id for the intent this gift is being paid with — `Intent.providerTxnId`. */
	readonly providerTxnId: string;
	/**
	 * business time: when the gift was made, as the donor experienced it.
	 *
	 * one value writing both `donation.received_at` and `payment.occurred_at`, because at quote
	 * time they are the same instant and neither has a better answer available. the settlement
	 * half is what replaces the payment's with the moment the money actually moved.
	 */
	readonly occurredAt: Date;
};

/** what the write produced, for a caller that has to log, answer with, or act on one. */
export type RecordedDonation = {
	/** the id the caller supplied, handed back so one value describes the whole write. */
	readonly donationId: string;
	/** the donor this gift was filed under — an existing contact or a newly minted one. */
	readonly contactId: string;
	/** the settlement attempt opened for it. */
	readonly paymentId: string;
	/**
	 * whether the donor is new to this deployment.
	 *
	 * carried because the caller cannot re-derive it: by the time it holds a `contactId` the row
	 * exists either way, and asking the database afterwards answers a different question. it is the
	 * difference between a first gift and a returning donor, which is the one thing anything
	 * downstream of a gift wants to know about the person who made it.
	 */
	readonly donorWasCreated: boolean;
};

/**
 * why a gift was not written, as a closed set.
 *
 * a `const` array plus a derived union rather than a TS `enum`, the way `PAYMENT_FAILURE_REASONS`
 * in ../payments/provider.ts and `SEND_FAILURE_REASONS` in ../email/provider.ts do it.
 *
 * the reason this module returns a result at all, where ../ledger/posting.ts throws, is the shape
 * of its most likely failure. a repeated attempt is ordinary here — `IntentRequest.idempotencyKey`
 * is designed to make one resolve to the intent that already exists — so the call arrives with a
 * transaction id the database already holds, and it comes back as drizzle's `Failed query: …` with
 * sqlite's code demoted to `.cause`. presented as a throw, that is indistinguishable at the call
 * site from a bug, and a public payment route would have to grow its own cause-walker to tell the
 * two apart or answer 500 to a donation that succeeded.
 *
 *   malformed_gift    — the gift does not add up, and nothing was written. this app built it, so
 *                       repeating the identical call changes nothing. see `problemWith`.
 *   duplicate_intent  — a payment already exists against this attempt's transaction id. the gift
 *                       was recorded by the earlier call; this one wrote nothing.
 *   missing_reference — the form, or the fund one of the lines names, is not in the database.
 *   write_failed      — the database refused for a reason this module does not classify, or the
 *                       call faulted. nothing was stored, and the cause is in the logs.
 *
 * there is deliberately no retryable/terminal partition over these, unlike the payment port's. that
 * one exists because a webhook has to answer a delivery 5xx or 2xx and two routes have to agree
 * about it. nothing consumes this that way, and repeating the identical call is never the answer to
 * any member here — three of them are deterministic, and `duplicate_intent` means the work is
 * already done.
 */
export const RECORD_FAILURE_REASONS = [
	'malformed_gift',
	'duplicate_intent',
	'missing_reference',
	'write_failed'
] as const;
export type RecordFailureReason = (typeof RECORD_FAILURE_REASONS)[number];

/**
 * why the gift was not written, naming the value to fix.
 *
 * `detail` is written for an operator and for an agent — CLAUDE.md's rule for a 4xx body applies to
 * anything that ends up in one. it never carries sqlite's own vocabulary: the extended result code
 * is what this module read to reach a reason and is not what it hands over, so a caller has nothing
 * to match on but the names above.
 */
export type RecordFailure = {
	readonly ok: false;
	readonly reason: RecordFailureReason;
	readonly detail: string;
};

/** a discriminated union, so a caller cannot reach the ids without having checked `ok`. */
export type RecordResult = { readonly ok: true; readonly value: RecordedDonation } | RecordFailure;

/**
 * one gift a donor authorized a repeating commitment for, before anything has been collected.
 *
 * it takes a `contactId` where `RecordDonationInput` takes a `ParsedContact`, and that is the one
 * real difference between the two inputs. the donor is committed before the commitment is created at
 * the processor, so that a donor this deployment cannot write refuses the gift with nothing charged —
 * so by the time this runs the row exists and re-resolving it would be a second answer to a question
 * already settled. see `mintCommitment` in ./quote.ts, the only caller.
 *
 * no `method` and no `providerTxnId`: both are facts about an attempt, and there is none.
 */
export type AuthorizedGiftInput = {
	/** the gift's id, minted before the commitment was created and carried on it. */
	readonly donationId: string;
	/** the donor's row, already committed — `commitDonor` in ./donor.ts. */
	readonly contactId: string;
	readonly formId: string;
	/** the validated `Origin` header, or null. */
	readonly origin: string | null;
	readonly currency: string;
	/** minor units — what each collection under the commitment will charge. */
	readonly totalMinor: number;
	/** the fee this app quoted and the donor agreed to, in the same minor units. */
	readonly feeMinor: number;
	/** at least one, summing to `totalMinor`. */
	readonly lines: readonly DonationLine[];
	readonly note: string | undefined;
	/**
	 * the dedication, all four columns of it.
	 *
	 * required for the reason `RecordDonationInput.tribute` is, and it carries more here: the person
	 * the donor asked us to tell is written on this row and on no other row of the series, so a
	 * caller that quietly stopped passing it would leave a family with nobody to tell and nothing
	 * saying so.
	 */
	readonly tribute: Tribute | null;
	/**
	 * the cause the commitment was authorized against, or `null`.
	 *
	 * required for `RecordDonationInput.programId`'s reason, and it carries more here: every later
	 * collection copies this row's cause (`openingGift` in ./collect.ts), so a caller that stopped
	 * passing it credits the whole series to nothing rather than one gift.
	 */
	readonly programId: string | null;
	/** business time: when the donor authorized the commitment. */
	readonly occurredAt: Date;
};

/** what the authorized-gift write produced. no ids, because the caller minted the only one. */
export type AuthorizedGiftResult = { readonly ok: true } | RecordFailure;

/**
 * the rail the donor picked, mapped onto the column that records which rail settled.
 *
 * two vocabularies that overlap without matching — `PAYMENT_METHODS` in packages/form/src/v1.ts offers
 * wallets, `PAYMENT_METHODS` in ../db/schema.ts models how money arrives — and the wallets are not
 * their own rail: Apple Pay and Google Pay are delivered through the card rail, which is the same
 * fact `INTENT_METHODS` in ../payments/stripe.ts turns into an intent parameter.
 *
 * total over `QuotedRail`, so a rail added to the form's list without a mapping is a compile error
 * rather than a row asserting a rail nobody used.
 *
 * writing this at all is a claim made before the fact, and `payment.method` is NOT NULL so there
 * is no way to decline to make it. `Settlement.method` in ../payments/provider.ts is emphatic that
 * the settled rail is read from the processor and never copied from what the donor picked
 * beforehand — which is exactly what the settlement half does to this column: it overwrites it
 * with what the charge reports. until then the row says what was quoted, which is the only thing
 * anybody knows.
 */
const QUOTED_RAIL_METHODS: Readonly<Record<QuotedRail, SettledRail>> = Object.freeze({
	card: 'card',
	apple_pay: 'card',
	google_pay: 'card',
	ach: 'ach',
	paypal: 'paypal',
	venmo: 'venmo'
});

/**
 * writes one gift, atomically, and hands back the ids it wrote under.
 *
 * the statements go in one `batch()` in foreign-key order — contact, donation, lines, payment —
 * one statement per row and never a multi-row `INSERT`, because D1 caps a query at 100 bound
 * parameters (CLAUDE.md). `Db` has no `transaction` and D1 has none, so this batch is the only
 * atomic unit available and everything the gift is made of has to be inside it: a donation with no
 * payment, or a contact with no gift, is a state nothing in the schema detects.
 *
 * it never throws — every outcome is a `RecordResult`, including a rejection out of `batch()` and
 * a fault from anywhere else in the call. see `RECORD_FAILURE_REASONS` for what a caller may find
 * there and why the driver's own vocabulary is not among it.
 */
export async function recordDonation(db: Db, input: RecordDonationInput): Promise<RecordResult> {
	const malformed = problemWith(input);
	if (malformed !== null) return { ok: false, reason: 'malformed_gift', detail: malformed };

	try {
		return { ok: true, value: await write(db, input) };
	} catch (error) {
		return refusalFor(error, input.formId, {
			ok: false,
			reason: 'duplicate_intent',
			detail: `a payment is already recorded against this attempt's transaction id. the gift it belongs to was written by the first call and nothing was written by this one.`
		});
	}
}

/**
 * writes the gift a repeating commitment was authorized for: the donation and its lines, in one
 * `batch()`, and nothing else.
 *
 * no donor statement, because the donor is committed before the commitment that names them is
 * created (see `AuthorizedGiftInput.contactId`), and no `payment` row, because nothing has been
 * attempted — the header's two-writers paragraph is the whole argument for both.
 *
 * it never throws, for the reason `recordDonation` above does not: the caller is a public,
 * payment-initiating endpoint and a commitment is live at the processor by the time this runs.
 */
export async function recordAuthorizedGift(
	db: Db,
	input: AuthorizedGiftInput
): Promise<AuthorizedGiftResult> {
	const malformed = problemWith(input);
	if (malformed !== null) return { ok: false, reason: 'malformed_gift', detail: malformed };

	const donationRow: NewDonation & TributeColumns = {
		id: input.donationId,
		contactId: input.contactId,
		totalMinor: input.totalMinor,
		currency: input.currency,
		feeMinor: input.feeMinor,
		receivedAt: input.occurredAt,
		formId: input.formId,
		origin: input.origin,
		// `recurring_id` is deliberately absent, and null is the only value it could take: it
		// references `recurring_plan`, whose row is written by the first charge that settles
		// (./collect.ts), so there is nothing yet for this gift to point at. that same null is what
		// the claim at settlement is guarded on.
		note: input.note ?? null,
		programId: input.programId,
		...tributeColumns(input.tribute)
	};

	const writes: Writes = [
		db.insert(donation).values(donationRow),
		...input.lines.map((line) =>
			db.insert(lineItem).values({
				id: uuidv7(),
				donationId: input.donationId,
				label: line.label,
				revenueAccountId: line.revenueAccountId,
				unitPriceMinor: line.amountMinor,
				lineTotalMinor: line.amountMinor
			} satisfies NewLineItem)
		)
	];

	try {
		await db.batch(writes);
		return { ok: true };
	} catch (error) {
		// nothing on this write sits under a unique index but the gift's own primary key, which is a
		// UUIDv7 minted moments earlier — so a collision here is a defect rather than the retry
		// `duplicate_intent` names, and calling it one would tell a caller the gift is already
		// recorded when it is not.
		return refusalFor(error, input.formId, {
			ok: false,
			reason: 'write_failed',
			detail: `the gift could not be written: its id (${input.donationId}) is already in the database. nothing about it was stored.`
		});
	}
}

/**
 * the four columns a tribute occupies, spelled with every key required.
 *
 * `NewDonation` types all four as optional, because the columns are nullable — so the compiler has
 * nothing to say about a value produced by `parseTribute` (./quote-input.ts) and dropped on the way
 * to the row. this type is what gives it something to say: both branches below must name all four,
 * and the annotation on `donationRow` makes leaving the spread out an error too.
 *
 * the `notify` pair collapses to two nulls together or two strings together, which is the pairing
 * `Tribute` holds and the columns cannot.
 */
type TributeColumns = {
	tributeKind: TributeKind | null;
	tributeHonoree: string | null;
	tributeNotifyName: string | null;
	tributeNotifyEmail: string | null;
};

function tributeColumns(tribute: Tribute | null): TributeColumns {
	if (tribute === null) {
		return {
			tributeKind: null,
			tributeHonoree: null,
			tributeNotifyName: null,
			tributeNotifyEmail: null
		};
	}
	return {
		tributeKind: tribute.kind,
		tributeHonoree: tribute.honoree,
		tributeNotifyName: tribute.notify?.name ?? null,
		tributeNotifyEmail: tribute.notify?.email ?? null
	};
}

/** the write itself, once the gift is known to add up. */
async function write(db: Db, input: RecordDonationInput): Promise<RecordedDonation> {
	const donor = await resolveDonor(db, input.donor, input.consentedToContact);
	const contactId = donor.contactId;

	const donationRow: NewDonation & TributeColumns = {
		id: input.donationId,
		contactId,
		totalMinor: input.totalMinor,
		currency: input.currency,
		feeMinor: input.feeMinor,
		receivedAt: input.occurredAt,
		formId: input.formId,
		origin: input.origin,
		// null rather than absent, because the column is nullable and `exactOptionalPropertyTypes`
		// makes an explicit `undefined` a different thing from an omitted key. a message of
		// whitespace never reaches here — see `parseQuoteRequest` in ./quote-input.ts.
		note: input.note ?? null,
		programId: input.programId,
		// `tribute_notified_at` is deliberately not among these. the stamp is the settlement path's,
		// claimed by a guarded update on a gift whose money has moved (../db/schema.ts) — writing one
		// here would mark a family as told about a gift the donor's bank may still refuse.
		...tributeColumns(input.tribute)
		// `created_at` is left to the column default: system time belongs to the write.
	};

	const lineRows: NewLineItem[] = input.lines.map((line) => ({
		id: uuidv7(),
		donationId: input.donationId,
		label: line.label,
		revenueAccountId: line.revenueAccountId,
		unitPriceMinor: line.amountMinor,
		lineTotalMinor: line.amountMinor
		// `quantity`, `tax_minor` and `revenue_account_is_postable` are left to their column
		// defaults — the last of those is not a fact about the line at all, see ../db/schema.ts.
	}));

	// minted into a name rather than read back off the row: `NewPayment['id']` is optional, because
	// the column carries a `$defaultFn`, so `paymentRow.id` is `string | undefined` even where it
	// was just written. the same reason `NewContactRow` exists in ../contacts/queries.ts.
	const paymentId = uuidv7();
	const paymentRow: NewPayment = {
		id: paymentId,
		donationId: input.donationId,
		amountMinor: input.totalMinor,
		currency: input.currency,
		direction: 'inbound',
		method: QUOTED_RAIL_METHODS[input.method],
		// nothing has settled. `pending` is the row's own vocabulary for money on its way and not
		// yet ours, which is exactly an intent the donor has not confirmed — and it is what keeps
		// this write out of the books, since only a `succeeded` payment triggers a posting.
		status: 'pending',
		provider: input.processor,
		providerTxnId: input.providerTxnId,
		occurredAt: input.occurredAt
	};

	// foreign-key order, and non-empty by construction rather than by assertion: the gift's own
	// three kinds of row are always there, and the donor's statement goes in front of them because
	// `donation.contact_id` has to resolve when its statement runs — which is a requirement of the
	// insert case and harmless in the update one.
	const gift: Writes = [
		db.insert(donation).values(donationRow),
		...lineRows.map((row) => db.insert(lineItem).values(row)),
		db.insert(payment).values(paymentRow)
	];
	// a matched donor whose consent was never asked contributes no statement at all — see
	// `resolveDonor` in ./donor.ts. the batch stays non-empty either way, which is what `Writes` says.
	const writes: Writes = donor.statement === null ? gift : [donor.statement, ...gift];

	await db.batch(writes);

	return {
		donationId: input.donationId,
		contactId,
		paymentId,
		donorWasCreated: donor.created
	};
}

/**
 * what is wrong with the gift's own arithmetic, or `null` — checked before anything is written.
 *
 * every rule here is one the database will not keep. `line_item`'s checks are `>= 0`, so a
 * zero-amount line stores clean; nothing in sqlite can express "these lines sum to that column",
 * because it is cross-row; and `STRICT` rejects a float on the way in but reports a datatype
 * mismatch on a column with no line number in it.
 *
 * why the sum is checked at all, when the schema declines to write cross-column amount rules as
 * `CHECK`s: that argument is about DDL cost — a check naming two columns blocks `DROP COLUMN` on
 * both, so it costs a table rebuild to withdraw — and none of that applies to an `if` in a
 * function. what does apply is the timing. these numbers are checked again at settlement, by
 * `post()` in ../ledger/posting.ts, which refuses an entry group that does not balance — and by
 * then the charge has cleared, so the same defect arrives as a `PostingError` against money the
 * org already has. the same rule is worth stating at both ends and it is only actionable at this
 * one.
 *
 * it holds exactly because of what `DonationLine` does not carry. there is no quantity, no
 * discount and no per-line tax on this input, and `tax_minor` and `non_deductible_minor` are
 * written by nothing here — so the counterexamples the schema names against a `CHECK` are all
 * columns this function leaves to their defaults. it survives fee coverage either way, because the
 * fee is expensed gross against a gift recorded at face value (see `donation.fee_minor` in
 * ../db/schema.ts): the donor covering it raises the total and the lines together.
 *
 * the wording mirrors `post()`'s — minor units spelled out, the offending index named — so that a
 * defect caught here and the same defect caught there read the same way.
 */
function problemWith(input: {
	readonly totalMinor: number;
	readonly feeMinor: number;
	readonly lines: readonly DonationLine[];
}): string | null {
	if (!Number.isSafeInteger(input.totalMinor) || input.totalMinor <= 0) {
		return `totalMinor is ${input.totalMinor}, which is not a positive whole number of minor units. amounts are minor units — $100.00 is 10_000, not 100.`;
	}
	if (!Number.isSafeInteger(input.feeMinor) || input.feeMinor < 0) {
		return `feeMinor is ${input.feeMinor}, which is not a whole number of minor units at or above zero.`;
	}
	if (input.lines.length === 0) {
		return 'this gift has no line items. a gift is itemized by at least one line, and the line is what says which fund it posts to.';
	}

	let sum = 0;
	for (const [i, line] of input.lines.entries()) {
		if (!Number.isSafeInteger(line.amountMinor)) {
			return `lines[${i}].amountMinor is ${line.amountMinor}, which is not a safe integer. amounts are minor units — $100.00 is 10_000, not 100.`;
		}
		if (line.amountMinor <= 0) {
			return `lines[${i}].amountMinor is ${line.amountMinor}. a line records a positive part of the gift, and a zero or negative one is the shape a mis-computed split produces.`;
		}
		sum += line.amountMinor;
	}

	if (sum !== input.totalMinor) {
		return `the line items sum to ${sum} but the donor is charged ${input.totalMinor} (minor units). every part of what is charged has to be itemized, because the lines are what the settlement posts revenue from.`;
	}

	return null;
}

/**
 * a rejection out of the write, in this module's vocabulary rather than the driver's.
 *
 * the mapping is short because only two constraints on this write path can fire in a way a caller
 * can do anything about, and both are named here rather than left for an endpoint to recognise in
 * a sentence:
 *
 *   - `SQLITE_CONSTRAINT_UNIQUE` is `payment_provider_txn_idx` (../db/schema.ts), and it is the
 *     ordinary outcome of a retry rather than a fault. `IntentRequest.idempotencyKey` in
 *     ../payments/provider.ts exists so that an attempt made twice resolves to the intent that
 *     already exists, which means the second call arrives here with a transaction id already in
 *     the table. the gift was recorded the first time; answering that with a fault would fail a
 *     donation that succeeded.
 *   - `SQLITE_CONSTRAINT_FOREIGNKEY` is one of the gift's outward references: the form, the cause
 *     it is credited to, or the fund a line names. the reason is not called `unknown_form` because
 *     the constraint cannot say which — the code is the same for all three — and a name that picked
 *     one would send whoever reads it to check the wrong thing.
 *
 * everything else is `write_failed`, including a throw that is not the database's at all. the
 * detail carries the sentence the caller can act on and never the code: a route that matched on
 * `SQLITE_` prose would be a second, unreviewed copy of this mapping inside a public payment path.
 *
 * `unique` is the caller's, because a UNIQUE rejection does not mean the same thing to both
 * writers: one of them opens a `payment` row under `payment_provider_txn_idx` and the other opens
 * none at all. each states what a collision means for the rows it writes.
 */
function refusalFor(error: unknown, formId: string, unique: RecordFailure): RecordFailure {
	switch (sqliteResultCode(error)) {
		case 'SQLITE_CONSTRAINT_UNIQUE':
			return unique;
		case 'SQLITE_CONSTRAINT_FOREIGNKEY':
			return {
				ok: false,
				reason: 'missing_reference',
				detail: `this gift names a row that is not in the database — its form (${formId}), the cause it is credited to, or the fund one of its lines posts to. re-read the form before quoting against it.`
			};
		default:
			// logged here because this is the one arm whose detail cannot name a cause, and a
			// deployment that refused a donation with no line anywhere saying why is worse than the
			// refusal. wrapped, for the reason `logProviderFault` in ../payments/provider.ts states:
			// `console.error` serialises what it is given and therefore runs the thrower's own
			// getters, so the one path that must not throw would have a throw site in it.
			try {
				console.error('recording a donation failed:', error);
			} catch {
				// nothing to report it to, and nothing this function may throw.
			}
			return {
				ok: false,
				reason: 'write_failed',
				detail:
					'the gift could not be written, and nothing about it was stored. this is a fault in ' +
					'this app or in the database rather than anything about the donation; the cause is in ' +
					'this deployment’s logs (the Cloudflare dashboard, or `pnpm run logs` from a checkout).'
			};
	}
}
