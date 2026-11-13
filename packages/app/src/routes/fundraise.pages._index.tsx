import { href } from 'react-router';
import { YourFundraisers } from '$lib/supporter/area/fundraisers';
import { supporterAreaLinks } from '$lib/supporter/area/links';
import { supporterFundraisersEnabled } from '$lib/server/org/queries';
import { readSupporterOrg, signedInSupporter, supporterAccount } from '$lib/server/supporters/area';
import { listOwnFundraisers } from '$lib/server/supporters/pages';
import { database } from '../context';
import type { Route } from './+types/fundraise.pages._index';

// Your fundraisers: the signed-in supporter's own pages, newest first ($lib/server/supporters/pages.ts
// reads only theirs). Start another is offered while the organisation takes new pages. a caller
// with no supporter session goes to the sign-in; a staff session is not one
// ($lib/server/supporters/session.ts).

export async function loader({ context, request }: Route.LoaderArgs) {
	const db = context.get(database);
	const signedIn = await signedInSupporter(db, request);
	const [org, open, pages] = await Promise.all([
		readSupporterOrg(db),
		supporterFundraisersEnabled(db),
		listOwnFundraisers(db, signedIn.supporterId)
	]);
	return {
		org,
		account: supporterAccount(signedIn),
		startHref: open ? href('/fundraise') : null,
		pages: pages.map((page) => ({
			id: page.id,
			title: page.title,
			status: page.status,
			hidden: page.hidden,
			address: href('/f/:slug', { slug: page.slug }),
			endedAt: page.endedAt?.toISOString() ?? null,
			manageHref: href('/fundraise/pages/:id', { id: page.id }),
			raisedMinor: page.raisedMinor,
			goalMinor: page.goalMinor,
			gifts: page.gifts,
			currency: page.currency
		}))
	};
}

/** one supporter's own pages, read under their session: no copy is kept. */
export function headers() {
	return { 'cache-control': 'no-store' };
}

export function meta(): Route.MetaDescriptors {
	return [{ title: 'Your fundraisers' }];
}

export function links(): Route.LinkDescriptors {
	return supporterAreaLinks();
}

export default function FundraisersRoute({ loaderData }: Route.ComponentProps) {
	return <YourFundraisers {...loaderData} />;
}
