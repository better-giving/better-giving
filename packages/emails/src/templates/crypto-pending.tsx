import type { CSSProperties } from 'react';
import { Divider, Heading, Layout, Paragraph, SmallPrint } from '../components/layout';
import { formatDateTime } from '../format';
import type { EmailTemplate } from '../template';
import { box, FONT_MONO, PANEL_BG, SPACE_2, SPACE_4, SPACE_6, SPACE_8 } from '../tokens';

// the donor's "here is where to send your crypto gift", sent when they are shown an address.
//
// pure, the same discipline ./receipt.tsx states: a model in, a subject and two arms out, no
// database, no clock, no I/O. when it is sent, and that it is sent once, is the caller's.
//
// `legalName` arrives proven rather than nullable, for ./uncollected.tsx's reason: a donor cannot
// be told where to send money by somebody they cannot identify.
//
// it is not a receipt and says so: nothing has arrived. it states no dollar figure either — the
// gift is recorded at the value of what arrives, which nobody knows yet.
//
// everything a donor copies is text, set in monospace: ../components/layout.tsx carries no image.

export interface CryptoPendingData {
	/** `org_profile.legal_name`, proven non-blank by the caller. */
	readonly legalName: string;
	/** who to address it to. `null` prints a neutral greeting rather than "Dear null". */
	readonly donorName: string | null;
	/** the coin as a donor reads it — `Tether USD`, never the processor's code. */
	readonly coinName: string;
	/** the network the coin travels on, printed beside the coin's name as it arrives. */
	readonly network: string;
	/** a canonical decimal string, printed verbatim: never parsed, so never rounded. */
	readonly coinAmount: string;
	readonly address: string;
	/** the memo the payment carries, or `null` where it carries none. */
	readonly memo: string | null;
	/** whether a payment sent without `memo` cannot be matched to the gift. */
	readonly memoRequired: boolean;
	/** when the address stops taking this gift. */
	readonly validUntil: Date;
}

/**
 * the labels, in one place so the two arms cannot word the block differently.
 *
 * `Amount today` names the figure as today's: it was priced when the address was made, and what
 * arrives is what the gift records.
 */
const LABELS = {
	coin: 'Coin',
	amount: 'Amount today',
	address: 'Address',
	memo: 'Memo',
	sendBy: 'Send by'
} as const;

const LABEL_WIDTH = Math.max(...Object.values(LABELS).map((label) => label.length)) + 2;

const LEAD = 'Where to send it:';

/** the notice, as a subject and two arms. */
export function template(data: CryptoPendingData): EmailTemplate {
	const subject = `Send your ${data.coinName} gift to ${data.legalName}`;
	const greeting = data.donorName === null ? 'Hello,' : `Dear ${data.donorName},`;
	const said = `Thank you for giving to ${data.legalName}. Your gift is made when the coins below arrive.`;
	const rows: readonly Row[] = [
		{ label: LABELS.coin, value: `${data.coinName} (${data.network} network)` },
		{ label: LABELS.amount, value: data.coinAmount },
		{ label: LABELS.address, value: data.address },
		...(data.memo === null ? [] : [{ label: LABELS.memo, value: data.memo }]),
		{ label: LABELS.sendBy, value: formatDateTime(data.validUntil) }
	];
	// the two things that lose a gift outright, stated before anything softer.
	const warnings = [
		`Send on the ${data.network} network only. Coins sent on any other network cannot be received.`,
		...(data.memo !== null && data.memoRequired
			? ['Include the memo when you send. A payment without it cannot be matched to your gift.']
			: [])
	];
	const valued =
		'The amount is priced at today’s rate. Your gift is recorded at the value of what arrives.';
	const copy: Copy = { greeting, said, rows, warnings, valued };

	return {
		subject,
		text: textArm(copy, data.legalName),
		node: (
			<Layout title={subject}>
				<Heading>{subject}</Heading>
				<Paragraph>{greeting}</Paragraph>
				<Paragraph>{said}</Paragraph>
				<Panel rows={rows} />
				{warnings.map((warning) => (
					<Paragraph key={warning}>
						<strong>{warning}</strong>
					</Paragraph>
				))}
				<Paragraph>{valued}</Paragraph>
				<Paragraph>{NOT_A_RECEIPT}</Paragraph>
				<Divider />
				<SmallPrint>{data.legalName}</SmallPrint>
			</Layout>
		)
	};
}

/** nothing has arrived, so nothing may read as receipted. */
export const NOT_A_RECEIPT = 'This email is not a receipt. Nothing has arrived yet.';

interface Row {
	readonly label: string;
	readonly value: string;
}

interface Copy {
	readonly greeting: string;
	readonly said: string;
	readonly rows: readonly Row[];
	readonly warnings: readonly string[];
	readonly valued: string;
}

/**
 * the plain-text arm, handed over rather than stripped: a stripper runs the block's cells into one
 * line, and an address a donor copies out of it has to sit on a line of its own with nothing
 * glued to either end.
 */
function textArm(copy: Copy, legalName: string): string {
	return [
		copy.greeting,
		'',
		copy.said,
		'',
		LEAD,
		'',
		...copy.rows.map(({ label, value }) => `${label.padEnd(LABEL_WIDTH)}${value}`),
		'',
		...copy.warnings.flatMap((warning) => [warning, '']),
		copy.valued,
		'',
		NOT_A_RECEIPT,
		'',
		'--',
		legalName
	].join('\n');
}

/** ./receipt.tsx's block treatment: a tinted ground, a presentation table, values in monospace. */
const PANEL_STYLE: CSSProperties = {
	margin: box(0, 0, SPACE_6),
	padding: SPACE_6,
	background: PANEL_BG
};
const LEAD_STYLE: CSSProperties = { margin: box(0, 0, SPACE_4) };
const TABLE_STYLE: CSSProperties = { margin: 0, borderCollapse: 'collapse' };
const LABEL_CELL_STYLE: CSSProperties = {
	padding: box(0, SPACE_8, SPACE_2, 0),
	verticalAlign: 'top'
};
/* an address is one unbroken run far wider than a phone, so it breaks anywhere rather than
   pushing the frame out. */
const VALUE_CELL_STYLE: CSSProperties = {
	padding: box(0, 0, SPACE_2),
	fontFamily: FONT_MONO,
	wordBreak: 'break-all'
};

function Panel({ rows }: { readonly rows: readonly Row[] }) {
	return (
		<div style={PANEL_STYLE}>
			<p style={LEAD_STYLE}>{LEAD}</p>
			<table role="presentation" cellPadding="0" cellSpacing="0" border={0} style={TABLE_STYLE}>
				<tbody>
					{rows.map(({ label, value }) => (
						<tr key={label}>
							<td style={LABEL_CELL_STYLE}>{label}</td>
							<td style={VALUE_CELL_STYLE}>
								{label === LABELS.amount ? <strong>{value}</strong> : value}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
