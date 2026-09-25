import type { EntryContext } from 'react-router';
import { PAYPAL_DEFAULT_API_URL, paypalApiOrigin, paypalSdkUrl } from '$lib/server/payments/paypal';

// the content security policy and framing headers every document this deployment draws carries.
//
// every document and not only the dashboard's, because they share one origin: a script that runs on
// any page here can read `/admin` and submit its actions with a signed-in operator's cookie. the
// donor's page runs stripe's, paypal's, chariot's and turnstile's scripts, so it is the page an
// injected script is likeliest to arrive on.
//
// ./entry.server.tsx is the one caller, and it is the seam because react router calls it for
// documents and for nothing else: a resource route's `Response` (`/api/*`, the webhooks, the
// console's and zapier's endpoints) and a `.data` answer never reach it, so none of them carries a
// policy. the embed is further out still — `/embed.js` and `/embed/*` are static assets served
// before the worker runs, with their headers in ../static/_headers.
//
// scripts are `'self'` plus a nonce minted per document. the nonce is what lets react router's
// inline scripts run — the hydration context, the route module imports, scroll restoration — and
// react's own streaming scripts; `'self'` is what lets the client build's modules load. the donor
// page's vendor scripts carry no nonce — the card's bundled modules inject them, and inside a module
// `document.currentScript` is null, so packages/form/src/embed/nonce.ts reads none to hand on — and
// they load because their origins are listed in its policy.
//
// every document gets the dashboard's policy unless a route it matched says otherwise through its
// `handle`, so a screen added later is strict until someone widens it on purpose.
//
// every document allows inline style, the dashboard's as well as the donor page's. operator
// components set layout through style attributes the server renders — the column widths in
// packages/operator/src/components/data/DataTable.jsx, the bar heights in data/Series.jsx, the style
// a caller hands status/Mark.jsx — and `default-src 'self'` alone refuses every one of them. a style cannot run
// script, so allowing it opens nothing the nonce closes.
//
// the donor page sends its referrer as `strict-origin-when-cross-origin`, so the processors it
// loads see this deployment's origin exactly as they see an integrator's on a page that sets no
// policy; every other document keeps its referrer to its own origin.

/** what a route's `handle` carries to have its documents drawn under the donor page's policy. */
export interface DonorPolicyHandle {
	readonly documentPolicy: 'donor';
}

/** a fresh nonce: 128 bits, base64. */
export function mintNonce(): string {
	return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/** the directives both policies share, the ones that are never widened. */
const LOCKED = [
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'self'",
	"frame-ancestors 'none'"
];

/** every operator document: the dashboard, sign-in, and the error page under no surface. */
function operatorPolicy(nonce: string): string[] {
	return [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}'`,
		// the brand marks packages/operator/src/styles/base.css draws are under vite's 4 KiB
		// `build.assetsInlineLimit`, so the built sheet carries them as `data:` urls.
		"img-src 'self' data:",
		"style-src 'self' 'unsafe-inline'",
		...LOCKED
	];
}

/**
 * the donor page: the operator base plus what the card, turnstile and the processors' client
 * halves load. the list is README.md's "If your site sends a Content-Security-Policy", the block an
 * integrator pastes, with this deployment's own origin as `'self'`; that section argues each line
 * and names the vendor pages it follows. the sources per vendor:
 *
 * - stripe.js — https://docs.stripe.com/security/guide: `js.stripe.com` and `*.js.stripe.com` in
 *   script-src and frame-src, `api.stripe.com` in connect-src, and `hooks.stripe.com` in frame-src
 *   for 3-D Secure and every redirecting method. its `maps.googleapis.com` entries are the address
 *   element's, which the card never mounts.
 * - paypal's web sdk v6 — the core is on the origin `paypalSdkUrl` maps the deployment's
 *   `PAYPAL_API_URL` to, and eligibility is read from that address itself (`www.paypal.com` and
 *   `api-m.paypal.com` where it is unset); the overlay a blocked popup falls back to is a frame on
 *   the core's origin. its fraud collector is on `c.paypal.com`, venmo's frames on
 *   `history.paypal.com` and `account.venmo.com`, and the buttons' wordmarks are images on
 *   `www.paypalobjects.com`, whatever the address.
 * - turnstile — https://developers.cloudflare.com/turnstile/reference/content-security-policy/:
 *   `challenges.cloudflare.com` in script-src and frame-src.
 * - chariot connect — `CHARIOT_SCRIPT_URL` in packages/form/src/embed/chariot.ts is on
 *   `cdn.givechariot.com`, which also serves its fonts and images, and its window is a frame on
 *   `secure.dafpay.com` (packages/form/custom-elements.json, the element's description;
 *   https://docs.givechariot.com/guides/dafpay/integrating-dafpay/integration).
 * - nowpayments — each coin's logo is an image on `nowpayments.io` (`LOGO_ORIGIN` in
 *   $lib/server/payments/nowpayments.ts).
 *
 * `style-src 'unsafe-inline'` is the card's own inline style writes and chariot's `<style>` blocks
 * (README.md). `font-src 'self'` stays because this route's error page is dressed from the operator
 * sheets and their fonts.
 */
function donorPolicy(nonce: string, paypal: PaypalOrigins): string[] {
	return [
		"default-src 'self'",
		[
			'script-src',
			"'self'",
			`'nonce-${nonce}'`,
			'https://js.stripe.com',
			'https://*.js.stripe.com',
			...paypal.sdk,
			'https://c.paypal.com',
			'https://cdn.givechariot.com',
			'https://challenges.cloudflare.com'
		].join(' '),
		[
			'connect-src',
			"'self'",
			'https://api.stripe.com',
			...paypal.sdk,
			...paypal.api,
			'https://c.paypal.com'
		].join(' '),
		[
			'frame-src',
			'https://js.stripe.com',
			'https://*.js.stripe.com',
			'https://hooks.stripe.com',
			...paypal.sdk,
			'https://history.paypal.com',
			'https://account.venmo.com',
			'https://secure.dafpay.com',
			'https://challenges.cloudflare.com'
		].join(' '),
		[
			'img-src',
			"'self'",
			'data:',
			'https://www.paypalobjects.com',
			'https://cdn.givechariot.com',
			'https://nowpayments.io'
		].join(' '),
		"font-src 'self' https://cdn.givechariot.com",
		"style-src 'self' 'unsafe-inline'",
		...LOCKED
	];
}

/** the donor policy's two paypal sources, each empty where the address yields no origin for it. */
interface PaypalOrigins {
	readonly api: readonly string[];
	readonly sdk: readonly string[];
}

/**
 * the origins a deployment's `PAYPAL_API_URL` names, by the same two functions the served config's
 * `sdkUrl` is built with.
 *
 * an address `paypalApiOrigin` refuses names neither: $lib/server/payments/factory.ts holds paypal
 * unusable on such a deployment, so the card offers it nowhere and the page has nothing to reach.
 */
function paypalOrigins(apiUrl: string = PAYPAL_DEFAULT_API_URL): PaypalOrigins {
	const api = paypalApiOrigin(apiUrl);
	const sdk = paypalSdkUrl(apiUrl);
	return {
		api: api === null ? [] : [api],
		sdk: sdk === null ? [] : [new URL(sdk).origin]
	};
}

function isDonorPolicyHandle(handle: unknown): handle is DonorPolicyHandle {
	return (
		typeof handle === 'object' &&
		handle !== null &&
		(handle as Partial<DonorPolicyHandle>).documentPolicy === 'donor'
	);
}

/**
 * sets a document's headers, under the policy the routes it matched choose. `paypalApiUrl` is the
 * deployment's `PAYPAL_API_URL`, read by the donor policy alone.
 */
export function setDocumentHeaders(
	headers: Headers,
	context: EntryContext,
	nonce: string,
	paypalApiUrl: string | undefined
): void {
	const donor = context.staticHandlerContext.matches.some((match) =>
		isDonorPolicyHandle(match.route.handle)
	);
	headers.set(
		'Content-Security-Policy',
		(donor ? donorPolicy(nonce, paypalOrigins(paypalApiUrl)) : operatorPolicy(nonce)).join('; ')
	);
	headers.set('X-Frame-Options', 'DENY');
	headers.set('Referrer-Policy', donor ? 'strict-origin-when-cross-origin' : 'same-origin');
}
