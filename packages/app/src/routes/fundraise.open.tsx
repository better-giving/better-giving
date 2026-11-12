import { data, href, redirect } from 'react-router';
import { INTENTS } from '$lib/supporter/area/forms';
import { supporterAreaLinks } from '$lib/supporter/area/links';
import { OpenLink } from '$lib/supporter/area/open-link';
import { usePosting } from '$lib/supporter/area/use-posting';
import { refuseWriteFromAnotherOrigin } from '$lib/server/auth/gate';
import { redirectWithFlash, SUPPORTER_PUBLISHED_FLASH } from '$lib/server/flash';
import { readSupporterOrg, toExpiredLink } from '$lib/server/supporters/area';
import { readOpeningLink, signInWithLink } from '$lib/server/supporters/links';
import { database } from '../context';
import type { Route } from './+types/fundraise.open';

// a mailed link opened: `/fundraise/open?token=`. a GET only draws a press naming what the link
// does, and for a confirm link the page it publishes, read without spending it (`readOpeningLink`
// in $lib/server/supporters/links.ts): mail scanners fetch the links in a message, and a fetch
// must neither publish a page nor sign anybody in. the press posts the token here, and the action
// spends it (`signInWithLink`): it signs the supporter in, and a confirm link takes its page live.
// a confirm link goes on to that page's
// manage screen, saying once that it is live where this opening published it, and a sign-in link
// to the supporter's list. a link used, expired or unknown goes to the sign-in screen's expired
// state, from the GET and from the post alike.
//
// `no-store` on every answer: the screen carries the token, and the post's redirect sets the
// session, which a kept copy would replay.

export async function loader({ context, request }: Route.LoaderArgs) {
	const db = context.get(database);
	const token = new URL(request.url).searchParams.get('token') ?? '';
	const link = token === '' ? null : await readOpeningLink(db, token, new Date());
	if (link === null) throw unstored(await toExpiredLink(request));
	return data(
		{ org: await readSupporterOrg(db), purpose: link.purpose, page: link.page, token },
		{ headers: { 'cache-control': 'no-store' } }
	);
}

/** `no-store`, carried onto the document. */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	refuseWriteFromAnotherOrigin(request);
	const posted = (await request.formData()).get('token');
	const token = typeof posted === 'string' ? posted : '';
	const opened =
		token === ''
			? ({ ok: false } as const)
			: await signInWithLink(context.get(database), request, token, new Date());
	if (!opened.ok) return unstored(await toExpiredLink(request));
	const answer =
		opened.purpose !== 'confirm' || opened.page === null
			? redirect(href('/fundraise/pages'), 303)
			: opened.published
				? await redirectWithFlash(
						request,
						SUPPORTER_PUBLISHED_FLASH,
						href('/fundraise/pages/:id', { id: opened.page.id }),
						'published'
					)
				: redirect(href('/fundraise/pages/:id', { id: opened.page.id }), 303);
	answer.headers.append('Set-Cookie', opened.setCookie);
	return unstored(answer);
}

function unstored(answer: Response): Response {
	answer.headers.set('cache-control', 'no-store');
	return answer;
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	return [
		{
			title: loaderData.purpose === 'confirm' ? 'Publish your fundraiser' : 'Open your fundraiser'
		}
	];
}

export function links(): Route.LinkDescriptors {
	return supporterAreaLinks();
}

export default function OpenRoute({ loaderData }: Route.ComponentProps) {
	return (
		<OpenLink
			org={loaderData.org}
			purpose={loaderData.purpose}
			page={loaderData.page}
			token={loaderData.token}
			opening={usePosting(INTENTS.open)}
		/>
	);
}
