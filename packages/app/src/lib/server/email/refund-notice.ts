import { refundNotice } from '@better-giving/emails';
import { renderEmail } from '@better-giving/emails/render';
import type { OrgProfile } from '../db/schema';
import { present } from '../org/receipt-fields';
import type { RenderedEmail } from './provider';

// the donor's notice of a refund, as this app's half of it: the one thing a deployment's rows have
// to prove before it may be written, and the refusal when they do not. what it says is
// packages/emails/src/templates/refund-notice.tsx's.
//
// no database and no clock here, the same as ./uncollected.ts. every figure arrives worked out, and
// when the notice is sent, and that it is sent once per refund, is the caller's.

/** what the notice is about: one refund of one gift. */
export interface RefundNoticeInput {
	/** the row from `org_profile`, or `null` when nobody has filled the settings form in. */
	readonly org: OrgProfile | null;
	/** who to address it to. `null` prints a neutral greeting rather than "Dear null". */
	readonly donorName: string | null;
	/** minor units — what the gift collected. */
	readonly giftMinor: number;
	/** when the gift was made. */
	readonly givenAt: Date;
	/** minor units — this refund alone. */
	readonly refundedMinor: number;
	/**
	 * minor units — what the gift collected less every refund of it that stands, this one included;
	 * zero once the whole gift is refunded, and what the subject is read from. a dispute still open
	 * takes nothing off it.
	 */
	readonly remainingMinor: number;
	/**
	 * minor units — `remainingMinor` less the gift's `donation.non_deductible_minor`, never below
	 * zero; so zero here does not mean the whole gift was refunded.
	 */
	readonly deductibleMinor: number;
	/** ISO-4217, uppercase, as `payment.currency` holds it. */
	readonly currency: string;
}

/** the rendered notice, or the one thing that stops it being written. */
export type RefundNoticeResult =
	| { readonly ok: true; readonly message: RenderedEmail }
	| {
			readonly ok: false;
			readonly reason: 'org_name_unknown';
			readonly detail: string;
	  };

export async function renderRefundNotice(input: RefundNoticeInput): Promise<RefundNoticeResult> {
	const legalName = input.org?.legalName ?? null;
	if (!present(legalName)) {
		return {
			ok: false,
			reason: 'org_name_unknown',
			detail:
				'No notice was written: the organisation has no registered name saved, and a donor ' +
				'cannot be told of a refund by somebody they cannot identify. Open the console ' +
				'(`better-giving start`) and fill in your organisation details under Organisation.'
		};
	}

	return {
		ok: true,
		message: await renderEmail(
			refundNotice.template({
				legalName,
				donorName: input.donorName,
				giftMinor: input.giftMinor,
				givenAt: input.givenAt,
				refundedMinor: input.refundedMinor,
				remainingMinor: input.remainingMinor,
				deductibleMinor: input.deductibleMinor,
				currency: input.currency
			})
		)
	};
}
