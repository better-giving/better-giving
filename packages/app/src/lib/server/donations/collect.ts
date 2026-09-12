import { and, eq, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { uuidv7 } from 'uuidv7';
import { projectTribute } from '../../donations/tributes';
import type { RecurringPlanStatus } from '../../recurring/statuses';
import { readContactSummaries, type ContactSummary } from '../contacts/queries';
import type { Db } from '../db/client';
import type { PostableAccountId } from '../db/postable';
import { sqliteResultCode } from '../db/rejection';
import {
	donation,
	lineItem,
	payment,
	program,
	recurringPlan,
	RECURRING_INTERVALS,
	type Donation,
	type NewDonation,
	type NewLineItem,
	type NewPayment,
	type NewRecurringPlan,
	type RecurringInterval,
	type RecurringPlan
} from '../db/schema';
import type { ReceiptContribution } from '../email/receipt';
import { readForm } from '../forms/queries';
import { postingStatements } from '../ledger/posting';
import {
	CONTACT_METADATA_KEY,
	DONATION_METADATA_KEY,
	FEE_COVERED_METADATA_KEY,
	FORM_METADATA_KEY,
	GIFT_MINOR_METADATA_KEY,
	INTERVAL_METADATA_KEY,
	isRetryable,
	type ProcessorName,
	type RecurringEvent,
	type RecurringGiftNotice,
	type Settlement
} from '../payments/provider';
import { alert, type SettleDeps, type SettleResult } from './delivery';
import { chargeEntry, feeEntry, unpostable } from './entries';
import { sendReceipt, type ReceiptOutcome } from './receipt';
import { sendSettledNotice, type Repeating } from './settled-notice';
import { sendTributeNotice } from './tribute-notice';

// the books for a gift that repeats: what one collection under a standing commitment writes, and
// what the commitment's own standing writes when it stops.
//
// ---------------------------------------------------------------------------
// this is an INSERT where ./settle.ts is an UPDATE, except on the one charge that has a row waiting
// for it — and that exception is the whole shape of the module.
//
// a one-off gift is quoted before it is paid: ./record.ts mints the donation, its line and a
// `pending` payment when the donor presses the button, and ./settle.ts corrects that row and posts
// it. a repeating gift is quoted before it is paid too — `mintCommitment` in ./quote.ts records the
// gift and its line, and no payment, because nothing has been attempted from this side. so the
// charge that opens a commitment *claims* that gift: it names it in the commitment's metadata
// (`DONATION_METADATA_KEY`), and this path writes the plan, the settled payment and both entry
// groups against the row that is already there rather than opening a second one for money the donor
// is already recorded as giving.
//
// every charge after it has nothing waiting. the donor pressed a button once, months ago, and the
// rail collects with nobody at a browser — so a later collection writes its own gift, its line, its
// settled payment and both entry groups, and refreshes the commitment, in one `batch()`.
//
// the un-claimed arm stays and is not dead weight: a commitment made outside this app names no gift
// of ours, and a pointer that resolves to nothing is not a reason to leave money out of the books.
//
// ---------------------------------------------------------------------------
// how a charge finds the gift it belongs to, which is the only hard question here.
//
// a collection arrives naming an invoice. `readRecurringGift` resolves that to the commitment it
// was raised under (../payments/provider.ts), and the commitment is the anchor for everything else:
//
//   which donor, which form, how often — off the commitment's metadata, which this app wrote when
//   it created the commitment and which the processor hands back on every read of it. the three
//   keys are `CONTACT_METADATA_KEY`, `FORM_METADATA_KEY` and `INTERVAL_METADATA_KEY`, and the
//   contract they form is stated on them. a collection's own PaymentIntent carries nothing:
//   Stripe mints it and copies nothing onto it, which is exactly why the invoice — not the
//   intent — is what this app subscribes to for a repeating gift.
//
//   and how much of the charge the donor chose to add — off the same metadata, through
//   `GIFT_MINOR_METADATA_KEY` and `FEE_COVERED_METADATA_KEY`. a commitment a donor covered the fee
//   on collects the grossed-up total every interval, so without those two the split is unreadable
//   at every charge and the fee is collected monthly and stated on no receipt. `coveredFeeOf`
//   below is what spends them.
//
//   and which gift the donor was recorded as making when they authorized it —
//   `DONATION_METADATA_KEY`, a pointer at a row of ours and the one thing on the commitment that
//   this app could not have carried before it wrote that row. it is optional where the other two
//   are not: a commitment that names no gift is one made outside this app, and the money still
//   reaches the books.
//
//   and who the gift was dedicated to, and which cause it went to — off that gift's own columns
//   rather than off the commitment. a donor's honoree is a person's name and nothing donor-typed is
//   exported to the processor, and a cause is a pointer at a row of ours that the processor has no
//   name for. the charge that opens the series keeps what it was authorized with; every later one
//   copies both from that opening charge (`openingGift` below), because a donor dedicates the gift
//   rather than January's instalment and gives to the cause rather than to the month. the person
//   the donor asked us to tell stays on the opening charge alone, which is what makes telling a
//   family one act.
//
//   which commitment row — `recurring_plan_provider_subscription_idx` (../db/schema.ts), the
//   unique index on `(provider, provider_subscription_id)`. the subscription id is all a rebill
//   arrives with, so that index is both the lookup for charge two onward and the constraint that
//   refuses a second commitment for one subscription.
//
//   how much, on which rail, at what time, and what it cost — `readSettlement` against the
//   transaction the collection was attempted on. the money is read once, there, and no second copy
//   of those numbers is taken off the invoice.
//
// ---------------------------------------------------------------------------
// every way of writing this twice, and the constraint that refuses each.
//
// the settlement path's rule is that a redelivery is refused by the database rather than by a
// read-then-write check, because `batch()` cannot make a check-then-insert atomic (CLAUDE.md). the
// same rule holds here, and there are three doors instead of one:
//
//   the same collection delivered twice — `payment_provider_txn_idx`, on
//   `(provider, provider_txn_id)`. the second delivery's payment row names the same transaction
//   and is refused, and the whole batch rolls back with it, so the donation, the line and both
//   entry groups go with it. this is the load-bearing one on this path: the entry groups are keyed
//   to a `payment.id` this module has just minted, so they are unique by construction and
//   `entry_group_source_idx` cannot see the duplicate — the payment index is what does.
//
//   the first collection delivered twice — `recurring_plan_provider_subscription_idx` as well,
//   since the second delivery would open a second commitment for one subscription. either
//   constraint alone would refuse the batch; both fire.
//
//   the `payment_intent.succeeded` that accompanies every collection — refused in ./settle.ts,
//   before any lookup, because the intent behind a collection names no gift in its metadata. that
//   is the guard which makes the order the two deliveries arrive in stop mattering; read its
//   header for what it costs to get wrong.
//
// a UNIQUE rejection therefore does not mean "stop" on its own, which is the one place this path
// is more than ./settle.ts. a commitment already opened is also what a *second* charge under a
// commitment this app has not yet recorded looks like, so a rejection is met by re-reading the
// commitment and writing the charge against it — the schema's own words for it are that the
// settlement "carries on to the donation it was really about". only a rejection from that second
// write means the books already hold this money.
//
// ---------------------------------------------------------------------------
// who is told, and what is still deliberately not written here.
//
// a collection that reached the books is receipted, by ./receipt.ts — the one sender ./settle.ts
// ends at too, so a repeating gift and a one-off one are receipted by the same code rather than by
// two copies of it. it is sent from `answerTo` below, the single arm both the first charge and
// every later one reach once their batch committed, and the stamp lands on that charge's own
// `donation.receipt_sent_at`: every collection is its own donation row (../db/schema.ts), so there
// is no per-commitment flag to keep honest against a redelivery. a send that fails leaves the
// column null, which is the backlog ../email/receipt.ts describes, and changes nothing
// about the collection — the money moved and the books have it.
//
// no thank-you: `donation.thankyou_sent_at` is written by nothing here. no email of any kind for a
// collection that failed either — the rail's own retry schedule is what tries again, and a
// deployment that mailed on every failed attempt would mail a donor whose card is merely expiring.
//
// nothing keeps a running total on the commitment. what a commitment has given is a `SUM` over its
// donations' ledger entries, at read time, like every other number in this app (CLAUDE.md).
// ---------------------------------------------------------------------------

/**
 * deals with one verified delivery about a repeating gift: resolve it to a commitment, read the
 * money where money moved, and write.
 *
 * never throws, for the reason `settleDelivery` in ./settle.ts never throws: an exception here is
 * a 500, and the processor reads a 500 as "deliver this again" for three days.
 */
export async function collectRecurringGift(
	deps: SettleDeps,
	event: RecurringEvent
): Promise<SettleResult> {
	const read = await deps.provider.readRecurringGift(event);
	if (!read.ok) {
		if (isRetryable(read.reason)) return { ok: false, reason: 'incomplete', detail: read.detail };
		if (read.reason === 'not_found') {
			// an invoice raised by hand on the same processor account reaches this endpoint exactly as
			// a repeating gift's does, and only the second is a gift this app keeps books for. silent,
			// because nothing here is anybody's fault and no money of this deployment's is
			// unaccounted for — it is the one terminal reason that means "not ours".
			return {
				ok: true,
				outcome: 'ignored',
				detail: `event ${event.id} (${event.type}) is about no repeating gift here: ${read.detail}`
			};
		}
		// every other terminal reason is a fault rather than a stranger's invoice —
		// `internal_error` is what `sealed` in ../payments/provider.ts turns an adapter's own throw
		// into — and the delivery it lands on may be an `invoice.paid` for money already collected.
		// answered 200 with nothing said, that gift is lost with nobody told.
		await alert(deps, {
			headline: 'A delivery about a repeating gift could not be read and was not acted on',
			body:
				'The delivery verified and the repeating gift behind it could not be read. Nothing was ' +
				'written. If it was a collection, money moved and the books do not have it. Repeating ' +
				'the call answers the same way, so this needs a person.',
			facts: [
				{ label: 'Event', value: event.id },
				{ label: 'Event type', value: event.type },
				{ label: 'Reason', value: read.detail }
			],
			action: 'Find this subscription in the Stripe dashboard and reconcile it by hand.'
		});
		return { ok: true, outcome: 'unactionable', detail: read.detail };
	}
	const notice = read.value;
	const plan = await findPlan(deps.db, deps.provider.processor, notice.providerGiftId);

	// a delivery about the commitment itself, which is about no collection at all.
	if (notice.about === 'commitment') return standingResult(deps.db, event, notice, plan);

	if (notice.providerTxnId === null) {
		// a collection with no transaction behind it, which is an invoice settled outside the
		// processor and marked paid. it is not a delivery about nothing: `invoice.paid` is subscribed
		// to precisely because it covers the out-of-band case (../payments/stripe.ts), so this is
		// money the organisation has received.
		//
		// nothing is synthesised from the invoice for it. the amount, the rail, the time and the fee
		// all come from a transaction there is none of, and a gift posted from figures nobody read
		// is worse than a gift a person enters by hand — which is what the alert asks for.
		await alert(deps, {
			headline: 'A repeating gift collected money the processor did not carry',
			body:
				'A collection under a repeating gift was marked paid with no transaction behind it, ' +
				'which is how an invoice settled outside Stripe arrives. Nothing was written: what the ' +
				'gift was worth and what it cost are not on the invoice to read.',
			facts: [
				{ label: 'Event', value: event.id },
				{ label: 'Repeating gift', value: notice.providerGiftId }
			],
			action: 'Find this invoice in the Stripe dashboard and record the gift by hand.'
		});
		return {
			ok: true,
			outcome: 'unmatched',
			detail: `a collection under ${notice.providerGiftId} was paid with no transaction to read it from; nothing was written.`
		};
	}

	// the money, read from the transaction rather than from the invoice that named it — the same
	// rule ./settle.ts follows, and for the same reason: deliveries carry no ordering guarantee.
	const money = await deps.provider.readSettlement(notice.providerTxnId);
	if (!money.ok) {
		if (isRetryable(money.reason)) return { ok: false, reason: 'incomplete', detail: money.detail };
		await alert(deps, {
			headline: 'A collection under a repeating gift could not be read and was not recorded',
			body:
				'The delivery verified and the transaction behind it could not be read. Nothing was ' +
				'written. Repeating the call answers the same way, so this needs a person.',
			facts: [
				{ label: 'Event', value: event.id },
				{ label: 'Repeating gift', value: notice.providerGiftId },
				{ label: 'Transaction', value: notice.providerTxnId },
				{ label: 'Reason', value: money.detail }
			],
			action: 'Find the payment in the Stripe dashboard and reconcile it by hand.'
		});
		return { ok: true, outcome: 'unactionable', detail: money.detail };
	}
	const settlement = money.value;

	if (settlement.status !== 'succeeded') {
		// nothing was collected, so there is nothing to record: unlike a one-off gift, no row was
		// opened at quote time for a failed attempt to correct. what the commitment's own standing
		// did over it is the one thing worth writing.
		const stood = await recordStanding(deps.db, event, notice, plan);
		if (stood !== null) return standingResult(deps.db, event, notice, plan, stood);
		return {
			ok: true,
			outcome: 'uncollected',
			detail: `a collection under ${notice.providerGiftId} is ${settlement.status}; nothing was written and the rail will try again.`
		};
	}

	// what the ledger will not take is decided here, at the door, rather than by a throw out of
	// `post()` further in. see `unpostable` in ./entries.ts, which ./settle.ts asks the same
	// question of — one settlement's own defects are one rule, and it is stated once.
	const refused = unpostable(settlement);
	if (refused !== null) {
		await alert(deps, {
			headline: 'A repeating gift collected money the books cannot record',
			body:
				'A collection succeeded and what the processor reported about it is not something the ' +
				'ledger can hold, so nothing was written. The same figures arrive on every redelivery, ' +
				'so this needs a person.',
			facts: [
				{ label: 'Event', value: event.id },
				{ label: 'Repeating gift', value: notice.providerGiftId },
				{ label: 'Transaction', value: settlement.providerTxnId },
				{ label: 'Problem', value: refused }
			],
			action: 'Find this payment in the Stripe dashboard and record the gift by hand.'
		});
		return {
			ok: true,
			outcome: 'unactionable',
			detail: `a collection under ${notice.providerGiftId} could not be posted: ${refused}`
		};
	}

	return recordCharge(deps, event, notice, plan, settlement);
}

/**
 * what a delivery that wrote nothing but the commitment's own standing answers with.
 *
 * shared by the two deliveries that reach it — the commitment's own event, and a collection that
 * did not collect — so that a gift ending is reported the same way whichever of them carried the
 * news.
 */
async function standingResult(
	db: Db,
	event: RecurringEvent,
	notice: RecurringGiftNotice,
	plan: RecurringPlan | null,
	already?: StandingChange | null
): Promise<SettleResult> {
	const change = already === undefined ? await recordStanding(db, event, notice, plan) : already;

	if (change === 'stopped') {
		return {
			ok: true,
			outcome: 'stopped',
			detail: `repeating gift ${notice.providerGiftId} has stopped and its record says so.`
		};
	}
	if (change === 'revived') {
		return {
			ok: true,
			outcome: 'updated',
			detail: `repeating gift ${notice.providerGiftId} is collecting again and its record says so.`
		};
	}
	return {
		ok: true,
		outcome: 'ignored',
		detail: `repeating gift ${notice.providerGiftId} is ${notice.state}; nothing here changed.`
	};
}

/**
 * the commitment a subscription id names, or null.
 *
 * looked up on `recurring_plan_provider_subscription_idx`, which is unique — so this is one row or
 * none rather than a query with an ordering in it. it is a lookup and never a gate: nothing below
 * depends on the answer still being true when the write runs, because every write it leads to is
 * refused by that same index or by `payment_provider_txn_idx` if it stopped being true.
 */
async function findPlan(
	db: Db,
	processor: ProcessorName,
	providerGiftId: string
): Promise<RecurringPlan | null> {
	const [row] = await db
		.select()
		.from(recurringPlan)
		.where(
			and(
				eq(recurringPlan.provider, processor),
				eq(recurringPlan.providerSubscriptionId, providerGiftId)
			)
		)
		.limit(1);
	return row ?? null;
}

/** how a commitment stopped, or null while it is still standing. */
type Ending = { readonly status: RecurringPlanStatus; readonly endedAt: Date };

/**
 * what the processor's word for a commitment means for the row that records it.
 *
 * only the two stopped states write anything. `active` is a commitment collecting, and `pending` is
 * one nothing has been collected under yet — which cannot be acted on at all (../payments/
 * provider.ts) and, on this path, describes a commitment whose row does not exist yet anyway.
 *
 * `ended_at` falls back to the delivery's own time, and that is the case
 * `RecurringGiftNotice.endedAt` names: a commitment the processor gave up on has stopped
 * collecting without ending, so it reports no date. the column is NOT NULL whenever the status is
 * not `active` (`recurring_plan_ended_at_check`), so the fallback is what keeps a lapsed
 * commitment recordable at all — and the delivery's time is when this deployment learned of it,
 * never a guess.
 */
function endingOf(notice: RecurringGiftNotice, event: RecurringEvent): Ending | null {
	if (notice.state === 'ended') {
		return { status: 'cancelled', endedAt: notice.endedAt ?? event.occurredAt };
	}
	if (notice.state === 'lapsed') {
		return { status: 'lapsed', endedAt: notice.endedAt ?? event.occurredAt };
	}
	return null;
}

/** what a delivery did to a commitment's own standing, where it did anything. */
type StandingChange = 'stopped' | 'revived';

/**
 * whether a commitment the rail reports as collecting has a record that says otherwise.
 *
 * `lapsed` and `cancelled` are not the same kind of stopped, and this is the one place the
 * difference is load-bearing. `lapsed` is the rail's own giving-up — Stripe's `unpaid`
 * (../payments/stripe.ts) — and it is reversible: the donor pays the invoice that was outstanding
 * and the commitment goes back to collecting. a row that could not follow it back would read
 * "stopped on <date>" while the gift charged every month, which is the worst shape a record can
 * take, because nothing about it looks wrong.
 *
 * `cancelled` never comes back, and that is a decision rather than a limitation of the rail.
 * cancelling is this app's own act through `cancelRecurringGift`, an operator is told it is
 * permanent, and a donor who wants to give again makes a new commitment — so a delivery claiming
 * otherwise is answered by leaving the row alone.
 */
function revives(notice: RecurringGiftNotice, plan: RecurringPlan): boolean {
	return notice.state === 'active' && plan.status === 'lapsed';
}

/**
 * brings a commitment's own record into line with what the rail says of it, and says what it did.
 *
 * both directions are a single conditional UPDATE, and the condition is what makes a redelivery a
 * no-op: an ending is written only over a row that is still `active`, so the first ending recorded
 * is the one that stands; a revival is written only over a row that is `lapsed`, so it cannot
 * resurrect a cancellation whatever a delivery claims. the row is chosen by the statement rather
 * than by a read taken beforehand, so there is no window between deciding and writing — the shape
 * CLAUDE.md's ban on read-then-write asks for.
 *
 * silent where this deployment holds no row for the commitment. a gift whose first collection never
 * succeeded has no row here by design, and a subscription created outside this app on the same
 * account has none either; neither is a fault and neither is worth an operator's attention.
 */
async function recordStanding(
	db: Db,
	event: RecurringEvent,
	notice: RecurringGiftNotice,
	plan: RecurringPlan | null
): Promise<StandingChange | null> {
	if (plan === null) return null;

	if (revives(notice, plan)) {
		const restored = await db
			.update(recurringPlan)
			.set({ status: 'active', endedAt: null, nextChargeAt: notice.nextChargeAt })
			.where(and(eq(recurringPlan.id, plan.id), eq(recurringPlan.status, 'lapsed')))
			.returning({ id: recurringPlan.id });
		return restored.length > 0 ? 'revived' : null;
	}

	const ending = endingOf(notice, event);
	if (ending === null) return null;

	const marked = await db
		.update(recurringPlan)
		.set({ status: ending.status, endedAt: ending.endedAt, nextChargeAt: null })
		.where(and(eq(recurringPlan.id, plan.id), eq(recurringPlan.status, 'active')))
		.returning({ id: recurringPlan.id });

	return marked.length > 0 ? 'stopped' : null;
}

/**
 * one collection that succeeded, written against the commitment it belongs to — opening that
 * commitment where this is the charge that started it.
 *
 * the retry after a duplicate is the "carries on to the donation it was really about" case
 * `recurring_plan`'s header describes, and it is why a UNIQUE rejection is not the end of this
 * path: another delivery opening the commitment first is indistinguishable, at the constraint,
 * from this delivery arriving twice — so the commitment is re-read and the charge written against
 * it, where a second rejection is what actually means the books already hold this money.
 */
async function recordCharge(
	deps: SettleDeps,
	event: RecurringEvent,
	notice: RecurringGiftNotice,
	plan: RecurringPlan | null,
	settlement: Settlement
): Promise<SettleResult> {
	if (plan !== null) return writeAgainstPlan(deps, event, notice, plan, settlement);

	const opened = await openCommitment(deps, event, notice, settlement);
	if (opened !== 'duplicate') return opened;

	const existing = await findPlan(deps.db, deps.provider.processor, notice.providerGiftId);
	if (existing === null) {
		// the write was refused for a duplicate and no commitment is there to have caused it, which
		// is a state nothing in this path produces. worth another delivery rather than a shrug: the
		// same batch runs again, and the constraints that refuse a duplicate are what make repeating
		// it safe.
		return {
			ok: false,
			reason: 'incomplete',
			detail: `a collection under ${notice.providerGiftId} was refused as a duplicate and no commitment could be found for it.`
		};
	}
	return writeAgainstPlan(deps, event, notice, existing, settlement);
}

/**
 * what one `batch()` did, in this module's vocabulary rather than the driver's.
 *
 *   written    — the rows are committed.
 *   duplicate  — a UNIQUE index refused it, which on this path means two different things: see
 *                `recordCharge`.
 *   refused    — the database will not hold what the commitment says, and will not hold it on any
 *                redelivery either. two constraints reach it and both are deterministic: a foreign
 *                key, which is a commitment naming a donor or a form that is not in this database,
 *                and a check, which is a value one of the tables refuses outright — a blank
 *                customer id on `recurring_plan` being the one a processor can actually produce.
 *   failed     — refused for a reason this module does not classify, or the call faulted. nothing
 *                was written and the cause is in the logs.
 */
type WriteOutcome = 'written' | 'duplicate' | 'refused' | 'failed';

/**
 * the first collection: the commitment, the gift, its line, its payment and both entry groups, in
 * one `batch()` — with the gift claimed rather than inserted where the donor already has one.
 *
 * the commitment is written here rather than when the donor set it up, which is `recurring_plan`'s
 * own rule: there is no status meaning "created at the rail, nothing charged yet", and a
 * subscription that never charges would otherwise leave a row claiming a commitment the donor never
 * completed. so the row and the charge that proves it land together or not at all. that is
 * unchanged by the gift being recorded at authorization: a `donation` with no successful payment
 * claims no income, because every figure in this app is a `SUM` over `ledger_entry` at read time.
 */
async function openCommitment(
	deps: SettleDeps,
	event: RecurringEvent,
	notice: RecurringGiftNotice,
	settlement: Settlement
): Promise<SettleResult | 'duplicate'> {
	const named = attribution(notice);
	if (typeof named === 'string') {
		await alert(deps, {
			headline: 'A repeating gift collected money this deployment cannot attribute',
			body:
				'A collection succeeded under a commitment whose record here could not be opened, so ' +
				'the money is not in the books. Sending the delivery again cannot fix it: what is ' +
				'missing is on the commitment at Stripe, not in this request.',
			facts: [
				{ label: 'Event', value: event.id },
				{ label: 'Repeating gift', value: notice.providerGiftId },
				{ label: 'Transaction', value: settlement.providerTxnId },
				{
					label: 'Amount',
					value: `${settlement.amountMinor} ${settlement.currency} (minor units)`
				},
				{ label: 'Problem', value: named }
			],
			action: 'Find this subscription in the Stripe dashboard and record the gift by hand.'
		});
		return {
			ok: true,
			outcome: 'unmatched',
			detail: `the commitment ${notice.providerGiftId} names nothing this deployment can record a gift against: ${named}`
		};
	}

	// `readForm` and not a query of its own, because it is the read that does not hide an archived
	// row (../forms/queries.ts): a commitment outlives the form it was made on being retired, and a
	// gift collected against a retired form still has to reach the books. the whole record because
	// the fund is what the charge posts to and the name is what the organisation's own notice calls
	// it (./settled-notice.ts) — one read for both.
	const giving = await readForm(deps.db, named.formId);
	if (giving === null) {
		await alert(deps, {
			headline: 'A repeating gift collected money against a form that is not here',
			body:
				'A collection succeeded under a commitment naming a form this deployment does not ' +
				'have, so there is no fund to post it to and the money is not in the books.',
			facts: [
				{ label: 'Event', value: event.id },
				{ label: 'Repeating gift', value: notice.providerGiftId },
				{ label: 'Form named by the commitment', value: named.formId },
				{ label: 'Transaction', value: settlement.providerTxnId }
			],
			action: 'Find this subscription in the Stripe dashboard and record the gift by hand.'
		});
		return {
			ok: true,
			outcome: 'unmatched',
			detail: `the commitment ${notice.providerGiftId} names form ${named.formId}, which is not in this database.`
		};
	}

	const ending = endingOf(notice, event);
	// minted into a name rather than read back off the row: `NewRecurringPlan['id']` is optional,
	// because the column carries a `$defaultFn`, so `planRow.id` is `string | undefined` even where
	// it was just written — and the donation in the same batch has to name it.
	const planId = uuidv7();
	const planRow: NewRecurringPlan = {
		id: planId,
		contactId: named.contactId,
		formId: named.formId,
		// what the first charge actually collected, rather than a figure carried on the commitment:
		// the money that moved is the money the donor agreed to, and it is already read once here.
		// an amount and an interval are fixed for a commitment's life (../db/schema.ts), so this
		// stays true of charge fifty.
		amountMinor: settlement.amountMinor,
		currency: settlement.currency,
		interval: named.interval,
		status: ending?.status ?? 'active',
		provider: deps.provider.processor,
		providerSubscriptionId: notice.providerGiftId,
		providerCustomerId: notice.providerCustomerId,
		// when the commitment began, which `recurring_plan` defines as when its first charge
		// settled — this charge.
		startedAt: settlement.occurredAt,
		nextChargeAt: ending === null ? notice.nextChargeAt : null,
		endedAt: ending?.endedAt ?? null
	};

	// the gift the donor was already recorded as making, where the commitment names one and it is
	// still claimable. read before the batch is built rather than gated on: the plan insert below is
	// in the same commit and is what refuses a second delivery.
	const authorized =
		named.authorizedGiftId === null
			? null
			: await findAuthorizedGift(deps.db, named.authorizedGiftId, named.contactId);

	const writes =
		authorized === null
			? chargeWrites(
					deps.db,
					deps.provider.processor,
					planId,
					named.contactId,
					named.formId,
					giving.revenueAccountId,
					// a commitment naming no gift of ours was dedicated to nobody and given to no cause
					// this app can know of.
					{ dedication: null, program: null },
					notice,
					settlement
				)
			: claimWrites(
					deps.db,
					deps.provider.processor,
					planId,
					authorized.gift,
					authorized.program,
					giving.revenueAccountId,
					notice,
					settlement
				);

	const wrote = await attempt(deps.db, [
		deps.db.insert(recurringPlan).values(planRow),
		...writes.statements
	]);
	if (wrote === 'duplicate') return 'duplicate';

	return answerTo(deps, wrote, {
		event,
		notice,
		settlement,
		charge: writes.charge,
		// the charge that mints the commitment, which is the one the organisation hears about.
		announce: { formName: giving.name, repeating: 'first' },
		names: `donor ${named.contactId} and form ${named.formId}`
	});
}

/**
 * a later collection: the gift, its line, its payment, both entry groups, and the commitment
 * refreshed — in one `batch()`.
 *
 * the fund is read off the form now rather than off anything the commitment froze, which is the
 * decision `recurring_plan` was shaped for: `form_id` is NOT NULL there so that
 * `form.revenue_account_id` is reachable for every later charge. moving a form to another fund
 * therefore moves the gifts collected after the move, and leaves the ones before it where they
 * were posted. a commitment that had to keep posting to a retired fund would be the alternative,
 * and nothing in this app could correct it.
 *
 * `readForm` for the reason `openCommitment` states, and it matters more here: a commitment
 * outlives the form it was made on being archived, and this is the path every later charge takes.
 *
 * the opening gift costs a second read, spent only where a collection succeeded and only on this
 * arm. it buys the two things the commitment deliberately does not carry: a donor's honoree is a
 * person's name and the cause is a pointer at a row of ours, so both stay in this database and
 * every later charge copies them from the charge that opened the series.
 */
async function writeAgainstPlan(
	deps: SettleDeps,
	event: RecurringEvent,
	notice: RecurringGiftNotice,
	plan: RecurringPlan,
	settlement: Settlement
): Promise<SettleResult> {
	const giving = await readForm(deps.db, plan.formId);
	if (giving === null) {
		await alert(deps, {
			headline: 'A repeating gift collected money against a form that is no longer here',
			body:
				'A collection succeeded under a commitment whose form has gone from this database, so ' +
				'there is no fund to post it to and the money is not in the books.',
			facts: [
				{ label: 'Event', value: event.id },
				{ label: 'Repeating gift', value: notice.providerGiftId },
				{ label: 'Form', value: plan.formId },
				{ label: 'Transaction', value: settlement.providerTxnId }
			],
			action: 'Find this subscription in the Stripe dashboard and record the gift by hand.'
		});
		return {
			ok: true,
			outcome: 'unmatched',
			detail: `the commitment ${notice.providerGiftId} is recorded against form ${plan.formId}, which is not in this database.`
		};
	}

	const writes = chargeWrites(
		deps.db,
		deps.provider.processor,
		plan.id,
		plan.contactId,
		plan.formId,
		giving.revenueAccountId,
		// what the series was authorized with, off the charge that opened it — the only place either
		// is written, since neither the dedication nor the cause reaches the processor.
		await openingGift(deps.db, plan.id),
		notice,
		settlement
	);
	const wrote = await attempt(deps.db, [
		...writes.statements,
		deps.db
			.update(recurringPlan)
			.set(refreshOf(plan, notice, event))
			.where(eq(recurringPlan.id, plan.id))
	]);

	if (wrote === 'duplicate') {
		return {
			ok: true,
			outcome: 'already_posted',
			detail: `the collection on ${settlement.providerTxnId} is already in the books; this delivery changed nothing.`
		};
	}
	return answerTo(deps, wrote, {
		event,
		notice,
		settlement,
		charge: writes.charge,
		// a charge under a commitment that already exists, whichever delivery opened it. the
		// organisation was told when it opened and is told nothing now.
		announce: { formName: giving.name, repeating: 'later' },
		names: `donor ${plan.contactId} and form ${plan.formId}`
	});
}

/**
 * what a write that was not a duplicate answers with, and — where it committed — who is told.
 *
 * the receipt is sent from here rather than from either caller, and that is what makes "one receipt
 * per collection" a property of this module instead of a rule two functions have to keep. both the
 * charge that opens a commitment and every charge after it end at this arm, and neither reaches it
 * twice: a first collection delivered again is refused as a `duplicate` before this and carries on
 * to `writeAgainstPlan`, whose own duplicate arm answers `already_posted` without returning here.
 *
 * the organisation's own notice is sent from here on every collection and reaches an inbox on one
 * of them. which one is ./settled-notice.ts's rule and is refused inside it, so what this arm owes
 * it is only `announce.repeating` — which charge in the series this is, a thing the callers know
 * and nothing reachable from here does.
 *
 * the missing-reference arm is the one worth stating: a commitment naming a donor or a form this
 * database does not hold fails identically on every redelivery, so it is answered 200 with an
 * alert rather than held open for three days. that is the same reasoning `unmatched` in ./settle.ts
 * is written from — a delivery nothing can be done about is worse than useless in the processor's
 * retry queue, because it also puts the endpoint into the failing state that endangers the
 * deliveries that can be handled.
 */
async function answerTo(
	deps: SettleDeps,
	wrote: Exclude<WriteOutcome, 'duplicate'>,
	about: {
		readonly event: RecurringEvent;
		readonly notice: RecurringGiftNotice;
		readonly settlement: Settlement;
		readonly charge: WrittenCharge;
		/**
		 * what the organisation's own notice is told about this charge — the form by the name an
		 * operator gave it, and which collection in the series this is. one name because they travel
		 * together and go to one place; `notice` above is the processor's word for the commitment and
		 * is a different thing entirely.
		 */
		readonly announce: { readonly formName: string; readonly repeating: Repeating };
		readonly names: string;
	}
): Promise<SettleResult> {
	if (wrote === 'written') {
		// every send is behind the commit, so everything they touch is touched after the money is in
		// the books. ./receipt.ts and ./settled-notice.ts report their own failures and raise none,
		// and this covers what is left: the alert and the donor read, each against a binding that can
		// fault like any other.
		// an exception escaping here is a 500 (`collectRecurringGift` promises it never throws),
		// which the processor reads as "deliver this again" for three days against a collection
		// `payment_provider_txn_idx` refuses every time — the gift banked and nobody told.
		//
		// the alert is inside the guard rather than in front of it, which is what makes a fault in it
		// reported as the receipt fault it causes: it runs first, so a throw there is also a receipt
		// that was never attempted, and `receiptFault` says exactly that.
		try {
			if (about.settlement.feeMinor === null) {
				// the same thing ./settle.ts says about a one-off gift, and it needs saying more here
				// rather than less: a commitment collects every month, so a fee this app cannot read
				// is `1020` overstated again on every collection, with no error anywhere and nothing
				// but a reconciliation to find it.
				await alert(deps, {
					headline: 'A collection under a repeating gift was posted with no processor fee',
					body:
						'The charge is in the books at face value and the fee it was taken out of is not. ' +
						'Undeposited funds is overstated by that amount until somebody posts it, and it ' +
						'will happen again on the next collection. Stripe published no fee for this ' +
						'payment in the currency the gift was charged in, which is the only currency the ' +
						'entry could be posted in.',
					facts: [
						{ label: 'Repeating gift', value: about.notice.providerGiftId },
						{ label: 'Transaction', value: about.settlement.providerTxnId }
					],
					// the same repair ./settle.ts names, and for the same reason: nothing in the
					// dashboard posts a correcting entry, so the figure is all this alert can hand
					// over.
					action:
						'Find this payment in the Stripe dashboard and keep the fee it states, in the ' +
						'currency the gift was charged in. Keep only a figure Stripe states for this ' +
						'payment: a fee reported in another currency is not one to convert, because Stripe ' +
						'publishes no fee in the currency a donor was charged in. This deployment records ' +
						'nothing for it, so carry that figure into the books your organisation keeps ' +
						'outside it.'
				});
			}

			const receipt = await receiptFor(deps, about.charge);

			// unconditional, including on the collections it says nothing about: which of them are
			// news is ./settled-notice.ts's rule to keep, not this arm's.
			await sendSettledNotice(deps, {
				// this collection's own figures, which are the commitment's as well on the charge that
				// opens it — `recurring_plan.amount_minor` is written from exactly these.
				amountMinor: about.settlement.amountMinor,
				currency: about.settlement.currency,
				donorName: receipt.donor?.displayName ?? null,
				donorEmail: receipt.donor?.primaryEmail ?? null,
				formName: about.announce.formName,
				repeating: about.announce.repeating,
				receipt: receipt.outcome,
				note: about.charge.note,
				tribute: about.charge.tribute
			});
		} catch (error) {
			await receiptFault(deps, about.charge, error);
		}
		return {
			ok: true,
			outcome: 'posted',
			detail: `a collection under ${about.notice.providerGiftId} was recorded and posted.`
		};
	}

	if (wrote === 'refused') {
		await alert(deps, {
			headline: 'A repeating gift collected money the database would not record',
			body:
				'A collection succeeded and the write was refused: the commitment names a donor or a ' +
				'form this deployment does not have, or something on it is a value these tables will ' +
				'not hold. The money is not in the books. Sending the delivery again cannot fix it. ' +
				'The database refuses the same write every time.',
			facts: [
				{ label: 'Event', value: about.event.id },
				{ label: 'Repeating gift', value: about.notice.providerGiftId },
				{ label: 'Named by the commitment', value: about.names },
				{ label: 'Transaction', value: about.settlement.providerTxnId },
				{
					label: 'Amount',
					value: `${about.settlement.amountMinor} ${about.settlement.currency} (minor units)`
				}
			],
			action: 'Find this subscription in the Stripe dashboard and record the gift by hand.'
		});
		return {
			ok: true,
			outcome: 'unmatched',
			detail: `the commitment ${about.notice.providerGiftId} names ${about.names}, and the database refused to record a gift against it.`
		};
	}

	return {
		ok: false,
		reason: 'incomplete',
		detail: `a collection under ${about.notice.providerGiftId} could not be written and nothing about it was stored.`
	};
}

/**
 * the donor's receipt for one collection, once the books have taken it — and who it was for.
 *
 * the donor is looked up here and nowhere earlier: this path plumbs a `contact_id` through every
 * write, and a name and an address are only needed once there is a gift to write about — a delivery
 * that posted nothing spends no read on it. `readContactSummaries` rather than a query of its own,
 * because every read of `contact` lives in ../contacts/queries.ts (its header says why).
 *
 * what it read and what came of it are handed back together, for the message that follows: the
 * organisation's notice names the same donor and says whether they were written to, and taking the
 * read out of here to share it would let a caller hand this function a donor belonging to some
 * other charge.
 *
 * a donor this deployment has no address for is answered by ./receipt.ts sending nothing, which
 * leaves `donation.receipt_sent_at` null — the same backlog an unrenderable receipt leaves. nothing
 * here is allowed to change what the delivery answered: the money moved, the books hold it, and a
 * failure to say so is reported rather than raised (./settle.ts's header states the rule for both
 * halves).
 */
async function receiptFor(
	deps: SettleDeps,
	charge: WrittenCharge
): Promise<{ donor: ContactSummary | undefined; outcome: ReceiptOutcome }> {
	const donor = (await readContactSummaries(deps.db, [charge.contactId])).get(charge.contactId);

	const outcome = await sendReceipt(deps, {
		donationId: charge.donationId,
		donorName: donor?.displayName ?? null,
		donorEmail: donor?.primaryEmail ?? null,
		contribution: charge.contribution,
		// the row just written, said back rather than the commitment read a second time — the same
		// rule `contribution` is under, so the document a donor files cannot disagree with the gift
		// it is about.
		tribute: charge.tribute,
		program: charge.program
	});

	// the person the donor asked us to tell, after the donor's own receipt. every collection but the
	// one that opened the series names nobody, and ./tribute-notice.ts answers that without a query.
	await sendTributeNotice(deps, {
		donationId: charge.donationId,
		donorName: donor?.displayName ?? null,
		tributeKind: charge.tribute?.kind ?? null,
		tributeHonoree: charge.tribute?.honoree ?? null,
		notifyName: charge.notifyName,
		notifyEmail: charge.notifyEmail
	});

	return { donor, outcome };
}

/**
 * a receipt step that faulted rather than answering, reported and gone no further.
 *
 * the gift is collected and posted by the time this can run, so there is nothing to undo and
 * nothing to hold the delivery open for: what is left is telling somebody, and `receipt_sent_at`
 * staying null is what keeps the gift on the unreceipted list until they act.
 *
 * the alert is guarded in turn because it goes out over the same transport that may be what
 * faulted. it logs its headline and facts before it reaches that transport (./delivery.ts), so the
 * sentence is in the logs either way.
 */
async function receiptFault(
	deps: SettleDeps,
	charge: WrittenCharge,
	error: unknown
): Promise<void> {
	try {
		await alert(deps, {
			headline: 'A collection was recorded and its receipt could not be attempted',
			body:
				'A collection under a repeating gift is in the books and the step that receipts it ' +
				'failed outright. The donor has not been told and is owed a receipt; the gift stays on ' +
				'the unreceipted list until one is sent.',
			facts: [
				{ label: 'Donation', value: charge.donationId },
				{ label: 'Donor', value: charge.contactId },
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

/**
 * what a collection tells the commitment's own row.
 *
 * `next_charge_at` is refreshed from what the rail expects, and cleared on a commitment that has
 * stopped — null is "none expected", which the column's own note defines. an ending is written
 * once: a row that is already stopped keeps the status and the date it stopped with, for the reason
 * `recordStanding` states.
 *
 * a collection is also the strongest possible statement that a lapsed commitment is collecting
 * again — money just moved under it — so it revives the row on the same terms `revives` sets out,
 * in the same batch as the gift it collected. a cancelled row is left alone, and its
 * `next_charge_at` cleared: whatever the rail collected, this deployment was told the gift was
 * over, and that is a reconciliation for a person rather than a status this path may overwrite.
 */
function refreshOf(plan: RecurringPlan, notice: RecurringGiftNotice, event: RecurringEvent) {
	if (revives(notice, plan)) {
		return { status: 'active' as const, endedAt: null, nextChargeAt: notice.nextChargeAt };
	}
	if (plan.status !== 'active') return { nextChargeAt: null };
	const ending = endingOf(notice, event);
	return ending === null
		? { nextChargeAt: notice.nextChargeAt }
		: { ...ending, nextChargeAt: null };
}

/**
 * the gift one collection wrote, as the donor has to be told it.
 *
 * minted alongside the statements rather than read back afterwards: the donation id is this
 * module's own (`uuidv7` below), so a caller that looked the gift up again would be looking it up
 * by the transaction it has just written. every figure here is this charge's own, which is what
 * makes charge fifty's receipt say what charge fifty collected rather than what the commitment
 * says or what the first charge did.
 *
 * the donor is a `contact_id` and not a name: this path plumbs the id and nothing else, and who to
 * write to is a read of ../contacts/queries.ts taken once the books have taken the money.
 */
type WrittenCharge = {
	readonly donationId: string;
	readonly contactId: string;
	/** what the row just written says the gift was dedicated to, or null where it says nothing. */
	readonly tribute: Dedication | null;
	/**
	 * the person the donor asked us to tell, off the row just written — both null on every charge
	 * but the one that opened the series, because that is what `chargeWrites` writes.
	 *
	 * they are on this type rather than read back because ./tribute-notice.ts's null-guard is what
	 * makes "one family told once" hold, and a read would be a second answer to a question the write
	 * has already settled.
	 */
	readonly notifyName: string | null;
	readonly notifyEmail: string | null;
	/** `donation.note`, and null on a collection: nobody was at a browser to write one. */
	readonly note: string | null;
	/**
	 * what the cause this charge is credited to is called, or null where it went to none.
	 *
	 * the name and not the id: this is what the receipt states, and the pointer is already on the
	 * row. it is said back from the same read the row was written from rather than looked up again,
	 * the same rule `contribution` below is under.
	 */
	readonly program: string | null;
	readonly contribution: ReceiptContribution;
};

/** one collection's rows, and the gift they record, minted together. */
type ChargeWrites = {
	readonly statements: BatchItem<'sqlite'>[];
	readonly charge: WrittenCharge;
};

/**
 * the fee the donor agreed to add, out of what this collection actually took.
 *
 * the commitment is what says there is one: `FEE_COVERED_METADATA_KEY` and
 * `GIFT_MINOR_METADATA_KEY` ride it from `mintCommitment` in ./quote.ts, and the difference between
 * what settled and the gift they name is the figure `donation.fee_minor` holds. it is derived from
 * the money that moved rather than from anything carried on the commitment's own row, so a
 * collection worth something else records its own split.
 *
 * never `settlement.feeMinor`, which is what the processor withheld: that one is posted by
 * `feeEntry` (./entries.ts) and printed on no receipt.
 *
 * zero where the commitment does not say, and that is not the "absence means unknown" rule in
 * ../payments/provider.ts being broken. that rule is about charges minted before those keys shipped;
 * a commitment carries what ./quote.ts wrote when it was created, and every commitment any fork of
 * this app can create carries both. so a shape that arrives without them is not a gift from before
 * the keys — it is a commitment made outside this app, whose donor agreed to no fee here. the money
 * is recorded either way: a split is a label on a charge that has already been collected.
 */
function coveredFeeOf(notice: RecurringGiftNotice, settlement: Settlement): number {
	if ((notice.metadata[FEE_COVERED_METADATA_KEY] ?? '').trim() !== 'true') return 0;
	const gift = Number((notice.metadata[GIFT_MINOR_METADATA_KEY] ?? '').trim());
	if (!Number.isSafeInteger(gift) || gift <= 0) return 0;
	const fee = settlement.amountMinor - gift;
	return Number.isSafeInteger(fee) && fee > 0 ? fee : 0;
}

/** a dedication once it is known to be one, which is what a row and a receipt both take. */
type Dedication = NonNullable<ReturnType<typeof projectTribute>>;

/**
 * what the charge that opened a series was authorized with, and what every later one copies.
 *
 * the cause carries its name as well as its id because the two are spent in different places from
 * one read: the id goes on the row and the name goes on the receipt (`ReceiptTarget.program` in
 * ./receipt.ts). a row with a pointer to a cause and a receipt that does not name it are the same
 * gift described two ways.
 */
type OpeningGift = {
	readonly dedication: Dedication | null;
	readonly program: { readonly id: string; readonly name: string } | null;
};

/**
 * what a collection writes when it has no gift waiting for it: the gift and the money.
 *
 * every later charge in a series takes this path, and so does the opening charge of a commitment
 * this app did not authorize. `opening` is what the series was authorized with — the dedication and
 * the cause, which the opening charge kept and every later one copies (`openingGift` above) — and
 * both are null where the series names neither.
 */
function chargeWrites(
	db: Db,
	processor: ProcessorName,
	planId: string,
	contactId: string,
	formId: string,
	fund: PostableAccountId,
	opening: OpeningGift,
	notice: RecurringGiftNotice,
	settlement: Settlement
): ChargeWrites {
	const donationId = uuidv7();
	const paymentId = uuidv7();
	const coveredFeeMinor = coveredFeeOf(notice, settlement);
	const dedication = opening.dedication;

	const giftRow: NewDonation = {
		id: donationId,
		contactId,
		totalMinor: settlement.amountMinor,
		currency: settlement.currency,
		// the fee the donor was quoted and chose to add on top, included in the total above
		// (packages/emails/src/templates/receipt.tsx) — never what the processor took. read off the
		// commitment for every charge in the series, because a collection arrives with metadata of
		// its own on none of them.
		feeMinor: coveredFeeMinor,
		// the business date of a collection is the day the money moved. the one-off path keeps the
		// day the donor gave, which is earlier than its settlement; here there is no earlier moment
		// — nobody was at a browser.
		receivedAt: settlement.occurredAt,
		formId,
		// no origin. it is the validated `Origin` of the request that made the gift, and a
		// collection is made by the rail with no request and no page behind it.
		origin: null,
		recurringId: planId,
		// the dedication the donor made when they set the commitment up, on this charge as on every
		// other in the series. the two notify columns are left null: the person to tell is named on
		// the charge that opened the series and on no other, which is what stops a family being
		// emailed every month for a year.
		tributeKind: dedication?.kind ?? null,
		tributeHonoree: dedication?.honoree ?? null,
		// the cause the donor gave to when they set the commitment up, on this charge as on every
		// other in the series: a report of what one cause raised is wrong without it, and a form
		// re-pinned next quarter must not rewrite what this series was given to.
		programId: opening.program?.id ?? null
	};

	const lineRow: NewLineItem = {
		id: uuidv7(),
		donationId,
		// what a donor is told this part of the gift is, which reads the same on a repeating gift as
		// on a one-off one. never a schema word (CLAUDE.md).
		label: 'Donation',
		revenueAccountId: fund,
		unitPriceMinor: settlement.amountMinor,
		lineTotalMinor: settlement.amountMinor
	};

	const paymentRow: NewPayment = {
		id: paymentId,
		donationId,
		amountMinor: settlement.amountMinor,
		currency: settlement.currency,
		direction: 'inbound',
		// the rail the processor says settled it. `payment.method` is NOT NULL and no quote stands
		// behind this row to fall back on, so a rail this schema does not model records as `card` —
		// which is what a commitment is charged on, since choosing monthly or yearly narrows the
		// donor's choice to it (../db/schema.ts).
		method: settlement.method ?? 'card',
		// written settled rather than corrected into it: this row is minted by the settlement that
		// produced it, so `pending` never describes it.
		status: 'succeeded',
		provider: processor,
		providerTxnId: settlement.providerTxnId,
		occurredAt: settlement.occurredAt
	};

	// one fund, taking the whole of what was collected: a commitment records one amount with no
	// split in it, and the line written just above says the same thing. `chargeEntry` takes a list
	// because a one-off gift can be itemized across funds (./settle.ts); a collection cannot.
	const gift = {
		paymentId,
		donationId,
		revenue: [{ accountId: fund, amountMinor: settlement.amountMinor }] as const
	};
	const fee = feeEntry(gift, settlement);

	return {
		// foreign-key order: the gift, its line and its payment, then the entries keyed to that
		// payment. one statement per row and never a multi-row INSERT — D1 caps a query at 100 bound
		// parameters (CLAUDE.md).
		statements: [
			db.insert(donation).values(giftRow),
			db.insert(lineItem).values(lineRow),
			db.insert(payment).values(paymentRow),
			...postingStatements(db, chargeEntry(gift, settlement)),
			...(fee === null ? [] : postingStatements(db, fee))
		],
		charge: {
			donationId,
			contactId,
			tribute: dedication,
			// the two columns the gift row above leaves null, said back rather than read: a later
			// collection names nobody to tell, which is what stops a family being mailed every month.
			notifyName: null,
			notifyEmail: null,
			// this path writes no note. a note is what a donor typed at a browser, and nobody was at
			// one — the opening charge kept theirs and `claimWrites` says it back.
			note: null,
			program: opening.program?.name ?? null,
			contribution: {
				// the row above, said back rather than the settlement read a second time, so the
				// document a donor files cannot disagree with the gift it is about.
				totalMinor: giftRow.totalMinor,
				currency: giftRow.currency,
				receivedAt: giftRow.receivedAt,
				coveredFeeMinor,
				// written by no path in this app, so this gift provided nothing in exchange and the
				// template says exactly that.
				nonDeductibleMinor: 0
			}
		}
	};
}

/**
 * what the charge that opens a commitment writes when the gift it is paying is already there: the
 * gift corrected to what moved, its line with it, the money, and the postings.
 *
 * an UPDATE where `chargeWrites` is an INSERT, and the three columns it corrects are the three the
 * quote could only claim. `total_minor` and the line's two amounts take what actually settled, which
 * is the rule the whole repeating path is written under — and it has to be all three together,
 * because the lines are what a posting credits and a line left at the quoted figure against a
 * settlement of another would put the gift's own record and the books at odds. `fee_minor` is
 * re-derived from what moved for the same reason (`coveredFeeOf` above).
 *
 * `received_at` is deliberately not corrected, which is the same call ./settle.ts makes about a
 * one-off gift: it is the business date of the gift, the day the donor gave, and somebody was at a
 * browser for this one. the money's own time goes on the payment row and on `recurring_plan
 * .started_at`. the note, the attributed origin, the dedication and the cause are left standing for
 * the same reason — they are what the donor said, and nothing about the charge revises them.
 *
 * the fund is written onto the line rather than assumed unchanged: a form moved to another fund
 * between the authorization and the first charge posts to where it points now, which is the same
 * answer `writeAgainstPlan` gives every later charge.
 *
 * the `is null` in the where is documentation on top of a guarantee: this statement is in the same
 * `batch()` as the commitment's own INSERT, so `recurring_plan_provider_subscription_idx` is what
 * refuses a second delivery, and a claim cannot half-happen.
 */
function claimWrites(
	db: Db,
	processor: ProcessorName,
	planId: string,
	gift: Donation,
	program: string | null,
	fund: PostableAccountId,
	notice: RecurringGiftNotice,
	settlement: Settlement
): ChargeWrites {
	const paymentId = uuidv7();
	const coveredFeeMinor = coveredFeeOf(notice, settlement);
	const dedication = projectTribute(gift.tributeKind, gift.tributeHonoree);

	const paymentRow: NewPayment = {
		id: paymentId,
		donationId: gift.id,
		amountMinor: settlement.amountMinor,
		currency: settlement.currency,
		direction: 'inbound',
		// the rail the processor says settled it, for the reason `chargeWrites` states: no `pending`
		// row stands behind this one to fall back on.
		method: settlement.method ?? 'card',
		status: 'succeeded',
		provider: processor,
		providerTxnId: settlement.providerTxnId,
		occurredAt: settlement.occurredAt
	};

	const posting = {
		paymentId,
		donationId: gift.id,
		revenue: [{ accountId: fund, amountMinor: settlement.amountMinor }] as const
	};
	const fee = feeEntry(posting, settlement);

	return {
		statements: [
			db
				.update(donation)
				.set({
					recurringId: planId,
					totalMinor: settlement.amountMinor,
					currency: settlement.currency,
					feeMinor: coveredFeeMinor
				})
				.where(and(eq(donation.id, gift.id), isNull(donation.recurringId))),
			db
				.update(lineItem)
				.set({
					revenueAccountId: fund,
					unitPriceMinor: settlement.amountMinor,
					lineTotalMinor: settlement.amountMinor
				})
				.where(eq(lineItem.donationId, gift.id)),
			db.insert(payment).values(paymentRow),
			...postingStatements(db, chargeEntry(posting, settlement)),
			...(fee === null ? [] : postingStatements(db, fee))
		],
		charge: {
			donationId: gift.id,
			contactId: gift.contactId,
			tribute: dedication,
			// the charge that opens a series is the one row of it that names anybody to tell, and the
			// correction above leaves all three of these standing.
			notifyName: gift.tributeNotifyName,
			notifyEmail: gift.tributeNotifyEmail,
			note: gift.note,
			// the cause the donor gave to, read with the row this is correcting: `program_id` is in no
			// `set` above, for the reason the note and the dedication are in none — it is what the
			// donor said, and nothing about the charge revises it.
			program,
			contribution: {
				totalMinor: settlement.amountMinor,
				currency: settlement.currency,
				// the donor's own date, said back off the row this is correcting — the receipt states
				// the day the gift was made, which the correction above leaves standing.
				receivedAt: gift.receivedAt,
				coveredFeeMinor,
				nonDeductibleMinor: gift.nonDeductibleMinor
			}
		}
	};
}

/**
 * runs one `batch()` and reads its rejection.
 *
 * the constraint codes are told apart rather than collapsed, because they have opposite answers: a
 * duplicate is work already done, and a refusal is a write the database will decline identically
 * for as long as anybody sends it. everything else is a delivery worth having again — nothing was
 * written, the next one runs the identical batch, and the constraints this module leans on are what
 * make repeating it safe.
 */
async function attempt(db: Db, writes: BatchItem<'sqlite'>[]): Promise<WriteOutcome> {
	const [first, ...rest] = writes;
	if (first === undefined) return 'failed';

	try {
		await db.batch([first, ...rest]);
		return 'written';
	} catch (error) {
		switch (sqliteResultCode(error)) {
			case 'SQLITE_CONSTRAINT_UNIQUE':
				return 'duplicate';
			case 'SQLITE_CONSTRAINT_FOREIGNKEY':
			case 'SQLITE_CONSTRAINT_CHECK':
				return 'refused';
			default:
				try {
					console.error('recording a collection under a repeating gift failed:', error);
				} catch {
					// nothing to report it to, and nothing on this path may throw.
				}
				return 'failed';
		}
	}
}

/** who the commitment says this money is from, or what is wrong with what it says. */
type Attribution = {
	readonly contactId: string;
	readonly formId: string;
	readonly interval: RecurringInterval;
	/**
	 * the gift this deployment recorded when the donor authorized the commitment, or null.
	 *
	 * null on a commitment made outside this app and on one made before the key shipped, and neither
	 * is a refusal: the money moved, and a gift written here holds it. `findAuthorizedGift` is what
	 * decides whether the row it names is one this charge may claim.
	 */
	readonly authorizedGiftId: string | null;
};

/**
 * the three facts a commitment has to carry, read off its metadata — and, for the one of them that
 * has a second source, off the rail's own schedule where the metadata cannot say.
 *
 * a sentence rather than a null on failure, because the sentence is what reaches an operator, and
 * "this gift is not attributable" is only actionable if it says which fact is missing. the contract
 * itself is stated on the keys in ../payments/provider.ts.
 *
 * blank is treated as absent: a metadata value the processor holds as an empty string satisfies
 * every presence check and then fails at the foreign key, which is the same defect one step later
 * and with a worse message.
 *
 * the donor and the form have no second source and never will: a `contact_id` is this deployment's
 * own row and nothing at the processor knows it, so a collection that cannot name one is money with
 * nobody to file it under and is refused. the cadence is not like that. it is a label on money that
 * has already moved, the rail's own schedule states it (`RecurringGiftNotice.interval`), and
 * refusing a gift the books could otherwise hold over this app's preferred spelling of "monthly" is
 * the worse trade — so the metadata leads and the schedule answers when it cannot. it is refused
 * only when neither can say, which is a commitment collecting on a cadence this app does not model
 * at all and therefore cannot record honestly.
 */
function attribution(notice: RecurringGiftNotice): Attribution | string {
	const contactId = (notice.metadata[CONTACT_METADATA_KEY] ?? '').trim();
	const formId = (notice.metadata[FORM_METADATA_KEY] ?? '').trim();
	const stated = (notice.metadata[INTERVAL_METADATA_KEY] ?? '').trim();
	const authorized = (notice.metadata[DONATION_METADATA_KEY] ?? '').trim();

	if (contactId === '')
		return `the commitment carries no \`${CONTACT_METADATA_KEY}\`, so there is no donor to file this gift under.`;
	if (formId === '')
		return `the commitment carries no \`${FORM_METADATA_KEY}\`, so there is no fund to post this gift to.`;

	const interval = (RECURRING_INTERVALS as readonly string[]).includes(stated)
		? (stated as RecurringInterval)
		: notice.interval;
	if (interval === null) {
		return `the commitment's \`${INTERVAL_METADATA_KEY}\` is ${JSON.stringify(stated)} and its schedule collects on a cadence this app does not model, so there is no interval to record it under. one of ${RECURRING_INTERVALS.join(', ')} is what a commitment here may be.`;
	}

	return { contactId, formId, interval, authorizedGiftId: authorized === '' ? null : authorized };
}

/**
 * the gift a commitment names, with what the cause it was given to is called.
 *
 * the name is joined rather than read afterwards, and left-joined because `donation.program_id` is
 * nullable — a gift given to no cause. it costs no round trip and it is what the receipt states,
 * the same shape `findTarget` in ./settle.ts joins the form's name in.
 */
type AuthorizedGift = { readonly gift: Donation; readonly program: string | null };

/**
 * the gift a commitment names, where it is still one this charge may claim.
 *
 * three conditions, and each of them is the reason a row is not claimable rather than a defensive
 * check. `recurring_id is null` is the whole idempotency of the claim as a statement: a gift already
 * attached to a commitment has been claimed, by this delivery's twin or by this delivery itself, and
 * claiming it again would put a second charge's money onto one row. the donor has to match because
 * the plan row is opened from the commitment's own `contact_id` and a gift filed under somebody else
 * would leave the two naming different people. and the id has to name a row at all — a commitment
 * made outside this app names none.
 *
 * it is a lookup and never a gate. what makes the claim safe under a redelivery is
 * `recurring_plan_provider_subscription_idx` refusing the second commitment in the same `batch()`,
 * which is the shape CLAUDE.md's ban on read-then-write asks for; the `is null` above rides on the
 * statement so the read cannot go stale between here and the write either.
 */
async function findAuthorizedGift(
	db: Db,
	donationId: string,
	contactId: string
): Promise<AuthorizedGift | null> {
	const [row] = await db
		.select({ gift: donation, program: program.name })
		.from(donation)
		.leftJoin(program, eq(donation.programId, program.id))
		.where(
			and(
				eq(donation.id, donationId),
				eq(donation.contactId, contactId),
				isNull(donation.recurringId)
			)
		)
		.limit(1);
	return row ?? null;
}

/**
 * what a series was authorized with, read off the charge that opened it: the dedication and the
 * cause.
 *
 * two facts in one read because they are copied together onto every later collection, for one
 * reason — a donor dedicates the gift and gives to the cause, rather than doing either to January's
 * instalment — and because neither reaches the processor, so this database is the only place they
 * are. splitting them would be a second query answering half a question.
 *
 * `donation_recurring_id_idx` and `order by received_at`, which is how `recurring_plan`'s header
 * says a first charge is identified — there is no sequence number and no first-charge flag, and
 * neither could be kept honest against a redelivered webhook. the opening charge is always the
 * earliest: a claimed gift carries the instant the donor authorized it, which is before any
 * collection, and an unclaimed series starts at its own first settlement.
 *
 * `projectTribute` rather than a check of its own, because `donation.tribute_kind` carries no CHECK
 * and cannot be given one — so what is stored is narrowed by the one rule every surface shares
 * (../../donations/tributes.ts). the cause needs no such narrowing: `donation.program_id` is a
 * foreign key, so a value in it names a row, and the join is what reads that row's name for the
 * receipt at no extra round trip.
 *
 * the two notify columns are not read and are not copied. they name the person the donor asked us to
 * tell, telling a family is one act, and the opening charge is the only row of the series that names
 * anybody — which is the failure `donation.tribute_notified_at` in ../db/schema.ts is written
 * against.
 */
async function openingGift(db: Db, planId: string): Promise<OpeningGift> {
	const [row] = await db
		.select({
			kind: donation.tributeKind,
			honoree: donation.tributeHonoree,
			programId: donation.programId,
			programName: program.name
		})
		.from(donation)
		.leftJoin(program, eq(donation.programId, program.id))
		.where(eq(donation.recurringId, planId))
		.orderBy(donation.receivedAt, donation.id)
		.limit(1);
	if (row === undefined) return { dedication: null, program: null };
	return {
		dedication: projectTribute(row.kind, row.honoree),
		program:
			row.programId === null || row.programName === null
				? null
				: { id: row.programId, name: row.programName }
	};
}
