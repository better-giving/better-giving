import { Divider, Heading, Layout, Paragraph, SmallPrint } from '../components/layout';
import { RecordPanel, type RecordRow, recordLines } from '../components/record';
import { formatDate, formatMoney } from '../format';
import type { EmailTemplate } from '../template';
import { EMPLOYER_SUBJECT_MAX, employerName, singleLine } from './employer';
import { GiftPageSentence, giftPageLine } from './gift-page';
import { greetingFor } from './greeting';

// the match pack: what a donor who named their employer hands that employer's giving portal, sent
// once, as soon as the employer is named.
//
// pure, the same discipline ./receipt.tsx states: a model in, a subject and two arms out, no
// database, no clock, no I/O. the caller reads the rows and decides whether the pack may be sent.
//
// the nonprofit is the filer, so the block names it by its legal name, the one a portal matches an
// EIN against. it claims nothing about the employer: no ratio, no cap, no deadline — those live in
// the employer's portal, and a mail that guessed one would be the mail a donor quotes back.
//
// the employer reaches this donor's own mail and nowhere else (AGENTS.md → Product surface).

/** who the donor files for: the nonprofit, as its registration names it. */
export interface MatchFiler {
	/** `org_profile.legal_name`, proven non-blank by the caller. */
	readonly legalName: string;
	/** `org_profile.tax_id`, printed exactly as stored, proven non-blank by the caller. */
	readonly ein: string;
	/**
	 * the mailing address on one line, or `null` where the profile holds none — the row is left out
	 * rather than printed blank or guessed.
	 */
	readonly address: string | null;
}

export interface MatchPackData {
	/** who to address it to. `null` prints a neutral greeting rather than "Dear null". */
	readonly donorName: string | null;
	/** the employer the donor named, as typed. capped and kept to one line here. */
	readonly employer: string;
	readonly filer: MatchFiler;
	/** minor units — what is left of the gift after the refunds that stand on it. */
	readonly amountMinor: number;
	/** ISO-4217, uppercase. */
	readonly currency: string;
	/** `donation.received_at` — the date the receipt prints. */
	readonly givenAt: Date;
	/**
	 * when the receipt went out, or `null` where it has not — the row is left out rather than
	 * claiming a receipt the donor cannot find.
	 */
	readonly receiptSentAt: Date | null;
	/** the donor's own page for this gift. built by the caller. */
	readonly giftPageUrl: string;
	/**
	 * whether the one reminder three days on will be sent. `false` drops the promise and the
	 * "stop reminding you" clause, so the pack promises no mail the caller will not send.
	 */
	readonly reminds: boolean;
}

/** the block's labels, in one place so the two arms cannot word the record differently. */
const LABELS = {
	nonprofit: 'Nonprofit',
	ein: 'EIN',
	address: 'Address',
	amount: 'Gift amount',
	date: 'Gift date',
	receipt: 'Receipt'
} as const;

/** the text arm's label column, wide enough for the longest label and two spaces. */
const LABEL_WIDTH = Math.max(...Object.values(LABELS).map((label) => label.length)) + 2;

const LEAD = 'Here is what the portal will ask for:';
const MARK_FILED = 'When you have filed, mark it on your gift page:';
const MARK_FILED_TO_STOP =
	'When you have filed, mark it on your gift page so we stop reminding you:';
const ONE_REMINDER = "We will remind you once, in three days, if it isn't marked filed.";

export function template(data: MatchPackData): EmailTemplate {
	const employer = employerName(data.employer);
	const subject = singleLine(
		`Details to ask ${employerName(data.employer, EMPLOYER_SUBJECT_MAX)} to match your gift`
	);
	const greeting = greetingFor(data.donorName);
	const markFiled = data.reminds ? MARK_FILED_TO_STOP : MARK_FILED;
	const thanks =
		`Thank you for naming your employer. If ${employer} matches gifts, you claim the match ` +
		"yourself through its giving portal. We can't say whether it matches or how much; its " +
		'portal or HR team can.';
	const rows: readonly RecordRow[] = [
		{ label: LABELS.nonprofit, value: data.filer.legalName },
		{ label: LABELS.ein, value: data.filer.ein },
		...(data.filer.address === null ? [] : [{ label: LABELS.address, value: data.filer.address }]),
		{ label: LABELS.amount, value: formatMoney(data.amountMinor, data.currency) },
		{ label: LABELS.date, value: formatDate(data.givenAt) },
		...(data.receiptSentAt === null
			? []
			: [{ label: LABELS.receipt, value: `Emailed to you on ${formatDate(data.receiptSentAt)}` }])
	];

	return {
		subject,
		text: [
			subject,
			'',
			greeting,
			'',
			thanks,
			'',
			LEAD,
			'',
			...recordLines(rows, LABEL_WIDTH),
			'',
			giftPageLine(markFiled, data.giftPageUrl),
			...(data.reminds ? ['', '--', ONE_REMINDER] : [])
		].join('\n'),
		node: (
			<Layout title={subject}>
				<Heading>{subject}</Heading>
				<Paragraph>{greeting}</Paragraph>
				<Paragraph>{thanks}</Paragraph>
				<Paragraph>{LEAD}</Paragraph>
				<RecordPanel lead={null} rows={rows} emphasised={[LABELS.amount]} pinLabels />
				<GiftPageSentence lead={markFiled} url={data.giftPageUrl} />
				{data.reminds ? (
					<>
						<Divider />
						<SmallPrint>{ONE_REMINDER}</SmallPrint>
					</>
				) : null}
			</Layout>
		)
	};
}
