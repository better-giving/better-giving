import type { adminAlert } from '@better-giving/emails';
import { and, asc, eq, gt, isNotNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client';
import { findPaymentDonor } from '../contacts/queries';
import { donation, payment } from '../db/schema';
import { renderRefundNotice, type RefundNoticeInput } from '../email/refund-notice';
import { readOrgProfile } from '../org/queries';
import { refundStands } from './queries';
import { alert, type MailDeps } from './delivery';

// the donor's notice of a refund: sent once the batch that recorded the refund commits, and sent
// again by a scheduled run for as long as it is owed.
//
// ./reverse.ts is the first caller, and it calls this only on the delivery whose batch wrote the
// refund row: a redelivery is answered `already_posted` above it. that batch writes the row with
// `payment.notice_owed_since` set (../db/schema.ts) on a refund that tells its donor, and a dispute
// or a refund written in the delivery that settled its gift never has it set.
//
// the column is cleared here once nothing more is owed: the notice went, there is nobody to send
// it to, the transport refuses it as unsendable, or a run's own send of it timed out and may have
// gone. every other way out leaves it set, and `sendOwedRefundNotices` below, on src/worker.ts's
// half-hourly `15,45 * * * *`, sends it again. the row owes from the moment it is written rather
// than from a failure, so a delivery killed between its commit and its send leaves the notice
// owed; what keeps the run and the delivery from both sending one is `NOTICE_GRACE_MS`. a clear
// that fails after the send went costs the donor a second copy, which is the better of the two
// ways to be wrong about an email.
//
// a timeout is the one failure that may have delivered (`indeterminate` on `SendResult` in
// ../email/provider.ts). on the delivery it leaves the notice owed, because a host that is down
// times out too; on a run it clears it, so a host that takes the message and then goes quiet
// costs the donor at most one second copy rather than one every half hour.
//
// every failure on the delivery is reported to an operator and none of them is raised. the refund
// is recorded before this runs, and a throw would be a 5xx the processor reads as "deliver this
// again" against a row that answers every redelivery `already_posted` — so the delivery log would
// say something untrue. the alert rides the transport that may be what faulted, which is why the
// column, not the alert, is what keeps the notice owed.

/**
 * how long the delivery that wrote a refund has for its own send before a run reads the notice as
 * owed — one half-hourly run, far past anything one delivery spends on it.
 */
const NOTICE_GRACE_MS = 30 * 60_000;

/**
 * how long after its refund was written a notice is still sent. one that has not gone in a week
 * is one the runs cannot send — a gift whose figures the notice cannot be written from, or a host
 * that refuses it every time — and a donor told of a refund weeks on is told nothing useful.
 */
const NOTICE_WINDOW_MS = 7 * 24 * 60 * 60_000;

/**
 * notices sent per run, oldest first, one after another. a run has its invocation to itself
 * (wrangler.jsonc's `triggers`), and a notice costs one SMTP connection and six D1 queries — the
 * donor, the organisation, the gift's figures and the clear — so fifty is a few hundred of
 * Workers Paid's 1,000 queries an invocation (../outbox/budget.ts's `LIMITS`) and one connection
 * at a time.
 */
const NOTICES_PER_RUN = 50;

/**
 * no notice starts this long after the run's scheduled time: a cron invocation is killed at fifteen
 * minutes of wall clock, and the margin is for an SMTP wait already under way.
 */
const RUN_DEADLINE_MS = 10 * 60_000;

/**
 * one refund to tell a donor about, and the figures it is told in. the gift's day, what is left of
 * it and what of it is now deductible are read here from the rows the refund's batch left
 * (`givenAndDeductible`).
 */
export type RefundNoticeTarget = Pick<
	RefundNoticeInput,
	'giftMinor' | 'refundedMinor' | 'currency'
> & {
	/** the gift's own `payment` row, the one refunded. who is written to is read off it. */
	readonly giftPaymentId: string;
	/** the gift refunded, named in anything an operator is told. */
	readonly donationId: string;
	/** the refund's own `payment` row, whose `notice_owed_since` this clears. */
	readonly refundId: string;
};

/**
 * sends the notice on the delivery that wrote the refund, and never throws. a notice that did not
 * go is told to staff.
 */
export async function sendRefundNotice(deps: MailDeps, target: RefundNoticeTarget): Promise<void> {
	const unsent = await attempt(deps, target, 'delivery');
	if (unsent === null) return;
	try {
		await alert(deps, unsent);
	} catch {
		// the alert rides the transport that may be what faulted. nothing on this path may throw.
	}
}

/**
 * sends every notice still owed on a refund written between a week and half an hour before `now`,
 * the run's scheduled time.
 *
 * one that does not go is logged, never alerted: the delivery that wrote the refund told staff
 * already, and a run every half hour would tell them again each time.
 */
export async function sendOwedRefundNotices(deps: MailDeps, now: Date): Promise<void> {
	const gift = alias(payment, 'gift');
	const owed = await deps.db
		.select({
			refundId: payment.id,
			donationId: payment.donationId,
			refundedMinor: payment.amountMinor,
			currency: payment.currency,
			giftPaymentId: gift.id,
			giftMinor: gift.amountMinor
		})
		.from(payment)
		.innerJoin(gift, eq(gift.id, payment.parentPaymentId))
		.where(
			and(
				eq(payment.direction, 'refund'),
				eq(payment.status, 'succeeded'),
				isNotNull(payment.noticeOwedSince),
				lte(payment.createdAt, new Date(now.getTime() - NOTICE_GRACE_MS)),
				gt(payment.createdAt, new Date(now.getTime() - NOTICE_WINDOW_MS))
			)
		)
		.orderBy(asc(payment.createdAt), asc(payment.id))
		.limit(NOTICES_PER_RUN);

	const deadline = now.getTime() + RUN_DEADLINE_MS;
	for (const target of owed) {
		if (Date.now() >= deadline) return;
		const unsent = await attempt(deps, target, 'run');
		if (unsent !== null) report(`${unsent.headline}:`, JSON.stringify(unsent.facts));
	}
}

/**
 * one try at the notice, from the delivery that wrote the refund or from a run: null where it went
 * or there is nobody to send it to, or the alert saying why it did not go. never throws.
 *
 * the donor is read here, inside the same guard as the send, so a caller past its commit holds
 * nothing that can throw.
 */
async function attempt(
	deps: MailDeps,
	target: RefundNoticeTarget,
	from: 'delivery' | 'run'
): Promise<adminAlert.AdminAlertData | null> {
	const facts = [
		{ label: 'Donation', value: target.donationId },
		{ label: 'Refund', value: target.refundId }
	];
	try {
		const donor = await findPaymentDonor(deps.db, target.giftPaymentId);
		// a donor nobody has an address for is not a fault, and nobody is told of it.
		if (donor === null || donor.email === null) {
			await settle(deps.db, target.refundId);
			return null;
		}

		const rendered = await renderRefundNotice({
			org: await readOrgProfile(deps.db),
			donorName: donor.displayName,
			giftMinor: target.giftMinor,
			refundedMinor: target.refundedMinor,
			currency: target.currency,
			...(await givenAndDeductible(deps.db, target))
		});
		if (!rendered.ok) {
			return {
				headline: 'A donor was not told of a refund',
				body:
					'A refund was recorded and the email telling the donor of it could not be written. ' +
					`The refund stands, and the donor has no email of it yet. ${RESENT}`,
				facts: [...facts, { label: 'Reason', value: rendered.detail }],
				action:
					'Open the console (`better-giving start`) and fill in the organisation’s details under Organisation.'
			};
		}

		const sent = await deps.email.send({ to: donor.email, ...rendered.message });
		if (!sent.ok) {
			// unsendable is caller data that no later send changes, and a run's timeout may have gone.
			const final = sent.reason === 'invalid_message' || (from === 'run' && sent.indeterminate);
			if (final) await settle(deps.db, target.refundId);
			return {
				headline: 'A donor’s refund notice did not send',
				body:
					'A refund was recorded and the email telling the donor of it did not send. The ' +
					`refund stands, and the donor has no email of it yet. ${final ? NOT_RESENT : RESENT}`,
				facts: [
					...facts,
					{ label: 'Reason', value: sent.reason },
					{ label: 'Detail', value: sent.detail },
					{ label: 'May have sent anyway', value: sent.indeterminate ? 'yes' : 'no' }
				],
				action:
					'Check the SMTP settings on the console (`better-giving start`) and send a test message.'
			};
		}
	} catch (error) {
		return {
			headline: 'A donor’s refund notice could not be attempted',
			body:
				'A refund was recorded and the step that emails the donor of it failed outright. The ' +
				`refund stands, and the donor has no email of it yet. ${RESENT}`,
			facts: [
				...facts,
				{ label: 'Reason', value: error instanceof Error ? error.message : String(error) }
			],
			action:
				'Check the SMTP settings on the console (`better-giving start`) and send a test message. The ' +
				'cause is in this deployment’s logs (the Cloudflare dashboard, or `pnpm run logs` from a ' +
				'checkout).'
		};
	}

	try {
		await settle(deps.db, target.refundId);
	} catch (error) {
		report(
			`refund ${target.refundId}'s notice went and was not recorded as sent, so it may go again:`,
			error
		);
	}
	return null;
}

/** how the alert of a notice still owed ends: the run's cadence, and `NOTICE_WINDOW_MS`. */
const RESENT =
	'This deployment tries it again every half hour until a week after the refund was recorded.';

/** how the alert of a notice no longer owed ends. */
const NOT_RESENT = 'This deployment does not try it again.';

/** the refund's notice recorded as owed no longer. */
async function settle(db: Db, refundId: string): Promise<void> {
	await db.update(payment).set({ noticeOwedSince: null }).where(eq(payment.id, refundId));
}

function report(message: string, detail: unknown): void {
	try {
		console.error(message, detail);
	} catch {
		// nothing to report it to, and nothing here may throw.
	}
}

/**
 * three things the notice states, read off the rows the refund's batch left:
 *
 *   - the day on the gift's receipt: `donation.received_at`, written at authorization and never
 *     moved by a settlement.
 *   - what is left of the gift: what it collected, less the refunds of it that stand
 *     (`refundStands` in ./queries.ts), so a dispute still open, which may yet be won, takes
 *     nothing off.
 *   - what of that is deductible: what is left, less the part that was never deductible.
 *
 * neither figure goes below nothing.
 */
async function givenAndDeductible(
	db: Db,
	target: RefundNoticeTarget
): Promise<Pick<RefundNoticeInput, 'givenAt' | 'remainingMinor' | 'deductibleMinor'>> {
	const [gift] = await db
		.select({ givenAt: donation.receivedAt, nonDeductibleMinor: donation.nonDeductibleMinor })
		.from(donation)
		.where(eq(donation.id, target.donationId));
	const [refunded] = await db
		.select({ minor: sql<number>`coalesce(sum(${payment.amountMinor}), 0)` })
		.from(payment)
		.where(and(eq(payment.parentPaymentId, target.giftPaymentId), refundStands(db, payment)));
	if (gift === undefined) throw new Error(`donation ${target.donationId} is not recorded.`);
	const remainingMinor = Math.max(0, target.giftMinor - (refunded?.minor ?? 0));
	return {
		givenAt: gift.givenAt,
		remainingMinor,
		deductibleMinor: Math.max(0, remainingMinor - gift.nonDeductibleMinor)
	};
}
