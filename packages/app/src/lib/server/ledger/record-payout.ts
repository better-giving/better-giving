import { alert, commit, type SettleDeps, type SettleResult } from '../donations/delivery';
import { payoutWrites } from '../books/writes';
import type { PayoutEvent } from '../payments/provider';
import { payoutReturnedPosting, payoutSettledPosting } from './payouts';
import { PostingError } from './posting';

// books a sponsor's payout event: `settleEvent` in ../donations/settle.ts hands every `payout`
// kind here, from a webhook delivery (`/api/sponsor/events`) or from the hourly pull
// (../payouts/pull.ts). a settled payout is grant income and a returned one is part of it going
// back; the two entries are ./payouts.ts's, and this file owns only the write.
//
// the key is the sponsor's own id, `settled:<payout_id>` or `returned:<return_id>`, and
// `entry_group_source_idx` in ../db/schema.ts is what makes a redelivered payout a no-op: the
// batch comes back from `commit` as `already_posted` and is answered 200, as a redelivered
// settlement is. nothing is read before the write, for `post()`'s reason.
//
// a body the ledger refuses — a negative amount, a currency it does not hold, an empty id — is a
// `PostingError` and is a payout this app cannot book rather than a fault worth a retry: staff are
// told and the event is answered 200, as anything a redelivery reads the same way is.
//
// a payout posts and does nothing else. no gift row points at it, no QuickBooks row is queued, and
// no Zap or webhook fires. a gift the sponsor took posts no income of its own (`paidOutByDonee` in
// ../payments/provider.ts), so the payout is where these books first see that money.

/** books one payout event from a body this app already trusts. never throws. */
export async function recordPayout(deps: SettleDeps, event: PayoutEvent): Promise<SettleResult> {
	const { payout } = event;
	let key: string;
	try {
		const posting =
			payout.kind === 'settled'
				? payoutSettledPosting(payout.body)
				: payoutReturnedPosting(payout.body);
		key = posting.group.sourceId;
		const committed = await commit(deps.db, payoutWrites(deps.db, posting));
		if (committed === 'failed') {
			return {
				ok: false,
				reason: 'incomplete',
				detail: `payout ${key} could not be written to the books, so it is worth delivering again.`
			};
		}
		if (committed === 'already_posted') {
			return {
				ok: true,
				outcome: 'already_posted',
				detail: `payout ${key} is already in the books; this event changed nothing.`
			};
		}
	} catch (error) {
		if (!(error instanceof PostingError)) throw error;
		await alert(deps, {
			headline: 'A Better Giving payout could not be put in your books',
			body:
				'Better Giving reported a payout, and the amount or its currency is one your ledger ' +
				'will not take. Nothing was posted.',
			facts: [
				{ label: 'Payout event', value: event.id },
				{ label: 'Type', value: event.type },
				{ label: 'Ledger refused it as', value: error.code }
			],
			action:
				'The payout itself is at Better Giving, in your payouts and bank details. Enter it ' +
				'on the Books page once you know why the ledger refused it.'
		}).catch(() => undefined);
		return {
			ok: true,
			outcome: 'unactionable',
			detail: `payout event ${event.id} is one the ledger refused as ${error.code}: ${error.message}`
		};
	}
	return {
		ok: true,
		outcome: 'updated',
		detail: `payout ${key} is in the books.`
	};
}
