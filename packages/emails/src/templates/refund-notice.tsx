import { Divider, Heading, Layout, Paragraph, SmallPrint } from '../components/layout';
import { formatDate, formatMoney } from '../format';
import type { EmailTemplate } from '../template';

// the donor's "we have refunded your gift" — a short notice, not a second receipt.
//
// pure, the same discipline ./receipt.tsx states: a model in, a subject and a body out, no
// database, no clock, no I/O. the caller works out every figure and decides whether this is a
// message worth sending; this decides only what it says.
//
// it carries two figures and names the gift they belong to. the receipt the donor already holds
// states the whole gift, and it is the document they file, so the second figure is the one that
// replaces it — said as a number even when it is zero, because "nothing" printed as USD 0.00 is
// the reading a donor cannot get wrong. it is not re-issued as a receipt: no tax id, no
// goods-or-services statement, nothing a donor could file as a second acknowledgement of money
// the organisation no longer holds.
//
// a gift refunded in parts gets one notice per part, each naming its own part and the remainder
// after it. the subject says "part of" while anything is left, which is what lets the last part's
// notice read as the gift refunded. it reads `remainingMinor` for that, never `deductibleMinor`: a
// gift with a part that was never deductible has nothing deductible long before nothing is left.
//
// `legalName` arrives proven, as it does for ./uncollected.tsx: a donor told about money leaving
// their gift by somebody they cannot identify has been told nothing, and that refusal is the app's.

export interface RefundNoticeData {
	/** `org_profile.legal_name`, proven non-blank by the caller. */
	readonly legalName: string;
	/** who to address it to. `null` prints a neutral greeting rather than "Dear null". */
	readonly donorName: string | null;
	/** minor units — what the gift collected, which is how the donor recognises it. */
	readonly giftMinor: number;
	/** when the gift was made. */
	readonly givenAt: Date;
	/** minor units — this refund alone, never the running total of every refund. */
	readonly refundedMinor: number;
	/**
	 * minor units — what the gift collected less every refund of it that stands, this one included;
	 * zero once the whole gift is refunded. a dispute still open takes nothing off it. never printed —
	 * it picks the subject.
	 */
	readonly remainingMinor: number;
	/**
	 * minor units — `remainingMinor` less the part of the gift that was never deductible
	 * (`donation.non_deductible_minor`), never below zero. zero does not mean the whole gift was
	 * refunded.
	 */
	readonly deductibleMinor: number;
	/** ISO-4217, uppercase, as `payment.currency` holds it. every figure above is in it. */
	readonly currency: string;
}

/** the notice, as a subject and a body. */
export function template(data: RefundNoticeData): EmailTemplate {
	const refunded = formatMoney(data.refundedMinor, data.currency);
	const deductible = formatMoney(data.deductibleMinor, data.currency);
	const gift = `your gift of ${formatMoney(data.giftMinor, data.currency)}, made on ${formatDate(data.givenAt)}`;
	const subject =
		data.remainingMinor === 0
			? `Your gift to ${data.legalName} has been refunded`
			: `Part of your gift to ${data.legalName} has been refunded`;
	const greeting = data.donorName === null ? 'Hello,' : `Dear ${data.donorName},`;
	const said =
		data.refundedMinor === data.giftMinor
			? `We have refunded ${gift}.`
			: `We have refunded ${refunded} of ${gift}.`;
	const figure =
		`For your tax records, the deductible amount of this gift is now ${deductible}. ` +
		'Use this amount in place of the one on your original receipt.';

	return {
		subject,
		node: (
			<Layout title={subject}>
				<Heading>{subject}</Heading>
				<Paragraph>{greeting}</Paragraph>
				<Paragraph>{said}</Paragraph>
				<Paragraph>{figure}</Paragraph>
				<Paragraph>There is nothing you need to do.</Paragraph>
				<Divider />
				<SmallPrint>{data.legalName}</SmallPrint>
			</Layout>
		)
	};
}
