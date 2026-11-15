import { and, asc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { giftMatch } from '../db/schema';
import { readMatchGift } from '../donations/queries';
import { renderMatchReminder } from '../email/match';
import { readOrgProfile } from '../org/queries';
import { giftPageUrl } from './links';
import { inBooks } from './match';
import type { PackDeps } from './pack';

// the one reminder, three days after the pack was sent, while the gift is not filed, matched or
// voided. `CRON_RUNS` in src/cron-runs.ts runs the sweep on a schedule of its own.
//
// it survives a restart because the due time is the row's (`reminder_due_at`, armed by the pack's
// claim, `sendOwedPack` in ./pack.ts), never a timer, and it sends once because the claim decides:
// the claim pattern ../donations/receipt.ts states for the receipt. a row is selected by the
// predicate `gift_match_reminder_due_idx` is built on ($lib/server/db/schema.ts; the plan is pinned by
// ../db/gift-match-schema.db.spec.ts and ./reminders.db.spec.ts), then claimed by one UPDATE that
// stamps `reminded_at` only where it is still null and the gift is still unfiled, unmatched and
// unvoided, and only a claim that returned its row sends. a send that did not go hands the claim
// back and moves the due time on by `REMINDER_RETRY_AFTER_MS`, so a reminder that cannot go is
// retried and never hammered, and never keeps a due one behind it out of the run. one that can never
// go — no donor address, no gift, nothing to sign it with — is handed back disarmed instead, its
// due time cleared, so it leaves the sweep and is logged once.
//
// no log line carries the employer.

/** how long a reminder that did not go waits before the sweep tries it again. */
export const REMINDER_RETRY_AFTER_MS = 60 * 60_000;

/** the most reminders one run claims. a run sends them one after another over one SMTP transport. */
export const REMINDERS_PER_RUN = 50;

/** the rows owed a reminder by `now`, oldest due first, through `gift_match_reminder_due_idx`. */
export function dueReminders(db: Db, now: Date) {
	return db
		.select({ donationId: giftMatch.donationId })
		.from(giftMatch)
		.where(
			and(
				lte(giftMatch.reminderDueAt, now),
				isNull(giftMatch.remindedAt),
				isNull(giftMatch.filedAt),
				isNull(giftMatch.matchedAt),
				isNull(giftMatch.voidedAt),
				inBooks(db)
			)
		)
		.orderBy(asc(giftMatch.reminderDueAt))
		.limit(REMINDERS_PER_RUN);
}

/**
 * every reminder due by `now`, claimed and sent. one that faults is logged and stops none of the
 * others; only the read itself throwing reaches the run, whose log the scheduler writes.
 */
export async function sendDueReminders(deps: PackDeps, now: Date): Promise<void> {
	const origin = deps.giftOrigin;
	const due = await dueReminders(deps.db, now);
	if (due.length === 0) return;
	if (origin === null) {
		console.warn(
			`${due.length} employer match reminder(s) are due and none was sent: a scheduled run has no request to name the gift page on, so BETTER_AUTH_URL has to pin this deployment's address (.env.example).`
		);
		return;
	}
	for (const { donationId } of due) await remind(deps, origin, donationId, now);
}

async function remind(
	deps: PackDeps,
	origin: string,
	donationId: string,
	now: Date
): Promise<void> {
	let held = false;
	try {
		const [claimed] = await deps.db
			.update(giftMatch)
			.set({ remindedAt: now })
			.where(
				and(
					eq(giftMatch.donationId, donationId),
					isNotNull(giftMatch.reminderDueAt),
					isNull(giftMatch.remindedAt),
					isNull(giftMatch.filedAt),
					isNull(giftMatch.matchedAt),
					isNull(giftMatch.voidedAt)
				)
			)
			.returning({ token: giftMatch.token, employer: giftMatch.employer });
		if (claimed === undefined) return;
		held = true;

		const unsent = await send(deps, origin, donationId, claimed.token, claimed.employer ?? '');
		if (unsent === null) return;
		await handBack(deps, donationId, unsent.permanent ? null : retryAt(now));
		console.error(
			`the employer match reminder for gift ${donationId} was not sent${unsent.permanent ? ', and will not be retried' : ''}: ${unsent.why}`
		);
	} catch (error) {
		try {
			if (held) await handBack(deps, donationId, retryAt(now));
		} catch {
			// the row keeps a claim for a reminder that did not go, and the log below is its only record.
		}
		console.error(`the employer match reminder for gift ${donationId} faulted:`, error);
	}
}

/** why a reminder did not go, and whether a later sweep could send it. */
type Unsent = { readonly why: string; readonly permanent: boolean };

const never = (why: string): Unsent => ({ why, permanent: true });

/** the reminder rendered and sent, or why it was not. */
async function send(
	deps: PackDeps,
	origin: string,
	donationId: string,
	token: string,
	employer: string
): Promise<Unsent | null> {
	const [gift, org] = await Promise.all([
		readMatchGift(deps.db, donationId),
		readOrgProfile(deps.db)
	]);
	if (gift === null) return never('the gift is gone');
	if (gift.donorEmail === null) return never('the donor has no email address');
	const rendered = await renderMatchReminder({
		// the profile holds a legal name and no display name, so the prose names the organisation
		// by its legal name.
		displayName: org?.legalName ?? '',
		donorName: gift.donorName,
		employer,
		amountMinor: gift.totalMinor,
		currency: gift.currency,
		givenAt: gift.receivedAt,
		giftPageUrl: giftPageUrl(origin, token)
	});
	if (!rendered.ok) return never(rendered.detail);
	const sent = await deps.email.send({ to: gift.donorEmail, ...rendered.message });
	return sent.ok ? null : { why: `${sent.reason}: ${sent.detail}`, permanent: false };
}

const retryAt = (now: Date) => new Date(now.getTime() + REMINDER_RETRY_AFTER_MS);

/** the claim handed back, due again at `dueAgain`, or disarmed where that is `null`. */
async function handBack(deps: PackDeps, donationId: string, dueAgain: Date | null): Promise<void> {
	await deps.db
		.update(giftMatch)
		.set({ remindedAt: null, reminderDueAt: dueAgain })
		.where(eq(giftMatch.donationId, donationId));
}
