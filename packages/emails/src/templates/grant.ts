import { midSentence } from './dedication';
import type { Dedication } from './receipt';

// what ./grant-requested.tsx and ./grant-received.tsx say alike, so the two mails a donor gets
// about one gift from their fund cannot word the same fact two ways.

/**
 * why neither mail is a receipt, in the words both carry.
 *
 * a gift from a donor-advised fund was deducted when the donor put the money into the fund, and
 * the fund's sponsor issued the receipt for that. a second document from the organisation reading
 * like one is a second deduction somebody's return claims, so both mails say plainly what they are
 * not, and neither carries the receipt's goods-or-services statement or keep-this line.
 */
export const NOT_A_TAX_RECEIPT =
	'This email is not a tax receipt. Your tax deduction was for the contribution you made to ' +
	'your fund, and the sponsor of your fund receipted that.';

/**
 * the dedication as a sentence of its own, or `null` where the gift was given for nobody.
 *
 * tense-free, because one mail is sent before the fund pays and the other after, and the same
 * sentence serves both.
 */
export function dedicationSentence(dedication: Dedication | null): string | null {
	return dedication === null
		? null
		: `The gift is ${midSentence(dedication.label)} ${dedication.honoree}.`;
}
