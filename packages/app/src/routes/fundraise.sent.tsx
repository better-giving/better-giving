import { data, href, redirect } from 'react-router';
import { defineForm } from '$lib/forms/definition';
import { INTENTS, SIGN_IN_FORM } from '$lib/supporter/area/forms';
import { supporterAreaLinks } from '$lib/supporter/area/links';
import { CheckEmail } from '$lib/supporter/area/sign-in';
import { usePosting } from '$lib/supporter/area/use-posting';
import { refuseWriteFromAnotherOrigin } from '$lib/server/auth/gate';
import { invalid, parseForm } from '$lib/server/conform';
import {
	redirectWithFlash,
	SUPPORTER_SENT_FLASH,
	SUPPORTER_SIGN_IN_FLASH,
	takeFlash
} from '$lib/server/flash';
import { linkMailer, readSupporterOrg } from '$lib/server/supporters/area';
import { linkLimiters, requestSignInLink, resendConfirmLink } from '$lib/server/supporters/links';
import {
	clearResendTicket,
	readResendTicket,
	writeResendTicket
} from '$lib/server/supporters/resend-ticket';
import { database, platform } from '../context';
import type { Route } from './+types/fundraise.sent';

// Check your email: where a start and a sign-in request land, saying the address the link went to.
// the address, which of the two sent it, and a start's page arrive in the flash the post set
// ($lib/server/flash.ts), so this screen is drawn once per send: a reload, a bookmark or a link
// here carries no flash, and goes on to the start form.
//
// Send it again posts `intent=resend` with the address the screen was drawn for. after a start it
// mails a fresh confirm link for the page (`resendConfirmLink` in $lib/server/supporters/links.ts),
// which the screen's loader names in a resend ticket ($lib/server/supporters/resend-ticket.ts),
// since the flash is spent; after a sign-in request, or for an address the ticket does not name, a
// sign-in link (`requestSignInLink`). either answers the same for every address, as the first ask
// did, and over its limit goes to the sign-in screen's too-many state.

/** Send it again as the action parses it: the sign-in form's address box, posted hidden. */
const RESEND = defineForm({ id: SIGN_IN_FORM.id, schema: SIGN_IN_FORM.schema });

/** a send as its flash carries it: `start <page id> <address>` or `sign-in <address>`. */
type Sent =
	| { readonly kind: 'start'; readonly pageId: string; readonly email: string }
	| { readonly kind: 'sign-in'; readonly email: string };

function readSent(marker: string): Sent | null {
	const [kind = '', ...rest] = marker.split(' ');
	if (kind === 'sign-in' && rest.length === 1 && rest[0]) return { kind, email: rest[0] };
	if (kind === 'start' && rest.length === 2 && rest[0] && rest[1]) {
		return { kind, pageId: rest[0], email: rest[1] };
	}
	return null;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const landed = await takeFlash(request, SUPPORTER_SENT_FLASH);
	const sent = landed === null ? null : readSent(landed.marker);
	if (landed === null || sent === null) throw redirect(href('/fundraise'));
	const org = await readSupporterOrg(context.get(database));
	const ticket =
		sent.kind === 'start'
			? await writeResendTicket(request, { pageId: sent.pageId, email: sent.email })
			: await clearResendTicket(request);
	return data(
		{ org, kind: sent.kind, email: sent.email },
		{
			headers: [
				['Set-Cookie', landed.clear],
				['Set-Cookie', ticket],
				['cache-control', 'no-store']
			]
		}
	);
}

/**
 * never read again under a drawn screen: the flash it was drawn from is spent, so a re-read after
 * Send it again would find none and leave.
 */
export function shouldRevalidate(): boolean {
	return false;
}

/** `no-store`, carried onto the document: the screen says an address back. */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function action({ context, request }: Route.ActionArgs) {
	refuseWriteFromAnotherOrigin(request);
	const db = context.get(database);
	const { env, deferred } = context.get(platform);
	const submission = parseForm(await request.formData(), RESEND);
	if (!submission.ok) return invalid(400, submission.reject());
	const { email } = submission.value;
	const now = new Date();
	const deps = {
		db,
		limiters: linkLimiters(env),
		defer: (work: Promise<unknown>) => deferred.waitUntil(work),
		sendLink: linkMailer(db, env),
		now
	};
	const ticket = await readResendTicket(request);
	const asked =
		ticket !== null && ticket.email === email
			? await resendConfirmLink(deps, ticket)
			: await requestSignInLink(deps, request, email);
	if (asked !== 'sent') {
		return redirectWithFlash(
			request,
			SUPPORTER_SIGN_IN_FLASH,
			href('/fundraise/sign-in'),
			`too-many ${asked.retryAfterSeconds} ${email}`
		);
	}
	return { resentAt: now.getTime() };
}

export function meta(): Route.MetaDescriptors {
	return [{ title: 'Check your email' }];
}

export function links(): Route.LinkDescriptors {
	return supporterAreaLinks();
}

export default function SentRoute({ loaderData, actionData }: Route.ComponentProps) {
	const { org, kind, email } = loaderData;
	return (
		<CheckEmail
			org={org}
			email={email}
			kind={kind}
			differentAddressHref={kind === 'start' ? href('/fundraise') : href('/fundraise/sign-in')}
			resentAt={actionData !== undefined && 'resentAt' in actionData ? actionData.resentAt : null}
			sending={usePosting(INTENTS.resend)}
		/>
	);
}
