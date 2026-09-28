import { DonateNotice } from '$lib/donate/notice';
import { PageWithCard } from '$lib/donate/page-with-card';
import { donorPageLinks, FORM_LOOK, PlainDonationPage, PlainPage } from '$lib/donate/plain-page';
import { ensureDonationPage } from '$lib/server/pages/donation-page';
import { loadPageView, refusedPage } from '$lib/server/pages/view';
import { database, platform } from '../context';
import type { DonorPolicyHandle } from '../document-policy';
import type { Route } from './+types/donate';

// the donation page: the organisation's own donor page, at /donate on the deployment.
//
// **it is a donor screen rather than an operator screen**, and everything odd about this file
// follows from that. the reader is a person who was handed a link, so a refusal is a sentence rather
// than a status somebody can act on; the page is dressed from packages/form's own four sheets rather
// than from the operator system, which is why `links` below does not return `operatorLinks`
// ($lib/admin/operator-links.ts); and no operator component is mounted anywhere under it.
//
// **it exists so that set-up can finish without a website.** the spam protection is registered
// against the sites a form is served on, and an organisation that has none had nothing to name.
// it is on no `site` row, and the deployment accepts its own origin off the request instead —
// $lib/server/pages/view.ts names where. and it is not a rehearsal surface: a gift made here is a
// real gift on whatever keys the deployment holds, because nothing in this project reads
// test-versus-live but a Stripe dispute alert's dashboard link — rehearsing is a second deployment
// (DEPLOY.md).
//
// the page is made on first need ($lib/server/pages/donation-page.ts), so a fresh deployment
// answers here before anyone has opened the editor. the gift goes through the card to
// `/api/v1/forms/:id/donations` against the page's owned settings row, same-origin, and nothing here
// initiates a payment; there is no action on this route.

export async function loader({ context, request }: Route.LoaderArgs) {
	const db = context.get(database);
	// the deploy-time values arrive off the context rather than through anything a loader returns:
	// a return value is serialized into the document, so an env handed onward puts the Stripe secret
	// one `return { env }` from being published.
	const { env } = context.get(platform);
	const page = await ensureDonationPage(db);
	const loaded = await loadPageView(
		db,
		env,
		{
			id: page.id,
			type: 'donation_page',
			formId: page.formId,
			name: null,
			document: page.published,
			address: '/donate'
		},
		request
	);
	if (loaded.kind === 'refused') return refusedPage();
	return loaded;
}

/**
 * the refusal's `cache-control`, carried out of the loader: a `data()`'s headers reach a document
 * response only through this export (`getDocumentHeaders` in react-router). the drawn page sets
 * none and takes the framework's default.
 */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

/**
 * the document policy this page is drawn under: the operator base widened by exactly the origins
 * the card and its processors load. ../document-policy.ts lists them and cites each.
 */
export const handle: DonorPolicyHandle = { documentPolicy: 'donor' };

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	// a refusal names nobody: an address turned down says nothing back about who it would serve.
	if (loaderData.kind === 'refused') return [{ title: 'Donate' }];
	const config = loaderData.kind === 'page' ? loaderData.view.config : loaderData.config;
	return [{ title: `Donate to ${config.orgLegalName}` }];
}

export function links(): Route.LinkDescriptors {
	return donorPageLinks();
}

export default function DonationPage({ loaderData }: Route.ComponentProps) {
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
