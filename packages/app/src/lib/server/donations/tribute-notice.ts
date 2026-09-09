import { and, eq, isNull } from 'drizzle-orm';
import { projectTribute } from '../../donations/tributes';
import type { Db } from '../db/client';
import { donation } from '../db/schema';
import { renderTributeNotice } from '../email/tribute';
import { readOrgProfile } from '../org/queries';
import { alert, type SettleDeps } from './delivery';

// the notice to the person a donor asked us to tell about a gift given in someone's honor or
// memory, sent once per gift that named one.
//
// it is a module of its own for the reason ./receipt.ts is one: both halves of the webhook end at
// it and neither may import the other. ./settle.ts settles a one-off gift against the payment row a
// quote minted, and ./collect.ts writes a collection under a standing commitment, so the step they
// share is lifted out rather than reached across.
//
// ---------------------------------------------------------------------------
// "once per family" is enforced here rather than agreed between the callers.
//
// `tribute_notified_at` is claimed before the mail goes out and only over a row where it is still
// null, so a second call naming a gift that has one sends nothing and says nothing. it is the
// statement that decides, not a read taken beforehand and relied on — which is what keeps this out
// of the read-then-write CLAUDE.md bans, along with the column being a record of an email rather
// than money. the claim is optimistic, so every way out of here that did not send hands it back
// (`release`): a row reading "told" over a notice nobody got is a family nothing will ever tell,
// and unlike the receipt there is no backlog screen that would show it.
//
// ---------------------------------------------------------------------------
// a repeating gift tells one family once, and this module's null-guard is what makes that hold.
//
// the person to tell is named on the charge that opened the series and on no other: ./collect.ts
// writes both notify columns null on every later collection (../db/schema.ts states the rule at
// `tribute_notified_at`). so a later collection arrives here naming nobody and is answered
// `nobody_to_tell` before any query runs — which is what stops a monthly gift given in someone's
// memory mailing the family every month for a year. a write path added to ./collect.ts that copied
// those two columns forward would defeat it, and nothing here could tell.
//
// ---------------------------------------------------------------------------
// what it never raises.
//
// every failure is reported and none of them changes the answer to the delivery, an outright throw
// from the database or the transport included. the batch is the commit and this runs after it: a
// non-200 makes the processor redeliver, the redelivery's posting is refused by the constraint that
// refuses a duplicate, and only the mail would run again.

/**
 * what one call did, for a caller that has something to say about it.
 *
 *   nobody_to_tell — the gift names no dedication, or nobody to tell about it. nothing was
 *                    attempted, nothing was claimed, and nothing anywhere else reports it: most
 *                    gifts name nobody, and that is not a fault.
 *   sent           — the person the donor named has been told and the gift is stamped.
 *   not_sent       — every other way of not sending, and they are one answer on purpose: the gift
 *                    was already notified by an earlier call, the deployment cannot write one yet,
 *                    the transport refused it, or the step faulted. the last three have already
 *                    told an operator by the time this returns, and the first means a notice did
 *                    go — so there is nothing a caller could truthfully add to any of them.
 */
export type TributeOutcome = 'sent' | 'nobody_to_tell' | 'not_sent';

/** one gift, as the four columns behind a dedication hold it. */
export type TributeTarget = {
	/** the gift being told about. `tribute_notified_at` is stamped on this row and no other. */
	readonly donationId: string;
	/** the donor's display name. `null` says "A donor" rather than naming nobody. */
	readonly donorName: string | null;
	/**
	 * `donation.tribute_kind` and `donation.tribute_honoree`, as stored and unnarrowed.
	 *
	 * `tribute_kind` carries no CHECK and cannot be given one, so anything at all can be sitting in
	 * it (../db/schema.ts). `projectTribute` decides whether the pair is a dedication at all, and it
	 * is done here rather than asked of the callers so that one of them cannot get it wrong.
	 */
	readonly tributeKind: string | null;
	readonly tributeHonoree: string | null;
	/** `donation.tribute_notify_name` and `donation.tribute_notify_email`. */
	readonly notifyName: string | null;
	readonly notifyEmail: string | null;
};

/**
 * tells the person a donor named, claimed, sent, and left claimed only if it went.
 *
 * the claim and the send are two commits, and that is not the multi-row rule being bent: `Db` has
 * no `transaction` and one `batch()` cannot hold a send anyway. ./receipt.ts's header argues it for
 * the column beside this one.
 *
 * it answers what it did, the same courtesy `sendReceipt` extends. nothing reads that answer, and
 * it is never a signal to act on: every arm that needed an operator has already told one.
 */
export async function sendTributeNotice(
	deps: SettleDeps,
	target: TributeTarget
): Promise<TributeOutcome> {
	const dedication = projectTribute(target.tributeKind, target.tributeHonoree);
	// no query on this path, which is what the once-per-series rule above rests on.
	if (dedication === null || target.notifyName === null || target.notifyEmail === null) {
		return 'nobody_to_tell';
	}

	try {
		// the gift claimed, or nothing. `.returning()` is what says which happened: no row means the
		// gift already carries a stamp — or is not there at all, which is the same "nobody left to
		// tell" from here.
		const [claimed] = await deps.db
			.update(donation)
			.set({ tributeNotifiedAt: new Date() })
			.where(and(eq(donation.id, target.donationId), isNull(donation.tributeNotifiedAt)))
			.returning({ id: donation.id });
		if (claimed === undefined) return 'not_sent';

		const rendered = await renderTributeNotice({
			org: await readOrgProfile(deps.db),
			notifyName: target.notifyName,
			donorName: target.donorName,
			tribute: dedication
		});

		if (!rendered.ok) {
			await release(deps.db, target.donationId);
			await alert(deps, {
				headline: 'A gift was recorded and the person it was dedicated to could not be told',
				body:
					'The gift is in the books. The donor asked that somebody be told it was made, and the ' +
					'notice could not be written. Nothing will try again on its own.',
				facts: [
					{ label: 'Donation', value: target.donationId },
					{ label: 'Reason', value: rendered.detail }
				],
				action:
					'Open the console (`better-giving open`) and fill in the organisation’s details under Organisation.'
			});
			return 'not_sent';
		}

		const sent = await deps.email.send({ to: target.notifyEmail, ...rendered.message });
		if (!sent.ok) {
			// handed back on an indeterminate send too. the alert says which it was, and a family who
			// gets a second copy is a better outcome than one this deployment records as told and never
			// wrote to.
			await release(deps.db, target.donationId);
			await alert(deps, {
				headline: 'A gift was recorded and the person it was dedicated to could not be told',
				body:
					'The gift is in the books. The person the donor asked us to tell was not written to, ' +
					'and nothing will try again on its own.',
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
 * hands the claim back, after a claim whose notice did not go.
 *
 * unconditional where the claim is conditional, and that is the asymmetry the pair needs: the claim
 * is what proved this call owns the row, so there is no second claimant to lose a race to and
 * nothing to guard the release against.
 */
async function release(db: Db, donationId: string): Promise<void> {
	await db.update(donation).set({ tributeNotifiedAt: null }).where(eq(donation.id, donationId));
}

/**
 * a step that threw rather than answering — the database, the transport, or the render.
 *
 * both halves are guarded in turn and neither may raise. the release is what the claim is owed, and
 * it is attempted first. the alert then goes out over a transport that may be the very thing that
 * faulted, and `alert` logs its headline and facts before it reaches that transport
 * (./delivery.ts), so the sentence lands either way.
 */
async function faulted(deps: SettleDeps, donationId: string, error: unknown): Promise<void> {
	try {
		await release(deps.db, donationId);
	} catch {
		// the gift keeps a stamp for a notice that did not go, and the alert below is the only record
		// of it. nothing on this path may throw.
	}

	try {
		await alert(deps, {
			headline: 'A gift was recorded and the person it was dedicated to could not be told',
			body:
				'The gift is in the books and the step that writes to them failed outright. The donor ' +
				'asked that somebody be told the gift was made, and nobody was.',
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
