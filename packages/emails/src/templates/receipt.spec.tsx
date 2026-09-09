import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import * as receipt from './receipt';
import type { GoodsOrServices, ReceiptContribution, ReceiptData, ReceiptOrg } from './receipt';

// pure, so every case here is an object literal and there is no database anywhere in the
// file — which is the property that makes a receipt reproducible in the first place.

const ORG: ReceiptOrg = {
	legalName: 'Hope Foundation',
	taxId: '12-3456789',
	addressLine1: '1 Charity Way',
	addressLine2: null,
	city: 'Springfield',
	region: 'IL',
	postalCode: '62701',
	country: 'United States'
};

const CONTRIBUTION: ReceiptContribution = {
	totalMinor: 10_000,
	nonDeductibleMinor: 0,
	currency: 'USD',
	receivedAt: new Date('2026-01-05T12:00:00Z')
};

/** $50 chosen with $1.81 added on top — the gift whose total is not the amount the donor picked. */
const COVERED: ReceiptContribution = { ...CONTRIBUTION, totalMinor: 5_181 };

function data(overrides: Partial<ReceiptData> = {}): ReceiptData {
	return {
		org: ORG,
		donorName: 'Ada Lovelace',
		contribution: CONTRIBUTION,
		goodsOrServices: { kind: 'none' },
		// the ordinary gift, given for nobody. every case about the fifth row states its own.
		tribute: null,
		// and recorded against no cause, which is what a form asking about none produces. every
		// case about the last row states its own.
		program: null,
		...overrides
	};
}

/** renders both arms. */
function rendered(overrides: Partial<ReceiptData> = {}) {
	return renderEmail(receipt.template(data(overrides)));
}

/** every case must hold in both arms — a claim about the text alone proves half a message. */
async function arms(overrides: Partial<ReceiptData> = {}): Promise<string[]> {
	const message = await rendered(overrides);
	return [message.text, message.html];
}

describe('receipt.template — what every receipt carries', () => {
	/**
	 * the four required elements: the organisation's legal name, the amount, the date of the
	 * contribution, and a goods-or-services statement. asserted together because a receipt
	 * missing any one of them is not a receipt, and in both arms because the plain-text one is
	 * what gets forwarded to an accountant and printed.
	 */
	it.each([
		{ element: 'the legal name', text: 'Hope Foundation' },
		{ element: 'the amount', text: 'USD 100.00' },
		{ element: 'the date of the contribution', text: 'January 5, 2026' },
		{ element: 'a goods-or-services statement', text: 'No goods or services were provided' }
	])('carries $element in both arms', async ({ text }) => {
		for (const arm of await arms()) expect(arm).toContain(text);
	});

	/**
	 * not legally required and printed anyway. donors verify a charity through the IRS's Tax
	 * Exempt Organization Search, which is keyed on the number, and a receipt without one is
	 * the one that comes back with a question attached.
	 */
	it.each([
		{ element: 'the EIN', text: '12-3456789' },
		{ element: 'the street address', text: '1 Charity Way' }
	])('carries $element in both arms', async ({ text }) => {
		for (const arm of await arms()) expect(arm).toContain(text);
	});

	/**
	 * the receipt is the only email a donor ever gets, so it says thank you before it says anything
	 * else — and it says it once. the sentence names the organisation and carries no figure and no
	 * date: those are rows of the receipt block below, and a document somebody files must not state
	 * the same number twice.
	 */
	it('thanks the donor once, above the receipt block, in both arms', async () => {
		for (const arm of await arms({ contribution: COVERED })) {
			expect(arm).toContain('Thank you for your gift to Hope Foundation.');
			expect(arm).toContain('Your support is what makes our work possible.');
			expect(arm.split('Thank you for your gift').length - 1).toBe(1);
			expect(arm.indexOf('Dear Ada,')).toBeLessThan(arm.indexOf('Thank you for your gift to'));
			expect(arm.indexOf('Thank you for your gift to')).toBeLessThan(
				arm.indexOf('Your support is what makes our work possible.')
			);
			expect(arm.indexOf('Your support is what makes our work possible.')).toBeLessThan(
				arm.indexOf('Your receipt:')
			);
		}
	});

	// the figures belong to the block and the thank-you carries none of them.
	it('keeps the amount and the date out of the thank-you', async () => {
		for (const arm of await arms()) {
			const thanks = arm.slice(
				arm.indexOf('Thank you for your gift to'),
				arm.indexOf('Your receipt:')
			);
			expect(thanks).not.toContain('USD 100.00');
			expect(thanks).not.toContain('January 5, 2026');
		}
	});

	/**
	 * the subject identifies the document and the block records who received the gift, so there is
	 * no heading over either. a heading turns a record into a letter, and it repeats the subject
	 * word for word to a reader who has just read it.
	 */
	it('names the organisation in the subject and on the receipt, under no heading', async () => {
		const message = await rendered({ org: { ...ORG, legalName: 'Riverside Trust' } });
		expect(message.subject).toContain('Riverside Trust');
		for (const arm of [message.text, message.html]) {
			expect(arm).toContain('Riverside Trust');
			expect(arm).not.toContain('Receipt for your gift to');
		}
		expect(message.html).not.toContain('<h1');
	});

	// the product is for US 501(c)(3) organisations, so the number is an EIN and the receipt says
	// so. the column stays `tax_id` (a rename buys nothing and costs a migration) and the label
	// leads it rather than following it.
	it('labels the number `EIN`', async () => {
		for (const arm of await arms()) expect(arm).toContain('EIN:');
	});

	it('prints the number as it is stored, dash and all', async () => {
		// the caller stores one spelling of a number an operator may paste four ways, so a template
		// that reformatted would be a second opinion about what a receipt prints.
		for (const arm of await arms()) expect(arm).toContain('EIN: 12-3456789');
	});

	/**
	 * the first name and nothing else, because that is what a greeting is. `donorName` is one
	 * unstructured string, which the caller allows to arrive untrimmed — so the first
	 * whitespace-delimited token is the whole heuristic, and the full name is on the `Donor` row
	 * where the record is.
	 */
	it.each([
		{ shape: 'a first and family name', donorName: 'Ada Lovelace' },
		{ shape: 'a single token', donorName: 'Ada' },
		{ shape: 'an untrimmed name', donorName: '  Ada Lovelace ' }
	])('greets $shape by its first token', async ({ donorName }) => {
		for (const arm of await arms({ donorName })) expect(arm).toContain('Dear Ada,');
	});

	it('greets neutrally without a name', async () => {
		for (const arm of await arms({ donorName: null })) {
			expect(arm).toContain('Hello,');
			expect(arm).not.toContain('null');
		}
	});

	// both arms, always. a template that produced only HTML would be a receipt some clients
	// render as an empty message, and one that produced only text would be the same document
	// with the disclosure buried.
	it('always produces both arms and a subject', async () => {
		const message = await rendered();
		expect(message.subject).toContain('Hope Foundation');
		expect(message.text.length).toBeGreaterThan(0);
		// a whole document rather than a fragment. the doctype is the one react-email writes and
		// not one this package chose, so the claim is that there is one and that `<html>` follows.
		expect(message.html.toLowerCase()).toContain('<!doctype html');
		expect(message.html).toContain('<html');
	});

	/**
	 * $250 is per contribution and is never aggregated, so one template serves every size and
	 * there is no branch on amount for the acknowledgement itself. a $5 gift and a $5,000 gift
	 * get the same document with a different number in it.
	 */
	it('does not change the acknowledgement with the size of the gift', async () => {
		const small = await rendered({ contribution: { ...CONTRIBUTION, totalMinor: 500 } });
		const large = await rendered({ contribution: { ...CONTRIBUTION, totalMinor: 500_000 } });
		expect(small.subject).toBe(large.subject);
		expect(small.text.replace('USD 5.00', 'X')).toBe(large.text.replace('USD 5,000.00', 'X'));
	});
});

describe('receipt.template — the goods-or-services statement', () => {
	/**
	 * three branches, and exactly one of them always prints. the statement is what makes the
	 * document a receipt, so there is no fourth case and no "leave it out" case.
	 */
	it.each([
		{
			branch: 'nothing was provided',
			goods: { kind: 'none' } as GoodsOrServices,
			contribution: CONTRIBUTION,
			says: 'No goods or services were provided to you in exchange for this contribution.'
		},
		{
			branch: 'goods or services were provided',
			goods: { kind: 'provided', description: 'two gala tickets' } as GoodsOrServices,
			contribution: { ...CONTRIBUTION, nonDeductibleMinor: 4_000 },
			says: 'In exchange for this contribution you received two gala tickets.'
		},
		{
			branch: 'only intangible religious benefits',
			goods: { kind: 'intangible_religious' } as GoodsOrServices,
			contribution: CONTRIBUTION,
			says: 'intangible religious benefits'
		}
	])('states it when $branch', async ({ goods, contribution, says }) => {
		for (const arm of await arms({ goodsOrServices: goods, contribution })) {
			expect(arm).toContain(says);
		}
	});

	/**
	 * the statement and the keep-this line are one paragraph in every branch, not two. they are the
	 * same instruction to the same reader — what the gift bought, and what to do with the document
	 * — and split apart they read as two footers stacked under a record.
	 */
	it.each([
		{
			branch: 'nothing was provided',
			goods: { kind: 'none' } as GoodsOrServices,
			contribution: CONTRIBUTION,
			ends: 'No goods or services were provided to you in exchange for this contribution.'
		},
		{
			branch: 'goods or services were provided',
			goods: { kind: 'provided', description: 'two gala tickets' } as GoodsOrServices,
			contribution: { ...CONTRIBUTION, nonDeductibleMinor: 4_000 },
			ends: 'We estimate the fair market value of what you received at USD 40.00.'
		},
		{
			branch: 'only intangible religious benefits',
			goods: { kind: 'intangible_religious' } as GoodsOrServices,
			contribution: CONTRIBUTION,
			ends: 'were intangible religious benefits.'
		}
	])('closes in one paragraph when $branch', async ({ goods, contribution, ends }) => {
		const closing = `${ends} Please keep this receipt with your tax records.`;
		const message = await rendered({ goodsOrServices: goods, contribution });
		expect(message.text).toContain(closing);
		// one `<p>`, which is the claim: two sentences inside one pair of tags.
		expect(message.html).toContain(`${closing}</p>`);
		expect(message.html).not.toContain('<p style="margin:0 0 16px">Please keep this receipt');
	});

	// the good-faith estimate of fair market value comes from `donation.non_deductible_minor`
	// — one source for that figure, so nothing on the page can disagree with the books.
	it('prints a good-faith estimate of the value received', async () => {
		for (const arm of await arms({
			goodsOrServices: { kind: 'provided', description: 'two gala tickets' },
			contribution: { ...CONTRIBUTION, nonDeductibleMinor: 4_000 }
		})) {
			expect(arm).toContain('USD 40.00');
		}
	});
});

describe('receipt.template — the receipt block', () => {
	const LEAD = 'Your receipt:';

	/**
	 * the record itself: who gave, who received, when, and how much. four rows in one order in
	 * both arms, because the plain-text one is what gets forwarded to an accountant and printed.
	 */
	it('states the four rows in order in both arms', async () => {
		for (const arm of await arms()) {
			expect(arm.indexOf(LEAD)).toBeLessThan(arm.indexOf('Donor'));
			expect(arm.indexOf('Donor')).toBeLessThan(arm.indexOf('Recipient'));
			expect(arm.indexOf('Recipient')).toBeLessThan(arm.indexOf('Date'));
			expect(arm.indexOf('Date')).toBeLessThan(arm.indexOf('Amount'));
		}
	});

	/**
	 * a fifth row, after the four and never among them. the quartet is what the law asks a receipt
	 * for and its order is settled; a dedication is a fact about this gift that the donor told us
	 * and the document states back.
	 */
	it('states the dedication after the four required rows', async () => {
		for (const arm of await arms({
			tribute: { label: 'In memory of', honoree: 'Margaret Chen' }
		})) {
			expect(arm.indexOf('Amount')).toBeLessThan(arm.indexOf('Dedication'));
			expect(arm).toContain('In memory of Margaret Chen');
		}
	});

	it('says in honor of a gift given for somebody living', async () => {
		// the phrase arrives already worded and is printed as it came: the two kinds are one word
		// apart and both slot into "in ___ of", so a template holding its own lookup would be a
		// second copy of the caller's, printing a true document for half of them.
		for (const arm of await arms({ tribute: { label: 'In honor of', honoree: 'Margaret Chen' } })) {
			expect(arm).toContain('In honor of Margaret Chen');
		}
	});

	/**
	 * omitted rather than printed blank, for the donor row's reason: a labelled row with nothing
	 * after it is the "receipt with an empty field" this template refuses everywhere else.
	 */
	it('omits the dedication row on a gift given for nobody', async () => {
		for (const arm of await arms({ tribute: null })) {
			expect(arm).not.toContain('Dedication');
			expect(arm).toContain('Amount');
		}
	});

	/**
	 * the last row, under the dedication. both are facts about this gift that the donor settled and
	 * the document states back, and the four the law asks for keep the top of the block.
	 */
	it('states the program after the dedication', async () => {
		for (const arm of await arms({
			tribute: { label: 'In memory of', honoree: 'Margaret Chen' },
			program: 'Clean water'
		})) {
			expect(arm.indexOf('Dedication')).toBeLessThan(arm.indexOf('Program'));
			expect(arm).toContain('Clean water');
		}
	});

	it('states the program on a gift given for nobody', async () => {
		// the two rows are independent facts: a gift can name a cause and no honoree, and the row
		// the dedication would have taken is not one the program falls into.
		for (const arm of await arms({ program: 'Clean water' })) {
			expect(arm.indexOf('Amount')).toBeLessThan(arm.indexOf('Program'));
			expect(arm).not.toContain('Dedication');
		}
	});

	/**
	 * omitted rather than printed blank, for the donor and dedication rows' reason: a labelled row
	 * with nothing after it is the "receipt with an empty field" this template refuses everywhere
	 * else. a form that asks about no cause is the ordinary case, not a gap.
	 */
	it('omits the program row on a gift recorded against no cause', async () => {
		for (const arm of await arms({ program: null })) {
			expect(arm).not.toContain('Program');
			expect(arm).toContain('Amount');
		}
	});

	/**
	 * the receipt goes to the donor, and the person they asked us to tell is somebody else — a
	 * third party's name and address, typed into a form, echoed back to nobody. `ReceiptData`
	 * carries no field for either, which is what makes this structural rather than a habit; the
	 * case is here so that a field added for one would fail rather than print.
	 */
	it('carries no way to name the person the donor asked us to tell', () => {
		const keys = Object.keys(
			data({ tribute: { label: 'In memory of', honoree: 'Margaret Chen' } })
		);
		expect(keys.filter((key) => /notify|recipient/i.test(key))).toEqual([]);
	});

	// and the value beside each label, from the same figures the rest of the document is built
	// from — the block is the record rather than a summary of one stated elsewhere.
	it('carries the value of every row in both arms', async () => {
		for (const arm of await arms()) {
			expect(arm).toContain('Ada Lovelace');
			expect(arm).toContain('Hope Foundation');
			expect(arm).toContain('January 5, 2026');
			expect(arm).toContain('USD 100.00');
		}
	});

	// the full name, where the greeting above took only the first token: one is how the document
	// addresses somebody and the other is who it says the gift came from.
	it('records the donor under their full name, whatever the greeting used', async () => {
		for (const arm of await arms({ donorName: 'Ada Lovelace' })) {
			expect(arm).toContain('Dear Ada,');
			expect(arm).toContain('Ada Lovelace');
		}
	});

	/**
	 * omitted rather than printed blank. a labelled row with nothing after it is the same "receipt
	 * with an empty field" the profile refusal exists to prevent, and an unnamed donor is not a
	 * reason to refuse a gift a receipt — the row is what goes, not the document.
	 */
	it('omits the donor row entirely without a name', async () => {
		for (const arm of await arms({ donorName: null })) {
			expect(arm).not.toContain('Donor');
			expect(arm).toContain('Recipient');
			expect(arm).toContain('USD 100.00');
		}
	});

	/**
	 * four real rows, and the reason is what an email client does with the styles: strip them and
	 * a table is still four rows, while a layout leaning on CSS to separate them collapses into
	 * one line that reads as a single wrong number on a document somebody files.
	 */
	it('lays the rows out as rows, not as one line', async () => {
		const message = await rendered();
		const block = message.html.slice(message.html.indexOf(LEAD));
		expect(block.match(/<tr[ >]/g)).toHaveLength(4);
		// the text arm is what gets pasted into a spreadsheet and read down, so its labels are a
		// column wide enough for the longest of them.
		expect(message.text).toContain('\nAmount      USD 100.00\n');
	});

	// the figure the donor's bank shows is the one an eye scanning the document is looking for,
	// and the only one set apart.
	it('emphasises only the amount in the HTML arm', async () => {
		const { html } = await rendered();
		expect(html).toContain('<strong>USD 100.00</strong>');
		expect(html).not.toContain('<strong>January 5, 2026</strong>');
		expect(html).not.toContain('<strong>Ada Lovelace</strong>');
	});

	/** the panel the block sits in, cut out of the document by its own opening tag. */
	function panel(html: string): string {
		const open = html.lastIndexOf('<div', html.indexOf('Your receipt:'));
		return html.slice(open, html.indexOf('</div>', open));
	}

	/** the block's own table, cut out by the lead above it — the document is full of others. */
	function table(html: string): string {
		const open = html.indexOf('<table', html.indexOf('Your receipt:'));
		return html.slice(open, html.indexOf('</table>', open));
	}

	/**
	 * a tinted panel sets the record apart from the sentences around it, and it stays quieter than
	 * the §6115 block: a ground and no rule around it. the bordered treatment is the disclosure's
	 * alone, because its prominence is a statutory standard and two competing blocks on one page
	 * is how a document meets that standard on paper and fails it in front of a reader.
	 */
	it('sets the block in a panel the disclosure still outweighs', async () => {
		const { html } = await rendered({
			goodsOrServices: { kind: 'provided', description: 'a gala ticket' },
			contribution: { ...CONTRIBUTION, totalMinor: 20_000, nonDeductibleMinor: 6_000 }
		});
		expect(panel(html)).toContain('background:');
		expect(panel(html)).not.toContain('border:');
		// the width and the fact of a border, not the colour: the value is the operator design
		// system's ink and is stated in packages/operator/src/styles/tokens.css, which is the only
		// place a colour is decided. what this case is about is that the disclosure carries a rule
		// and the panel does not.
		expect(html).toMatch(/border:2px solid #[0-9a-f]{6}/);
	});

	/**
	 * and a background is among the first things a stripped-down client drops, so the block has to
	 * survive losing it — the same property the disclosure and the table are already held to.
	 */
	it('still reads as a labelled set of rows with every style stripped', async () => {
		const stripped = (await rendered()).html.replace(/ style="[^"]*"/g, '');
		expect(stripped).toContain('<p>Your receipt:</p>');
		expect(stripped).toContain('<tr><td>Donor</td><td>Ada Lovelace</td></tr>');
		expect(stripped).toContain('<tr><td>Recipient</td><td>Hope Foundation</td></tr>');
		expect(stripped).toContain('<tr><td>Date</td><td>January 5, 2026</td></tr>');
		expect(stripped).toContain('<tr><td>Amount</td><td><strong>USD 100.00</strong></td></tr>');
	});

	/**
	 * the values are set in a monospace face so the column reads down, which is the whole reason a
	 * record is laid out as one. the labels stay in the body face — a label set like a figure reads
	 * as another figure.
	 */
	it('sets the values in monospace and the labels in the body face', async () => {
		const { html } = await rendered();
		// the block's table alone: the organisation's name is also in the title and the thank-you,
		// and the shell wraps the whole document in tables of its own.
		const block = table(html);
		for (const value of ['Ada Lovelace', 'Hope Foundation', 'January 5, 2026', 'USD 100.00']) {
			const at = block.indexOf(value);
			expect(block.slice(block.lastIndexOf('<td', at), at)).toContain('monospace');
		}
		expect(block).toContain('<td style="padding:0 24px 4px 0">Donor</td>');
	});

	/**
	 * the text arm cannot have a panel, so it is ruled off instead — in the character the
	 * disclosure block already rules with, so the two read as one document rather than as two
	 * conventions. it does not take the disclosure's capitals: that treatment is the statutory
	 * block's, for the same reason the border is.
	 */
	it('rules the block off in the text arm without shouting its lead', async () => {
		const { text } = await rendered();
		const rule = '-------------------------------------------------------------';
		expect(text).toContain(`${rule}\nYour receipt:\n`);
		expect(text).toContain(`Amount      USD 100.00\n${rule}\n`);
		expect(text).not.toContain('YOUR RECEIPT');
	});
});

describe('receipt.template — the processing fee the donor added', () => {
	/**
	 * the donor sees one figure: the total they paid. what it was made of is bookkeeping —
	 * `donation.fee_minor` and `donation.total_minor` are still separate columns and still separate
	 * ledger entries — and a donor reconciles nothing by reading it back off the document they file.
	 */
	it('says nothing about the fee, in either arm', async () => {
		for (const arm of await arms({ contribution: COVERED })) {
			expect(arm.toLowerCase()).not.toContain('fee');
			expect(arm.toLowerCase()).not.toContain('processing');
		}
	});

	// the total, and no part of it. the two figures the document used to break the payment into are
	// the ones a reader would reconcile against, and neither is on the page.
	it('prints the total as the only figure on a gift that covered a fee', async () => {
		for (const arm of await arms({ contribution: COVERED })) {
			expect(arm).toContain('USD 51.81');
			expect(arm).not.toContain('USD 50.00');
			expect(arm).not.toContain('USD 1.81');
		}
	});

	/**
	 * and it never partitions the payment by tax character. a fee the donor chose to add is not
	 * something they received in exchange, so the §6115 sentence relates it correctly already — a
	 * second, narrower claim beside the general one is the failure this asserts against, and it
	 * would be on a document somebody files.
	 */
	it.each(['deductible', 'non-deductible', 'not part of your donation', 'administrative'])(
		'never partitions the payment by tax character — no %s',
		async (word) => {
			for (const arm of await arms({ contribution: COVERED })) {
				expect(arm.toLowerCase()).not.toContain(word);
			}
		}
	);

	/**
	 * a covered fee changes neither the disclosure's words nor its place: the §6115 standard is
	 * prominence, and it stays above the goods statement and the identity block on every gift.
	 */
	it('leaves the §6115 disclosure and the goods statement where they were', async () => {
		const contribution = {
			...CONTRIBUTION,
			totalMinor: 20_000,
			nonDeductibleMinor: 6_000
		};
		for (const arm of await arms({
			goodsOrServices: { kind: 'provided', description: 'a gala ticket' },
			contribution
		})) {
			expect(arm).toContain('limited to the excess of the money you contributed');
			expect(arm.indexOf('Your receipt:')).toBeLessThan(
				arm.indexOf('limited to the excess of the money you contributed')
			);
			expect(arm.indexOf('limited to the excess of the money you contributed')).toBeLessThan(
				arm.indexOf('In exchange for this')
			);
			expect(arm.indexOf('limited to the excess of the money you contributed')).toBeLessThan(
				arm.indexOf('EIN:')
			);
		}
	});

	// and the plain branch keeps its sentence word for word: the statement is what makes the
	// document a receipt, and a covered fee is not a reason to word it differently.
	it('leaves the no-goods statement word for word', async () => {
		for (const arm of await arms({ contribution: COVERED })) {
			expect(arm).toContain(
				'No goods or services were provided to you in exchange for this contribution.'
			);
		}
	});
});

describe('receipt.template — the §6115 quid pro quo disclosure', () => {
	const TICKETS: GoodsOrServices = { kind: 'provided', description: 'a gala ticket' };
	const DISCLOSURE = 'limited to the excess of the money you contributed';

	/**
	 * it triggers on the gross payment, not on the deductible part — a $90 dinner ticket worth
	 * $60 is a $90 payment, so it discloses even though only $30 of it is a contribution.
	 */
	it('discloses on a quid pro quo payment over $75', async () => {
		for (const arm of await arms({
			goodsOrServices: TICKETS,
			contribution: { ...CONTRIBUTION, totalMinor: 9_000, nonDeductibleMinor: 6_000 }
		})) {
			expect(arm).toContain(DISCLOSURE);
		}
	});

	// over, not at: a payment of exactly $75.00 does not trigger it.
	it('does not disclose at exactly $75', async () => {
		for (const arm of await arms({
			goodsOrServices: TICKETS,
			contribution: { ...CONTRIBUTION, totalMinor: 7_500, nonDeductibleMinor: 4_000 }
		})) {
			expect(arm).not.toContain(DISCLOSURE);
		}
	});

	/**
	 * a gift with nothing given back is not a quid pro quo contribution at any size, and
	 * neither is one whose only benefit was intangible and religious — §6115 excepts it by
	 * name. printing the disclosure on either would tell a donor their deduction is limited
	 * when it is not.
	 */
	it.each([
		{ branch: 'nothing was provided', goods: { kind: 'none' } as GoodsOrServices },
		{
			branch: 'intangible religious benefits',
			goods: { kind: 'intangible_religious' } as GoodsOrServices
		}
	])('does not disclose on a large gift when $branch', async ({ goods }) => {
		for (const arm of await arms({
			goodsOrServices: goods,
			contribution: { ...CONTRIBUTION, totalMinor: 500_000 }
		})) {
			expect(arm).not.toContain(DISCLOSURE);
		}
	});

	/**
	 * "in a manner likely to come to the attention of the donor" is the statutory standard, so
	 * it is not footer fine print in either arm: it sits above the goods statement and the
	 * identity block, under its own heading. asserted by position rather than by prose,
	 * because that is the part a later edit would quietly undo.
	 */
	it('places the disclosure prominently, above the details, in both arms', async () => {
		const message = await rendered({
			goodsOrServices: TICKETS,
			contribution: { ...CONTRIBUTION, totalMinor: 20_000, nonDeductibleMinor: 6_000 }
		});
		for (const arm of [message.text, message.html]) {
			// the text arm shouts it in caps and the HTML arm sets it bold — same words, so the
			// comparison is case-insensitive rather than duplicated.
			expect(arm.toLowerCase()).toContain('important for your tax return');
			expect(arm.indexOf(DISCLOSURE)).toBeLessThan(arm.indexOf('In exchange for this'));
			expect(arm.indexOf(DISCLOSURE)).toBeLessThan(arm.indexOf('EIN:'));
		}
	});
});

describe('receipt.template — the HTML arm', () => {
	/**
	 * every value that came from a human is escaped by React on the way into the markup. a legal
	 * name with an ampersand in it is ordinary, and a donor name is whatever was typed into a
	 * public, unauthenticated form.
	 */
	it('escapes the organisation name and the donor name', async () => {
		const message = await rendered({
			org: { ...ORG, legalName: 'Smith & Sons <Trust>' },
			donorName: '<script>alert(1)</script>'
		});
		expect(message.html).not.toContain('<script>');
		expect(message.html).toContain('Smith &amp; Sons &lt;Trust&gt;');
		// and the text arm carries it verbatim, which is correct: there is no markup to escape.
		expect(message.text).toContain('Smith & Sons <Trust>');
	});

	// the name reaches the arm four times — the title, the thank-you, the recipient row and the
	// identity block under the rule — and every one of them is text somebody typed into /admin, so
	// none of them may be the one that goes out raw.
	it('escapes the organisation name everywhere it appears', async () => {
		const message = await rendered({ org: { ...ORG, legalName: 'Smith & Sons <Trust>' } });
		expect(message.html.match(/Smith &amp; Sons &lt;Trust&gt;/g)).toHaveLength(4);
		expect(message.html).not.toContain('Smith & Sons <');
	});

	// the description is free text an operator typed, and it lands inside the statement.
	it('escapes the goods description', async () => {
		const message = await rendered({
			goodsOrServices: { kind: 'provided', description: '<b>two</b> tickets' },
			contribution: { ...CONTRIBUTION, nonDeductibleMinor: 4_000 }
		});
		expect(message.html).toContain('&lt;b&gt;two&lt;/b&gt;');
		expect(message.html).not.toContain('<b>two</b>');
	});
});
