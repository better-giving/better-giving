import { formatMoney } from '../format';

// a gift's amount as the match pack, its reminder, the gift page and its copied details state it:
// what is left of the gift, with what was given beside it where refunds took part of it, because
// the receipt the donor files states what was given.

/** what is left and what was given, each already spelled, where refunds took part of the gift. */
export function amountAfterRefunds(left: string, given: string): string {
	return `${left} after refunds, of ${given} given`;
}

/** the amount spelled as a mail spells money (../format.ts): what is left, and what was given where that is more. */
export function giftAmount(leftMinor: number, givenMinor: number, currency: string): string {
	const left = formatMoney(leftMinor, currency);
	return leftMinor < givenMinor
		? amountAfterRefunds(left, formatMoney(givenMinor, currency))
		: left;
}
