import { Divider, Heading, Layout, Paragraph, SmallPrint } from '../components/layout';
import { formatDate, formatMoney } from '../format';
import type { EmailTemplate } from '../template';
import { employerName, singleLine } from './employer';
import { GiftPageSentence, giftPageLine } from './gift-page';
import { greetingFor } from './greeting';

// the one reminder to file an employer match, sent once, three days after ./match-pack.tsx, to a
// donor who has not marked the gift filed.
//
// pure, the same discipline ./receipt.tsx states. whether it is due, and that it goes once, is the
// caller's. it repeats none of the filing details: the gift page holds them, and a second copy
// here would be one more copy to drift. no ratio and no deadline, for ./match-pack.tsx's reason.

export interface MatchReminderData {
	/** what the organisation is called in prose — the subject names it, and nothing here files it. */
	readonly displayName: string;
	/** who to address it to. `null` prints a neutral greeting rather than "Dear null". */
	readonly donorName: string | null;
	/** the employer the donor named, as typed. capped and kept to one line here. */
	readonly employer: string;
	/** minor units — the gift as the receipt states it. */
	readonly amountMinor: number;
	/** ISO-4217, uppercase. */
	readonly currency: string;
	/** `donation.received_at` — the date the receipt prints. */
	readonly givenAt: Date;
	/** the donor's own page for this gift. built by the caller. */
	readonly giftPageUrl: string;
}

const MARK_IT = "If you already filed, mark it there and we won't write again.";
const ONLY_ONE = 'This is the only reminder we will send.';

export function template(data: MatchReminderData): EmailTemplate {
	const subject = singleLine(`Did you file the match for your gift to ${data.displayName}?`);
	const greeting = greetingFor(data.donorName);
	const lead =
		`You told us ${employerName(data.employer)} may match your ` +
		`${formatMoney(data.amountMinor, data.currency)} gift from ${formatDate(data.givenAt)}. ` +
		"If you haven't filed yet, the details are on your gift page:";

	return {
		subject,
		text: [
			subject,
			'',
			greeting,
			'',
			giftPageLine(lead, data.giftPageUrl),
			'',
			MARK_IT,
			'',
			'--',
			ONLY_ONE
		].join('\n'),
		node: (
			<Layout title={subject}>
				<Heading>{subject}</Heading>
				<Paragraph>{greeting}</Paragraph>
				<GiftPageSentence lead={lead} url={data.giftPageUrl} />
				<Paragraph>{MARK_IT}</Paragraph>
				<Divider />
				<SmallPrint>{ONLY_ONE}</SmallPrint>
			</Layout>
		)
	};
}
