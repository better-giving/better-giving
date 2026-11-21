import { formatMinor } from './money';
import { sharesText } from './shares';

// what a donor pledged on the stock or IRA (QCD) rail, in the words the Gifts screen and the
// donor's receipt both print — `50 shares of AAPL`, `$5,000.00 from Fidelity Investments` — in the
// one place a loader, a component and the mail may import from.

/** shares of a ticker, as `pledge.shares_millionths` holds them. */
export type PledgedShares = { readonly ticker: string; readonly sharesMillionths: number };

/** `50 shares of AAPL`, `1 share of AAPL`, `0.5 shares of AAPL`. */
export function sharesPhrase({ ticker, sharesMillionths }: PledgedShares): string {
	const shares = sharesText(sharesMillionths);
	return `${shares} ${shares === '1' ? 'share' : 'shares'} of ${ticker}`;
}

/** what one pledge names: shares of a ticker, or an amount from the donor's IRA custodian. */
export function pledgedPhrase(
	pledged:
		| ({ readonly method: 'stock' } & PledgedShares)
		| {
				readonly method: 'ira_qcd';
				readonly amountMinor: number;
				readonly currency: string;
				readonly custodian: string;
		  }
): string {
	return pledged.method === 'stock'
		? sharesPhrase(pledged)
		: `${formatMinor(pledged.amountMinor, pledged.currency)} from ${pledged.custodian}`;
}
