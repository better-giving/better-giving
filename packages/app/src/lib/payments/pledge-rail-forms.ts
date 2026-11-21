// the Save and Disable presses on /admin/payments' Stocks and IRA (QCD) cards: each form's id and
// schema, which the route's action and the screen each state their `defineForm` with — the form-id
// gate (../../../form-rules.ts) reads a form's id where the form is declared, as
// $lib/matching/forms.ts does for a gift's match.
//
// pure and not under `$lib/server/**`, so a component may import every name here and the browser
// runs the same schema before a press. every box is required, and each blank one is flagged with
// `REQUIRED` at once, the generic word the operator's other forms flag an empty box with.
import { REQUIRED } from '@better-giving/operator/console/org-rules';
import { z } from 'zod';

/** each press's form id. Disable states no box: the rail it turns off is its id. */
export const PLEDGE_RAIL_FORMS = {
	stock: 'payments-stock',
	stockOff: 'payments-stock-off',
	iraQcd: 'payments-ira-qcd',
	iraQcdOff: 'payments-ira-qcd-off'
} as const;

/** far past any brokerage's name or account, short of a pasted page. */
export const MAX_RAIL_DETAIL = 200;

/** a mailing address: a few lines. */
export const MAX_MAILING_ADDRESS = 500;

const detail = (max: number) =>
	z
		.string({ error: REQUIRED })
		.trim()
		.min(1, { error: REQUIRED, abort: true })
		.max(max, { error: `must be at most ${max} characters` });

/** where a donor's broker transfers shares. */
export const STOCK_RAIL_INPUT = z.object({
	brokerage_name: detail(MAX_RAIL_DETAIL),
	dtc_number: detail(MAX_RAIL_DETAIL),
	account_number: detail(MAX_RAIL_DETAIL),
	account_name: detail(MAX_RAIL_DETAIL)
});

/** who an IRA custodian's check is made out to, and where it is mailed. */
export const IRA_QCD_RAIL_INPUT = z.object({
	payee_name: detail(MAX_RAIL_DETAIL),
	// a textarea submits its line breaks as CRLF; stored as LF, the one break the donor's pending
	// screen and the emails print.
	mailing_address: detail(MAX_MAILING_ADDRESS).transform((text) => text.replace(/\r\n?/g, '\n'))
});

/** Disable: nothing to state. */
export const DISABLE_RAIL_INPUT = z.object({});
