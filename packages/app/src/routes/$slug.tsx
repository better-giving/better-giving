import { RESUME_FORM_PARAM } from '@better-giving/form/embed/resume';
import { data, type ShouldRevalidateFunctionArgs } from 'react-router';
import * as copy from '$lib/donate/copy';
import { DonateNotice } from '$lib/donate/notice';
import { PageWithCard } from '$lib/donate/page-with-card';
import {
	donorPageLinks,
	EndedCampaignPage,
	FORM_LOOK,
	PlainDonationPage,
	PlainPage
} from '$lib/donate/plain-page';
import { shareImage } from '$lib/page/image-src';
import { checkSlug } from '$lib/page/slug';
import { meterDonorPage } from '$lib/server/api/meter';
import { donorPageRateLimitRefusal } from '$lib/server/api/rate-limit';
import { readOrgProfile, readOrgProfileLogo } from '$lib/server/org/queries';
import { readServedCampaign } from '$lib/server/pages/campaign';
import { readDocument } from '$lib/server/pages/document';
import { donorLook, loadPageView, refusedPage } from '$lib/server/pages/view';
import { database, overDonorPageLimit, platform } from '../context';
import type { DonorPolicyHandle } from '../document-policy';
import type { Route } from './+types/$slug';

// a campaign at its own address: `/{slug}` on the deployment, one top-level segment.
//
// a donor screen, dressed and served as ./donate.tsx is — the form's four sheets, the donor
// document policy, no operator component — and everything that route's header says of the reader,
// the origin and the gift holds here unchanged. the gift goes through the card to
// `/api/v1/forms/:id/donations` against the campaign's owned settings row; there is no action.
//
// every static top-level route outranks this one in react router's matcher, so `/donate`,
// `/admin` and the rest never arrive here (../routes.spec.ts holds it), and $lib/page/slug.ts
// refuses a campaign the address of any of them. what does arrive is every other single segment
// anyone types or scans for, so an address no campaign could hold is refused before the database
// is read. the matcher ignores case and a slug is lowercase, so a capital is one of those: the
// refusal, never a redirect to the other spelling.
//
// a `live` campaign draws its published page, read through the rule $lib/server/pages/view.ts
// applies; where that rule refuses the document, the plain page of its donation settings is drawn
// instead and the refusal is logged. either is `no-store`, for the reason ./donate.tsx gives.
//
// an `ended` campaign — ended by End, or live and past its published end date, which reads the same
// ($lib/page/ended.ts) — still holds its address, so the address answers 200 with the ended screen:
// the organisation's name and logo atop it, the campaign's name, that it has ended, and the way on
// to /donate — in its own published look ($lib/server/pages/view.ts's `donorLook`), with none of its
// blocks and no donation box, since its owned settings row is out of service (`endCampaign` in
// $lib/server/pages/queries.ts, and read so past the end date by `readPublishedConfig`).
// `no-store`, because publishing it again puts it back live at the same address.
//
// one never published, one deleted and a slug nobody holds are the same 404 with the same body, so
// the answer says nothing about which it was.
//
// every view is charged per address before the loader reads anything (`meterDonorPage` in
// $lib/server/api/meter.ts), and an address over it is drawn the same plain notice under a 429.

export const middleware: Route.MiddlewareFunction[] = [meterDonorPage];

export async function loader({ context, params, request }: Route.LoaderArgs) {
	if (context.get(overDonorPageLimit)) return donorPageRateLimitRefusal();
	const address = checkSlug(params.slug);
	if (!address.ok) return refusedPage();
	const db = context.get(database);
	const { env } = context.get(platform);
	const now = Date.now();
	const campaign = await readServedCampaign(db, address.slug, now);
	if (campaign === null) return refusedPage();
	if (campaign.state === 'ended') {
		const [profile, logo] = await Promise.all([readOrgProfile(db), readOrgProfileLogo(db)]);
		const published = readDocument(campaign, 'published', campaign.published);
		return data(
			{
				kind: 'ended',
				name: campaign.name,
				orgName: profile?.legalName ?? null,
				look: donorLook(
					published.ok ? published.page.look : undefined,
					profile?.brandColour ?? null
				),
				logo
			} as const,
			{ headers: { 'cache-control': 'no-store' } }
		);
	}
	const loaded = await loadPageView(
		db,
		env,
		{
			id: campaign.id,
			type: 'campaign',
			formId: campaign.formId,
			name: campaign.name,
			document: campaign.published,
			address: `/${address.slug}`
		},
		request,
		{ now }
	);
	if (loaded.kind === 'refused') return refusedPage();
	// a donor's return from authorizing their gift, read as ./donate.tsx reads it: the stamp naming
	// this campaign's own settings row, and nothing else.
	const { formId } = loaded.kind === 'page' ? loaded.view.config : loaded.config;
	const resuming = new URL(request.url).searchParams.get(RESUME_FORM_PARAM) === formId;
	return data({ ...loaded, resuming }, { headers: { 'cache-control': 'no-store' } });
}

/**
 * the loader runs again only for an address naming another campaign, which owns another settings
 * row and so serves another config. on the same address a re-read could only swap the config under
 * a gift in progress and end it, and would answer `resuming: false` under a claimed return — the
 * argument is `shouldRevalidate` in ./donate.tsx.
 */
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
		case 'page': {
			const image = shareImage(loaderData.view.page, loaderData.view.sharing.url);
			return [
				{ title: loaderData.view.pageName },
				...(image === null ? [] : [{ property: 'og:image', content: image }])
			];
		}
		case 'plain':
			return [{ title: `Donate to ${loaderData.config.orgLegalName}` }];
		case 'ended':
			return [{ title: copy.campaignEnded(loaderData.name) }];
		case 'refused':
			return [{ title: 'Donate' }];
	}
}

export function links(): Route.LinkDescriptors {
	return donorPageLinks();
}

export default function CampaignPage({ loaderData }: Route.ComponentProps) {
	switch (loaderData.kind) {
		case 'page':
			return <PageWithCard {...loaderData.view} resuming={loaderData.resuming} />;
		case 'plain':
			return (
				<PlainDonationPage
					config={loaderData.config}
					look={loaderData.look}
					resuming={loaderData.resuming}
				/>
			);
		case 'ended':
			return (
				<EndedCampaignPage
					name={loaderData.name}
					orgName={loaderData.orgName}
					look={loaderData.look}
					logo={loaderData.logo}
				/>
			);
		case 'refused':
			return (
				<PlainPage look={FORM_LOOK}>
					<DonateNotice />
				</PlainPage>
			);
	}
}
