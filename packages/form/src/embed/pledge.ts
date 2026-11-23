// the IRA (QCD) option in the payment box, beside ./stripe.ts, ./paypal.ts and ./chariot.ts and
// presented to the flow by ./surface.ts.
//
// what it collects is `ira_qcd`, one of `PLEDGE_RAILS` in ./rails.ts, and no processor stands behind
// it: the donor's custodian sends the gift later and the organisation's staff mark it received, so
// nothing is confirmed after the save and `confirm` and `resume` below answer nothing. what is left
// for an adapter is the row — one row of ./rows.ts's shape, standing while the flow offers the rail
// (`pledgeIsOffered` in ../checkout.machine.ts, told through `offer`), holding the custodian box and
// the benefits panel the card built (`ira` on `CardView` in ../views.ts).
//
// opening the row is choosing the rail, where the rows beside it choose by their own button: the box
// inside is the rest of the choice. so the rail is reported when the row opens and taken back when it
// closes, whoever closes it. `stock`, the other pledge rail, has no row: its ticker is picked on the
// first step.

import type { CheckoutPorts } from '../ports';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../v1';
import { createRows, type Row, type RowList } from './rows';
import type { PaymentSurface } from './stripe';

/** the payment surface this adapter presents, plus the one thing ./surface.ts tells it. */
export type PledgePaymentSurface = PaymentSurface & {
	/** whether the flow offers IRA (QCD) right now — told on every reading, so a repeat changes nothing. */
	offer(offered: boolean): void;
	/** the one row the panel stands in while it stands, which ./surface.ts opens and closes. */
	readonly rows: RowList;
};

/** the IRA (QCD) option, standing in `mount` while it is offered and holding `panel` inside it. */
export function createPaymentSurface(
	mount: HTMLElement,
	panel: HTMLElement,
	onRail: (rail: PaymentMethod | null) => void
): PledgePaymentSurface {
	const rowList = createRows(mount);
	let row: Row | null = null;
	let stopped = false;

	const settle = (offered: boolean): void => {
		const wanted = offered && !stopped;
		if (wanted && row === null) {
			row = rowList.draw(PAYMENT_METHOD_LABELS.ira_qcd, 'ira', panel, (open) =>
				onRail(open ? 'ira_qcd' : null)
			);
		} else if (!wanted && row !== null) {
			rowList.erase(row);
			row = null;
		}
	};

	// never asked on this rail: the save is the whole press. answered as the answer nobody has, for the
	// reason ./chariot.ts gives.
	const unanswerable: CheckoutPorts['confirm'] = () => Promise.resolve({ kind: 'indeterminate' });

	return {
		confirm: unanswerable,
		resume: () => Promise.resolve({ kind: 'indeterminate' }),
		rows: rowList,
		quoting() {},
		quoted() {},
		// which cadence is offered IRA (QCD) is the flow's answer, carried by `offer` above.
		cadence() {},
		offer: settle,
		stop() {
			stopped = true;
			settle(false);
		}
	};
}
