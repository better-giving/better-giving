import { supporterSignIn } from '@better-giving/emails';
import { renderEmail } from '@better-giving/emails/render';
import type { MailDeps } from './alert';
import type { SendResult } from './provider';

// a supporter's sign-in link, sent. what it says is
// packages/emails/src/templates/supporter-sign-in.tsx's; which address it goes to, the link it
// carries and what a failed send means for the person who asked are the caller's.
//
// no database here: the organisation's name arrives resolved, and both addresses arrive absolute,
// built by the caller from the request's own origin.

export interface SupporterSignInInput {
	/** the supporter's address. already read as an address by the endpoint that took it. */
	readonly to: string;
	/** the whole address the supporter opens, token and all. */
	readonly link: string;
	/** the address of the page that sends a new link, printed in the expiry sentence. */
	readonly signInUrl: string;
	/** `org_profile.legal_name`, or the app's own name where none is saved. */
	readonly orgName: string;
	readonly arm: supporterSignIn.SupporterSignInArm;
}

/** never throws for a delivery failure: the port's answer is returned as it came. */
export async function sendSupporterSignInEmail(
	deps: Pick<MailDeps, 'email'>,
	input: SupporterSignInInput
): Promise<SendResult> {
	const message = await renderEmail(
		supporterSignIn.template({
			orgName: input.orgName,
			link: input.link,
			signInUrl: input.signInUrl,
			arm: input.arm
		})
	);
	return deps.email.send({ to: input.to, ...message });
}
