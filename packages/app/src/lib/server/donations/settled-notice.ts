import { formatMoney } from '@better-giving/emails';
import { TRIBUTE_KIND_LABELS, type TributeKind } from '@better-giving/form/v1';
import { alert, type SettleDeps } from './delivery';
import type { ReceiptOutcome } from './receipt';

// the organisation's own news that a gift reached the books — one message per settled gift, at the
// moment the donor's receipt goes.
//
// it is a module of its own for the reason ./receipt.ts is one: both halves of the webhook end at
// it and neither may import the other. ./settle.ts settles a one-off gift against the payment row a
// quote minted and ./collect.ts writes a collection under a standing commitment, so the step they
// share is lifted out rather than reached across.
//
// ---------------------------------------------------------------------------
// it is `alert` (./delivery.ts) rather than a sender of its own, and the reuse is the decision.
//
// where it goes, the silence where no address is saved, and the sentence reaching the logs either
// way are all properties of that one pipe, and a second pipe would be a second set of them to keep
// true. what is new here is only the genre: every other caller of it reports a fault, and this one
// reports a gift that worked — which is why `action` is null. the template renders that field as
// "What to do:", and there is nothing to do about good news.
//
// ---------------------------------------------------------------------------
// it fires whether or not the donor is being receipted, and that is the case it was added for.
//
// a donor who gave no address is receipted by nothing, so before this message a gift from one was
// completely silent: money in the books, the books balanced, and not a word to anybody. so the
// notice goes anyway and says in its own sentence that no receipt went with it — which is the only
// place that fact is ever stated, since an unaddressed donor is not a fault and leaves no alert
// behind.
//
// which case that is comes from `sendReceipt`'s own answer and is never re-derived here. the two
// modules would otherwise hold one rule in two places, and this is the one where drift is silent:
// nothing would break, the message would simply tell an operator something untrue about whether
// their donor was written to, which is the exact failure this file exists to prevent. every other
// way of not sending is `not_sent` and says nothing extra — those arms have already alerted on
// their own (./receipt.ts), and repeating them here would be two mails about one failure.
//
// ---------------------------------------------------------------------------
// a repeating gift is announced once, on the charge that opens it — and that is enforced here.
//
// the commitment starting is the news; charge fifty is the commitment doing what it was set up to
// do. a notice on every collection would mail the organisation monthly, forever, per donor, about
// money nobody has to act on — which is how an address stops being read. the donor's own receipt is
// unaffected and still goes on every collection.
//
// so `repeating` names all three cases a caller can be in and `'later'` returns before anything is
// composed, rather than the callers deciding whether to call at all. a caller that knows which
// charge it is cannot get the rule wrong, and a write path added to ./collect.ts later inherits it
// instead of having to be told — which is the failure worth designing against, because nothing
// about it is visible until an operator's inbox has a year of monthly mail in it.
//
// ---------------------------------------------------------------------------
// nothing here throws. it is sent after the batch that banked the gift, so a throw would be a 500
// the processor reads as "deliver this again" for three days against a posting the constraint
// refuses every time — the gift banked and the donor receipted twice. `alert` logs its headline and
// facts before it reaches the transport, so a fault leaves the sentence in the logs.
//
// ---------------------------------------------------------------------------
// the note and the dedication are the donor's own words, and they are on this message so that an
// organisation reads them without opening the dashboard. a dedication in particular is what a
// fundraiser writes back about, and a gift that has one is the gift most likely to be answered by
// hand. both are required keys with nullable values, for the reason `ReceiptTarget.tribute` in
// ./receipt.ts gives: a caller that has one and forgets it is a compile error rather than a notice
// quietly missing what the donor said. the dedication is worded by the expression the receipt
// adapter writes (../email/receipt.ts), so one gift is not worded two ways.
//
// ---------------------------------------------------------------------------
// and unlike the receipt, a notice that does not go is gone. `donation.receipt_sent_at` is a
// backlog a person can work through; this message has no column, and it cannot have one that means
// anything — the gift is committed before it is composed, and a redelivery is answered
// `already_posted` above the step that sends it (./settle.ts, ./collect.ts), so a worker that dies
// in between loses the notice with nothing recording that it was owed. that is the trade a courtesy
// message is worth: the money is in the books either way, and the gift is on the Gifts screen
// whether or not anybody was mailed about it.

/**
 * where one settled gift sits in a series, which is the whole of what decides whether this is news.
 *
 *   none  — a one-off gift. every one is announced.
 *   first — the collection that opened a commitment, and the only one under it that is announced.
 *   later — every collection after it, which is announced to nobody.
 *
 * three states rather than a boolean because there are three: a one-off gift and a later collection
 * are not the same thing said twice, and the fact line below reads differently for each.
 */
export type Repeating = 'none' | 'first' | 'later';

/** one gift that settled, as the people who run this deployment want to hear it. */
export type SettledGift = {
	readonly amountMinor: number;
	readonly currency: string;
	/** `null` is a donor whose record carries no name — the notice says so rather than "null". */
	readonly donorName: string | null;
	/** `null` is a donor nobody has an address for. what that meant for the receipt is `receipt`. */
	readonly donorEmail: string | null;
	/** the name an operator gave the form, never its id: the id is not a thing they have seen. */
	readonly formName: string | null;
	readonly repeating: Repeating;
	/** what ./receipt.ts answered for this same gift, read rather than guessed at. */
	readonly receipt: ReceiptOutcome;
	/** `donation.note` — anything the donor wanted to say, never parsed. `null` where they said nothing. */
	readonly note: string | null;
	/**
	 * who the gift was given in honor or in memory of, narrowed off the gift's own columns by
	 * `projectTribute` in `$lib/donations/tributes.ts`, or `null` where it was given for nobody.
	 *
	 * the honoree and nothing else. the person the donor asked us to tell is written to by
	 * ./tribute-notice.ts and is not named here: this message is the organisation's own news.
	 */
	readonly tribute: { readonly kind: TributeKind; readonly honoree: string } | null;
};

/** how a gift's place in a series reads to somebody who did not set it up. */
function seriesFact(repeating: Repeating): string {
	switch (repeating) {
		case 'none':
			return 'no';
		case 'first':
			return 'yes, this is its first collection';
		// unreachable: a later collection returns before any of this is composed. it is spelled out
		// rather than defaulted so that a state added to `Repeating` stops the type check here.
		case 'later':
			return 'yes';
	}
}

/**
 * tells the organisation a gift is in the books, and says when nobody was receipted for it.
 *
 * called on every settled gift, including the collections it says nothing about — see the header
 * for why the once-rule is refused here rather than asked of the callers.
 */
export async function sendSettledNotice(deps: SettleDeps, gift: SettledGift): Promise<void> {
	if (gift.repeating === 'later') return;

	const sentence = [
		'The gift is in the books. Open Gifts in /admin to see it with the donor and the payment ' +
			'behind it.'
	];
	if (gift.receipt === 'no_address') {
		sentence.push('The donor gave no email address, so no receipt was sent.');
	}

	try {
		await alert(deps, {
			headline: `A gift of ${formatMoney(gift.amountMinor, gift.currency)} was received`,
			body: sentence.join(' '),
			facts: [
				{ label: 'Amount', value: formatMoney(gift.amountMinor, gift.currency) },
				{ label: 'Donor', value: gift.donorName ?? 'no name recorded' },
				{ label: 'Donor email', value: gift.donorEmail ?? 'none given' },
				{ label: 'Form', value: gift.formName ?? 'no form recorded' },
				{ label: 'Repeating gift', value: seriesFact(gift.repeating) },
				// only where the donor said something: an empty "Dedication:" row reads as a gift given
				// for nobody in particular, which is a different statement from saying nothing.
				...(gift.tribute === null
					? []
					: [
							{
								label: 'Dedication',
								value: `${TRIBUTE_KIND_LABELS[gift.tribute.kind]} ${gift.tribute.honoree}`
							}
						]),
				...(gift.note === null ? [] : [{ label: 'Note', value: gift.note }])
			],
			action: null
		});
	} catch {
		// nothing to report it to, and nothing on this path may throw.
	}
}
