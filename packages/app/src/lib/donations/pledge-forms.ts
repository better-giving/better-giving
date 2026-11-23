// Mark received on the Gifts screen's "Waiting to arrive" card: the form's id and schema, which the
// route's action and the dialog each state their `defineForm` with, as $lib/matching/forms.ts does
// for a gift's match. pure and not under `$lib/server/**`, so a component may import every name here.
//
// the value and the day are Add donation's own rules (`GIFT_FIELD_RULES` in ./input-schema.ts): a
// received pledge is a gift in hand, positive, at most the currency's decimals, dated a calendar
// day no later than tomorrow UTC (`latestAccountingDay` in $lib/ledger/input-schema.ts).
import { z } from 'zod';
import { GIFT_FIELD_RULES } from './input-schema';

export const MARK_RECEIVED_FORM_ID = 'pledge-received';

/** what a press naming no pledge on the card is told. the id is hidden, so a reload is the fix. */
export const STALE_PLEDGE = 'This page did not say which pledge arrived. Reload it and try again.';

export const MARK_RECEIVED_INPUT = z.object({
	/** the pledge, carried hidden from the row whose button opened the dialog. */
	pledge_id: z.string({ error: STALE_PLEDGE }).trim().min(1, { error: STALE_PLEDGE }),
	/** "Value received": the dollar value on the day it arrived, which staff enter. */
	value: GIFT_FIELD_RULES.amount,
	/** "Date received". */
	received_on: GIFT_FIELD_RULES.received_on
});
