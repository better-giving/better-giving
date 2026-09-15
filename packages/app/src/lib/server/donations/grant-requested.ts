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
				headline: 'A donor was not told their grant request went to their fund',
				body:
					'A donor-advised fund gift was recorded and the donor’s confirmation could not be ' +
					'written. The grant stands and the gift is recorded; the donor has no email saying so.',
				facts: [
					{ label: 'Donation', value: target.donationId },
					{ label: 'Reason', value: rendered.detail }
				],
				action:
					'Open the console (`better-giving start`) and fill in the organisation’s details under Organisation.'
			});
			return;
		}

		const sent = await deps.email.send({ to: target.donorEmail, ...rendered.message });
		if (!sent.ok) {
			await alert(deps, {
				headline: 'A donor’s grant request confirmation did not send',
				body:
					'A donor-advised fund gift was recorded and the email confirming it to the donor did ' +
					'not send. The grant stands and the gift is recorded.',
				facts: [
					{ label: 'Donation', value: target.donationId },
					{ label: 'Reason', value: sent.reason },
					{ label: 'Detail', value: sent.detail },
					{ label: 'May have sent anyway', value: sent.indeterminate ? 'yes' : 'no' }
				],
				action:
					'Check the SMTP settings on the console (`better-giving start`) and send a test message.'
			});
		}
	} catch (error) {
		try {
			await alert(deps, {
				headline: 'A donor’s grant request confirmation could not be attempted',
				body:
					'A donor-advised fund gift was recorded and the step that confirms it to the donor ' +
					'failed outright. The grant stands and the gift is recorded.',
				facts: [
					{ label: 'Donation', value: target.donationId },
					{ label: 'Reason', value: error instanceof Error ? error.message : String(error) }
				],
				action:
					'Check the SMTP settings on the console (`better-giving start`) and send a test message. The ' +
					'cause is in this deployment’s logs (the Cloudflare dashboard, or `pnpm run logs` from a ' +
					'checkout).'
			});
		} catch {
			// the alert rides the transport that may be what faulted. nothing on this path may throw.
		}
	}
}
