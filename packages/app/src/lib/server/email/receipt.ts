import { receipt } from '@better-giving/emails';
import { renderEmail } from '@better-giving/emails/render';
import { TRIBUTE_KIND_LABELS, type TributeKind } from '@better-giving/form/v1';
import type { OrgProfile } from '../db/schema';
import { listFields, profileForReceipt, type ReceiptField } from '../org/receipt-fields';
import type { RenderedEmail } from './provider';

// the donor's receipt — the one document this app produces that somebody else files with a
// tax authority. this file is the app's half of it: what a deployment's own rows have to prove
// before one may be printed, and the refusal when they do not.
//
// what is on a receipt and why is packages/emails/src/templates/receipt.tsx's, which renders
// what it is given and refuses nothing.
//
// no database, no clock, no randomness: a model in, a message or a refusal out — the same
// discipline ../ledger/posting.ts states for `post()`, and for a sharper reason here. a receipt
// that read the profile itself could say something different about the same gift depending on
// when it ran, and the whole value of a receipt is that it is reproducible. the caller reads the
// row; this decides whether it may be printed at all.

/** the gift, as the `donation` row holds it. */
export interface ReceiptContribution extends receipt.ReceiptContribution {
	/**
	 * `donation.fee_minor` — the processing fee the donor chose to add on top, quoted to them
	 * before they pressed and included in `totalMinor`. zero on a gift where nobody covered one.
	 *
	 * nothing on the receipt prints it or anything derived from it. the document states the total
	 * the donor paid, which is the figure their bank shows and the figure the books hold; how that
	 * total was made up is this deployment's bookkeeping. it is on this model for the consistency
	 * check below, which refuses a gift whose two amount columns contradict each other — which is
	 * why it is here and not on the package's own model.
	 *
	 * it is the quoted fee and never the processor's settled one (`Settlement.feeMinor` in
	 * ../payments/provider.ts). that number is what the processor that moved the money actually
	 * took, off a settlement record the donor never saw and never agreed to. the two are separate columns for that
	 * reason — ../donations/entries.ts says the same thing from the ledger's side.
	 */
	readonly coveredFeeMinor: number;
}

export interface ReceiptInput {
	/**
	 * the row from `org_profile`, or `null` when nobody has filled the settings form in.
	 * `null` is an expected input, not a caller error — see the refusal below.
	 */
	readonly org: OrgProfile | null;
	/**
	 * who to address it to: `contact.display_name`, one string a donor typed or a form derived,
	 * untrimmed, which the database proves only is not blank. `null` prints a neutral greeting
	 * rather than "Dear null".
	 */
	readonly donorName: string | null;
	readonly contribution: ReceiptContribution;
	readonly goodsOrServices: receipt.GoodsOrServices;
	/**
	 * who the gift was given in honor or in memory of, or `null` where it was given for nobody.
	 *
	 * a required key with a nullable value: a caller that forgot it would otherwise print a receipt
	 * silently missing a fact the donor stated, and the gift most likely to be dedicated is the one
	 * somebody reads closest.
	 *
	 * it names the honoree and nothing else. the person the donor asked us to tell is a third
	 * party — their name and their address, typed into a form — and this document goes to the
	 * donor, so there is no field here for either and none may be added. `donation.tribute_kind`
	 * carries no CHECK, so a caller narrows before it gets here: `projectTribute` in
	 * ../donations/tributes.ts is what does.
	 */
	readonly tribute: { readonly kind: TributeKind; readonly honoree: string } | null;
	/**
	 * what the cause the gift was credited to is called, or `null` where it went to none.
	 *
	 * a required key with a nullable value for `tribute`'s reason. the name and never the id: the
	 * pointer is on the gift's own row and a donor reads words, so what arrives here is already the
	 * `program.name` its caller joined.
	 */
	readonly program: string | null;
}

/**
 * it refuses instead of throwing, and it refuses instead of rendering blanks.
 *
 * `org/queries.ts` states the rule this implements: a receipt template that finds no profile
 * must not render a blank one. a receipt with an empty name or no EIN is worse than no
 * receipt at all — it is a document a donor files and an auditor rejects, and by then the
 * gift is a year old. and it must not throw, because the caller that renders it is the caller
 * that has already committed the gift to the ledger; see `EmailProvider.send`, which makes
 * the same promise for the same reason.
 *
 * so an incomplete deployment produces a value the caller can act on: leave
 * `donation.receipt_sent_at` null, which is exactly the "donors still owed a receipt"
 * backlog, and fix the settings.
 *
 * nothing is carved out of that. every rendering this app produces is a document somebody files,
 * so there is no degraded mode and no reader for whom a gap is acceptable — a caller that finds a
 * field unsaved gets the refusal, and the way out of it is filling the field in.
 */
export type ReceiptResult =
	| { readonly ok: true; readonly message: RenderedEmail }
	| {
			readonly ok: false;
			readonly reason: 'org_profile_incomplete';
			/** which fields, in the vocabulary /admin's settings form uses for its inputs. */
			readonly missing: readonly ReceiptField[];
			readonly detail: string;
	  }
	| {
			readonly ok: false;
			readonly reason: 'goods_or_services_incomplete';
			readonly detail: string;
	  }
	/**
	 * the mirror image of `goods_or_services_incomplete`, and a separate reason because it is a
	 * separate problem. that one is a gift somebody has not finished describing; this one is a
	 * gift whose record contradicts itself — a fair market value with nothing recorded as
	 * provided, or a value larger than the payment it came out of. no operator input fills that
	 * in, so the two must not read alike.
	 */
	| {
			readonly ok: false;
			readonly reason: 'goods_or_services_inconsistent';
			readonly detail: string;
	  }
	/**
	 * a covered fee larger than the payment it was added to. a separate reason from the two above
	 * because it is a separate column and a separate correction: nothing about goods or services is
	 * wrong on that gift, and an operator sent to the fair market value would find it right.
	 */
	| {
			readonly ok: false;
			readonly reason: 'covered_fee_inconsistent';
			readonly detail: string;
	  };

/** renders the receipt, or explains why this deployment cannot print one yet. */
export async function renderReceipt(input: ReceiptInput): Promise<ReceiptResult> {
	const profile = profileForReceipt(input.org);
	if (!profile.ok) {
		return {
			ok: false,
			reason: 'org_profile_incomplete',
			// the machine-readable half stays field names: a caller marks the inputs with it.
			missing: profile.missing,
			/**
			 * words, not columns, and caller-neutral. a column name here is schema vocabulary on a
			 * screen, which CLAUDE.md forbids and `org/receipt-fields.ts` holds the words for. and it
			 * claims nothing about whether a gift was recorded: this function does not know whether
			 * anything was posted either way.
			 */
			detail:
				`No receipt was rendered: the organisation's ${listFields(profile.missing)} ` +
				`${profile.missing.length === 1 ? 'is' : 'are'} not saved, and a receipt must carry ` +
				'them. Open the console (`better-giving start`) and fill in your organisation details ' +
				'under Organisation.'
		};
	}

	const goods = input.goodsOrServices;
	const fairMarketValueMinor = input.contribution.nonDeductibleMinor;

	if (goods.kind === 'provided') {
		// a receipt that says goods were provided and estimates their value at nothing is not a
		// receipt, it is a §6115 violation with a friendly tone. both halves or neither.
		if (goods.description.trim() === '' || fairMarketValueMinor <= 0) {
			return {
				ok: false,
				reason: 'goods_or_services_incomplete',
				detail:
					'No receipt was rendered: this gift is recorded as one where the donor received ' +
					'goods or services, but the description or the fair market value ' +
					'(`donation.non_deductible_minor`) is missing. The IRS requires both: a description ' +
					'of what was provided and a good-faith estimate of its value.'
			};
		}
	} else if (fairMarketValueMinor !== 0) {
		/**
		 * the other half of "both halves or neither". the guard above runs in one direction only,
		 * so without this one `{ totalMinor: 20_000, nonDeductibleMinor: 6_000 }` with
		 * `kind: 'none'` renders happily: it prints "No goods or services were provided to you
		 * in exchange for this contribution", omits the §6115 disclosure because the template
		 * discloses only on `kind === 'provided'`, and contradicts the books — on the one document a
		 * donor files with a tax return. `intangible_religious` is the same hole.
		 *
		 * a non-zero fair market value is the record of goods provided. it cannot be true
		 * alongside a statement that nothing was.
		 */
		return {
			ok: false,
			reason: 'goods_or_services_inconsistent',
			detail:
				'No receipt was rendered: this gift carries a fair market value ' +
				'(`donation.non_deductible_minor`) but is recorded as one where the donor received ' +
				`${goods.kind === 'none' ? 'nothing' : 'only intangible religious benefits'} in ` +
				'return. A receipt printed from that would state the opposite of what the books say ' +
				'and would omit the §6115 disclosure. Correct the donation record.'
		};
	}

	/**
	 * more value received than money paid is not a contribution, and nothing else here refuses
	 * it: the receipt prints a payment and a larger "value of what you received" beside it, with
	 * the disclosure explaining that the deductible part is the excess of one over the other —
	 * an excess that is negative.
	 */
	if (fairMarketValueMinor > input.contribution.totalMinor) {
		return {
			ok: false,
			reason: 'goods_or_services_inconsistent',
			detail:
				'No receipt was rendered: the fair market value recorded against this gift ' +
				'(`donation.non_deductible_minor`) is larger than the payment itself ' +
				'(`donation.total_minor`), so there is no contribution to acknowledge. Correct the ' +
				'donation record.'
		};
	}

	/**
	 * the same shape of nonsense as the check above, from the other column: a fee larger than the
	 * payment it was added to is a gift whose record contradicts itself — the money taken cannot be
	 * less than the part of it that was fee.
	 *
	 * nothing upstream prevents it. `donation_fee_minor_check` asserts only `>= 0`, and the schema
	 * carries no cross-column amount check on purpose — see `donation` in ../db/schema.ts, where
	 * the reason is that a two-column check blocks `DROP COLUMN` on both of them.
	 *
	 * neither figure reaches the document any more, so this refuses over what the row says rather
	 * than over what would print: the receipt is what a correction gets checked against later, and a
	 * corrupt row nobody was told about is a row nobody fixes. the caller's refusal path is the
	 * telling — ../donations/receipt.ts leaves the gift unreceipted and alerts.
	 */
	if (input.contribution.coveredFeeMinor > input.contribution.totalMinor) {
		return {
			ok: false,
			reason: 'covered_fee_inconsistent',
			detail:
				'No receipt was rendered: the processing fee recorded against this gift ' +
				'(`donation.fee_minor`) is larger than the payment itself (`donation.total_minor`), so ' +
				'the record contradicts itself and no receipt printed from it could be true. Correct ' +
				'the donation record.'
		};
	}

	/**
	 * the eight fields a receipt prints and nothing else off the row. `profile.org` is a whole
	 * `OrgProfile` with its receipt fields proven, and the notification address, the deductibility
	 * wording and the timestamps come with it — none of which belongs on a document a donor files.
	 */
	const org: receipt.ReceiptOrg = {
		legalName: profile.org.legalName,
		taxId: profile.org.taxId,
		addressLine1: profile.org.addressLine1,
		addressLine2: profile.org.addressLine2,
		city: profile.org.city,
		region: profile.org.region,
		postalCode: profile.org.postalCode,
		country: profile.org.country
	};

	return {
		ok: true,
		message: await renderEmail(
			receipt.template({
				org,
				donorName: input.donorName,
				contribution: input.contribution,
				goodsOrServices: goods,
				// the phrase, not the kind: the template prints what it is handed, and the two words a
				// donor was asked in are `@better-giving/form`'s to spell.
				tribute:
					input.tribute === null
						? null
						: {
								label: TRIBUTE_KIND_LABELS[input.tribute.kind],
								honoree: input.tribute.honoree
							},
				program: input.program
			})
		)
	};
}
