import { data, href } from 'react-router';
import { APP_NAME } from '$lib/admin/screen-title';
import { FundraiserPage, fundraiserPageLinks } from '$lib/supporter/public/fundraiser-page';
import { staffGate } from '$lib/server/auth/gate';
import { SERVED_LOCALE } from '$lib/server/forms/published-config';
import { readOrgProfile, readOrgProfileLogo } from '$lib/server/org/queries';
import { donorContact } from '$lib/server/pages/view';
import { supporterShareUrl } from '$lib/server/supporters/area';
import { readFundraiserPreview } from '$lib/server/supporters/view';
import { database, platform } from '../context';
import type { DonorPolicyHandle } from '../document-policy';
import type { Route } from './+types/admin.supporter-pages.$id.preview';

// staff's look at a supporter's fundraiser the public cannot see — hidden, or still waiting on its
// confirm link — at /admin/supporter-pages/{id}/preview, which Open on Supporter pages
// (./_app.admin.supporter-pages.tsx) opens for such a page.
//
// **outside ./_app.tsx, mounting the session gate itself**, for ./preview.$pageId.tsx's reason: the
// dashboard's frame would be drawn around a page that has to look as a donor sees it. members may
// open it as they may hide and show. a supporter's session is no staff session and opens nothing
// here ($lib/server/supporters/session.ts).
//
// it draws the live page whatever state the fundraiser is in (`readFundraiserPreview` in
// $lib/server/supporters/view.ts) with no donation box, so nothing here can start a gift, and
// without the messages section, whose Show more reads the public list. no cache keeps it.

export const middleware: Route.MiddlewareFunction[] = [staffGate];

export async function loader({ context, params, request }: Route.LoaderArgs) {
	const db = context.get(database);
	const { env } = context.get(platform);
	const [preview, profile, logo] = await Promise.all([
		readFundraiserPreview(db, params.id),
		readOrgProfile(db),
		readOrgProfileLogo(db)
	]);
	if (preview === null) throw data(null, { status: 404 });
	const now = new Date();
	return {
		fundraiser: {
			title: preview.title,
			story: preview.story,
			name: preview.name,
			startedAt: (preview.startedAt ?? now).toISOString(),
			photoId: preview.photoId,
			raisedMinor: preview.raisedMinor,
			goalMinor: preview.goalMinor,
			gifts: preview.gifts,
			goalReached: preview.goalReached,
			messages: preview.messages
		},
		org: { name: profile?.legalName ?? APP_NAME, taxId: profile?.taxId ?? null, logo },
		look: { brandColour: profile?.brandColour ?? null },
		money: { locale: SERVED_LOCALE, currency: preview.currency },
		now: now.toISOString(),
		sharing: {
			message: preview.title,
			url: supporterShareUrl(env, request, href('/f/:slug', { slug: preview.slug }))
		},
		contact: donorContact(profile),
		fundraiserEntry: false
	};
}

export function headers(): Headers {
	return new Headers({ 'cache-control': 'no-store' });
}

export const handle: DonorPolicyHandle = { documentPolicy: 'donor' };

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: `Preview: ${loaderData.fundraiser.title}` }];
}

export function links(): Route.LinkDescriptors {
	return fundraiserPageLinks();
}

export default function FundraiserPreviewRoute({ loaderData }: Route.ComponentProps) {
	return <FundraiserPage {...loaderData} donationBox={null} />;
}
