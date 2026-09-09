import { tribute } from '@better-giving/emails';
import { renderEmail } from '@better-giving/emails/render';
import { TRIBUTE_KIND_LABELS, type TributeKind } from '@better-giving/form/v1';
import type { OrgProfile } from '../db/schema';
import { present } from '../org/receipt-fields';
import type { RenderedEmail } from './provider';

// the notice to the person a donor asked us to tell about a gift given in someone's honor or
// memory, as this app's half of it: the one thing a deployment's rows have to prove before the
// notice may be written, and the refusal when they do not. what it says is
// packages/emails/src/templates/tribute.tsx's.
//
// no database and no clock, the same as ./receipt.ts and ./uncollected.ts. the caller reads the
// rows, claims the send and decides whether there is anybody to write to at all —
// ../donations/tribute-notice.ts holds all three.
//
// the kind becomes a phrase here and nowhere further in: `@better-giving/emails` may not import
// `@better-giving/form`, so the two words a donor was asked in are mapped at this boundary, exactly
// as ./receipt.ts maps them for the dedication row on a receipt. one mapping in one direction, so
// the notice and the receipt cannot word one gift differently.

/** what the message is about: a gift, who it was for, and who asked for this to be sent. */
export interface TributeNoticeInput {
	/** the row from `org_profile`, or `null` when nobody has filled the settings form in. */
	readonly org: OrgProfile | null;
	/** `donation.tribute_notify_name` — who this is addressed to. */
	readonly notifyName: string;
	/** the donor's display name, or `null` where the gift names nobody to say it was from. */
	readonly donorName: string | null;
	/**
	 * what the gift was given for, narrowed off the gift's own two columns by `projectTribute` in
	 * `$lib/donations/tributes.ts`. a notice with no dedication on it is not a message at all, so
	 * this is required rather than nullable and the caller returns before it gets here.
	 */
	readonly tribute: { readonly kind: TributeKind; readonly honoree: string };
}

/** the rendered notice, or the one thing that stops it being written. */
export type TributeNoticeResult =
	| { readonly ok: true; readonly message: RenderedEmail }
	| {
			readonly ok: false;
			readonly reason: 'org_name_unknown';
			readonly detail: string;
	  };

export async function renderTributeNotice(input: TributeNoticeInput): Promise<TributeNoticeResult> {
	const legalName = input.org?.legalName ?? null;
	if (!present(legalName)) {
		return {
			ok: false,
			reason: 'org_name_unknown',
			detail:
				'No notice was written: the organisation has no registered name saved, and this message ' +
				'goes to somebody who never gave this deployment an address, about somebody they have ' +
				'lost. An organisation that cannot name itself is indistinguishable from a stranger. ' +
				'Open the console (`better-giving open`) and fill in your organisation details under ' +
				'Organisation.'
		};
	}

	return {
		ok: true,
		message: await renderEmail(
			tribute.template({
				legalName,
				notifyName: input.notifyName,
				donorName: input.donorName,
				// the phrase, not the kind: the template prints what it is handed, and the two words a
				// donor was asked in are `@better-giving/form`'s to spell.
				tribute: {
					label: TRIBUTE_KIND_LABELS[input.tribute.kind],
					honoree: input.tribute.honoree
				}
			})
		)
	};
}
