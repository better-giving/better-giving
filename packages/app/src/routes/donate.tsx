import { RESUME_FORM_PARAM } from '@better-giving/form/embed/resume';
import { data, type ShouldRevalidateFunctionArgs } from 'react-router';
import { DonateNotice } from '$lib/donate/notice';
import { PageWithCard } from '$lib/donate/page-with-card';
import { donorPageLinks, FORM_LOOK, PlainDonationPage, PlainPage } from '$lib/donate/plain-page';
import { shareImage } from '$lib/page/image-src';
import { meterDonorPage } from '$lib/server/api/meter';
import { donorPageRateLimitRefusal } from '$lib/server/api/rate-limit';
import { ensureDonationPage } from '$lib/server/pages/donation-page';
import { loadPageView, refusedPage } from '$lib/server/pages/view';
import { database, overDonorPageLimit, platform } from '../context';
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
//
// every view is charged per address before the loader reads anything (`meterDonorPage` in
// $lib/server/api/meter.ts), and an address over it is drawn the same plain notice under a 429.
//
// every answer is `no-store`: the amounts and settings are in the document, so a kept copy would
// show a donor figures the operator has since changed, and a kept refusal would outlive the fix.

export const middleware: Route.MiddlewareFunction[] = [meterDonorPage];

export async function loader({ context, request }: Route.LoaderArgs) {
	if (context.get(overDonorPageLimit)) return donorPageRateLimitRefusal();
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
		request,
		{ now: Date.now() }
	);
	if (loaded.kind === 'refused') return refusedPage();
	// a donor back from authorizing their gift arrives here with the stamp naming the page's
	// settings row, and the card's first paint is then the wait for that gift rather than an empty
	// donation box. the stamp is the whole of what is read: the token beside it is the card's to
	// claim once its flow starts. a stamp naming another form is no return of this page's.
	const { formId } = loaded.kind === 'page' ? loaded.view.config : loaded.config;
	const resuming = new URL(request.url).searchParams.get(RESUME_FORM_PARAM) === formId;
	return data({ ...loaded, resuming }, { headers: { 'cache-control': 'no-store' } });
}

/**
 * the loader never runs again under a drawn page.
 *
 * the card builds its checkout from the config this loader returns and stops it when a new one
 * arrives (the checkout effect in $lib/donate/card.tsx), and this route draws one page whose
 * settings row never changes under it, so a re-read — a same-address navigation, a submission, a
 * `revalidate()` — could only swap the published config under a gift in progress and end it. a
 * page republished meanwhile reaches the donor on their next load.
 *
 * the resume stamp is a search parameter and so re-reads nothing either. the card scrubs it with
 * `history.replaceState`, out of react router's sight, so a navigation off the stamped address the
 * router still holds would re-read without the stamp and answer `resuming: false` under the
 * takeover the flow is showing.
 */
export function shouldRevalidate(_asked: ShouldRevalidateFunctionArgs): boolean {
	return false;
}

/**
 * the loader's `cache-control`, carried out of it onto the document: a `data()`'s headers reach a
 * document response only through this export (`getDocumentHeaders` in react-router).
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
	if (loaderData.kind === 'plain')
		return [{ title: `Donate to ${loaderData.config.orgLegalName}` }];
	const { config, page, sharing } = loaderData.view;
	const image = shareImage(page, sharing.url);
	return [
		{ title: `Donate to ${config.orgLegalName}` },
		...(image === null ? [] : [{ property: 'og:image', content: image }])
	];
}

export function links(): Route.LinkDescriptors {
	return donorPageLinks();
}

export default function DonationPage({ loaderData }: Route.ComponentProps) {
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
		case 'refused':
			return (
				<PlainPage look={FORM_LOOK}>
					<DonateNotice />
				</PlainPage>
			);
	}
}
