import { DonateNotice } from '$lib/donate/notice';
import { PageWithCard } from '$lib/donate/page-with-card';
import { donorPageLinks, FORM_LOOK, PlainDonationPage, PlainPage } from '$lib/donate/plain-page';
import { checkSlug } from '$lib/page/slug';
import { readServedCampaign } from '$lib/server/pages/campaign';
import { loadPageView, refusedPage } from '$lib/server/pages/view';
import { database, platform } from '../context';
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
// only a `live` campaign answers. one never published, one ended, one deleted and a slug nobody
// holds are the same 404 with the same body, so the answer says nothing about which it was. the
// published document passes the read rule in $lib/server/pages/view.ts, which draws the plain page
// of its donation settings, logged, where the rule refuses it.

export async function loader({ context, params, request }: Route.LoaderArgs) {
	const address = checkSlug(params.slug);
	if (!address.ok) return refusedPage();
	const db = context.get(database);
	const { env } = context.get(platform);
	const campaign = await readServedCampaign(db, address.slug);
	if (campaign === null) return refusedPage();
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
		request
	);
	if (loaded.kind === 'refused') return refusedPage();
	return loaded;
}

/** the refusal's `cache-control`, carried out of the loader as ./donate.tsx carries it. */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

/** the donor page's document policy, which ../document-policy.ts lists and cites. */
export const handle: DonorPolicyHandle = { documentPolicy: 'donor' };

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	switch (loaderData.kind) {
		case 'page':
			return [{ title: loaderData.view.pageName }];
		case 'plain':
			return [{ title: `Donate to ${loaderData.config.orgLegalName}` }];
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
		case 'refused':
			return (
				<PlainPage look={FORM_LOOK}>
					<DonateNotice orgName={null} />
				</PlainPage>
			);
	}
}
