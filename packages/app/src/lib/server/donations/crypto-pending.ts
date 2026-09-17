import { renderCryptoPending, type CryptoPendingInput } from '../email/crypto-pending';
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
				headline: 'A donor was not sent where to send their crypto gift',
				body:
					'A crypto gift was recorded and the email telling the donor where to send it could not be ' +
					'written. The address stands and the donor was shown it on the page; they have no email ' +
					'of it.',
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
				headline: 'A donor’s crypto payment instructions did not send',
				body:
					'A crypto gift was recorded and the email telling the donor where to send it did not ' +
					'send. The address stands and the donor was shown it on the page.',
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
				headline: 'A donor’s crypto payment instructions could not be attempted',
				body:
					'A crypto gift was recorded and the step that emails the donor where to send it failed ' +
					'outright. The address stands and the donor was shown it on the page.',
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
