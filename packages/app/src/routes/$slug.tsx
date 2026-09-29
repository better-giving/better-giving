import { data } from 'react-router';
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
import { readOrgLogo, readOrgLook, readOrgProfile } from '$lib/server/org/queries';
import { readServedCampaign } from '$lib/server/pages/campaign';
import { loadPageView, refusedPage } from '$lib/server/pages/view';
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
// a `live` campaign draws its published page. the document passes the read rule in
// $lib/server/pages/view.ts, which draws the plain page of its donation settings, logged, where the
// rule refuses it.
//
// an `ended` campaign — ended by End, or live and past its published end date, which reads the same
// ($lib/page/ended.ts) — still holds its address, so the address answers 200 with the ended screen:
// the organisation's name and logo atop it, the campaign's name, that it has ended, and the way on
// to /donate — in the organisation's look, with none of its blocks and no donation box, since its
// owned settings row is out of service (`endCampaign` in $lib/server/pages/queries.ts, and read so
// past the end date by `readPublishedConfig`). `no-store`, because publishing it again puts it back
// live at the same address.
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
		const [profile, orgLook, orgLogo] = await Promise.all([
			readOrgProfile(db),
			readOrgLook(db),
			readOrgLogo(db)
		]);
		return data(
			{
				kind: 'ended',
				name: campaign.name,
				orgName: profile?.legalName ?? null,
				look: orgLook.look,
				logo: orgLogo.logo
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
	return loaded;
}

/**
 * the ended screen's and the refusal's `cache-control`, carried out of the loader as ./donate.tsx
 * carries it.
 */
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
			return <PageWithCard {...loaderData.view} />;
		case 'plain':
			return <PlainDonationPage config={loaderData.config} look={loaderData.look} />;
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
