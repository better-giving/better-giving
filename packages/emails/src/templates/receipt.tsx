import { Fragment, type CSSProperties } from 'react';
import { Divider, Layout, Paragraph, SmallPrint } from '../components/layout';
import { formatDate, formatMoney } from '../format';
import type { EmailTemplate } from '../template';
import {
	BLOCK_BG,
	BORDER_WIDTH_STRONG,
	box,
	FONT_MONO,
	INK,
	PANEL_BG,
	SPACE_2,
	SPACE_4,
	SPACE_6,
	SPACE_8,
	WEIGHT_BOLD
} from '../tokens';

// the donor's receipt — the one document this app produces that somebody else files with a
// tax authority.
//
// pure: no database, no clock, no I/O, no randomness. it takes a model and returns a subject and
// two arms, the same discipline packages/app/src/lib/server/ledger/posting.ts states for `post()`,
// and for a sharper reason here: a template that read the profile itself would be a template that
// could render a different receipt for the same gift depending on when it ran, and the whole value
// of a receipt is that it is reproducible. the caller reads the row; this decides what it says.
//
// it refuses nothing. a gift whose record contradicts itself — a fair market value with nothing
// recorded as provided, a value larger than the payment it came out of, an organisation whose
// details are not saved — is refused by the caller, which is where the words for a gap and the
// backlog it leaves behind both live. this renders what it is given.
//
// ---------------------------------------------------------------------------
// what is on a receipt and why — the content below is researched and settled, not sketched.
//
// required on every one: the organization's legal name, the amount, a goods-or-services
// statement, and the date of the contribution.
//
// it is shaped as a record and not as a letter: a greeting, one thank-you naming the
// organization, then the gift as a labelled block — donor, recipient, date, amount — and the
// statutory sentences under it. no heading, because the subject already identifies the document
// and a heading repeats it word for word to somebody who has just read it. no figure above the
// block either: a number stated twice on a document somebody files is a number somebody
// reconciles.
//
// the EIN and the address are not legally required and are printed anyway. donors verify a
// charity through the IRS's Tax Exempt Organization Search, which is keyed on the number, and
// a receipt without one is the receipt that comes back with a question attached. the address
// is not required for a cash gift either; it is what makes the document read as coming from
// an institution.
//
// $250 is per contribution, never aggregated — a donor who gives $100 three times has no
// $250 gift. so one template serves every size and there is no branch on amount for the
// acknowledgement itself. the single amount branch in this file is §6115's, below, which is a
// different rule with a different threshold.
//
// the goods-or-services sentence branches exactly three ways and one of them always prints:
// nothing was provided; something was, with a description and a good-faith estimate of its
// fair market value; or the only benefit was an intangible religious one. there is no fourth
// case and no "leave it out" case — the statement is what makes the document a receipt.
//
// this is not legal advice and a tax professional reviews the final copy. that sentence
// belongs in this comment and not in the email: a disclaimer on a receipt is a receipt a
// donor's accountant queries.
// ---------------------------------------------------------------------------

/**
 * what, if anything, the donor got back.
 *
 * a closed union rather than a nullable description, because "no goods or services" is a
 * positive statement the receipt has to make, not the absence of one. an optional field
 * would let a caller pass nothing and mean either "nothing was provided" or "nobody
 * recorded it", and only the first of those is safe to print.
 */
export type GoodsOrServices =
	| { readonly kind: 'none' }
	| {
			readonly kind: 'provided';
			/** what the donor received, in their words — "two gala tickets", "a tote bag". */
			readonly description: string;
	  }
	| { readonly kind: 'intangible_religious' };

/**
 * who sent it, as the receipt prints them.
 *
 * every required field is a `string` and none of them is nullable, which is why there is not a
 * single `??` in this file. a nullable one would invite three, and only two of them fail safe:
 * `org.addressLine1 ?? ''` and `org.country ?? ''` produce `''` and get dropped by the empty-line
 * filter in `identityLines`. the third does not. `` `EIN: ${…?? ''}` `` is `'EIN: '`, which is not
 * `''`, so it survives the filter and prints a bare label with nothing after it — a receipt with a
 * blank field, standing one dropped list entry away. proving the fields in the type makes the
 * fallback fail to compile, and the caller is what proves them: a deployment whose organisation
 * details are unsaved has no receipt to print, and finding that out is the caller's job.
 */
export interface ReceiptOrg {
	readonly legalName: string;
	/** printed under the label `EIN`, exactly as the caller stored it — nothing here reformats it. */
	readonly taxId: string;
	readonly addressLine1: string;
	readonly city: string;
	readonly country: string;
	/** a suite number. */
	readonly addressLine2: string | null;
	/** the two plenty of countries do not have, so a receipt must read correctly without them. */
	readonly region: string | null;
	readonly postalCode: string | null;
}

/** the gift, as the `donation` row holds it. */
export interface ReceiptContribution {
	/** `donation.total_minor` — the gross payment, which is what §6115's threshold measures. */
	readonly totalMinor: number;
	/**
	 * `donation.non_deductible_minor` — the good-faith estimate of the fair market value of
	 * anything the donor received back, and the only source for that figure.
	 *
	 * `donation.tax_minor` (the deductible remainder) is deliberately not in this model. the
	 * required §6115 disclosure is a statement — that the deductible amount is limited to the
	 * excess of the payment over the value received — and not a figure the charity computes for
	 * the donor. carrying a stored deductible amount would mean printing two numbers that can
	 * disagree with each other by a rounding error, on the one document where the arithmetic
	 * has to hold. so this template prints the payment and the value received, and says how the
	 * two relate.
	 */
	readonly nonDeductibleMinor: number;
	/** ISO-4217, uppercase — `donation.currency`, whose check already enforces the shape. */
	readonly currency: string;
	/** `donation.received_at` — the business date of the gift, which is the tax year it lands in. */
	readonly receivedAt: Date;
}

/**
 * what a gift was given for — the phrase, and the person it names.
 *
 * `label` is the phrase already worded — "In honor of", "In memory of" — and not a kind anything
 * in this package maps. the two words are the donor's own vocabulary, which the app states where
 * the donor was asked in; a lookup here would be a second copy of it, one word apart, printing a
 * true document for half of them.
 *
 * shared with ./tribute.tsx, so the receipt and the notice cannot word one gift two ways.
 */
export interface Dedication {
	readonly label: string;
	readonly honoree: string;
}

export interface ReceiptData {
	readonly org: ReceiptOrg;
	/** who to address it to. `null` prints a neutral greeting rather than "Dear null". */
	readonly donorName: string | null;
	readonly contribution: ReceiptContribution;
	readonly goodsOrServices: GoodsOrServices;
	/**
	 * who the gift was given in honor or in memory of, or `null` where it was given for nobody.
	 *
	 * a required key with a nullable value: a caller that forgot it would otherwise print a receipt
	 * silently missing a fact the donor stated, and the gift most likely to be dedicated is the one
	 * somebody reads closest.
	 *
	 * it names the honoree and nothing else. the person the donor asked us to tell is a third
	 * party — their name and their address, typed into a form — and this document goes to the
	 * donor, so there is no field here for either and none may be added.
	 */
	readonly tribute: Dedication | null;
	/**
	 * what the organisation calls the cause this gift went to, or `null` where the form recorded
	 * none.
	 *
	 * a required key with a nullable value, for `tribute`'s reason: a caller that forgot it would
	 * print a receipt silently missing what the donor chose, on the one document they keep.
	 *
	 * the name and nothing else. it is the fundraiser's own wording — the same string a donor read
	 * on the form — and this template neither looks one up nor falls back to one: a gift recorded
	 * against no cause has no row here, and a gift recorded against a cause that has since been
	 * retired prints the name it was given under.
	 */
	readonly program: string | null;
}

/**
 * §6115's threshold, in minor units: a quid pro quo contribution over $75 must carry the
 * disclosure, and it must be "in a manner likely to come to the attention of the donor" —
 * which is why it is a prominent block in both arms below and not a footer.
 *
 * over, not at: a payment of exactly $75.00 does not trigger it.
 *
 * it is compared against the gross payment, not against the deductible part. that is the
 * rule, and it is the one people get wrong: a $90 dinner ticket worth $60 is a $90 payment,
 * so it discloses, even though only $30 of it is a contribution.
 *
 * denominated in US dollars and applied to whatever currency the gift is in. §6115 is a US
 * rule and this is a US number; a deployment taking EUR compares euros against 7500 minor
 * units and therefore discloses slightly too often. that direction is the safe one — the
 * failure of over-disclosing is a sentence a donor did not need, and the failure of
 * under-disclosing is a penalty per contribution.
 */
const QUID_PRO_QUO_THRESHOLD_MINOR = 7500;

/** the receipt, as a subject and two arms. */
export function template(data: ReceiptData): EmailTemplate {
	const { org } = data;
	const goods = data.goodsOrServices;

	// every value below is decided once and used by both arms, so the text and the HTML
	// cannot say different things about the same gift.
	const amount = formatMoney(data.contribution.totalMinor, data.contribution.currency);
	const date = formatDate(data.contribution.receivedAt);
	const value = formatMoney(data.contribution.nonDeductibleMinor, data.contribution.currency);
	const discloses =
		goods.kind === 'provided' && data.contribution.totalMinor > QUID_PRO_QUO_THRESHOLD_MINOR;
	const closing = `${goodsStatement(goods, value)} ${KEEP_THIS}`;
	const subject = `Your donation receipt from ${org.legalName}`;
	const greeting = data.donorName === null ? 'Hello,' : `Dear ${firstName(data.donorName)},`;
	const thanks = `Thank you for your gift to ${org.legalName}. ${SUPPORT}`;
	/**
	 * the block, assembled once rather than per arm — which is what makes "the same rows in the
	 * same order in both arms" a property of this file instead of a coincidence between two
	 * functions further down.
	 *
	 * an unnamed donor drops the row and keeps the document. a labelled row with nothing after it
	 * is the same blank field `identityLines` proves away below, and nobody's name is not a reason
	 * to refuse somebody the receipt for a gift they made.
	 */
	const rows: readonly ReceiptRow[] = [
		...(data.donorName === null ? [] : [{ label: RECEIPT_LABELS.donor, value: data.donorName }]),
		{ label: RECEIPT_LABELS.recipient, value: org.legalName },
		{ label: RECEIPT_LABELS.date, value: date },
		{ label: RECEIPT_LABELS.amount, value: amount },
		// after the four and never among them: the quartet is what the law asks a receipt for and
		// its order is settled, and this is a fact about the gift the donor stated and the document
		// states back. a gift given for nobody drops the row, the way an unnamed donor drops theirs.
		...(data.tribute === null
			? []
			: [
					{
						label: RECEIPT_LABELS.dedication,
						value: `${data.tribute.label} ${data.tribute.honoree}`
					}
				]),
		// last, and under the dedication for the same reason it is under the four: it is a fact
		// about this gift the donor chose and the document states back, rather than one of the
		// things the law asks a receipt for. a gift recorded against no cause drops the row, the
		// way an unnamed donor drops theirs.
		...(data.program === null ? [] : [{ label: RECEIPT_LABELS.program, value: data.program }])
	];

	const copy: ReceiptCopy = { org, greeting, thanks, rows, closing, discloses };
	return {
		subject,
		text: textArm(copy),
		node: <ReceiptDocument {...copy} subject={subject} />
	};
}

/** what both arms are built from, once the input has been resolved into sentences. */
interface ReceiptCopy {
	readonly org: ReceiptOrg;
	readonly greeting: string;
	readonly thanks: string;
	/** the receipt block, in print order. */
	readonly rows: readonly ReceiptRow[];
	/** the goods-or-services statement and the keep-this line, one paragraph. */
	readonly closing: string;
	readonly discloses: boolean;
}

/** one line of the receipt block: a label, and a value already spelled. */
interface ReceiptRow {
	readonly label: string;
	readonly value: string;
}

/**
 * the lead and every label, in one place so the two arms cannot word the record differently.
 *
 * none of them may partition the payment by tax character — no deductible, non-deductible, or
 * "not part of your donation", in a label or in the lead. `DISCLOSURE` below is the only sentence
 * on this document that relates the payment to what is deductible, and a narrower claim beside it
 * would be a figure for the donor's return that this template deliberately does not compute (see
 * `nonDeductibleMinor`).
 *
 * `Recipient` states who received the money on the same footing as `Donor` states who gave it,
 * which is what a record does and what a letterhead does not.
 *
 * `Dedication` is the fundraiser's own word and the word the donor was asked in —
 * packages/form/src/views.ts writes `Dedicate this gift` on the tick that opens the boxes. it names
 * the honoree only: the person the donor asked us to tell never appears on this document.
 *
 * `Program` is the fundraiser's own word for a cause and the word a donor was offered on the form,
 * and it names what the gift went to rather than which fund it posts to — the receipt states the
 * organisation's own record of the gift and never the chart of accounts.
 */
const RECEIPT_LEAD = 'Your receipt:';

const RECEIPT_LABELS = {
	donor: 'Donor',
	recipient: 'Recipient',
	date: 'Date',
	amount: 'Amount',
	dedication: 'Dedication',
	program: 'Program'
} as const;

/** the label column in the text arm, widened by the longest label rather than by a guess. */
const RECEIPT_LABEL_WIDTH =
	Math.max(...Object.values(RECEIPT_LABELS).map((label) => label.length)) + 2;

/**
 * how the greeting addresses somebody, from a name that has no parts.
 *
 * `donorName` is one string a donor typed or a form derived, which the caller only proves is not
 * blank — it may arrive untrimmed and it carries no first-or-family structure to read. so the
 * first whitespace-delimited token is the whole heuristic, and it is wrong in the ways an
 * unstructured name is wrong: a name written family-name-first is greeted by the family name, and
 * one carrying a particle is greeted by the particle.
 *
 * that is a greeting and not the record. the full name is on the `Donor` row of the block below,
 * which is the line the document is read from.
 */
function firstName(donorName: string): string {
	const trimmed = donorName.trim();
	const space = trimmed.search(/\s/);
	return space === -1 ? trimmed : trimmed.slice(0, space);
}

/**
 * the words a donor gets from this deployment that are not a figure or a statutory sentence.
 *
 * it closes the one thank-you, whose first sentence names the organisation. neither of them
 * carries a figure or a date: those are rows of the block below, and the sentence a donor reads
 * first cannot disagree with a number it does not state.
 *
 * it stays above the block and the disclosure. a gratitude line under the figures is a footer.
 *
 * ungated on purpose. it prints on every receipt that goes out, a one-off gift and every
 * collection under a standing commitment alike, because that is what
 * packages/app/src/lib/server/donations/receipt.ts sends — there is no first-charge case for it to
 * know about and adding one would mean thanking a repeating donor once and billing them monthly.
 *
 * static copy, and that is a property to keep: that caller claims `receipt_sent_at` before it
 * renders, so anything here able to fail to render is a donor recorded as receipted who received
 * nothing.
 */
const SUPPORT = 'Your support is what makes our work possible.';

/**
 * what to do with the document, and the second half of the paragraph the receipt closes with.
 *
 * one paragraph with the goods-or-services statement rather than two: they are the same
 * instruction to the same reader — what the gift bought, and what to keep — and split apart they
 * read as two footers stacked under the record.
 */
const KEEP_THIS = 'Please keep this receipt with your tax records.';

/**
 * the goods-or-services sentence — the branch that always prints, in all three of its forms.
 *
 * the wording follows IRS Publication 1771 closely on purpose. it is the phrasing donors'
 * accountants recognise, and "we didn't give you anything" is not the same sentence in the
 * eyes of the person auditing it.
 */
function goodsStatement(goods: GoodsOrServices, value: string): string {
	switch (goods.kind) {
		case 'none':
			return 'No goods or services were provided to you in exchange for this contribution.';
		case 'provided':
			return (
				`In exchange for this contribution you received ${goods.description}. ` +
				`We estimate the fair market value of what you received at ${value}.`
			);
		case 'intangible_religious':
			return (
				'The only benefits you received in exchange for this contribution were intangible ' +
				'religious benefits.'
			);
	}
}

/**
 * the §6115 disclosure itself, printed only when a quid pro quo payment cleared the
 * threshold. one string, so the two arms disclose in identical words.
 */
const DISCLOSURE =
	'The amount of your contribution that is deductible for federal income tax purposes is ' +
	'limited to the excess of the money you contributed over the value of the goods and ' +
	'services we provided to you.';

const DISCLOSURE_HEADING = 'Important for your tax return';

/**
 * how a block is set apart where there is no styling to set it apart with.
 *
 * one character and one width for both blocks that use it, so the receipt and the disclosure read
 * as one document rather than as two conventions that met in a mailbox.
 */
const TEXT_RULE = '-------------------------------------------------------------';

/**
 * the plain-text arm.
 *
 * not a fallback. it is the copy that survives being forwarded, printed and pasted into a
 * tax filing, and it is the only arm some clients ever render — so the disclosure gets the
 * same prominence here as in the HTML: its own block, set off by rules, above the details
 * rather than under them. "likely to come to the attention of the donor" is the standard, and
 * a line at the bottom of a wall of text is not it.
 *
 * it is handed to the caller rather than stripped out of the jsx below, which is what
 * ../template.ts's optional `text` is for: none of the layout in this function survives a stripper.
 */
function textArm(copy: ReceiptCopy): string {
	const lines: string[] = [];

	// the block between rules, because this arm has no background to tint it with. it takes no
	// capitals: that treatment belongs to the disclosure alone, for the same reason its border
	// does in the other arm.
	lines.push(copy.greeting, '', copy.thanks, '', TEXT_RULE, RECEIPT_LEAD, '');

	// one line per row, and the labels padded to a column: this arm is what gets pasted into a
	// spreadsheet and read down, so the values have to line up when it is.
	for (const { label, value } of copy.rows) {
		lines.push(`${label.padEnd(RECEIPT_LABEL_WIDTH)}${value}`);
	}
	lines.push(TEXT_RULE, '');

	if (copy.discloses) {
		lines.push(TEXT_RULE, DISCLOSURE_HEADING.toUpperCase(), '', DISCLOSURE, TEXT_RULE, '');
	}

	lines.push(copy.closing, '', '--');
	lines.push(...identityLines(copy.org).map((line) => line.text));

	return lines.join('\n');
}

/** the HTML arm. same content, same order, same sentences — only the presentation differs. */
function ReceiptDocument(copy: ReceiptCopy & { readonly subject: string }) {
	return (
		<Layout title={copy.subject}>
			<Paragraph>{copy.greeting}</Paragraph>
			<Paragraph>{copy.thanks}</Paragraph>
			<ReceiptPanel rows={copy.rows} />
			{copy.discloses ? <Disclosure /> : null}
			<Paragraph>{copy.closing}</Paragraph>
			<Divider />
			<SmallPrint>
				{identityLines(copy.org).map((line, index) => (
					<Fragment key={line.field}>
						{index === 0 ? null : <br />}
						{line.text}
					</Fragment>
				))}
			</SmallPrint>
		</Layout>
	);
}

/**
 * a bordered, tinted block above the details, not a footnote under them — the statutory standard
 * is prominence, and inline styles are the only styling an email client can be relied on to keep.
 * it still reads correctly with every style stripped, because the heading is a real paragraph whose
 * bold is structural — a `<strong>`, which survives the styles going — and the block is in document
 * order where it matters.
 */
function Disclosure() {
	return (
		<div style={DISCLOSURE_STYLE}>
			<p style={DISCLOSURE_HEADING_STYLE}>
				<strong>{DISCLOSURE_HEADING}</strong>
			</p>
			<p style={{ margin: 0 }}>{DISCLOSURE}</p>
		</div>
	);
}

const DISCLOSURE_STYLE: CSSProperties = {
	margin: box(0, 0, SPACE_6),
	padding: SPACE_6,
	border: `${BORDER_WIDTH_STRONG}px solid ${INK}`,
	background: BLOCK_BG
};

const DISCLOSURE_HEADING_STYLE: CSSProperties = {
	margin: box(0, 0, SPACE_4),
	fontWeight: WEIGHT_BOLD
};

/**
 * the ground the block sits on. a rung lighter than the disclosure's and carrying no border at
 * all, which is the whole of how the two are kept apart: the statutory standard for the disclosure
 * is prominence, and a second block matching its rule would be two blocks competing for the same
 * eye. the heavy treatment — a border, and a heading over it — stays the disclosure's alone.
 */
const PANEL_STYLE: CSSProperties = {
	margin: box(0, 0, SPACE_6),
	padding: SPACE_6,
	background: PANEL_BG
};

const LEAD_STYLE: CSSProperties = { margin: box(0, 0, SPACE_4) };
const TABLE_STYLE: CSSProperties = { margin: 0, borderCollapse: 'collapse' };
const LABEL_CELL_STYLE: CSSProperties = { padding: box(0, SPACE_8, SPACE_2, 0) };
/* the values are set in the system's monospace stack, so the column reads down. the labels do not
   take it: a label set like a figure reads as another figure. */
const VALUE_CELL_STYLE: CSSProperties = { padding: box(0, 0, SPACE_2), fontFamily: FONT_MONO };

/**
 * the block in the HTML arm: a label and its value, one row each, in the order they were decided,
 * on a tinted panel.
 *
 * a table inside the panel rather than the panel doing the work, because a background is among the
 * first things a client drops and a `<td>` is not — which is the state ../components/layout.tsx
 * says an email arrives in. stripped of every style this is still a lead paragraph over four
 * labelled rows; a block leaning on CSS to separate them collapses into one line on a document
 * somebody files, where it reads as a single wrong number. `role="presentation"` because it is a
 * layout, not data with headers.
 *
 * only the amount is emphasised: it is the figure the donor's bank shows and the one an eye
 * scanning the document is looking for. matched on the label rather than on the position, so the
 * emphasis follows the row wherever the order is edited.
 */
function ReceiptPanel({ rows }: { readonly rows: readonly ReceiptRow[] }) {
	return (
		<div style={PANEL_STYLE}>
			<p style={LEAD_STYLE}>{RECEIPT_LEAD}</p>
			<table role="presentation" cellPadding="0" cellSpacing="0" border={0} style={TABLE_STYLE}>
				<tbody>
					{rows.map(({ label, value }) => (
						<tr key={label}>
							<td style={LABEL_CELL_STYLE}>{label}</td>
							<td style={VALUE_CELL_STYLE}>
								{label === RECEIPT_LABELS.amount ? <strong>{value}</strong> : value}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** one line of the identity block: which detail it came from, and the text to print. */
interface IdentityLine {
	/**
	 * a key for the HTML arm's list that is neither the text nor the index. the text is not unique
	 * — a city-state prints its own name as the city line and again as the country — and an index
	 * is what React tells you not to key on.
	 */
	readonly field: string;
	readonly text: string;
}

/**
 * who sent it — name, address, EIN, one line each.
 *
 * shared by both arms so the two can never carry different addresses, and returned as lines
 * rather than as a string so the HTML arm can put each on its own `<br>`.
 *
 * `taxId` is labelled `EIN`, which is the word a US donor and their preparer look for, and the
 * value is printed exactly as stored: the caller settles the spelling at the save, so nothing here
 * formats it. the optional lines are the ones plenty of countries do not have, so a receipt must
 * read correctly without them.
 *
 * it takes a `ReceiptOrg`, whose five required fields are strings, which is why there is not a
 * single `??` in it — that type's own comment argues what the third fallback would print.
 */
function identityLines(org: ReceiptOrg): IdentityLine[] {
	return [
		{ field: 'legalName', text: org.legalName },
		{ field: 'addressLine1', text: org.addressLine1 },
		...(org.addressLine2 === null ? [] : [{ field: 'addressLine2', text: org.addressLine2 }]),
		{
			field: 'locality',
			text: [org.city, org.region, org.postalCode].filter((part) => part !== null).join(' ')
		},
		{ field: 'country', text: org.country },
		{ field: 'taxId', text: `EIN: ${org.taxId}` }
	].filter((line) => line.text !== '');
}
