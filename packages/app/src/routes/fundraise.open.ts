import { href, redirect } from 'react-router';
import {
	redirectWithFlash,
	SUPPORTER_PUBLISHED_FLASH,
	SUPPORTER_SIGN_IN_FLASH
} from '$lib/server/flash';
import { signInWithLink } from '$lib/server/supporters/links';
import { database } from '../context';
import type { Route } from './+types/fundraise.open';

// a mailed link opened: `/fundraise/open?token=`. a loader that spends the link and answers with a
// redirect, and nothing else (`signInWithLink` in $lib/server/supporters/links.ts). an open link
// signs the supporter in, and a confirm link takes its page live: a confirm link goes on to that
// page's manage screen, saying once that it is live, and a sign-in link to the supporter's list. a
// link used, expired or unknown goes to the sign-in screen's expired state.
//
// `no-store` on every answer: the redirect sets the session, and a kept copy would replay it.

export async function loader({ context, request }: Route.LoaderArgs): Promise<Response> {
	const token = new URL(request.url).searchParams.get('token') ?? '';
	const opened =
		token === ''
			? ({ ok: false } as const)
			: await signInWithLink(context.get(database), request, token, new Date());
	if (!opened.ok) {
		return unstored(
			await redirectWithFlash(
				request,
				SUPPORTER_SIGN_IN_FLASH,
				href('/fundraise/sign-in'),
				'expired'
			)
		);
	}
	const answer =
		opened.purpose === 'confirm' && opened.page !== null
			? await redirectWithFlash(
					request,
					SUPPORTER_PUBLISHED_FLASH,
					href('/fundraise/pages/:id', { id: opened.page.id }),
					'published'
				)
			: redirect(href('/fundraise/pages'), 303);
	answer.headers.append('Set-Cookie', opened.setCookie);
	return unstored(answer);
}

function unstored(answer: Response): Response {
	answer.headers.set('cache-control', 'no-store');
	return answer;
}
