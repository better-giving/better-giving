import { data, href } from 'react-router';
import { INTENT, INTENTS } from '$lib/supporter/area/forms';
import { supporterAreaLinks } from '$lib/supporter/area/links';
import { ManageFundraiser } from '$lib/supporter/area/manage';
import { usePosting } from '$lib/supporter/area/use-posting';
import { refuseWriteFromAnotherOrigin } from '$lib/server/auth/gate';
import { notFound } from '$lib/server/db/load-failure';
import { SUPPORTER_PUBLISHED_FLASH, takeFlash } from '$lib/server/flash';
import {
	NOT_YOUR_PAGE,
	readSupporterOrg,
	signedInSupporter,
	supporterAccount,
	supporterShareUrl
} from '$lib/server/supporters/area';
import { endOwnFundraiser, readOwnFundraiser } from '$lib/server/supporters/pages';
import { database, platform } from '../context';
import type { Route } from './+types/fundraise.pages.$id._index';

// one of the signed-in supporter's pages: what it has raised, its link, its gifts and End. the page
// is read for its own supporter alone, so another supporter's id is the same 404 as an unknown one
// ($lib/server/supporters/pages.ts). the visit after its confirm link published it says once that
// it is live, off the flash ./fundraise.open.tsx set.
//
// End posts `intent=end` here; an end that lands is drawn by the re-read, and one that throws is
// said in the confirm. what a gift shows its supporter is pages.ts's: never a donor's email, address
// or payment method.

export async function loader({ context, params, request }: Route.LoaderArgs) {
	const db = context.get(database);
	const signedIn = await signedInSupporter(db, request);
	const [org, page, landed] = await Promise.all([
		readSupporterOrg(db),
		readOwnFundraiser(db, signedIn.supporterId, params.id),
		takeFlash(request, SUPPORTER_PUBLISHED_FLASH)
	]);
	if (page === null) notFound(NOT_YOUR_PAGE);
	const address = href('/f/:slug', { slug: page.slug });
	return data(
		{
			org,
			account: supporterAccount(signedIn),
			page: {
				id: page.id,
				title: page.title,
				status: page.status,
				hidden: page.hidden,
				hiddenNote: page.hiddenNote,
				goalMinor: page.goalMinor,
				raisedMinor: page.raisedMinor,
				gifts: page.gifts,
				currency: page.currency,
				endedAt: page.endedAt?.toISOString() ?? null,
				publishedAt: page.publishedAt?.toISOString() ?? null,
				address,
				url: supporterShareUrl(context.get(platform).env, request, address),
				giftList: page.giftList.map((gift) => ({
					amountMinor: gift.amountMinor,
					receivedAt: gift.receivedAt.toISOString(),
					shown: gift.shown
				}))
			},
			// `org_profile` holds no address meant for the public; its notification address is
			// operational (`notification_email` in $lib/server/db/schema.ts).
			orgContactEmail: null,
			justPublished: landed?.marker === 'published',
			backHref: href('/fundraise/pages'),
			editHref: href('/fundraise/pages/:id/edit', { id: page.id })
		},
		landed === null ? {} : { headers: { 'Set-Cookie': landed.clear } }
	);
}

/** one supporter's own page, read under their session: no copy is kept. */
export function headers() {
	return { 'cache-control': 'no-store' };
}

export async function action({ context, params, request }: Route.ActionArgs) {
	refuseWriteFromAnotherOrigin(request);
	const db = context.get(database);
	const signedIn = await signedInSupporter(db, request);
	const intent = (await request.formData()).get(INTENT);
	if (intent !== INTENTS.end) {
		throw new Response(`\`${INTENT}\` is \`${INTENTS.end}\` on this screen and nothing else.`, {
			status: 400
		});
	}
	let ended: Awaited<ReturnType<typeof endOwnFundraiser>>;
	try {
		ended = await endOwnFundraiser(db, signedIn.supporterId, params.id, new Date());
	} catch (e) {
		console.error(`ending fundraiser ${params.id} failed:`, e);
		return data({ endRefused: true }, 500);
	}
	if (ended === 'not_found') notFound(NOT_YOUR_PAGE);
	return { endRefused: false };
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: loaderData.page.title }];
}

export function links(): Route.LinkDescriptors {
	return supporterAreaLinks();
}

export default function ManageRoute({ loaderData, actionData }: Route.ComponentProps) {
	const ending = usePosting(INTENTS.end);
	return (
		<ManageFundraiser
			{...loaderData}
			endRefused={actionData?.endRefused === true}
			ending={ending}
		/>
	);
}
