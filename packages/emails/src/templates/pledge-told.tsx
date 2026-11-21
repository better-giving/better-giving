import { formatMoney } from '../format';
import { Divider, Heading, Layout, Paragraph, SmallPrint } from '../components/layout';
import type { EmailTemplate } from '../template';
import { Facts, FOOTER } from './admin-alert';

// the mail that tells the organisation a donor has asked their broker or IRA custodian to send a
// pledged gift — the donor's "I've contacted my broker" or "I've asked my custodian".
//
// sent once per pledge, to the same address as ./admin-alert.tsx and in the same voice, with the
// same labelled facts so the reference can be read character by character against a transfer.
//
// a stock pledge states shares and no dollar figure anywhere: nothing has been valued until the
// shares arrive, and a share count printed as money is the mistake this mail exists not to make.
//
// pure, the same as the alert: a model in, a subject and a body out.

/** what the donor pledged, as the mail states it. */
export type PledgedGift =
	| { readonly method: 'stock'; readonly ticker: string; readonly shares: string }
	| {
			readonly method: 'ira_qcd';
			readonly amountMinor: number;
			readonly currency: string;
			readonly custodian: string;
	  };

export interface PledgeToldData {
	readonly donorName: string;
	/** null where the donor's record holds no address. */
	readonly donorEmail: string | null;
	/** what the donor quotes on the transfer: `CFCP-AAPL-7Q2D`. */
	readonly reference: string;
	readonly pledged: PledgedGift;
}

/** a donor's pledge on its way: who, what, the reference to match it by, and what happens next. */
export function template(data: PledgeToldData): EmailTemplate {
	const what = pledgedWords(data.pledged);
	const coming = `${what} ${isOne(data.pledged) ? 'is' : 'are'} on the way`;
	const subject = `${data.donorName} says ${coming}`;
	return {
		subject,
		node: (
			<Layout title={subject}>
				<Heading>{subject}</Heading>
				<Paragraph>{asked(data.donorName, data.pledged, what)}</Paragraph>
				<Facts
					facts={[
						{
							label: 'Donor',
							value:
								data.donorEmail === null ? data.donorName : `${data.donorName} (${data.donorEmail})`
						},
						{ label: 'Pledged', value: what },
						{ label: 'Reference', value: data.reference }
					]}
				/>
				<Paragraph>
					{data.pledged.method === 'stock'
						? 'The gift counts toward your totals once you mark it received on Gifts, at its value on the day the shares arrive. The donor’s receipt goes then.'
						: 'The gift counts toward your totals once you mark it received on Gifts, at the amount the check is for. The donor’s receipt goes then.'}
				</Paragraph>
				<Divider />
				<SmallPrint>{FOOTER}</SmallPrint>
			</Layout>
		)
	};
}

/** `50 shares of AAPL`, `1 share of AAPL`, `USD 5,000.00 from Fidelity Investments`. */
function pledgedWords(pledged: PledgedGift): string {
	if (pledged.method === 'stock') {
		return `${pledged.shares} ${isOne(pledged) ? 'share' : 'shares'} of ${pledged.ticker}`;
	}
	return `${formatMoney(pledged.amountMinor, pledged.currency)} from ${pledged.custodian}`;
}

/** whether the subject's verb is singular: one share, or an amount. */
function isOne(pledged: PledgedGift): boolean {
	return pledged.method !== 'stock' || pledged.shares === '1';
}

function asked(donorName: string, pledged: PledgedGift, what: string): string {
	return pledged.method === 'stock'
		? `${donorName} has asked their broker to transfer ${what} to your brokerage account, quoting the reference below.`
		: `${donorName} has asked their IRA custodian to send ${what}, quoting the reference below.`;
}
