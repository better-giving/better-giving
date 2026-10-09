import {
	FILL_IN_ORG_DETAILS,
	SEND_THIS_TO_WHOEVER_SET_IT_UP,
	TEST_THE_SMTP_SETTINGS
} from '../email/alert';
import { renderGrantRequested, type GrantNoticeInput } from '../email/grant';
import { readOrgProfile } from '../org/queries';
import { alert, type MailDeps } from './delivery';

// the donor's "your fund has the request", sent once the gift written against a new grant commits.
//
// ./quote.ts is the one caller, and it calls this only on the write that recorded a new gift: a
// session submitted twice answers the grant Chariot already holds, the second write is refused as a
// duplicate, and nothing is sent for it. that refusal is the whole of "once" — no column records
// that this went, because a notice nobody got is not a debt a later path pays back.
//
// every failure here is reported to an operator and none of them is raised. the gift is committed
// before this runs, and the quote's answer to the donor is already decided by that commit.

/** one grant request to tell a donor about. */
export type GrantRequestedTarget = Omit<GrantNoticeInput, 'org'> & {
	/** the gift it is about, named in anything an operator is told. */
	readonly donationId: string;
	/** `null` is a donor nobody has an address for, and nothing is sent. */
	readonly donorEmail: string | null;
};

/** sends the notice, and never throws. */
export async function sendGrantRequested(
	deps: MailDeps,
	target: GrantRequestedTarget
): Promise<void> {
	if (target.donorEmail === null) return;

	try {
		const rendered = await renderGrantRequested({ ...target, org: await readOrgProfile(deps.db) });
		if (!rendered.ok) {
			await alert(deps, {
				headline: 'A donor didn’t get their grant confirmation',
				body:
					'A donor-advised fund gift was recorded, but the email confirming the grant request ' +
					'couldn’t be prepared. The grant and the gift are fine, but the donor has no email ' +
					'about it.',
				facts: [
					{ label: 'Gift ID', value: target.donationId },
					{ label: 'Reason', value: rendered.detail }
				],
				action: FILL_IN_ORG_DETAILS
			});
			return;
		}

		const sent = await deps.email.send({ to: target.donorEmail, ...rendered.message });
		if (!sent.ok) {
			await alert(deps, {
				headline: 'A donor didn’t get their grant confirmation',
				body:
					'A donor-advised fund gift was recorded, but the email confirming the grant request ' +
					'failed to send. The grant and the gift are fine.',
				facts: [
					{ label: 'Gift ID', value: target.donationId },
					{ label: 'What went wrong', value: sent.detail },
					{ label: 'May have been delivered anyway', value: sent.indeterminate ? 'yes' : 'no' },
					{ label: 'Error code', value: sent.reason }
				],
				action: TEST_THE_SMTP_SETTINGS
			});
		}
	} catch (error) {
		try {
			await alert(deps, {
				headline: 'A donor didn’t get their grant confirmation',
				body:
					'A donor-advised fund gift was recorded, but the email confirming the grant request ' +
					'failed with an unexpected error. The grant and the gift are fine.',
				facts: [
					{ label: 'Gift ID', value: target.donationId },
					{ label: 'Reason', value: error instanceof Error ? error.message : String(error) }
				],
				action: `${TEST_THE_SMTP_SETTINGS}${SEND_THIS_TO_WHOEVER_SET_IT_UP}`
			});
		} catch {
			// the alert rides the transport that may be what faulted. nothing on this path may throw.
		}
	}
}
