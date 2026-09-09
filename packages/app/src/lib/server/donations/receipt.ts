import type { TributeKind } from '@better-giving/form/v1';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { donation } from '../db/schema';
import { renderReceipt, type ReceiptContribution } from '../email/receipt';
import { readOrgProfile } from '../org/queries';
import { alert, type SettleDeps } from './delivery';

// the donor's receipt, sent once per gift that reached the books, whichever path put it there.
//
// it is a module of its own for the reason ./delivery.ts is one: both halves of the webhook end at
// it and neither may import the other. ./settle.ts settles a one-off gift against the payment row a
// quote minted, and ./collect.ts writes a collection under a standing commitment — a repeating gift
// is not downstream of a one-off one, so the step they share is lifted out rather than reached
// across.
//
// ---------------------------------------------------------------------------
// "once per gift" is enforced here rather than agreed between the callers.
//
// `receipt_sent_at` is claimed before the mail goes out and only over a row where it is still null,
// so a second call naming a gift that has one sends nothing and says nothing. it is the statement
// that decides, not a read taken beforehand and relied on — which is what keeps this out of the
// read-then-write CLAUDE.md bans, along with the column being a record of an email rather than
// money, with no balance gated on it and no total derived from it. a lost race costs a duplicate
// receipt or a backlog entry, never books that do not balance.
//
// the claim is therefore optimistic, and every way out of here that did not send has to hand it
// back — see `release`. a column left reading "sent" over a receipt nobody got is the one failure
// the unreceipted backlog cannot show anybody, which is worse than the duplicate it prevents.
//
// what a caller is trusted with is which gifts to name and nothing else, which is why a third one
// needs no rule from this comment to be correct.
//
// ---------------------------------------------------------------------------
// what it takes, and what it never raises.
//
// the gift's own figures rather than a row or a query, because the two callers hold them
// differently — ./settle.ts reads the donation it corrected, ./collect.ts holds the row it just
// minted — and because a receipt is reproducible from what is on it. the caller reads; this decides
// what is said and records that it went.
//
// every failure here is reported and none of them changes the answer to the delivery, an outright
// throw from the database or the transport included. the batch is the commit and this runs after
// it: a non-200 makes the processor redeliver, the redelivery's posting is refused by the
// constraint that refuses a duplicate, and only the mail would run again — a donor receipted twice
// for one gift.

/**
 * what one call did, for a caller that has something to say about it.
 *
 *   sent       — the donor has their receipt and the gift is stamped.
 *   no_address — there is nobody to send to. nothing was attempted, nothing was stamped, and
 *                nothing anywhere else reports it: an unaddressed donor is not a fault, so this
 *                arm raises no alert and leaves no trace but the null stamp.
 *   not_sent   — every other way of not sending, and they are one answer on purpose: the gift was
 *                already receipted by an earlier call, the deployment cannot render one yet, the
 *                transport refused it, or the step faulted. the last three have already told an
 *                operator by the time this returns, and the first means a receipt did go — so
 *                there is nothing a caller could truthfully add to any of them.
 */
export type ReceiptOutcome = 'sent' | 'no_address' | 'not_sent';

/** one gift to receipt: who to write to, and what the gift's own row says it was. */
export type ReceiptTarget = {
	/** the charge being receipted. `receipt_sent_at` is stamped on this row and no other. */
	readonly donationId: string;
	/** `null` prints a neutral greeting rather than "Dear null". */
	readonly donorName: string | null;
	/** `null` is a donor nobody has an address for, and nothing is sent. */
	readonly donorEmail: string | null;
	readonly contribution: ReceiptContribution;
	/**
	 * who the gift was given in honor or in memory of, narrowed off the gift's own columns by
	 * `projectTribute` in `$lib/donations/tributes.ts`, or `null` where it was given for nobody.
	 *
	 * a required key with a nullable value, so a caller that has one and forgets it is a compile
	 * error rather than a receipt quietly missing what the donor said. it never carries the person
	 * the donor asked us to tell: this document goes to the donor, and that is somebody else's name
	 * and somebody else's address.
	 */
	readonly tribute: { readonly kind: TributeKind; readonly honoree: string } | null;
	/**
	 * what the cause this gift was credited to is called, or `null` where it went to none.
	 *
	 * the name rather than `donation.program_id`, because a receipt is reproducible from what is on
	 * it and a pointer is not something a donor reads. a required key with a nullable value, for
	 * `tribute`'s reason: a caller holding the name and forgetting it prints a receipt that says
	 * less than the gift's own row does.
	 *
	 * the caller is what joins it — `findTarget` in ./settle.ts and `openingGift` in ./collect.ts —
	 * because both already read the gift and neither costs a round trip for it.
	 */
	readonly program: string | null;
};

/**
 * the donor's receipt, claimed, sent, and left claimed only if it went.
 *
 * a deployment that cannot render one yet hands the claim back and says so once. that is the
 * "donors still owed a receipt" backlog ../email/receipt.ts names, and it is why the template
 * refuses rather than rendering a document with a blank legal name on it.
 *
 * the claim and the send are two commits, and that is not the multi-row rule being bent: `Db` has
 * no `transaction` and one `batch()` cannot hold a send anyway. see the header for why the column
 * is not the kind of value that rule is about.
 *
 * it answers what it did rather than nothing, so that a caller with something to say about an
 * unwritten-to donor can say it without re-deriving this module's rule from the same inputs —
 * ./settled-notice.ts is the one that does. the answer is a courtesy to callers and never a
 * signal to act on: every arm that needed an operator has already told one.
 */
export async function sendReceipt(
	deps: SettleDeps,
	target: ReceiptTarget
): Promise<ReceiptOutcome> {
	if (target.donorEmail === null) return 'no_address';

	try {
		// the gift claimed, or nothing. `.returning()` is what says which happened: no row means the
		// gift already carries a stamp — or is not there at all, which is the same "nothing to
		// receipt" from here.
		const [claimed] = await deps.db
			.update(donation)
			.set({ receiptSentAt: new Date() })
			.where(and(eq(donation.id, target.donationId), isNull(donation.receiptSentAt)))
			.returning({ id: donation.id });
		if (claimed === undefined) return 'not_sent';

		const rendered = await renderReceipt({
			// a document a donor files, so an incomplete profile is refused rather than printed with a
			// gap in it — which is the refusal this function's own header describes, and the backlog
			// below is what it leaves behind.
			org: await readOrgProfile(deps.db),
			donorName: target.donorName,
			contribution: target.contribution,
			// v0 records no quid pro quo: `donation.non_deductible_minor` is written by nothing and
			// defaults to zero, so "nothing was provided in exchange" is a statement this deployment can
			// make rather than one it is guessing at.
			goodsOrServices: { kind: 'none' },
			tribute: target.tribute,
			program: target.program
		});

		if (!rendered.ok) {
			await release(deps.db, target.donationId);
			await alert(deps, {
				headline: 'A gift was recorded and its receipt could not be written',
				body:
					'The gift is in the books. The receipt was not sent, and the donor is owed one. The ' +
					'gift stays on the unreceipted list until this is fixed and it is sent.',
				facts: [
					{ label: 'Donation', value: target.donationId },
					{ label: 'Reason', value: rendered.detail }
				],
				action:
					'Open the console (`better-giving open`) and fill in the organisation’s details under Organisation.'
			});
			return 'not_sent';
		}

		const sent = await deps.email.send({ to: target.donorEmail, ...rendered.message });
		if (!sent.ok) {
			// handed back on an indeterminate send too. the alert says which it was, and a donor who
			// gets a second copy is a better outcome than one this deployment records as receipted and
			// never wrote to.
			await release(deps.db, target.donationId);
			await alert(deps, {
				headline: 'A gift was recorded and its receipt did not send',
				body:
					'The gift is in the books and the donor has not been told. It stays on the unreceipted ' +
					'list, so nothing is lost by fixing the mail settings and sending it again.',
				facts: [
					{ label: 'Donation', value: target.donationId },
					{ label: 'Reason', value: sent.reason },
					{ label: 'Detail', value: sent.detail },
					{ label: 'May have sent anyway', value: sent.indeterminate ? 'yes' : 'no' }
				],
				action:
					'Check the SMTP settings on the console (`better-giving open`) and send a test message.'
			});
			return 'not_sent';
		}

		return 'sent';
	} catch (error) {
		await faulted(deps, target.donationId, error);
		return 'not_sent';
	}
}

/**
 * hands a gift back to the unreceipted backlog, after a claim whose receipt did not go.
 *
 * unconditional where the claim is conditional, and that is the asymmetry the pair needs: the claim
 * is what proved this call owns the row, so there is no second claimant to lose a race to and
 * nothing to guard the release against.
 */
async function release(db: Db, donationId: string): Promise<void> {
	await db.update(donation).set({ receiptSentAt: null }).where(eq(donation.id, donationId));
}

/**
 * a receipt step that threw rather than answering — the database, the transport, or the render.
 *
 * both halves are guarded in turn and neither may raise. the release is what the claim is owed, and
 * it is attempted first: a gift whose receipt never went has to read as owed one. the alert then
 * goes out over a transport that may be the very thing that faulted, and `alert` logs its headline
 * and facts before it reaches that transport (./delivery.ts), so the sentence lands either way.
 */
async function faulted(deps: SettleDeps, donationId: string, error: unknown): Promise<void> {
	try {
		await release(deps.db, donationId);
	} catch {
		// the gift keeps a stamp for a receipt that did not go, and the alert below is the only
		// record of it. nothing on this path may throw.
	}

	try {
		await alert(deps, {
			headline: 'A gift was recorded and its receipt could not be attempted',
			body:
				'The gift is in the books and the step that receipts it failed outright. The donor has ' +
				'not been told and is owed a receipt.',
			facts: [
				{ label: 'Donation', value: donationId },
				{ label: 'Reason', value: error instanceof Error ? error.message : String(error) }
			],
			action:
				'Check the SMTP settings on the console (`better-giving open`) and send a test message. The ' +
				'cause is in this deployment’s logs (the Cloudflare dashboard, or `pnpm run logs` from a ' +
				'checkout).'
		});
	} catch {
		// nothing to report it to, and nothing on this path may throw.
	}
}
