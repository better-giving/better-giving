import { renderCryptoPending, type CryptoPendingInput } from '../email/crypto-pending';
import {
	FILL_IN_ORG_DETAILS,
	SEND_THIS_TO_WHOEVER_SET_IT_UP,
	TEST_THE_SMTP_SETTINGS
} from '../email/alert';
import { readOrgProfile } from '../org/queries';
import { alert, type MailDeps } from './delivery';

// the donor's "here is where to send it", sent once the gift written against a new crypto payment
// commits — ./grant-requested.ts's shape, for the same reasons.
//
// ./quote.ts is the one caller, and it calls this only on the write that recorded a new gift. the
// notice is the donor's only copy of the address, amount and memo outside the page they may close,
// so nothing is cut from it; the QR is not in it (the address as text is what a mail client keeps).
//
// every failure here is reported to an operator and none of them is raised. the gift and the
// payment exist before this runs, and a notice that did not go undoes neither.

/** one address to tell a donor about. */
export type CryptoPendingTarget = Omit<CryptoPendingInput, 'org'> & {
	/** the gift it is about, named in anything an operator is told. */
	readonly donationId: string;
	/** `null` is a donor nobody has an address for, and nothing is sent. */
	readonly donorEmail: string | null;
};

/** sends the notice, and never throws. */
export async function sendCryptoPending(
	deps: MailDeps,
	target: CryptoPendingTarget
): Promise<void> {
	if (target.donorEmail === null) return;

	try {
		const rendered = await renderCryptoPending({ ...target, org: await readOrgProfile(deps.db) });
		if (!rendered.ok) {
			await alert(deps, {
				headline: 'A donor didn’t get their crypto payment instructions',
				body:
					'A donor started a crypto gift, but the email with the address to send it to couldn’t ' +
					'be prepared. They saw the address on the page but have no copy by email.',
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
				headline: 'A donor didn’t get their crypto payment instructions',
				body:
					'A donor started a crypto gift, but the email with the address to send it to failed to ' +
					'send. They saw the address on the page.',
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
				headline: 'A donor didn’t get their crypto payment instructions',
				body:
					'A donor started a crypto gift, but emailing them the address failed with an unexpected ' +
					'error. They saw the address on the page.',
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
