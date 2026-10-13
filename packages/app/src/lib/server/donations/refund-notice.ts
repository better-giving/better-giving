import type { adminAlert } from '@better-giving/emails';
import { and, asc, eq, gt, isNotNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client';
import { findPaymentDonor } from '../contacts/queries';
import { donation, payment } from '../db/schema';
import {
	FILL_IN_ORG_DETAILS,
	SEND_THIS_TO_WHOEVER_SET_IT_UP,
	TEST_THE_SMTP_SETTINGS
} from '../email/alert';
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
// it to, the donor's address is refused, a second run's send of it may have gone, or its week is
// up. every other way out leaves it set, and `sendOwedRefundNotices` below, on src/worker.ts's
// `15 * * * *` and `45 * * * *`, sends it again. the row owes from the moment it is written rather
// than from a failure, so a delivery killed between its commit and its send leaves the notice
// owed; what keeps the run and the delivery from both sending one is `NOTICE_GRACE_MS`. a clear
// that fails after the send went costs the donor a second copy, which is the better of the two
// ways to be wrong about an email.
//
// an address is refused when the transport cannot hand it to a host (`invalid_message`) or the
// host refuses the mailbox itself (`addressRefused` on `SendResult` in ../email/provider.ts): no
// later send reaches it, and every one would count against the sender's standing with the host.
//
// a timeout is the one failure that may have delivered (`indeterminate` on that same result). on
// the delivery it leaves the notice owed, because a host that is down times out too. on a run it
// leaves it owed once, stamped in `payment.notice_maybe_sent_at`, and the next run that comes
// back unsure clears it: a host down past one run still gets a second, and a host that takes the
// message and then goes quiet costs the donor one copy per run that tried, two at most past the
// delivery's own.
//
// staff hear of a notice once when it fails on the delivery, and once more when a run stops owing
// it unsent; a run's other failures are logged, because a run every half hour would tell them
// again each time.
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
 * how long past its week a notice still owed is read, to be given up and told to staff. any run in
 * that day does it, so only a schedule stopped for longer leaves the row owed.
 */
const GIVE_UP_READ_MS = 24 * 60 * 60_000;

/**
 * notices sent per run, oldest first, one after another. a run has its invocation to itself
 * (wrangler.jsonc's `triggers`), and a notice costs one SMTP connection and six D1 queries — the
 * donor, the organisation, the gift's figures and the clear or stamp — so fifty is a few hundred of
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
	const unsent = await attempt(deps, target, { by: 'delivery' });
	if (unsent !== null) await tell(deps, unsent.alert);
}

/**
 * sends every notice still owed on a refund written between a week and half an hour before `now`,
 * the run's scheduled time, and gives up on one whose week is up.
 *
 * one that does not go and is still owed is logged, never alerted: the delivery that wrote the
 * refund told staff already, and a run every half hour would tell them again each time. one the
 * run stops owing unsent is told to staff, once.
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
			giftMinor: gift.amountMinor,
			maybeSentAt: payment.noticeMaybeSentAt,
			createdAt: payment.createdAt
		})
		.from(payment)
		.innerJoin(gift, eq(gift.id, payment.parentPaymentId))
		.where(
			and(
				eq(payment.direction, 'refund'),
				eq(payment.status, 'succeeded'),
				isNotNull(payment.noticeOwedSince),
				lte(payment.createdAt, new Date(now.getTime() - NOTICE_GRACE_MS)),
				gt(payment.createdAt, new Date(now.getTime() - NOTICE_WINDOW_MS - GIVE_UP_READ_MS))
			)
		)
		.orderBy(asc(payment.createdAt), asc(payment.id))
		.limit(NOTICES_PER_RUN);

	const deadline = now.getTime() + RUN_DEADLINE_MS;
	const lapsed = now.getTime() - NOTICE_WINDOW_MS;
	for (const target of owed) {
		if (Date.now() >= deadline) return;
		if (target.createdAt.getTime() <= lapsed) {
			await giveUp(deps, target);
			continue;
		}
		const unsent = await attempt(deps, target, {
			by: 'run',
			maybeSent: target.maybeSentAt !== null
		});
		if (unsent === null) continue;
		if (unsent.owed) report(`${unsent.alert.headline}:`, JSON.stringify(unsent.alert.facts));
		else await tell(deps, unsent.alert);
	}
}

/**
 * stops owing a notice whose week is up, and tells staff. told only once the clear lands, so a
 * clear that fails is tried by the next run rather than told twice.
 */
async function giveUp(deps: MailDeps, target: RefundNoticeTarget): Promise<void> {
	try {
		await settle(deps.db, target.refundId);
	} catch (error) {
		report(`refund ${target.refundId}'s notice could not be given up, so a later run will:`, error);
		return;
	}
	await tell(deps, {
		headline: 'A donor wasn’t told about their refund',
		body:
			'A refund was recorded a week ago, and the email telling the donor still hasn’t gone. The ' +
			`refund is fine. ${NOT_RESENT}`,
		facts: [
			{ label: 'Gift ID', value: target.donationId },
			{ label: 'Refund ID', value: target.refundId }
		],
		action:
			'Find the gift on Gifts in your dashboard and let the donor know about their refund ' +
			'yourself.'
	});
}

/** the delivery that wrote the refund, or a run, which knows whether a run's send may have gone. */
type Sender = { readonly by: 'delivery' } | { readonly by: 'run'; readonly maybeSent: boolean };

/** a notice that did not go, what staff are told of it, and whether a later run still sends it. */
type Unsent = { readonly alert: adminAlert.AdminAlertData; readonly owed: boolean };

/** an alert to staff, which rides the transport that may be what faulted: it never throws. */
async function tell(deps: MailDeps, told: adminAlert.AdminAlertData): Promise<void> {
	try {
		await alert(deps, told);
	} catch {
		// nothing on this path may throw.
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
	sender: Sender
): Promise<Unsent | null> {
	const facts = [
		{ label: 'Gift ID', value: target.donationId },
		{ label: 'Refund ID', value: target.refundId }
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
				alert: {
					headline: 'A donor wasn’t told about their refund',
					body:
						'A refund was recorded, but the email telling the donor couldn’t be prepared. The ' +
						'refund is fine, but the donor has no email about it.',
					facts: [...facts, { label: 'Reason', value: rendered.detail }],
					action: `${FILL_IN_ORG_DETAILS} It will be sent again once that’s fixed.`
				},
				owed: true
			};
		}

		const sent = await deps.email.send({ to: donor.email, ...rendered.message });
		if (!sent.ok) {
			// an address the transport or the host refuses is one no later send reaches, and a run's
			// send that may have gone is sent once more, never twice.
			const addressRefused = sent.reason === 'invalid_message' || sent.addressRefused === true;
			const unsure = sender.by === 'run' && sent.indeterminate;
			const final = addressRefused || (unsure && sender.maybeSent);
			if (final) await settle(deps.db, target.refundId);
			else if (unsure) await maybeSent(deps.db, target.refundId);
			return {
				alert: {
					headline: 'A donor wasn’t told about their refund',
					body:
						'A refund was recorded, but the email telling the donor failed to send. The refund ' +
						`is fine. ${final ? NOT_RESENT : RESENT}`,
					facts: [
						...facts,
						{ label: 'What went wrong', value: sent.detail },
						{ label: 'May have been delivered anyway', value: sent.indeterminate ? 'yes' : 'no' },
						{ label: 'Error code', value: sent.reason }
					],
					action: addressRefused
						? ADDRESS_REFUSED
						: `${TEST_THE_SMTP_SETTINGS}${final ? TELL_THEM_YOURSELF : ''}`
				},
				owed: !final
			};
		}
	} catch (error) {
		return {
			alert: {
				headline: 'A donor wasn’t told about their refund',
				body:
					'A refund was recorded, but emailing the donor failed with an unexpected error. The ' +
					`refund is fine. ${RESENT}`,
				facts: [
					...facts,
					{ label: 'Reason', value: error instanceof Error ? error.message : String(error) }
				],
				action: `${TEST_THE_SMTP_SETTINGS}${SEND_THIS_TO_WHOEVER_SET_IT_UP}`
			},
			owed: true
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

/**
 * how the alert of a notice still owed ends: `sendOwedRefundNotices` sends it again, and tells
 * staff where it stops owing it unsent.
 */
const RESENT =
	'It will be sent again automatically. If it still can’t be sent, you’ll get another email ' +
	'saying so.';

/** how the alert of a notice no longer owed ends. */
const NOT_RESENT = 'It won’t be sent again.';

/** the action where no later send reaches the donor's address. */
const ADDRESS_REFUSED =
	'The donor’s email address was refused. Find the gift on Gifts in your dashboard, check the ' +
	'address there, and let the donor know about their refund yourself.';

/** how the action of a notice no longer owed ends, where the address was not what failed. */
const TELL_THEM_YOURSELF = ' Then let the donor know about their refund yourself.';

/** a run's send of the refund's notice recorded as one that may have gone. */
async function maybeSent(db: Db, refundId: string): Promise<void> {
	await db.update(payment).set({ noticeMaybeSentAt: new Date() }).where(eq(payment.id, refundId));
}

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
