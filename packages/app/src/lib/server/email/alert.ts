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
 * receipted without a `PaymentProvider`. `SettleDeps` is written as `MailDeps & {…}`, so the
 * compiler holds it to that.
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
