import { RESUME_FORM_PARAM } from '@better-giving/form/embed/resume';
import { data, redirect, type ShouldRevalidateFunctionArgs } from 'react-router';
import { DonateNotice } from '$lib/donate/notice';
import { PageWithCard, type PageWithCardProps } from '$lib/donate/page-with-card';
import {
	donorPageLinks,
	FORM_LOOK,
	PlainDonationPage,
	PlainPage,
	SITE_CHROME_SHEETS
} from '$lib/donate/plain-page';
import { useShowMoreMessages } from '$lib/donate/show-more';
import { NAMELESS_FOOTER, SiteFooter } from '$lib/donate/site-footer';
import { shareImage } from '$lib/page/image-src';
import { meterDonorPage } from '$lib/server/api/meter';
import { donorPageRateLimitRefusal } from '$lib/server/api/rate-limit';
import { identityMissing } from '$lib/server/org/identity';
import { readOrgProfile } from '$lib/server/org/queries';
import { ensureDonationPage } from '$lib/server/pages/donation-page';
import { loadPageView, refusedPage, withFundraiserEntry } from '$lib/server/pages/view';
import { database, overDonorPageLimit, platform } from '../context';
import type { DonorPolicyHandle } from '../document-policy';
import type { Route } from './+types/_index';

// the donation page: the organisation's own donor page, at `/` on the deployment, which is its home
// page too. `/donate` is the address it had before and answers a permanent redirect to `/`
// (./donate.tsx), so a link already shared or printed still arrives.
//
// **it is a donor screen rather than an operator screen**, and everything odd about this file
// follows from that. the reader is a person who was handed a link, so a refusal is a sentence rather
// than a status somebody can act on; the page is dressed from packages/form's own sheets rather
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
	const now = Date.now();
	const loaded = await loadPageView(
		db,
		env,
		{
			id: page.id,
			type: 'donation_page',
			formId: page.formId,
			name: null,
			document: page.published,
			address: '/'
		},
		request,
		{ now }
	);
	if (loaded.kind === 'refused') {
		// a deployment whose organisation has no registered name or EIN has nothing to show a donor
		// yet and cannot go live (`identityMissing`, the same check the console's readiness reads), so
		// its first visitor is sent to the dashboard to set it up. temporary, never 308: the address
		// is the donation page once it is. a page that is off or failed on a set-up organisation keeps
		// the refusal.
		if (identityMissing(await readOrgProfile(db)).length > 0) return redirect('/admin', 302);
		return refusedPage();
	}
	const drawn = await withFundraiserEntry(db, loaded);
	// a donor back from authorizing their gift arrives here with the stamp naming the page's
	// settings row, and the card's first paint is then the wait for that gift rather than an empty
	// donation box. the stamp is the whole of what is read: the token beside it is the card's to
	// claim once its flow starts. a stamp naming another form is no return of this page's.
	const { formId } = drawn.kind === 'page' ? drawn.view.config : drawn.config;
	const resuming = new URL(request.url).searchParams.get(RESUME_FORM_PARAM) === formId;
	// the instant the page was read, which every donor message's age is counted from on the server
	// and in the browser alike, so the two renders say the same.
	return data(
		{ ...drawn, resuming, now: new Date(now).toISOString() },
		{ headers: { 'cache-control': 'no-store' } }
	);
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
	return donorPageLinks(SITE_CHROME_SHEETS);
}

export default function DonationPage({ loaderData }: Route.ComponentProps) {
	switch (loaderData.kind) {
		case 'page':
			return (
				<CardPage
					{...loaderData.view}
					profile={loaderData.profile}
					resuming={loaderData.resuming}
					now={loaderData.now}
				/>
			);
		case 'plain':
			return (
				<PlainDonationPage
					config={loaderData.config}
					look={loaderData.look}
					resuming={loaderData.resuming}
					footer={<SiteFooter info={NAMELESS_FOOTER} />}
				/>
			);
		case 'refused':
			return (
				<PlainPage look={FORM_LOOK} footer={<SiteFooter info={NAMELESS_FOOTER} />}>
					<DonateNotice />
				</PlainPage>
			);
	}
}

/** the page and its card, with Show more messages counting ages from `now`, the loader's instant. */
function CardPage({ now, ...page }: PageWithCardProps & { readonly now: string }) {
	const donorMessages = useShowMoreMessages(now);
	return <PageWithCard {...page} donorMessages={donorMessages} />;
}
