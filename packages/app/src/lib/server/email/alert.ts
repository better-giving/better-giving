import { adminAlert, type EmailTemplate } from '@better-giving/emails';
import { renderEmail } from '@better-giving/emails/render';
import type { Db } from '../db/client';
import { readOrgProfile } from '../org/queries';
import type { EmailProvider, SendResult } from './provider';

// the one way this app tells an operator something, and the address it goes to.
//
// a module of its own, beside the port, because the money path and the books both send through
// it: ../donations/ reaches ../accounting/ through ../books/writes.ts, so a sender living in either
// would make the two import each other (../accounting/no-donations-imports.spec.ts).
// ../donations/delivery.ts re-exports `alert` and `MailDeps` for the modules under it; every other
// caller imports from here.

/**
 * the part of `SettleDeps` (../donations/delivery.ts) that reads the database and sends mail — all
 * a receipt or an alert needs, so a gift no processor took (../donations/record-in-hand.ts) can be
 * receipted without a `PaymentProvider`.
 */
export type MailDeps = { readonly db: Db; readonly email: EmailProvider };

/**
 * one operational alert, to the address the console names.
 *
 * silent where no address is saved, because there is nowhere to send it — `notification_email` is
 * nullable and a fresh deployment has none. the sentence still reaches the logs either way, which
 * is the floor: an alert nobody configured must not become an exception on the money path.
 */
export async function alert(deps: MailDeps, input: adminAlert.AdminAlertData): Promise<void> {
	try {
		console.error(`${input.headline}:`, JSON.stringify(input.facts));
	} catch {
		// nothing to report it to, and nothing on this path may throw.
	}

	await mailOperator(deps, adminAlert.template(input));
}

/** an alert's action where only the organisation's saved details fix what went wrong. */
export const FILL_IN_ORG_DETAILS =
	'Open the console (run `better-giving start`), go to Organisation and fill in what’s missing.';

/** an alert's action where an email did not send. */
export const TEST_THE_SMTP_SETTINGS =
	'Open the console (run `better-giving start`), go to SMTP and press Send test email. Fix ' +
	'whatever the test reports.';

/**
 * what follows {@link TEST_THE_SMTP_SETTINGS} where the send threw rather than answering: the cause
 * is in the worker's logs, which the person reading the alert may not be the one able to open.
 */
export const SEND_THIS_TO_WHOEVER_SET_IT_UP =
	' If the test works, send this email to whoever set up your donations app. The cause is in its ' +
	'logs (Cloudflare dashboard, or `pnpm run logs`).';

/** how an action ends where an email to a donor did not go and nothing sends it again. */
export const NO_RESEND = ' This email won’t be resent, so contact them yourself if they need it.';

/**
 * one message to the address the console names for operational mail, which every alert goes to.
 * `no_address` where none is saved — `notification_email` is nullable and a fresh deployment has
 * none. what to do about a message that did not go is the caller's.
 */
export async function mailOperator(
	deps: MailDeps,
	message: EmailTemplate
): Promise<SendResult | 'no_address'> {
	const profile = await readOrgProfile(deps.db);
	const to = profile?.notificationEmail ?? null;
	if (to === null) return 'no_address';
	return deps.email.send({ to, ...(await renderEmail(message)) });
}
