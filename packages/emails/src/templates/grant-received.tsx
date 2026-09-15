import { Divider, Heading, Layout, Paragraph, SmallPrint } from '../components/layout';
import { formatMoney } from '../format';
import type { EmailTemplate } from '../template';
import { dedicationSentence, NOT_A_TAX_RECEIPT } from './grant';
import type { Dedication } from './receipt';

// the donor's thank-you once the organisation has the money their fund granted.
//
// pure, the same discipline ./receipt.tsx states: a model in, a subject and a body out, no
// database, no clock, no I/O. when it is sent, and that it is sent once, is the caller's.
//
// `legalName` arrives proven rather than nullable, for ./uncollected.tsx's reason: a donor cannot
// be thanked by somebody they cannot identify.
//
// it is a thank-you and never a receipt, and says so in the words ./grant-requested.tsx used —
// ./grant.ts argues the sentence. the amount is what the fund granted, which is the figure the
// donor saw leave their fund, and not what the organisation netted after anyone's fee.

export interface GrantReceivedData {
	/** `org_profile.legal_name`, proven non-blank by the caller. */
	readonly legalName: string;
	/** who to address it to. `null` prints a neutral greeting rather than "Dear null". */
	readonly donorName: string | null;
	/** minor units — the gift the fund granted. */
	readonly amountMinor: number;
	/** ISO-4217, uppercase, as `payment.currency` holds it. */
	readonly currency: string;
	/** who the gift was given in honor or in memory of, or `null` where it was given for nobody. */
	readonly dedication: Dedication | null;
}

/** the thank-you, as a subject and a body. */
export function template(data: GrantReceivedData): EmailTemplate {
	const amount = formatMoney(data.amountMinor, data.currency);
	const subject = `${data.legalName} received your gift`;
	const greeting = data.donorName === null ? 'Hello,' : `Dear ${data.donorName},`;
	const said = [
		`Thank you for your gift. The ${amount} from your donor-advised fund has arrived at ` +
			`${data.legalName}.`,
		dedicationSentence(data.dedication)
	]
		.filter((sentence) => sentence !== null)
		.join(' ');

	return {
		subject,
		node: (
			<Layout title={subject}>
				<Heading>{subject}</Heading>
				<Paragraph>{greeting}</Paragraph>
				<Paragraph>{said}</Paragraph>
				<Paragraph>{NOT_A_TAX_RECEIPT}</Paragraph>
				<Divider />
				<SmallPrint>{data.legalName}</SmallPrint>
			</Layout>
		)
	};
}
