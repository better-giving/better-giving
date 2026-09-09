import { uncollected } from '@better-giving/emails';
import { renderEmail } from '@better-giving/emails/render';
import type { OrgProfile } from '../db/schema';
import { present } from '../org/receipt-fields';
import type { RenderedEmail } from './provider';

// the donor's "we could not collect your gift", as this app's half of it: the one thing a
// deployment's rows have to prove before the notice may be written, and the refusal when they do
// not. what it says is packages/emails/src/templates/uncollected.tsx's.
//
// no database and no clock here either, the same as ./receipt.ts. the caller reads the rows and
// decides whether this is a message worth sending at all — ../donations/settle.ts holds that
// decision, and it is a narrow one.

/** what the message is about: an attempt that ended without money moving. */
export interface UncollectedInput {
	/** the row from `org_profile`, or `null` when nobody has filled the settings form in. */
	readonly org: OrgProfile | null;
	/** who to address it to. `null` prints a neutral greeting rather than "Dear null". */
	readonly donorName: string | null;
	/** minor units — what the donor agreed to give and was not charged. */
	readonly amountMinor: number;
	/** ISO-4217, uppercase, as `payment.currency` holds it. */
	readonly currency: string;
}

/** the rendered notice, or the one thing that stops it being written. */
export type UncollectedResult =
	| { readonly ok: true; readonly message: RenderedEmail }
	| {
			readonly ok: false;
			readonly reason: 'org_name_unknown';
			readonly detail: string;
	  };

export async function renderUncollectedNotice(input: UncollectedInput): Promise<UncollectedResult> {
	const legalName = input.org?.legalName ?? null;
	if (!present(legalName)) {
		return {
			ok: false,
			reason: 'org_name_unknown',
			detail:
				'No notice was written: the organisation has no registered name saved, and a donor ' +
				'cannot be told a payment failed by somebody they cannot identify. Open the console ' +
				'(`better-giving open`) and fill in your organisation details under Organisation.'
		};
	}

	return {
		ok: true,
		message: await renderEmail(
			uncollected.template({
				legalName,
				donorName: input.donorName,
				amountMinor: input.amountMinor,
				currency: input.currency
			})
		)
	};
}
