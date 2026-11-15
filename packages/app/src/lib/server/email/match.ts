import { matchPack, matchReminder } from '@better-giving/emails';
import { renderEmail } from '@better-giving/emails/render';
import { IDENTITY_FOLD } from '@better-giving/operator/setup-folds';
import type { OrgProfile } from '../db/schema';
import { listFields, present, type ReceiptField } from '../org/receipt-fields';
import type { RenderedEmail } from './provider';

// the employer match pack and its one reminder, as this app's half of them: what a deployment's
// rows have to prove before either may be written, the refusal when they do not, and the filing
// address read off the profile. what each says is packages/emails/src/templates/match-pack.tsx's
// and match-reminder.tsx's.
//
// no database and no clock here, the same as ./receipt.ts. when each is sent, and that the
// reminder goes once, is the caller's.
//
// the employer is the donor's own words and reaches this donor's mail alone (AGENTS.md → Product
// surface): no refusal below carries it, so a caller that logs a refusal logs none of it.

/** the pack: sent once, as soon as the donor names their employer. */
export interface MatchPackInput {
	/** the row from `org_profile`, or `null` when nobody has filled the settings form in. */
	readonly org: OrgProfile | null;
	/** `contact.display_name`. `null` prints a neutral greeting rather than "Dear null". */
	readonly donorName: string | null;
	/** the employer the donor named, as stored. */
	readonly employer: string;
	/**
	 * minor units — what is left of the gift after the refunds that stand on it, as
	 * `readMatchGift` in ../donations/queries.ts reads it (`remainingMinor`).
	 */
	readonly amountMinor: number;
	/** ISO-4217, uppercase, as `donation.currency` holds it. */
	readonly currency: string;
	/** `donation.received_at`. */
	readonly givenAt: Date;
	/** `donation.receipt_sent_at`, or `null` where no receipt has gone out — the row is left out. */
	readonly receiptSentAt: Date | null;
	/** the absolute address of the donor's own page for this gift. */
	readonly giftPageUrl: string;
	/** whether the one reminder will be sent: the pack promises it only then. */
	readonly reminds: boolean;
}

/** the reminder: sent once, three days after the pack, while the gift is not marked filed. */
export interface MatchReminderInput {
	/** what the organisation is called in prose; the subject names it. */
	readonly displayName: string;
	/** `contact.display_name`. `null` prints a neutral greeting rather than "Dear null". */
	readonly donorName: string | null;
	/** the employer the donor named, as stored. */
	readonly employer: string;
	/**
	 * minor units — what is left of the gift after the refunds that stand on it, as
	 * `readMatchGift` in ../donations/queries.ts reads it (`remainingMinor`).
	 */
	readonly amountMinor: number;
	/** ISO-4217, uppercase, as `donation.currency` holds it. */
	readonly currency: string;
	/** `donation.received_at`. */
	readonly givenAt: Date;
	/** the absolute address of the donor's own page for this gift. */
	readonly giftPageUrl: string;
}

/** the two fields the filing block cannot be written without. */
type FilerField = Extract<ReceiptField, 'legal_name' | 'tax_id'>;

/** an employer that is blank once trimmed: a mail naming it would ask nobody to match. */
type EmployerUnnamed = {
	readonly ok: false;
	readonly reason: 'employer_unnamed';
	readonly detail: string;
};

export type MatchPackResult =
	| { readonly ok: true; readonly message: RenderedEmail }
	| {
			readonly ok: false;
			readonly reason: 'filer_incomplete';
			/** which fields, in the vocabulary /admin's settings form uses for its inputs. */
			readonly missing: readonly FilerField[];
			readonly detail: string;
	  }
	| EmployerUnnamed;

export type MatchReminderResult =
	| { readonly ok: true; readonly message: RenderedEmail }
	| { readonly ok: false; readonly reason: 'org_name_unknown'; readonly detail: string }
	| EmployerUnnamed;

const EMPLOYER_UNNAMED: EmployerUnnamed = {
	ok: false,
	reason: 'employer_unnamed',
	detail: 'No match mail was written: the gift names no employer.'
};

/** the filing fields the profile lacks, in the settings form's vocabulary; none where both are saved. */
export function missingFilerFields(org: OrgProfile | null): readonly FilerField[] {
	return [
		...(present(org?.legalName ?? null) ? [] : (['legal_name'] as const)),
		...(present(org?.taxId ?? null) ? [] : (['tax_id'] as const))
	];
}

/** renders the pack, or says what stops it being written. */
export async function renderMatchPack(input: MatchPackInput): Promise<MatchPackResult> {
	const legalName = input.org?.legalName ?? null;
	const ein = input.org?.taxId ?? null;
	if (!present(legalName) || !present(ein)) {
		const missing = missingFilerFields(input.org);
		return {
			ok: false,
			reason: 'filer_incomplete',
			missing,
			detail:
				`No match pack was written: the organisation's ${listFields(missing)} ` +
				`${missing.length === 1 ? 'is' : 'are'} not saved, and an employer's giving portal ` +
				`asks for both. Fill in what’s missing under ${IDENTITY_FOLD} in Settings.`
		};
	}
	if (!present(input.employer)) return EMPLOYER_UNNAMED;

	return {
		ok: true,
		message: await renderEmail(
			matchPack.template({
				donorName: input.donorName,
				employer: input.employer,
				filer: { legalName, ein, address: mailingAddress(input.org) },
				amountMinor: input.amountMinor,
				currency: input.currency,
				givenAt: input.givenAt,
				receiptSentAt: input.receiptSentAt,
				giftPageUrl: input.giftPageUrl,
				reminds: input.reminds
			})
		)
	};
}

/** renders the reminder, or says what stops it being written. */
export async function renderMatchReminder(input: MatchReminderInput): Promise<MatchReminderResult> {
	if (!present(input.displayName)) {
		return {
			ok: false,
			reason: 'org_name_unknown',
			detail:
				'No match reminder was written: the organisation has no name to sign it with, and a ' +
				'donor cannot be reminded by somebody they cannot identify.'
		};
	}
	if (!present(input.employer)) return EMPLOYER_UNNAMED;

	return {
		ok: true,
		message: await renderEmail(
			matchReminder.template({
				displayName: input.displayName,
				donorName: input.donorName,
				employer: input.employer,
				amountMinor: input.amountMinor,
				currency: input.currency,
				givenAt: input.givenAt,
				giftPageUrl: input.giftPageUrl
			})
		)
	};
}

/**
 * the profile's mailing address on one line — `1250 Mill Street, Suite 200, Cincinnati, OH 45202,
 * United States` — or `null` where its street, city or country is unsaved, the three a receipt
 * requires (`RECEIPT_FIELDS` in ../org/receipt-fields.ts). a part address is no address to file,
 * and the pack and the gift page (../matching/views.ts) leave the row out rather than print one.
 */
export function mailingAddress(org: OrgProfile | null): string | null {
	if (org === null) return null;
	const { addressLine1, city, country } = org;
	if (!present(addressLine1) || !present(city) || !present(country)) return null;
	const regionAndPostcode = [org.region, org.postalCode].filter(present).join(' ');
	return [
		addressLine1,
		...(present(org.addressLine2) ? [org.addressLine2] : []),
		regionAndPostcode === '' ? city : `${city}, ${regionAndPostcode}`,
		country
	].join(', ');
}
