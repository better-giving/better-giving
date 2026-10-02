import formLayout from '@better-giving/form/styles/layout.css?url';
import formMotion from '@better-giving/form/styles/motion.css?url';
import formParts from '@better-giving/form/styles/parts.css?url';
import { RESUME_FORM_PARAM } from '@better-giving/form/embed/resume';
import formTokens from '@better-giving/form/styles/tokens.css?url';
import { data, type ShouldRevalidateFunctionArgs } from 'react-router';
import { DonateCard } from '$lib/donate/card';
import { DonateNotice } from '$lib/donate/notice';
import pageChrome from '$lib/donate/page.css?url';
import { cachedCadences } from '$lib/server/forms/cadence-cache';
import { cachedCoins } from '$lib/server/forms/coin-cache';
import { readPublishedConfig, renderableConfig } from '$lib/server/forms/published-config';
import { cachedRails } from '$lib/server/forms/rail-cache';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { database, platform } from '../context';
import type { DonorPolicyHandle } from '../document-policy';
import type { Route } from './+types/$formId';

// the donor's page: one top-level segment, the form it names, and nothing else.
//
// **it is the only screen in this app that is not an operator screen**, and everything odd about
// this file follows from that. the reader is a person who was handed a link, so a refusal is a
// sentence rather than a status somebody can act on; the card is dressed from packages/form's own
// four sheets rather than from the operator system, which is why `links` below is the only one in
// the app that does not return `operatorLinks` ($lib/admin/operator-links.ts); and no operator
// component is mounted anywhere under it.
//
// **it exists so that set-up can finish without a website.** the spam protection is registered
// against the sites a form is served on, and an organisation that has none had nothing to name. it
// is not a site an operator ticks — no `site` row and no form's `allowed_origins` carries it, and
// the deployment accepts its own origin off the request instead ($lib/server/api/cors.ts, and
// `acceptableHostnames` in $lib/server/donations/quote.ts), so unticking a site never takes this
// page down. and it is not a rehearsal surface: a gift made here is a real gift on whatever keys the
// deployment holds, because nothing in this project reads test-versus-live but a Stripe dispute
// alert's dashboard link — rehearsing is a second deployment (DEPLOY.md).
//
// the address is a single segment and every static top-level route this app serves outranks it by
// react router's own precedence, so none of them is named here and none is excluded. `/embed.js` is
// a static asset and is served before routing reaches this file at all. ../routes.spec.ts asserts
// which address reaches which route, against the app's own route config.
//
// the gift's own path is unchanged: the card posts to `/api/v1/forms/:id/donations`, same-origin,
// through the seam in $lib/donate/ports.ts. nothing here initiates a payment and there is no action
// on this route.

/**
 * what a path segment may hold to be worth reading a row for.
 *
 * it admits every id this project mints and a great deal it does not, on purpose: the public id
 * format is deliberately unpinned — `form_id_not_blank_check` in $lib/server/db/schema.ts states
 * why — so a second reader here that required a prefix and a length would be pinning in a route
 * what the database would not pin in a column. what it refuses is the characters no address segment
 * should carry, which is a route's rule rather than a claim about ids: `/favicon.ico`, `/.env`,
 * `/wp-login.php` and the rest of what every host on the internet is asked for whether or not
 * anybody linked it. drawing a donation page for those would put a payment form behind every
 * scanner's dictionary.
 */
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * what both answers carry, each for its own reason stated where it is returned. the edge cache in
 * front of the served config is an entry per form behind an endpoint, not a document anybody is
 * holding a link to, and it is no precedent for keeping this one.
 */
const UNKEPT = { 'cache-control': 'no-store' };

/**
 * the answer for every address this route will not draw a form for, and there is only the one.
 *
 * a donor cannot act on which of the six refusals `readPublishedConfig` reached — a draft, a
 * retired form, an id that never existed, a deployment nobody finished — so the page states none of
 * them. the statuses those refusals carry belong to the endpoint an integrator reads
 * (./api.v1.forms.$id.config.ts) and stay there.
 *
 * `no-store` so that a form published after the refusal is not hidden behind a kept "no form here".
 */
function noForm() {
	return data({ ok: false } as const, { status: 404, headers: UNKEPT });
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
	if (!SEGMENT.test(params.formId)) return noForm();

	const db = context.get(database);
	// the deploy-time values arrive off the context rather than through anything a loader returns:
	// a return value is serialized into the document, so an env handed onward puts the Stripe secret
	// one `return { env }` from being published. `readPublishedConfig` narrows it.
	const { env } = context.get(platform);
	const processors = createPaymentProviders(env);
	const url = new URL(request.url);
	const origin = url.origin;

	// composed exactly as ./api.v1.forms.$id.config.ts composes it, so the page and the embed refuse
	// on the same ladder: an account approved for no rail draws the notice here for the same reason
	// the endpoint answers a refusal there.
	const result = renderableConfig(
		await readPublishedConfig(
			db,
			params.formId,
			env,
			() => cachedCadences(processors, origin),
			() => cachedRails(processors, origin),
			() => cachedCoins(processors, origin)
		)
	);
	if (!result.ok) return noForm();

	// a donor back from authorizing their gift arrives on this page's own address with the stamp
	// naming this form, and the card's first paint is then the wait for that gift rather than an
	// empty donation form. the stamp is the whole of what is read: the token beside it is the card's
	// to claim once its flow starts. a stamp naming another form is no return of this one's.
	const resuming = url.searchParams.get(RESUME_FORM_PARAM) === result.config.formId;

	// the served config alone. `result.form` is the row it was read from and carries
	// `allowed_origins` — the list of sites this organisation's forms may be used on, which a
	// document served to anyone is no place for.
	//
	// `no-store` because the amounts and settings are in this document: a kept copy would show a donor
	// figures the operator has since changed.
	return data({ ok: true, config: result.config, resuming } as const, { headers: UNKEPT });
}

/**
 * the loader runs again only for an address naming another form.
 *
 * the card builds its checkout from the config this loader returns and stops it when a new one
 * arrives (the checkout effect in $lib/donate/card.tsx), so a re-read on the same form — a
 * same-address navigation, a submission, a `revalidate()` — would swap the published config under a
 * gift in progress and end it. a form republished meanwhile reaches the donor on their next load.
 *
 * the resume stamp is a search parameter and so re-reads nothing either. the card scrubs it with
 * `history.replaceState`, out of react router's sight, so the router still holds the stamped address
 * and a later navigation on the same form leaves from it — a re-read there would answer
 * `resuming: false` under the takeover the flow is showing.
 */
export function shouldRevalidate({ currentParams, nextParams }: ShouldRevalidateFunctionArgs) {
	return currentParams.formId !== nextParams.formId;
}

/**
 * the loader's `cache-control`, carried out of it onto the document.
 *
 * a `data()`'s headers reach a *document* response only through this export: react router merges a
 * loader's headers into the document's own by asking each matched route for one, and a route with
 * no `headers` contributes cookies and nothing else (`getDocumentHeaders` in react-router).
 */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

/**
 * the document policy this page is drawn under: the operator base widened by exactly the origins
 * the card and its processors load. ../document-policy.ts lists them and cites each; every other
 * document is drawn under the base alone.
 */
export const handle: DonorPolicyHandle = { documentPolicy: 'donor' };

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	// the organisation is named only where there is a form to give to. a refused address names
	// nobody: an address that reached this deployment and was turned down says nothing back about
	// what would have been accepted.
	return [{ title: loaderData.ok ? `Donate to ${loaderData.config.orgLegalName}` : 'Donate' }];
}

/**
 * the form's four sheets and the page's own chrome, in that order.
 *
 * the four are in the order `sheetsFor` in packages/form/src/element.ts adopts them, which is
 * cascade order for the equal-specificity rules they are almost entirely made of. none of them is
 * hoisted with a `precedence`: this route's whole document is these five, so there is nothing for a
 * precedence to order them against.
 */
export function links(): Route.LinkDescriptors {
	return [formTokens, formParts, formLayout, formMotion, pageChrome].map((href) => ({
		rel: 'stylesheet' as const,
		href
	}));
}

export default function DonorPage({ loaderData }: Route.ComponentProps) {
	if (!loaderData.ok) {
		return (
			<main className="stage">
				<DonateNotice orgName={null} />
			</main>
		);
	}

	// the organisation named once, above the card. the card states the legal identity the gift is
	// solicited under; this states who the donor came here for.
	return (
		<main className="stage">
			<h1 className="org-name">{loaderData.config.orgLegalName}</h1>
			<DonateCard config={loaderData.config} resuming={loaderData.resuming} />
		</main>
	);
}
