import { POSTING_ACCOUNTS, postableId } from '../db/accounts';
import type { PostableAccountId } from '../db/postable';
import { post, type PostingLine } from '../ledger/posting';
import type { Settlement } from '../payments/provider';

// the entry groups a gift that reached the organisation makes: the two a charge that succeeded makes,
// stated once for both halves of the webhook, and the one a gift received in hand makes
// (`receivedInHandEntry`, for ./record-in-hand.ts). and the three a refund or a dispute of such a
// gift makes, for ./reverse.ts: the money leaving (`reversalEntry`); where the refund did not stand
// or the dispute was won, the money coming back (`reinstatementEntry`); and where a dispute closes
// with figures the books do not hold, the close's settle-up (`settleUpEntry`).
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
 * a refund or a dispute is asked the same question about its own figures (./reverse.ts), with the
 * dispute's fee where it has one, which is why it takes the fields a reversal also carries rather
 * than a whole settlement.
 *
 * every writer asks before it builds an entry — ./settle.ts, ./collect.ts and ./reverse.ts —
 * because all three have the same contract: they never throw. a `PostingError` out of `chargeEntry` is an exception on the money path, which is a 500,
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
export function unpostable(
	settlement: Pick<Settlement, 'amountMinor' | 'currency' | 'occurredAt' | 'feeMinor'>
): string | null {
	if (!Number.isSafeInteger(settlement.amountMinor) || settlement.amountMinor <= 0) {
		return `the amount is ${settlement.amountMinor}, which is not a positive whole number of minor units.`;
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
 * rules hold that together. no share of a gift is ever allocated proportionally — a settled amount
 * spread across lines by ratio is a split nobody chose, and it needs a rounding rule to place a
 * residual that no fund has a claim to — so a caller whose figures disagree decides at its own door
 * what that means rather than handing over numbers to be adjusted here. the one exception is a
 * partial refund (`reversalEntry` below): it comes off every line of the gift in proportion, rounded
 * by `shareOf`'s rule, and any other split is a correction in /admin/books. and `post()` refuses an entry
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

/**
 * `lines` scaled to `amountMinor`, each keeping its sign, one figure per line in the same order.
 *
 * debits and credits are apportioned separately, each side summing to exactly `amountMinor`, so
 * the result balances whatever the rounding does. a side is split by largest remainder: every line
 * takes the whole minor units of its share, and the units left over go one each to the lines whose
 * shares lost the most, the earlier line winning a tie. deterministic, so the same lines and amount
 * always make the same figures.
 *
 * integer arithmetic throughout, because a line times an amount can pass the range a float holds
 * whole.
 */
function shareOf(lines: readonly PostingLine[], amountMinor: number): number[] {
	const shares = lines.map(() => 0);
	for (const sign of [1, -1]) {
		const side = lines.flatMap((line, index) =>
			Math.sign(line.amountMinor) === sign ? [{ index, whole: Math.abs(line.amountMinor) }] : []
		);
		const total = BigInt(side.reduce((sum, l) => sum + l.whole, 0));
		const parts = side.map(({ index, whole }) => {
			const scaled = BigInt(whole) * BigInt(amountMinor);
			return { index, floor: scaled / total, remainder: scaled % total };
		});
		let left = BigInt(amountMinor) - parts.reduce((sum, p) => sum + p.floor, 0n);
		const byClaim = [...parts].sort((a, b) =>
			a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1
		);
		for (const part of byClaim) {
			const extra = left > 0n ? 1n : 0n;
			left -= extra;
			shares[part.index] = sign * Number(part.floor + extra);
		}
	}
	return shares;
}

/** a gift in the books and the refund row that takes money back off it. */
export type ReversedGift = {
	/** the refund's own `payment.id` — `entry_group.source_id`. */
	readonly refundPaymentId: string;
	/** the gift the money was for, named in the memo as a charge names it. */
	readonly donationId: string;
	/** the lines of the gift's own `'payment'` group, in posting order. */
	readonly original: readonly PostingLine[];
	/** minor units: what the gift's earlier refunds that still stand have already taken off it. */
	readonly alreadyRefundedMinor: number;
	/** the lines of the gift's own `'fee'` group, in posting order — none where no fee was booked. */
	readonly fee: readonly PostingLine[];
};

/** money that moved on a refund or a dispute: which, how much, in what, and when. */
export type RefundedMoney = {
	readonly kind: 'refund' | 'dispute_opened' | 'dispute_lost';
	/** minor units, positive, in the gift's own currency. */
	readonly amountMinor: number;
	readonly currency: string;
	readonly occurredAt: Date;
	/** minor units: what the processor charged for the reversal itself — a dispute fee. null where it charged none. */
	readonly feeMinor: number | null;
	/**
	 * minor units: the part of the gift's own fee the processor gave back with a refund, no more
	 * than what of it is still booked. null where it gave none back, and for a dispute.
	 */
	readonly feeReturnedMinor: number | null;
};

/**
 * the refund: the gift's own lines reversed, scaled to what was refunded, plus any fee the
 * processor charged for the reversal, less any of the gift's fee it gave back.
 *
 * apportioned as the gift's share of everything refunded so far, this refund included, less its
 * share of what earlier refunds took. so however the cents of each refund fall, refunds adding up to
 * the whole gift take every line of it back exactly.
 *
 * the gift's posted lines are mirrored rather than named here, so a refund comes out of whichever
 * asset account the gift went into — `1020` for a charge, and whatever else a gift was ever posted
 * to — and off every fund it credited. the processor's fee on the gift is not in those lines: it
 * stays expensed in the gift's own `'fee'` group, but for what the processor gave back with a
 * refund, which is that group's lines reversed and scaled to the figure given back — out of
 * processor fees and into whichever account the fee was taken from. ./reverse.ts caps the figure at
 * what of the fee is still booked.
 *
 * a dispute's fee is two lines of this same group, expensed and credited to `1020` as `feeEntry`
 * books the gift's own, so the event keeps one group and one key. `reinstatementEntry` reads those
 * two lines back out.
 */
export function reversalEntry(gift: ReversedGift, refund: RefundedMoney) {
	const fee = refund.feeMinor;
	return post({
		sourceType: 'refund',
		sourceId: gift.refundPaymentId,
		currency: refund.currency,
		occurredAt: refund.occurredAt,
		memo: `${refund.kind === 'refund' ? 'refund' : 'dispute'} on donation ${gift.donationId}`,
		lines: [
			...refundShares(gift, refund.amountMinor),
			...(fee === null || fee <= 0 ? [] : feeLines(fee)),
			...feeReturnLines(gift.fee, refund.feeReturnedMinor)
		]
	});
}

/**
 * the gift's own fee lines reversed, scaled to what the processor gave back: out of processor fees
 * and back into whichever account the fee was taken from.
 */
function feeReturnLines(fee: readonly PostingLine[], returnedMinor: number | null): PostingLine[] {
	if (returnedMinor === null || returnedMinor <= 0) return [];
	return putBack(fee, returnedMinor);
}

/** `lines` mirrored, scaled to `amountMinor`; a line whose figure comes to nothing is left out. */
function putBack(lines: readonly PostingLine[], amountMinor: number): PostingLine[] {
	const shares = shareOf(lines, amountMinor);
	return lines
		.map((line, i) => ({ accountId: line.accountId, amountMinor: -(shares[i] ?? 0) }))
		.filter((line) => line.amountMinor !== 0);
}

/**
 * a fee the processor took for a reversal: expensed, and out of what it owes (`feeEntry` above). a
 * negative figure is a fee given back, and none is no lines.
 */
function feeLines(feeMinor: number): PostingLine[] {
	if (feeMinor === 0) return [];
	return [
		{ accountId: postableId('processorFees'), amountMinor: feeMinor },
		{ accountId: postableId('undepositedFunds'), amountMinor: -feeMinor }
	];
}

/**
 * this refund's figure for each of the gift's lines, reversed. a line whose figure comes to nothing
 * is left out, because `post()` refuses a line of zero.
 */
function refundShares(gift: ReversedGift, amountMinor: number): PostingLine[] {
	const before = shareOf(gift.original, gift.alreadyRefundedMinor);
	const after = shareOf(gift.original, gift.alreadyRefundedMinor + amountMinor);
	return gift.original
		.map((line, i) => ({
			accountId: line.accountId,
			amountMinor: (before[i] ?? 0) - (after[i] ?? 0)
		}))
		.filter((line) => line.amountMinor !== 0);
}

/** a refund or a dispute's withdrawal in the books that did not stand. */
export type FailedRefund = {
	/** the refund's own `payment.id` — `entry_group.source_id` of both its groups. */
	readonly refundPaymentId: string;
	readonly donationId: string;
	/** the lines of the refund's own `'refund'` group, in posting order. */
	readonly withdrawn: readonly PostingLine[];
};

/**
 * the money a withdrawal that did not stand put back: the exact mirror of what it took, less any
 * fee the processor charged for it, plus that fee where the processor gave it back.
 *
 * `('payment', refund row)`, because it is money in on that row, and it is the grain
 * `entry_group_source_idx` in ../db/schema.ts gives a refund-direction row's reinstatement.
 */
export function reinstatementEntry(
	refund: FailedRefund,
	when: Pick<RefundedMoney, 'currency' | 'occurredAt'> & {
		readonly kind: 'refund_failed' | 'dispute_won';
		/** minor units: the reversal's fee the processor gave back. null where it gave none back. */
		readonly feeReturnedMinor: number | null;
	}
) {
	const returned = when.feeReturnedMinor;
	return post({
		sourceType: 'payment',
		sourceId: refund.refundPaymentId,
		currency: when.currency,
		occurredAt: when.occurredAt,
		memo:
			when.kind === 'dispute_won'
				? `dispute on donation ${refund.donationId} won`
				: `refund on donation ${refund.donationId} did not stand`,
		lines: [
			...withoutReversalFee(refund.withdrawn),
			...(returned === null || returned <= 0 ? [] : feeLines(returned))
		].map((line) => ({ accountId: line.accountId, amountMinor: -line.amountMinor }))
	});
}

/**
 * a withdrawal's lines without the fee charged for it (`reversalEntry` above): each processor-fee
 * debit and one `1020` credit of the same figure. the gift's own lines carry no processor fee, and
 * a refund's fee given back is a processor-fee credit, so whatever is left is the gift's money and
 * its fee given back.
 */
function withoutReversalFee(lines: readonly PostingLine[]): PostingLine[] {
	const processorFees = postableId('processorFees');
	const charged = (line: PostingLine) => line.accountId === processorFees && line.amountMinor > 0;
	const rest = lines.filter((line) => !charged(line));
	for (const fee of lines.filter(charged)) {
		const credit = rest.findIndex(
			(line) =>
				line.accountId === postableId('undepositedFunds') && line.amountMinor === -fee.amountMinor
		);
		if (credit !== -1) rest.splice(credit, 1);
	}
	return rest;
}

/** what the books hold of a dispute as it closes. */
export type ClosingDispute = {
	/**
	 * `entry_group.source_id` of the settle-up: the withdrawal's own `payment.id`, or, for a win whose
	 * opening was never recorded here, the disputed payment's — the one key on either row nothing
	 * else posts under, so a redelivered close collides.
	 */
	readonly sourcePaymentId: string;
	readonly donationId: string;
	/** minor units: what the withdrawal's row says the opening took, and 0 where none was recorded. */
	readonly amountMinor: number;
	/**
	 * the lines the books hold of the dispute, in posting order: its withdrawal's `'refund'` group,
	 * and a win's reinstatement after them. none where no opening was recorded.
	 */
	readonly held: readonly PostingLine[];
};

/** what the processor reported at a dispute's close. */
export type DisputeClose = Pick<RefundedMoney, 'currency' | 'occurredAt'> &
	(
		| {
				readonly outcome: 'lost';
				/** minor units: what the processor finally took. null where it names no figure but the opening's. */
				readonly amountMinor: number | null;
				/** minor units: every fee the processor charged for the dispute, the opening's included. */
				readonly feeMinor: number | null;
		  }
		| {
				readonly outcome: 'won';
				/** minor units: the dispute fee the processor kept, net of what it gave back. */
				readonly feeKeptMinor: number;
		  }
	);

/**
 * the settle-up of a dispute at its close, or null where the close carries nothing the books do not
 * already hold of it.
 *
 * lost, two parts, either or both:
 *
 *   - the fee charged at the close less the fee the opening already booked, expensed out of `1020`
 *     as `feeLines` books it. a close naming less fee than was booked gives none back.
 *   - where the processor took less than the opening withdrew, the difference put back: that share
 *     of the withdrawal's own lines but its fee, mirrored, scaled by `shareOf`'s rule.
 *
 * won, one part: the fee the processor kept less the fee the books hold of the dispute, its
 * withdrawal and reinstatement together — expensed out of `1020` where it kept more, and given back
 * into `1020` where it kept less.
 *
 * the groups it answers stay as they were written, and this group is the correction.
 * `('adjustment', sourcePaymentId)`.
 */
export function settleUpEntry(dispute: ClosingDispute, close: DisputeClose) {
	const processorFees = postableId('processorFees');
	const heldFeeMinor = dispute.held
		.filter((line) => line.accountId === processorFees)
		.reduce((sum, line) => sum + line.amountMinor, 0);
	const lines =
		close.outcome === 'won'
			? feeLines(close.feeKeptMinor - heldFeeMinor)
			: lostSettleUpLines(dispute, close, heldFeeMinor);
	if (lines.length === 0) return null;
	return post({
		sourceType: 'adjustment',
		sourceId: dispute.sourcePaymentId,
		currency: close.currency,
		occurredAt: close.occurredAt,
		memo: `dispute on donation ${dispute.donationId} ${close.outcome}: settled up at the close`,
		lines
	});
}

function lostSettleUpLines(
	dispute: ClosingDispute,
	close: Extract<DisputeClose, { outcome: 'lost' }>,
	heldFeeMinor: number
): PostingLine[] {
	const feeOwedMinor = (close.feeMinor ?? 0) - heldFeeMinor;
	const putBackMinor = dispute.amountMinor - (close.amountMinor ?? dispute.amountMinor);
	return [
		...(putBackMinor > 0 ? putBack(withoutReversalFee(dispute.held), putBackMinor) : []),
		...(feeOwedMinor > 0 ? feeLines(feeOwedMinor) : [])
	];
}

/**
 * what an operator does about a settled charge posted with no fee (`feeEntry` above answers null),
 * for the alert both halves of the webhook send about one. the figure has to come from the
 * processor, because this app could not read it, and a correction in /admin/books
 * (../books/correct.ts) posts it as `feeEntry` would have: out of `1020` into processor fees.
 */
export function missingFeeCorrection(processor: string): string {
	const label = (account: { readonly code: string; readonly name: string }) =>
		`${account.code} — ${account.name}`;
	return (
		`Find this payment in the ${processor} dashboard and the fee it states, in the currency the ` +
		`gift was charged in. Keep only a figure ${processor} states for this payment: a fee reported ` +
		'in another currency is not one to convert, because the converted figure is one nobody ' +
		'published. Post it in /admin/books as a correction dated the day the payment settled, out of ' +
		`${label(POSTING_ACCOUNTS.undepositedFunds)} into ${label(POSTING_ACCOUNTS.processorFees)}.`
	);
}

/** a gift an operator entered by hand, as its one entry group needs it. */
export type GiftReceivedInHand = {
	/** the payment the operator recorded — `entry_group.source_id`, the card path's grain. */
	readonly paymentId: string;
	readonly donationId: string;
	/** the fund the gift's one line names. */
	readonly revenueAccountId: PostableAccountId;
	/** minor units, positive. */
	readonly amountMinor: number;
	readonly currency: string;
	/** the gift's own date, which decides the period this lands in. */
	readonly dated: Date;
};

/**
 * the gift recognised, for cash or a cheque received in hand.
 *
 * the debit is `1010 Bank / Cash` rather than `1020`, because no processor stands between the donor
 * and the organisation: the money is in hand, and it is what ties to the bank statement. no fee
 * entry goes beside it — nothing was withheld.
 */
export function receivedInHandEntry(gift: GiftReceivedInHand) {
	return post({
		sourceType: 'payment',
		sourceId: gift.paymentId,
		currency: gift.currency,
		occurredAt: gift.dated,
		memo: `donation ${gift.donationId}`,
		lines: [
			{ accountId: postableId('bankCash'), amountMinor: gift.amountMinor },
			{ accountId: gift.revenueAccountId, amountMinor: -gift.amountMinor }
		]
	});
}
