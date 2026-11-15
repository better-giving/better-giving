import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { giftMatch } from '../db/schema';
import { readMatchGift } from '../donations/queries';
import type { MailDeps } from '../email/alert';
import { renderMatchPack } from '../email/match';
import { readOrgProfile } from '../org/queries';
import { giftPageUrl } from './links';
import { inBooks, type MatchKey, type MatchWrite, nameEmployer } from './match';

// the pack: the filing details, mailed at once when the donor first names an employer.
//
// claimed before the send and only over a row still owed one, the claim pattern
// ../donations/receipt.ts states for the receipt: `pack_sent_at` set where it is null, the send, and
// on every way out that did not send the claim handed back with `pack_failed_at` stamped in the same
// statement, which the gifts list shows as "Send failed". a send that went clears an earlier
// failure in its claim.
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
	readonly giftOrigin: string | null;
};

/** what one call did: sent, owed nothing, or claimed and failed (stamped). */
export type PackOutcome = 'sent' | 'not_owed' | 'failed';

/** the pack for this gift, claimed and sent, where one is owed. never throws. */
export async function sendOwedPack(
	deps: PackDeps,
	donationId: string,
	now: Date
): Promise<PackOutcome> {
	if (deps.giftOrigin === null) return 'not_owed';
	let held = false;
	try {
		const [claimed] = await deps.db
			.update(giftMatch)
			.set({ packSentAt: now, packFailedAt: null })
			.where(
				and(
					eq(giftMatch.donationId, donationId),
					isNull(giftMatch.packSentAt),
					isNotNull(giftMatch.employer),
					isNull(giftMatch.matchedAt),
					isNull(giftMatch.voidedAt),
					inBooks(deps.db)
				)
			)
			.returning({ token: giftMatch.token, employer: giftMatch.employer });
		if (claimed === undefined) return 'not_owed';
		held = true;

		const why = await send(
			deps,
			donationId,
			claimed.token,
			claimed.employer ?? '',
			deps.giftOrigin
		);
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
	origin: string
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
		amountMinor: gift.totalMinor,
		currency: gift.currency,
		givenAt: gift.receivedAt,
		receiptSentAt: gift.receiptSentAt,
		giftPageUrl: giftPageUrl(origin, token)
	});
	if (!rendered.ok) return rendered.detail;
	const sent = await deps.email.send({ to: gift.donorEmail, ...rendered.message });
	return sent.ok ? null : `${sent.reason}: ${sent.detail}`;
}

/** the claim handed back, stamped as a send that failed. */
async function failed(db: Db, donationId: string, now: Date): Promise<void> {
	await db
		.update(giftMatch)
		.set({ packSentAt: null, packFailedAt: now })
		.where(eq(giftMatch.donationId, donationId));
}

/** what naming the employer needs: the pack's, and where work after the answer goes. */
export type EmployerDeps = PackDeps & {
	/** the deferred-work tracker ($lib/server/runtime/deferred.ts), so the answer waits on no mail. */
	readonly defer: (work: Promise<unknown>) => void;
};

/**
 * the donor naming their employer, from the thank-you or the gift page: the write, and where it
 * changed the employer of a gift no pack has gone for, the pack after the answer.
 */
export async function employerNamed(
	deps: EmployerDeps,
	key: MatchKey,
	typed: string,
	now: Date
): Promise<MatchWrite> {
	const written = await nameEmployer(deps.db, key, typed, now);
	if (written.ok && written.changed && written.state.packSentAt === null) {
		deps.defer(sendOwedPack(deps, written.state.donationId, now));
	}
	return written;
}
