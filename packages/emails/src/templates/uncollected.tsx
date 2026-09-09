import { Divider, Heading, Layout, Paragraph, SmallPrint } from '../components/layout';
import { formatMoney } from '../format';
import type { EmailTemplate } from '../template';

// the donor's "we could not collect your gift".
//
// pure, the same discipline ./receipt.tsx states: a model in, a subject and a body out, no
// database, no clock, no I/O. the caller reads the rows and decides whether this is a message
// worth sending at all, and that decision is a narrow one.
//
// `legalName` arrives proven rather than nullable, which is the one refusal this message has and
// it stays with the caller: a donor cannot be told a payment failed by somebody they cannot
// identify, so a deployment with no registered name saved writes no notice — and the words for
// that gap, and the operator it reaches, are the app's.

export interface UncollectedData {
	/** `org_profile.legal_name`, proven non-blank by the caller. */
	readonly legalName: string;
	/** who to address it to. `null` prints a neutral greeting rather than "Dear null". */
	readonly donorName: string | null;
	/** minor units — what the donor agreed to give and was not charged. */
	readonly amountMinor: number;
	/** ISO-4217, uppercase, as `payment.currency` holds it. */
	readonly currency: string;
}

/** the notice, as a subject and a body. */
export function template(data: UncollectedData): EmailTemplate {
	const amount = formatMoney(data.amountMinor, data.currency);
	const subject = `Your gift to ${data.legalName} did not go through`;
	const greeting = data.donorName === null ? 'Hello,' : `Dear ${data.donorName},`;
	// the instrument is named because it is the whole explanation: this message reaches a donor on
	// one rail only, a bank debit that ended after they left the form, and "your payment" would
	// leave them guessing which card it was.
	const said =
		`The ${amount} bank debit for your gift to ${data.legalName} did not go through, so the gift ` +
		'was not made. Nothing was charged and no money has left your account.';
	const closed =
		'There is nothing you need to do. If you would still like to give, you can make ' +
		'the gift again.';

	return {
		subject,
		node: (
			<Layout title={subject}>
				<Heading>{subject}</Heading>
				<Paragraph>{greeting}</Paragraph>
				<Paragraph>{said}</Paragraph>
				<Paragraph>{closed}</Paragraph>
				<Divider />
				<SmallPrint>{data.legalName}</SmallPrint>
			</Layout>
		)
	};
}
