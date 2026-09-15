import { Divider, Heading, Layout, Paragraph, SmallPrint } from '../components/layout';
import { formatMoney } from '../format';
import type { EmailTemplate } from '../template';
import { dedicationSentence, NOT_A_TAX_RECEIPT } from './grant';
import type { Dedication } from './receipt';

// the donor's "your fund has the request", sent when they finish in their fund's window and the
// grant is created.
//
// pure, the same discipline ./receipt.tsx states: a model in, a subject and a body out, no
// database, no clock, no I/O. when it is sent, and that it is sent once, is the caller's.
//
// `legalName` arrives proven rather than nullable, for ./uncollected.tsx's reason: a donor cannot
// be told where their gift is going by somebody they cannot identify.
//
// it is not a receipt and says so. the fund has not paid anything yet, and when it does the gift
// was already deducted the day the donor funded their account — ./grant.ts argues the sentence.
// it carries no link and no date the fund will pay by: the timing is the fund's, and "usually
// within a few weeks" is the most this deployment can truthfully say.

export interface GrantRequestedData {
	/** `org_profile.legal_name`, proven non-blank by the caller. */
	readonly legalName: string;
	/** who to address it to. `null` prints a neutral greeting rather than "Dear null". */
	readonly donorName: string | null;
	/** minor units — the gift the fund was asked to grant. */
	readonly amountMinor: number;
	/** ISO-4217, uppercase, as `payment.currency` holds it. */
	readonly currency: string;
	/** who the gift was given in honor or in memory of, or `null` where it was given for nobody. */
	readonly dedication: Dedication | null;
}

/** the notice, as a subject and a body. */
export function template(data: GrantRequestedData): EmailTemplate {
	const amount = formatMoney(data.amountMinor, data.currency);
	const subject = `Your grant request to ${data.legalName} is on its way`;
	const greeting = data.donorName === null ? 'Hello,' : `Dear ${data.donorName},`;
	const said = [
		`Your donor-advised fund has your request to give ${amount} to ${data.legalName}.`,
		dedicationSentence(data.dedication)
	]
		.filter((sentence) => sentence !== null)
		.join(' ');
	const next =
		`Your fund pays ${data.legalName} directly, usually within a few weeks. ` +
		'There is nothing more you need to do.';

	return {
		subject,
		node: (
			<Layout title={subject}>
				<Heading>{subject}</Heading>
				<Paragraph>{greeting}</Paragraph>
				<Paragraph>{said}</Paragraph>
				<Paragraph>{next}</Paragraph>
				<Paragraph>{NOT_A_TAX_RECEIPT}</Paragraph>
				<Divider />
				<SmallPrint>{data.legalName}</SmallPrint>
			</Layout>
		)
	};
}
