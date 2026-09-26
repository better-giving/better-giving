import { refundNotice } from '@better-giving/emails';

// the notice a donor gets when part of a gift is refunded: the part, and what of the gift is now
// deductible. a full refund names the gift alone and zero as deductible, and its subject drops
// "part of".
export default function RefundNotice() {
	return refundNotice.template({
		legalName: 'Hope Foundation',
		donorName: 'Ada Lovelace',
		giftMinor: 10_000,
		givenAt: new Date('2026-08-03T12:00:00Z'),
		refundedMinor: 2_500,
		remainingMinor: 7_500,
		deductibleMinor: 7_500,
		currency: 'USD'
	}).node;
}
