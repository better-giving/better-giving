import { postableId } from '../db/accounts';
import type { PostableAccountId } from '../db/postable';
import { post, type PostingLine } from '../ledger/posting';
import type { Settlement } from '../payments/provider';

// the two entry groups a charge that succeeded makes, stated once for both halves of the webhook.
//
// ./settle.ts posts a one-off gift against the payment row a quote minted, and ./collect.ts posts
// a collection under a standing commitment. the accounting is the same accounting — a gift
// recognised at face value, and the processor's cut expensed gross — so it is written here rather
// than twice, where a later change to how a gift is recognised would have to be made in two files
// and would be made in one.
//
// the door in front of them is here for the same reason. `unpostable` names every defect a
// settlement can carry on its own that `post()` would otherwise refuse by throwing, and both halves
// have to ask before they build an entry — so it lives beside the entries it guards rather than in
// whichever half needed it first.
//
// nothing here writes. `post()` returns a validated `Posting` and the caller splices its statements
// into its own `batch()`, which is the rule ../ledger/posting.ts's header states and the reason a
// donation, its payment and its ledger lines can land together or not at all.

/**
 * why a settlement is not something the ledger can hold, or null.
 *
 * ../ledger/posting.ts refuses an entry group by throwing, and everything it refuses about the
 * settlement itself is decidable before a single row is built: an amount that is zero, negative or
 * not a whole number of minor units; a currency that is not three uppercase letters, which is
 * exactly what the processor's own lowercase `usd` is if an adapter ever stopped uppercasing it; a
 * date that is not a date; and a fee that is not whole, which `feeEntry` passes through because its
 * own guard is about sign rather than shape.
 *
 * both halves ask before they build an entry, because both have the same contract: they never
 * throw. a `PostingError` out of `chargeEntry` is an exception on the money path, which is a 500,
 * which the processor reads as "deliver this again" for three days — against figures that will be
 * refused identically every time. a settlement the books cannot take is not a gift to record and it
 * is not an exception either; it is a delivery answered with a sentence somebody can act on.
 *
 * what it deliberately does not state is the ledger's arithmetic. the balance and the arity `post()`
 * also checks are about the funds a caller credits rather than about the settlement, and the two
 * callers stand differently to them: ./collect.ts hands `chargeEntry` a single share worth the whole
 * of what was collected, so it cannot fail them at all, and ./settle.ts, whose gift may be itemized
 * across several funds, has a door of its own for that disagreement (`recognitionOf` there). so this
 * is every defect a settlement carries on its own, and only those.
 */
export function unpostable(settlement: Settlement): string | null {
	if (!Number.isSafeInteger(settlement.amountMinor) || settlement.amountMinor <= 0) {
		return `the amount collected is ${settlement.amountMinor}, which is not a positive whole number of minor units.`;
	}
	if (!/^[A-Z]{3}$/.test(settlement.currency)) {
		return `the currency is ${JSON.stringify(settlement.currency)}, which is not a 3-letter uppercase ISO-4217 code.`;
	}
	if (Number.isNaN(settlement.occurredAt.getTime())) {
		return 'the processor reported no usable time for it, and that time is the date the entry would be posted under.';
	}
	if (settlement.feeMinor !== null && !Number.isSafeInteger(settlement.feeMinor)) {
		return `the processor's fee is ${settlement.feeMinor}, which is not a whole number of minor units.`;
	}
	return null;
}

/** one fund a gift's lines name, and what of the gift is its. */
export type RevenueShare = {
	readonly accountId: PostableAccountId;
	/** minor units, positive — what this fund is credited, not what the whole gift came to. */
	readonly amountMinor: number;
};

/**
 * every fund a gift credits, at least one, and never a fund twice over one line.
 *
 * a non-empty tuple rather than an array, so "a gift with no fund to post to" is a shape a caller
 * cannot hand over — `post()` would refuse the resulting single-line entry with `too_few_lines`,
 * which is a correct rejection carrying none of the reason.
 */
export type GiftRevenue = readonly [RevenueShare, ...RevenueShare[]];

/** the rows a posting is made against, and the funds it credits. */
export type ChargedGift = {
	/** the settlement attempt these entries are keyed to — `entry_group.source_id`. */
	readonly paymentId: string;
	/** the gift the money is for, named in the memo so a journal reads without a join. */
	readonly donationId: string;
	/**
	 * the revenue accounts this gift's own lines name, each with that line's own amount.
	 *
	 * an argument rather than a constant because the two callers know it differently: a one-off
	 * gift's funds are decided when the quote is minted and written onto its `line_item` rows, and a
	 * collection's is read off the form the commitment was made on at the moment it is collected —
	 * `recurring_plan.form_id` is NOT NULL for exactly that (../db/schema.ts), so charge fifty posts
	 * to the fund the form names then rather than to one frozen a year earlier.
	 *
	 * they must sum to `Settlement.amountMinor`, and this module does not reconcile them — see
	 * `chargeEntry`.
	 */
	readonly revenue: GiftRevenue;
};

/**
 * entry group A: the gift recognised, at face value.
 *
 * a card charge is not cash — it is money the processor owes the organisation — so the debit is
 * `1020 Undeposited Funds` and not `1010 Bank Cash`. the transfer of that money into the bank is
 * deliberately not modelled anywhere: the app cannot observe money arriving in a bank account, so
 * it does not claim to. a fundraiser reconciling against a bank statement finds this gift in
 * undeposited funds rather than in the bank, and it stays there.
 *
 * one credit per fund the gift's lines name, each for that line's own amount, against the one
 * debit. a gift is itemized by at least one line and the line is what says which fund it posts to
 * (./record.ts), so a gift split across two funds credits both — which is what an operator pointing
 * a form at a restricted appeal is asking for, and what a single credit for the whole amount took
 * away from them.
 *
 * what this does not split is one line's own amount across deductible and non-deductible. the
 * non-deductible account exists and is reachable through `donationRevenueAccount`
 * (../db/accounts.ts), and nothing writes `donation.non_deductible_minor` — it defaults to zero on
 * every gift this app takes — so that split would be arithmetic over a column no path populates.
 * the quid pro quo path is what makes it two lines per fund, and it arrives with whatever writes
 * that column: it multiplies these lines rather than replacing them.
 *
 * the settled amount rather than the donation's total, because this posts what actually moved: the
 * two agree today and a partial capture is what would part them.
 *
 * the shares therefore have to sum to the settled amount, and nothing here reconciles them. two
 * rules hold that together. no share is ever allocated proportionally — a settled amount spread
 * across lines by ratio is a split nobody chose, and it needs a rounding rule to place a residual
 * that no fund has a claim to — so a caller whose figures disagree decides at its own door what
 * that means rather than handing over numbers to be adjusted here. and `post()` refuses an entry
 * group that does not sum to zero (`unbalanced`, ../ledger/posting.ts), which is the backstop that
 * makes a caller skipping that door a loud failure rather than books that do not say where the
 * money went.
 */
export function chargeEntry(gift: ChargedGift, settlement: Settlement) {
	const lines: PostingLine[] = [
		{ accountId: postableId('undepositedFunds'), amountMinor: settlement.amountMinor },
		...gift.revenue.map((share) => ({
			accountId: share.accountId,
			amountMinor: -share.amountMinor
		}))
	];

	return post({
		sourceType: 'payment',
		sourceId: gift.paymentId,
		currency: settlement.currency,
		occurredAt: settlement.occurredAt,
		memo: `donation ${gift.donationId}`,
		lines
	});
}

/**
 * entry group B: what the processor kept, expensed gross.
 *
 * the fee is the processor's own figure and never the one this app quoted. the two are different
 * numbers on purpose — the donor agreed to an estimate and `donation.fee_minor` keeps that, while
 * this line has to reconcile against a bank statement, so it can only be what was actually taken.
 *
 * `null` where there is no figure. that is the ordinary answer for a transaction still in flight,
 * which does not reach here, and the anomalous one for a settled charge — a gift whose fee never
 * posts leaves `1020` overstated by it and no error anywhere, so both callers tell an operator
 * when they get one.
 *
 * the credit is against `1020` rather than the bank, for the same reason the charge debits it: the
 * processor never sends the fee, it withholds it, so what it owes drops by exactly this.
 */
export function feeEntry(gift: ChargedGift, settlement: Settlement) {
	const fee = settlement.feeMinor;
	if (fee === null || fee <= 0) return null;

	return post({
		sourceType: 'fee',
		sourceId: gift.paymentId,
		currency: settlement.currency,
		occurredAt: settlement.occurredAt,
		memo: `processor fee on donation ${gift.donationId}`,
		lines: [
			{ accountId: postableId('processorFees'), amountMinor: fee },
			{ accountId: postableId('undepositedFunds'), amountMinor: -fee }
		]
	});
}
