import { grantReceived, grantRequested } from '@better-giving/emails';
import { renderEmail } from '@better-giving/emails/render';
import { TRIBUTE_KIND_LABELS, type TributeKind } from '@better-giving/form/v1';
import type { OrgProfile } from '../db/schema';
import { present } from '../org/receipt-fields';
import type { RenderedEmail } from './provider';

// the donor's two notices about a donor-advised fund grant, as this app's half of them: the one
// thing a deployment's rows have to prove before either may be written, and the refusal when they
// do not. what each says is packages/emails/src/templates/grant-requested.tsx's and
// grant-received.tsx's.
//
// no database and no clock here, the same as ./receipt.ts and ./uncollected.ts. when each is sent,
// and that it is sent once, is ../donations/grant-requested.ts's and ../donations/receipt.ts's.

/** what either notice is about: one grant, from the gift's own figures. */
export interface GrantNoticeInput {
	/** the row from `org_profile`, or `null` when nobody has filled the settings form in. */
	readonly org: OrgProfile | null;
	/** who to address it to. `null` prints a neutral greeting rather than "Dear null". */
	readonly donorName: string | null;
	/** minor units — the gift portion, never the grant total with a covered fee in it. */
	readonly amountMinor: number;
	/** ISO-4217, uppercase, as `payment.currency` holds it. */
	readonly currency: string;
	/** who the gift was given in honor or in memory of, or `null` where it was given for nobody. */
	readonly tribute: { readonly kind: TributeKind; readonly honoree: string } | null;
}

/** the rendered notice, or the one thing that stops it being written. */
export type GrantNoticeResult =
	| { readonly ok: true; readonly message: RenderedEmail }
	| {
			readonly ok: false;
			readonly reason: 'org_name_unknown';
			readonly detail: string;
	  };

export function renderGrantRequested(input: GrantNoticeInput): Promise<GrantNoticeResult> {
	return render(input, grantRequested.template);
}

export function renderGrantReceived(input: GrantNoticeInput): Promise<GrantNoticeResult> {
	return render(input, grantReceived.template);
}

async function render(
	input: GrantNoticeInput,
	template: typeof grantRequested.template | typeof grantReceived.template
): Promise<GrantNoticeResult> {
	const legalName = input.org?.legalName ?? null;
	if (!present(legalName)) {
		return {
			ok: false,
			reason: 'org_name_unknown',
			detail:
				'No notice was written: the organisation has no registered name saved, and a donor ' +
				'cannot be told where their grant is going by somebody they cannot identify. Open the ' +
				'console (`better-giving start`) and fill in your organisation details under Organisation.'
		};
	}

	return {
		ok: true,
		message: await renderEmail(
			template({
				legalName,
				donorName: input.donorName,
				amountMinor: input.amountMinor,
				currency: input.currency,
				// the phrase, not the kind, as ./receipt.ts hands it over.
				dedication:
					input.tribute === null
						? null
						: { label: TRIBUTE_KIND_LABELS[input.tribute.kind], honoree: input.tribute.honoree }
			})
		)
	};
}
