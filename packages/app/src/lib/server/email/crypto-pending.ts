import { cryptoPending } from '@better-giving/emails';
import { renderEmail } from '@better-giving/emails/render';
import type { OrgProfile } from '../db/schema';
import { present } from '../org/receipt-fields';
import type { RenderedEmail } from './provider';

// the donor's notice of where to send a crypto gift, as this app's half of it: the one thing a
// deployment's rows have to prove before it may be written, and the refusal when they do not. what
// it says is packages/emails/src/templates/crypto-pending.tsx's.
//
// no database and no clock here, the same as ./grant.ts. when it is sent, and that it is sent once,
// is the caller's.

/** what the notice is about: one address minted for one gift. */
export interface CryptoPendingInput {
	/** the row from `org_profile`, or `null` when nobody has filled the settings form in. */
	readonly org: OrgProfile | null;
	/** who to address it to. `null` prints a neutral greeting rather than "Dear null". */
	readonly donorName: string | null;
	/** the coin as a donor reads it — `Tether USD`, never the processor's code. */
	readonly coinName: string;
	/** the network the coin travels on. */
	readonly network: string;
	/** a canonical decimal string, handed through verbatim. */
	readonly coinAmount: string;
	readonly address: string;
	/** the memo the payment carries, or `null` where it carries none. */
	readonly memo: string | null;
	/** whether a payment sent without `memo` cannot be matched to the gift. */
	readonly memoRequired: boolean;
	/** when the address stops taking this gift. */
	readonly validUntil: Date;
}

/** the rendered notice, or the one thing that stops it being written. */
export type CryptoPendingResult =
	| { readonly ok: true; readonly message: RenderedEmail }
	| {
			readonly ok: false;
			readonly reason: 'org_name_unknown';
			readonly detail: string;
	  };

export async function renderCryptoPending(input: CryptoPendingInput): Promise<CryptoPendingResult> {
	const legalName = input.org?.legalName ?? null;
	if (!present(legalName)) {
		return {
			ok: false,
			reason: 'org_name_unknown',
			detail:
				'No notice was written: the organisation has no registered name saved, and a donor ' +
				'cannot be told where to send a gift by somebody they cannot identify. Open the ' +
				'console (`better-giving start`) and fill in your organisation details under Organisation.'
		};
	}

	return {
		ok: true,
		message: await renderEmail(
			cryptoPending.template({
				legalName,
				donorName: input.donorName,
				coinName: input.coinName,
				network: input.network,
				coinAmount: input.coinAmount,
				address: input.address,
				memo: input.memo,
				memoRequired: input.memoRequired,
				validUntil: input.validUntil
			})
		)
	};
}
