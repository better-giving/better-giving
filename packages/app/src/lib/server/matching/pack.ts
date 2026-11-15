import { and, asc, eq, exists, isNotNull, isNull, lte, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';
import { contact, donation, giftMatch } from '../db/schema';
import { readMatchGift } from '../donations/queries';
import type { MailDeps } from '../email/alert';
import { missingFilerFields, renderMatchPack } from '../email/match';
import { readOrgProfile } from '../org/queries';
import { type GiftOrigin, giftPageUrl } from './links';
import { inBooks, type MatchKey, type MatchWrite, nameEmployer, REMINDER_AFTER_MS } from './match';

// the pack: the filing details, mailed at once when the donor first names an employer.
//
// the claim arms the one reminder (./reminders.ts) `REMINDER_AFTER_MS` after it, as the pack's own
// copy promises (packages/emails/src/templates/match-pack.tsx), and handing a claim back disarms it:
// no reminder falls due for a pack that did not go. it arms one only where the origin is pinned
// (`GiftOrigin` in ./links.ts): the sweep runs with no request and names the page on the pin alone,
// so on a request's host the pack promises no reminder and none falls due.
//
// claimed before the send and only over a row still owed one, the claim pattern
// ../donations/receipt.ts states for the receipt: `pack_sent_at` set where it is null, the send, and
// on every way out that did not send the claim handed back with `pack_failed_at` stamped in the same
// statement, which the gifts list shows as "Details email failed". a send that went clears an earlier
// failure in its claim.
//
// a pack that failed is claimed again by `sendFailedPacks`, which `CRON_RUNS` in src/cron-runs.ts
// runs beside the reminders, once `PACK_RETRY_AFTER_MS` has passed since its stamp: the claim moves
// that stamp on every failure, so one row is tried at most once in that time. the retry claims
// through the same predicate as the first send, so a pack that went is never claimed again.
//
// owed only once the gift is in the books. a donor can name the employer on the thank-you before
// the processor's settlement arrives, so the receipt step asks again once it does
// (`sendReceipt` in ../donations/receipt.ts), and whichever call claims first sends.
//
// nothing here throws, and no refusal or log line carries the employer: it is the donor's own words
// and reaches their mail alone.

/** what the pack needs besides the database and the transport: the origin its link is built on. */
export type PackDeps = MailDeps & {
	/** `giftLinkOrigin` in ./links.ts. `null` sends nothing: a pack with no link to the page is none. */
	readonly giftOrigin: GiftOrigin | null;
};

/** what one call did: sent, owed nothing, or claimed and failed (stamped). */
export type PackOutcome = 'sent' | 'not_owed' | 'failed';

/** how long after a pack failed (`pack_failed_at`) the sweep may try it again. */
const PACK_RETRY_AFTER_MS = 60 * 60_000;

/** the most failed packs one run claims. a run sends them one after another over one transport. */
const PACKS_PER_RUN = 50;

/** a row still owed its pack: an employer named, none sent, the match open, the gift in the books. */
function owed(db: Db): SQL[] {
	return [
		isNull(giftMatch.packSentAt),
		isNotNull(giftMatch.employer),
		isNull(giftMatch.matchedAt),
		isNull(giftMatch.voidedAt),
		inBooks(db)
	];
}

/**
 * a failed pack the sweep may try at `now`: failed at least `PACK_RETRY_AFTER_MS` before it, to a
 * donor with an address — one without stays failed until an address is saved, rather than being
 * refused once an hour.
 */
function retryable(db: Db, now: Date): SQL[] {
	return [
		lte(giftMatch.packFailedAt, new Date(now.getTime() - PACK_RETRY_AFTER_MS)),
		exists(
			db
				.select({ id: donation.id })
				.from(donation)
				.innerJoin(contact, eq(contact.id, donation.contactId))
				.where(and(eq(donation.id, giftMatch.donationId), isNotNull(contact.primaryEmail)))
		)
	];
}

/** the pack for this gift, claimed and sent, where one is owed. never throws. */
export function sendOwedPack(deps: PackDeps, donationId: string, now: Date): Promise<PackOutcome> {
	return claimAndSend(deps, donationId, now, []);
}

/**
 * every failed pack due a retry by `now`, oldest failure first, claimed and sent. nothing is claimed
 * where no pinned origin names the page, nor while the profile lacks a field the pack cannot be
 * written without: the gifts list shows those packs as failed, and saving Settings lets the next run
 * send them. only the reads throwing reach the run, whose log the scheduler writes.
 */
export async function sendFailedPacks(deps: PackDeps, now: Date): Promise<void> {
	if (deps.giftOrigin === null) return;
	if (missingFilerFields(await readOrgProfile(deps.db)).length > 0) return;
	const due = await deps.db
		.select({ donationId: giftMatch.donationId })
		.from(giftMatch)
		.where(and(...owed(deps.db), ...retryable(deps.db, now)))
		.orderBy(asc(giftMatch.packFailedAt))
		.limit(PACKS_PER_RUN);
	for (const { donationId } of due) {
		await claimAndSend(deps, donationId, now, retryable(deps.db, now));
	}
}

/** the pack claimed where the row is owed one and meets `also`, then sent. never throws. */
async function claimAndSend(
	deps: PackDeps,
	donationId: string,
	now: Date,
	also: readonly SQL[]
): Promise<PackOutcome> {
	const origin = deps.giftOrigin;
	if (origin === null) return 'not_owed';
	let held = false;
	try {
		const [claimed] = await deps.db
			.update(giftMatch)
			.set({
				packSentAt: now,
				packFailedAt: null,
				reminderDueAt: origin.pinned ? new Date(now.getTime() + REMINDER_AFTER_MS) : null
			})
			.where(and(eq(giftMatch.donationId, donationId), ...owed(deps.db), ...also))
			.returning({ token: giftMatch.token, employer: giftMatch.employer });
		if (claimed === undefined) return 'not_owed';
		held = true;

		const why = await send(deps, donationId, claimed.token, claimed.employer ?? '', origin);
		if (why === null) return 'sent';
		await failed(deps.db, donationId, now);
		console.error(`the employer match pack for gift ${donationId} was not sent: ${why}`);
		return 'failed';
	} catch (error) {
		try {
			if (held) await failed(deps.db, donationId, now);
		} catch {
			// the row keeps a claim for a pack that did not go, and the log below is its only record.
		}
		console.error(`the employer match pack for gift ${donationId} faulted:`, error);
		return 'failed';
	}
}

/** the pack rendered and sent, or why it was not. */
async function send(
	deps: PackDeps,
	donationId: string,
	token: string,
	employer: string,
	origin: GiftOrigin
): Promise<string | null> {
	const [gift, org] = await Promise.all([
		readMatchGift(deps.db, donationId),
		readOrgProfile(deps.db)
	]);
	if (gift === null) return 'the gift is gone';
	if (gift.donorEmail === null) return 'the donor has no email address';
	const rendered = await renderMatchPack({
		org,
		donorName: gift.donorName,
		employer,
		amountMinor: gift.remainingMinor,
		currency: gift.currency,
		givenAt: gift.receivedAt,
		receiptSentAt: gift.receiptSentAt,
		giftPageUrl: giftPageUrl(origin, token),
		reminds: origin.pinned
	});
	if (!rendered.ok) return rendered.detail;
	const sent = await deps.email.send({ to: gift.donorEmail, ...rendered.message });
	return sent.ok ? null : `${sent.reason}: ${sent.detail}`;
}

/** the claim handed back, stamped as a send that failed, and the reminder it armed disarmed. */
async function failed(db: Db, donationId: string, now: Date): Promise<void> {
	await db
		.update(giftMatch)
		.set({ packSentAt: null, packFailedAt: now, reminderDueAt: null })
		.where(eq(giftMatch.donationId, donationId));
}

/** what naming the employer needs: the pack's, and where work after the answer goes. */
export type EmployerDeps = PackDeps & {
	/** the deferred-work tracker ($lib/server/runtime/deferred.ts), so the answer waits on no mail. */
	readonly defer: (work: Promise<unknown>) => void;
	/**
	 * the request's, where its caller may stop waiting for the answer (the donation form's Skip and
	 * its timeout): once it has aborted, the write that already landed stands and no pack is deferred.
	 */
	readonly signal?: AbortSignal;
};

/**
 * the donor naming their employer, from the thank-you or the gift page: the write, and where the
 * gift names an employer and no pack has gone for it, the pack after the answer — on a save of the
 * same text too, so a donor whose pack failed gets it by saving again.
 */
export async function employerNamed(
	deps: EmployerDeps,
	key: MatchKey,
	typed: string,
	now: Date
): Promise<MatchWrite> {
	const written = await nameEmployer(deps.db, key, typed);
	if (deps.signal?.aborted) return written;
	if (written.ok && written.state.employer !== null && written.state.packSentAt === null) {
		deps.defer(sendOwedPack(deps, written.state.donationId, now));
	}
	return written;
}
