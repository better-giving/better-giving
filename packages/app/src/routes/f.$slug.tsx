import { RESUME_FORM_PARAM } from '@better-giving/form/embed/resume';
import { data, href, type ShouldRevalidateFunctionArgs } from 'react-router';
import * as copy from '$lib/donate/copy';
import { useShowMoreMessages } from '$lib/donate/show-more';
import {
	FundraiserEndedPage,
	FundraiserNotFoundPage,
	FundraiserPageWithCard,
	fundraiserPageLinks
} from '$lib/supporter/public/fundraiser-page';
import type { FundraiserPageProps } from '$lib/supporter/public/types';
import type { FormConfig } from '@better-giving/form/v1';
import { meterDonorPage } from '$lib/server/api/meter';
import { donorPageRateLimitRefusal } from '$lib/server/api/rate-limit';
import { SERVED_LOCALE } from '$lib/server/forms/published-config';
import {
	readOrgProfile,
	readOrgProfileLogo,
	supporterFundraisersEnabled
} from '$lib/server/org/queries';
import { loadFundraiserFrame, refusedPage } from '$lib/server/pages/view';
import { supporterShareUrl } from '$lib/server/supporters/area';
import { readPublicFundraiser } from '$lib/server/supporters/view';
import { database, overDonorPageLimit, platform } from '../context';
import type { DonorPolicyHandle } from '../document-policy';
import type { Route } from './+types/f.$slug';

// a supporter's fundraiser at `/f/{slug}`: a donor screen, dressed, served and metered as a
// campaign's address is (./$slug.tsx), and everything that route's header says of the reader, the
// origin and the gift holds here. the gift goes through the card to `/api/v1/forms/:id/donations`
// against the fundraiser's own settings row, whose served config takes a gift while the page is
// live and shown (`fundraiserTakingGifts` in $lib/server/supporters/gifts.ts); there is no action.
//
// three answers, `readPublicFundraiser`'s ($lib/server/supporters/view.ts): live draws the page and
// its card; ended answers 200 with the ended screen and its final total, since the address still
// holds; hidden, pending and an address nobody holds are the same 404 an unknown campaign address
// gets, with the same body. a live page whose served config refuses is that 404 too, as a refused
// campaign is. every answer is `no-store`, for ./donate.tsx's reason.

export const middleware: Route.MiddlewareFunction[] = [meterDonorPage];

export async function loader({ context, params, request }: Route.LoaderArgs) {
	if (context.get(overDonorPageLimit)) return donorPageRateLimitRefusal();
	const db = context.get(database);
	const { env } = context.get(platform);
	const now = Date.now();
	const fundraiser = await readPublicFundraiser(db, params.slug);
	switch (fundraiser.kind) {
		case 'not_found':
			return refusedPage();
		case 'ended': {
			const [profile, logo] = await Promise.all([readOrgProfile(db), readOrgProfileLogo(db)]);
			const { kind, title, name, raisedMinor, goalMinor, gifts, currency } = fundraiser;
			return data(
				{
					kind,
					fundraiser: { title, name, raisedMinor, goalMinor, gifts },
					org: { name: profile?.legalName ?? null, taxId: profile?.taxId ?? null, logo },
					look: { brandColour: profile?.brandColour ?? null },
					money: { locale: SERVED_LOCALE, currency }
				},
				{ headers: NO_STORE }
			);
		}
		case 'live': {
			const [frame, fundraiserEntry] = await Promise.all([
				loadFundraiserFrame(db, env, fundraiser.formId, request, { now }),
				supporterFundraisersEnabled(db)
			]);
			if (frame === null) return refusedPage();
			const url = new URL(request.url);
			const { kind, id: _id, formId, currency: _currency, startedAt, ...shown } = fundraiser;
			return data(
				{
					kind,
					...frame,
					fundraiser: { ...shown, startedAt: startedAt.toISOString() },
					sharing: {
						message: fundraiser.title,
						url: supporterShareUrl(env, request, href('/f/:slug', { slug: params.slug }))
					},
					fundraiserEntry,
					// a donor's return from authorizing their gift, read as ./donate.tsx reads it.
					resuming: url.searchParams.get(RESUME_FORM_PARAM) === formId,
					now: new Date(now).toISOString()
				},
				{ headers: NO_STORE }
			);
		}
	}
}

const NO_STORE = { 'cache-control': 'no-store' };

/** the loader runs again only for another fundraiser, for `shouldRevalidate` in ./$slug.tsx's reason. */
export function shouldRevalidate({ currentParams, nextParams }: ShouldRevalidateFunctionArgs) {
	return currentParams.slug !== nextParams.slug;
}

/** every answer's `cache-control`, carried out of the loader as ./donate.tsx carries it. */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

/** the donor page's document policy, which ../document-policy.ts lists and cites. */
export const handle: DonorPolicyHandle = { documentPolicy: 'donor' };

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	switch (loaderData.kind) {
		case 'live':
			return [{ title: loaderData.fundraiser.title }];
		case 'ended':
			return [{ title: copy.campaignEnded(loaderData.fundraiser.title) }];
		case 'refused':
			return [{ title: 'Donate' }];
	}
}

export function links(): Route.LinkDescriptors {
	return fundraiserPageLinks();
}

export default function FundraiserRoute({ loaderData, params }: Route.ComponentProps) {
	switch (loaderData.kind) {
		case 'live':
			return <LivePage {...loaderData} slug={params.slug} />;
		case 'ended':
			return <FundraiserEndedPage {...loaderData} />;
		case 'refused':
			return <FundraiserNotFoundPage />;
	}
}

/** the live page and its card, Show more asking this fundraiser's own list. */
function LivePage({
	slug,
	...page
}: FundraiserPageProps & {
	readonly config: FormConfig;
	readonly resuming: boolean;
	readonly slug: string;
}) {
	const donorMessages = useShowMoreMessages(page.now, href('/f/:slug/messages', { slug }));
	return <FundraiserPageWithCard {...page} donorMessages={donorMessages} />;
}
