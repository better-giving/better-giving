import { href, redirect } from 'react-router';
import { APP_NAME } from '../../admin/screen-title';
import type { SupporterAccount, SupporterOrg } from '../../supporter/area/shell';
import { type ChallengeResult, verifyChallenge } from '../api/challenge';
import type { Db } from '../db/client';
import { notFound } from '../db/load-failure';
import { createEmailProvider } from '../email/factory';
import { sendSupporterSignInEmail } from '../email/supporter-sign-in';
import { readOrgProfile, readOrgProfileLogo } from '../org/queries';
import type { SendLink } from './links';
import { type OwnFundraiser, readOwnFundraiser } from './pages';
import { requireSupporter, type SignedInSupporter } from './session';

// what the routes under /fundraise share: the organisation as every supporter screen names it, the
// mail a link goes out in, the spam check a start runs, and the signed-in supporter. the rules are
// ./links.ts's, ./start.ts's and ./session.ts's; this binds them to a request.

/** where a supporter signs in, and where every guarded supporter route sends a caller with none. */
export const SIGN_IN_PATH = href('/fundraise/sign-in');

/** the organisation as a supporter screen's top bar draws it. */
export async function readSupporterOrg(db: Db): Promise<SupporterOrg> {
	const [profile, logo] = await Promise.all([readOrgProfile(db), readOrgProfileLogo(db)]);
	return {
		name: profile?.legalName ?? APP_NAME,
		logo,
		brandColour: profile?.brandColour ?? null
	};
}

/**
 * mails a link, its address built on `origin`, the deployment's own as the request names it. a send
 * that fails is logged and nothing else: the screen that asked has already answered the same for
 * every address (`requestSignInLink` in ./links.ts).
 */
export function linkMailer(db: Db, env: Env, origin: string): SendLink {
	return async (mail) => {
		const profile = await readOrgProfile(db);
		const sent = await sendSupporterSignInEmail(
			{ email: createEmailProvider(env) },
			{
				to: mail.to,
				link: `${origin}${href('/fundraise/open')}?${new URLSearchParams({ token: mail.token })}`,
				signInUrl: `${origin}${SIGN_IN_PATH}`,
				orgName: profile?.legalName ?? APP_NAME,
				arm: mail.arm
			}
		);
		if (!sent.ok) console.error('a supporter’s link could not be sent:', sent.reason, sent.detail);
	};
}

/**
 * the spam check a donation submission runs (`verifyChallenge` in ../api/challenge.ts), over what a
 * start posted in `CHALLENGE_FIELD` ($lib/supporter/area/forms.ts), solved on this deployment's own host.
 */
export function startChallenge(
	env: Env,
	request: Request,
	posted: FormDataEntryValue | null
): () => Promise<ChallengeResult> {
	const answer = typeof posted === 'string' && posted !== '' ? posted : undefined;
	return () =>
		verifyChallenge(
			{
				secretKey: env.TURNSTILE_SECRET_KEY,
				siteKey: env.TURNSTILE_SITE_KEY,
				token: answer,
				altchaPayload: answer,
				allowedHostnames: [new URL(request.url).hostname],
				request
			},
			env.ALTCHA
		);
}

/** the signed-in supporter, or the 303 to the sign-in a guarded supporter route answers with. */
export function signedInSupporter(db: Db, request: Request): Promise<SignedInSupporter> {
	return requireSupporter(db, request, new Date(), SIGN_IN_PATH);
}

/** the top bar's end on a signed-in screen. */
export function supporterAccount(signedIn: SignedInSupporter): SupporterAccount {
	return { email: signedIn.email, signOutAction: href('/fundraise/sign-out') };
}

/** what a supporter is told at a page id that is not theirs, or not anyone's. */
export const NOT_YOUR_PAGE =
	'No fundraiser of yours is at this address. Open Your fundraisers for your pages.';

/**
 * the signed-in supporter and their page `id` as its edit screen takes it: a 404 thrown where the
 * page is not theirs, and a 303 to its manage screen where it has ended, which offers no Edit.
 */
export async function editablePage(
	db: Db,
	request: Request,
	id: string
): Promise<{ signedIn: SignedInSupporter; page: OwnFundraiser }> {
	const signedIn = await signedInSupporter(db, request);
	const page = await readOwnFundraiser(db, signedIn.supporterId, id);
	if (page === null) notFound(NOT_YOUR_PAGE);
	if (page.status === 'ended') throw redirect(href('/fundraise/pages/:id', { id }), 303);
	return { signedIn, page };
}
