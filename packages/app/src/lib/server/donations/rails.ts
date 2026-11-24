import { IN_HAND_METHOD_LABELS, IN_HAND_METHODS } from '../../donations/methods';
import { type PaymentMethod, PLEDGE_METHODS } from '../db/schema';

/**
 * what each rail is called on an /admin screen: the gifts list and a gift's own page.
 *
 * the word is resolved in a loader rather than looked up in the page, which is where this parts
 * company with `DONATION_STATUS_LABELS` and `TRIBUTE_KIND_LABELS`: those vocabularies are declared
 * outside `$lib/server/**` because a component may import them, and this one is the `payment`
 * table's own — `PAYMENT_METHODS` in `$lib/server/db/schema.ts`, which a component may not reach at
 * all. so what crosses is the word, and the type is what keeps the table total: a rail added to the
 * column is a compile error here rather than a raw `ach` on a screen.
 *
 * every word is the fundraiser's. `Bank transfer` and never `ACH`, which is the schema's word and
 * exactly the initialism CLAUDE.md keeps off a screen. `PayPal` and `Venmo` are the two a donor
 * read on the button they pressed, so they are what a staff member holding that donor's email
 * hears — and `Venmo` is never `PayPal` here, though PayPal is what settled it.
 *
 * the two rails money arrives on in hand are `IN_HAND_METHOD_LABELS`' words, spread rather than
 * spelled again, so a cheque reads `Cheque` here and on the screen that adds one.
 */
export const RAIL_LABELS: Record<PaymentMethod, string> = {
	...IN_HAND_METHOD_LABELS,
	card: 'Card',
	ach: 'Bank transfer',
	paypal: 'PayPal',
	venmo: 'Venmo',
	daf: 'Donor-advised fund',
	crypto: 'Crypto',
	stock: 'Stocks',
	ira_qcd: 'IRA (QCD)'
};

/**
 * whether the gift is dated by a day rather than an instant: money staff entered in hand, or a stock
 * or IRA (QCD) pledge they marked received (../donations/receive-pledge.ts). both store the day
 * typed at that day's UTC midnight.
 */
export function isDatedByDay(method: PaymentMethod | null | undefined): boolean {
	return method != null && DATED_BY_DAY_METHODS.includes(method);
}

/** the rails `isDatedByDay` answers true for. */
export const DATED_BY_DAY_METHODS: readonly PaymentMethod[] = [
	...IN_HAND_METHODS,
	...PLEDGE_METHODS
];
