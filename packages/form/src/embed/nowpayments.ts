// the crypto option in the payment box, beside ./stripe.ts, ./paypal.ts and ./chariot.ts and
// presented to the flow by ./surface.ts.
//
// what it collects is `crypto` (`NOWPAYMENTS_RAILS` in ./rails.ts), and there is no processor script
// behind it: the quote mints an address and the donor sends the coin from their own wallet, so nothing
// is confirmed after the quote and `confirm` and `resume` below answer nothing. what is left for an
// adapter is the row — one row of ./rows.ts's shape, standing while the flow offers the rail
// (`cryptoIsOffered` in ../checkout.machine.ts, told through `offer`), holding the coin list the card
// built (`coins` on `CardView` in ../views.ts).
//
// opening the row is choosing the rail, which is where it differs from the rows beside it: the coin
// list inside is the rest of the choice rather than a processor's button that makes it. so the rail is
// reported when the row opens and taken back when it closes, whoever closes it — the donor, a
// neighbour opening, or the option leaving the box with a repeating cadence.

import type { CheckoutPorts, ConfirmOutcome } from '../ports';
import type { PaymentMethod } from '../v1';
import { createRows, type Row, type RowList } from './rows';
import type { PaymentSurface } from './stripe';

/** what a donor reads on the row, which is `PAYMENT_METHOD_LABELS.crypto` in ../v1.ts. */
const ROW_NAME = 'Crypto';

/** the payment surface this adapter presents, plus the one thing ./surface.ts tells it. */
export type NowpaymentsPaymentSurface = PaymentSurface & {
	/** whether the flow offers crypto right now — told on every reading, so a repeat changes nothing. */
	offer(offered: boolean): void;
	/** the one row the coin list stands in while it stands, which ./surface.ts opens and closes. */
	readonly rows: RowList;
};

/** the crypto option, standing in `mount` while it is offered and holding `coins` inside it. */
export function createPaymentSurface(
	mount: HTMLElement,
	coins: HTMLElement,
	onRail: (rail: PaymentMethod | null) => void
): NowpaymentsPaymentSurface {
	const rowList = createRows(mount);
	let row: Row | null = null;
	let stopped = false;

	const settle = (offered: boolean): void => {
		const wanted = offered && !stopped;
		if (wanted && row === null) {
			row = rowList.draw(ROW_NAME, 'crypto', coins, (open) => onRail(open ? 'crypto' : null));
		} else if (!wanted && row !== null) {
			rowList.erase(row);
			row = null;
		}
	};

	// never asked on this rail: the quote is the whole press. answered as the answer nobody has, for
	// the reason ./chariot.ts gives.
	const unanswerable: CheckoutPorts['confirm'] = (): Promise<ConfirmOutcome> =>
		Promise.resolve({ kind: 'indeterminate' });

	return {
		confirm: unanswerable,
		resume: () => Promise.resolve({ kind: 'indeterminate' }),
		rows: rowList,
		quoted() {},
		// which cadence is offered crypto is the flow's answer, carried by `offer` below.
		cadence() {},
		offer: settle,
		stop() {
			stopped = true;
			settle(false);
		}
	};
}
