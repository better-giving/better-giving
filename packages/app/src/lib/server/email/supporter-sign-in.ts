import { supporterSignIn } from '@better-giving/emails';
import { renderEmail } from '@better-giving/emails/render';
import { LINK_LIFETIME_MS } from '../supporters/links';
import type { MailDeps } from './alert';
import type { SendResult } from './provider';

// a supporter's sign-in link, sent. what it says is
// packages/emails/src/templates/supporter-sign-in.tsx's; which address it goes to, the link it
// carries and what a failed send means for the person who asked are the caller's.
//
// no database here: the organisation's name arrives resolved, and both addresses arrive absolute,
// built by the caller on the origin `BETTER_AUTH_URL` pins (`supporterLinkOrigin` in
// ../supporters/area.ts), never the request's. the lifetime the mail states is the one
// ../supporters/links.ts gives a link, handed in here because the template cannot import the app.

/** the template's fields bar the lifetime, and the supporter's address, already read as one. */
export type SupporterSignInInput = Omit<supporterSignIn.SupporterSignInData, 'linkLifetimeMs'> & {
	readonly to: string;
};

/** never throws for a delivery failure: the port's answer is returned as it came. */
export async function sendSupporterSignInEmail(
	deps: Pick<MailDeps, 'email'>,
	{ to, ...data }: SupporterSignInInput
): Promise<SendResult> {
	const message = await renderEmail(
		supporterSignIn.template({ ...data, linkLifetimeMs: LINK_LIFETIME_MS })
	);
	return deps.email.send({ to, ...message });
}
