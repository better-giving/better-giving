import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { API_BASE_PATH } from '$lib/server/api/surface';
import {
	QUICKBOOKS_CALLBACK_PATH,
	QUICKBOOKS_CONNECT_PATH
} from '$lib/server/accounting/connect-link';
import { AGENT_PROMPT_PATH, OPENAPI_PATH } from '$lib/server/integrations/openapi';
import { CONNECTOR_BASE_PATH } from '$lib/server/connector/surface';
import { INTEGRATIONS_BASE_PATH } from '$lib/server/integrations/surface';
import { ZAPIER_BASE_PATH } from '$lib/server/zapier/surface';
import { CHARIOT_WEBHOOK_PATH } from '@better-giving/operator/chariot/webhook-subscription';
import { NOWPAYMENTS_IPN_PATH } from '@better-giving/operator/nowpayments/ipn-callback';
import { PAYPAL_WEBHOOK_PATH } from '@better-giving/operator/paypal/webhook-listener';
import { STRIPE_WEBHOOK_PATH } from '@better-giving/operator/stripe/webhook-endpoint';
import {
	matchedFileAt,
	reachesServerTree,
	readFromDisk,
	routeManifest,
	statusAt,
	under,
	type ReadModule,
	type RouteRecord
} from './routes.testing';

// the guard on "every route in this app is behind the login, or somebody said out loud why not".
//
// why this file exists. the gate is a `middleware` on one layout (src/lib/server/auth/gate.ts),
// and what puts a route behind it is where the route sits in the tree — so a route file created
// anywhere else is served to anonymous callers with nothing anywhere reporting it. there is no
// error to notice and no list for a reviewer to read: the only signal a route is unauthenticated
// is the name it was given, which is exactly the kind of fact that gets decided by whichever file
// was already open.
//
// how it works: the app's own route config, run. ./routes.testing.ts imports ./routes.ts and
// resolves it, so what is swept is what react router will serve rather than a spec's idea of which
// files are addresses. a runtime probe would only cover the paths a test happens to request, and
// the route that matters is the one nobody wrote a test for.
//
// every route is in one of two categories, and a name that no longer matches a file fails too,
// so a list cannot rot into permission for a route that was moved or deleted.
//
// the two: a route is under the protected layout, or is the preview that mounts the same gate
// itself, in which case the gate redirects an anonymous caller to the login; or it is on
// PUBLIC_ROUTE_FILES below, which is a decision somebody typed next to the reason.
//
// and it holds one more mounting on the same principle, one category over. being public is a line
// somebody typed on the list below; being *metered* is not a decision and must not become one, so
// every route served under `/api/v1` is held to sitting under the layout that charges that
// surface's rate limit, and none of them may charge it again. the two rules are one rule about two
// surfaces: what a request owes is decided where the surface is, never per endpoint.
//
// `/zapier` is a surface checked by a credential rather than a session: Zapier's servers present
// the deployment's Zapier key ($lib/server/zapier/key.ts), checked by the layout's middleware, so
// every route served there is held to sitting under that layout and is in neither category above.
// `/integrations/v1` is the same shape again: an organisation's own systems present an API key
// ($lib/server/integrations/surface.ts), checked by that surface's layout.

/** the layout the gate is mounted on, and being under it is what makes a route gated. */
const PROTECTED_LAYOUT = 'routes/_app.tsx';

/**
 * the prefix better-auth's own router was mounted at, which this deployment no longer serves.
 *
 * it is a string in this file and nowhere else in the app, and that is the point: nothing here
 * mounts it, so there is no constant to import and no fourth category on the list above for it.
 * the cases at the foot of this file are what hold that — a surface that disappeared by nobody
 * writing a route file is a surface nobody reviews, so it is asserted rather than assumed.
 */
const RETIRED_AUTH_PREFIX = '/api/auth';

/**
 * the layout the public api's rate limit is mounted on, and being under it is what makes a route
 * on that surface metered.
 *
 * the same shape as the gate above and for the same reason, one category over: `/api/v1` is
 * public, unauthenticated and payment-initiating, and a limiter each endpoint called would be
 * allow-by-default — the endpoint written without the call is unmetered, reads like every other
 * endpoint, and nothing at runtime reports it. $lib/server/api/meter.ts argues it; the sweeps at
 * the foot of this file are what hold it.
 */
const API_LAYOUT = 'routes/api.v1.ts';

/** the document every screen renders into. no `middleware` may go on it — see its own header. */
const ROOT_ROUTE = 'root.tsx';

/**
 * the payment processors' callbacks, with the address each answers on — the routes in this app that
 * owe their position.
 *
 * every other route's placement decides what it inherits; theirs decides what they do not. the
 * delivery is verified against the raw body exactly as sent, and the body is read exactly once by
 * the handler that owns it (CLAUDE.md) — so a `middleware` anywhere above any of them that touched
 * the request would break verification in production and nowhere else. they are named here so the
 * case at the foot of `where middleware is mounted` can hold that none has a layout above it.
 *
 * the address is here beside the file rather than left to the name, because it is what an operator
 * pastes into a processor's dashboard: Stripe's is registered by this app and PayPal's is typed in
 * by hand. NOWPayments' is named on each payment this app creates.
 *
 * each address is the constant the rest of the tree builds from rather than a second spelling of
 * it, which is what makes this the pin: a route file renamed changes the path react router resolves
 * and nothing else, so a literal here would agree with the rename and leave every caller of those
 * constants pointing at a 404.
 */
const PROCESSOR_CALLBACKS: Readonly<Record<string, string>> = {
	'routes/api.stripe.webhook.ts': STRIPE_WEBHOOK_PATH,
	'routes/api.paypal.webhook.ts': PAYPAL_WEBHOOK_PATH,
	'routes/api.chariot.webhook.ts': CHARIOT_WEBHOOK_PATH,
	'routes/api.nowpayments.webhook.ts': NOWPAYMENTS_IPN_PATH
};

/** the donation page, at `/donate`. */
const DONOR_PAGE = 'routes/donate.tsx';

/** a campaign, at its own top-level address. */
const CAMPAIGN_PAGE = 'routes/$slug.tsx';

/**
 * the donor's pages, which with the preview below are the screens outside the layout that wear no
 * operator stylesheet.
 *
 * each draws the donation form's own card and links the form's four sheets in its own `links`, and
 * those four are unlayered while every operator declaration is layered (src/app.css) — so a
 * document holding both would let one side outrank the other on properties only one of them sets.
 * they are named here so the sweep below can hold every *other* screen outside the layout to
 * carrying the operator sheet without holding these to it.
 */
const DONOR_PAGES: readonly string[] = [DONOR_PAGE, CAMPAIGN_PAGE];

/**
 * the editor's preview of a page, the one route outside the protected layout that is behind the
 * login: it mounts the layout's own gate itself, because the layout's frame would be drawn around a
 * page that has to look as a donor sees it. the file's own header argues it; the cases below hold
 * it to mounting the gate, and to the donor page's sheets rather than the operator's.
 */
const PREVIEW_PAGE = 'routes/preview.$pageId.tsx';

/**
 * every route file that is deliberately served to anonymous callers.
 *
 * adding a line here is the decision, and it is the whole point of the file: a route outside the
 * protected layout is public whether or not anyone meant it to be, so the list makes that a thing
 * somebody types on purpose next to the reason.
 *
 * still being added to while the react tree is written.
 */
const PUBLIC_ROUTE_FILES: readonly string[] = [
	// the sign-in screen: the one page that cannot sit behind the login, and the first of the four
	// screens on this list whose action writes for a caller with no session. what it owes instead
	// of a session is the sign-in limiter, charged inside that action before the body is read. it
	// shares that bucket with the two other forms that spend it — ./routes/forgot.tsx below and
	// `/admin/members/password` behind the gate — because the key is the credential's rather than
	// any path's, and the better-auth endpoint that would spend it is a 404 here (CLAUDE.md).
	'routes/login.tsx',
	// the page an invited colleague opens to set a password, which is the second screen on this
	// list and the second write served to a caller with no session. they hold none by definition —
	// the point of the page is that they do not have a way in yet — and what stands in for one is
	// the single-use token from the invitation mail, checked before anything is written
	// ($lib/server/auth/invitations.ts). the token is on the address rather than in a box, so the
	// address bar is the whole of the credential and the page renders nothing without it.
	'routes/join.tsx',
	// where a member who cannot sign in asks for a link, which is the third screen on this list and
	// the third write served to a caller with no session — they hold none by definition, because
	// not being able to get one is the reason they are here. what it owes instead is the sign-in
	// limiter, charged in its own action before the body is read: a request here mails whoever is
	// named, so the bucket is what stops this form being a way to post somebody else's inbox from
	// this deployment's own address.
	'routes/forgot.tsx',
	// the page that link opens, which is the fourth. what stands in for a session is the single-use
	// token from the mail, checked before anything is written ($lib/server/auth/members.ts). it
	// charges nothing, exactly as routes/join.tsx charges nothing: the sign-in bucket bounds
	// guessing at a credential, and a random token from a mailbox is not one anybody guesses at.
	'routes/reset.tsx',
	// the public api's own layout. it is here because it is a route in its own right — a layout
	// with a path is a branch in the tree — and it answers `/api/v1` itself with a 404 naming the
	// surface. what everything beneath it owes instead of a session starts here: the rate limit is
	// mounted on this file, for the whole surface at once.
	'routes/api.v1.ts',
	// the config the embedded donation form boots on, read from a page on somebody else's website.
	// it is unauthenticated because the caller is a donor's browser on a site this deployment has
	// never seen. CORS from the form's own `allowed_origins`; the limit from the layout above it;
	// no Turnstile and no amount bounds, because it takes no submission and initiates no payment.
	'routes/api.v1.forms.$id.config.ts',
	// the ALTCHA challenge that same form solves before it submits, where ALTCHA is the spam check.
	// unauthenticated for the same reason; CORS from the form's own `allowed_origins` and the limit
	// from the layout above it. a challenge initiates nothing: it is the work the submission below
	// must show, and the submission is where it is checked.
	'routes/api.v1.forms.$id.challenge.ts',
	// the endpoint that takes the gift, submitted by a donor's browser on that same page. it is
	// unauthenticated for the same reason and owes all four: CORS from the form's own
	// `allowed_origins`, the limit from the layout above it plus a tighter bucket of its own, a
	// spam check (Turnstile or ALTCHA) passed before any intent is minted, and the amount re-read
	// from the form record rather than taken from the body.
	'routes/api.v1.forms.$id.donations.ts',
	// the standing of one crypto gift, polled by the donation form's waiting screen on that same
	// page. CORS from the form's own `allowed_origins` and the limit from the layout above it; no
	// Turnstile, by the user-approved exception its header states — a token per poll cannot exist,
	// the id is a uuid the Turnstile-gated endpoint above minted, and the read initiates nothing and
	// answers a state with no amount or donor detail.
	'routes/api.v1.forms.$id.donations.$donationId.ts',
	// the payment processors' callbacks, delivered by machines belonging to somebody else. they are
	// unauthenticated because there is no session a processor could hold and no page any of them is
	// answering: no origin to echo, no visitor to challenge, no form id in the path. what stands
	// in for all of it is the delivery being verified against the raw body, checked before anything
	// is parsed — which is also why none is under a layout at all, held below.
	...Object.keys(PROCESSOR_CALLBACKS),
	// where connecting a QuickBooks company begins, opened by the deployer's own browser from an
	// address the Connect press on Books minted. what stops an outsider connecting their own books
	// and taking this organisation's gifts into them is the session on the press that mints the
	// address; the signature is how that check reaches this route
	// ($lib/server/accounting/connect-link.ts). nothing downstream adds a second one — whoever opens
	// the address is whoever signs in at Intuit.
	'routes/quickbooks.connect.tsx',
	// where Intuit sends that browser back. it is unauthenticated for the same reason, and what
	// stands in for a session is the `state` that went out with it, in a cookie on that same browser
	// and cleared on every arm — so the round trip cannot be made twice.
	'routes/quickbooks.callback.tsx',
	// the donation page, opened from a link the organisation published. it is unauthenticated
	// because a donor holds no session and never could — there is nobody for a gate here to ask
	// about. it initiates no payment itself and takes no submission: the gift goes through the
	// endpoint above it, same-origin, which owes all four of that surface's checks. the one write
	// its loader makes is the page itself, once per deployment — the one-Donation-page index turns
	// every later arrival into a read. and what it hands the browser is the served config alone,
	// never the `form` row it was read from — that row carries `allowed_origins`.
	DONOR_PAGE,
	// a campaign's page, opened from a link the organisation published, and public for the same
	// reasons: no session, no submission, the gift through the endpoint above, the served config
	// alone. its loader writes nothing, and an address no campaign could hold is refused before the
	// database is read, so a scanner walking top-level paths costs this deployment no query.
	CAMPAIGN_PAGE,
	// a page's photos, fetched by the `<img>` of a donor who holds no session. it reads bytes by id
	// and writes nothing, and a draft's image is as reachable by its id as a live one's: the id is a
	// uuidv7 minted by `createImage` ($lib/server/images/queries.ts), whose random bits nobody outside
	// this deployment can enumerate, so knowing the address is the permission.
	'routes/image.$id.ts',
	// the read API's OpenAPI document and the agent prompt beside it: documentation a developer or
	// an agent reads before they hold a key, so neither is under ./routes/integrations.v1.ts's key
	// check. each is built from constants and the request's own origin and reads nothing from the
	// database, which is what makes it safe to serve to anyone and to cache publicly
	// ($lib/server/integrations/openapi.ts).
	'routes/integrations.openapi[.]json.ts',
	'routes/integrations.agent-prompt[.]md.ts',
	// the page a chat's photo link opens, on the operator's phone with no dashboard session: the
	// link's 256-bit token is the permission, good once, for half an hour, for one photo on one page,
	// and only while the connection that asked for it stands ($lib/server/connector/photos.ts). its
	// write lands in the page's draft alone, through the dashboard's own guarded writer.
	'routes/photo.$token.tsx'
];

/**
 * the layout the Zapier key check and that surface's rate limit are mounted on — one more
 * mounting of the same shape. src/routes/zapier.ts argues it.
 */
const ZAPIER_LAYOUT = 'routes/zapier.ts';

/**
 * the layout the read API's key check is mounted on — the same mounting again.
 * src/routes/integrations.v1.ts argues it.
 */
const INTEGRATIONS_LAYOUT = 'routes/integrations.v1.ts';

/**
 * the layout the connector key check is mounted on — the same mounting again, for Better Giving's
 * central connector. src/routes/connector.v1.ts argues it.
 */
const CONNECTOR_LAYOUT = 'routes/connector.v1.ts';

let routes: RouteRecord[];
beforeAll(async () => {
	routes = await routeManifest();
});

/** whether a route is served on the surface Zapier's servers call. */
function zapierRoute(route: RouteRecord): boolean {
	return route.path === ZAPIER_BASE_PATH || route.path.startsWith(`${ZAPIER_BASE_PATH}/`);
}

/** whether a route is served on the read API an organisation's own systems call. */
function integrationsRoute(route: RouteRecord): boolean {
	return (
		route.path === INTEGRATIONS_BASE_PATH || route.path.startsWith(`${INTEGRATIONS_BASE_PATH}/`)
	);
}

/** whether a route is served on the surface Better Giving's connector calls. */
function connectorRoute(route: RouteRecord): boolean {
	return route.path === CONNECTOR_BASE_PATH || route.path.startsWith(`${CONNECTOR_BASE_PATH}/`);
}

/** every route on the connector surface that is not under the layout checking the key. */
function uncheckedConnectorRoutes(manifest: readonly RouteRecord[]): string[] {
	return manifest
		.filter((route) => connectorRoute(route) && !under(route, CONNECTOR_LAYOUT))
		.map(
			(route) =>
				`${route.file} is served at ${route.path} and is not under ${CONNECTOR_LAYOUT}, so nothing checks the connector key for it. Name it so it nests under that layout.`
		);
}

/** whether a route is served on the public api. */
function apiRoute(route: RouteRecord): boolean {
	return route.path === API_BASE_PATH || route.path.startsWith(`${API_BASE_PATH}/`);
}

/**
 * every route on the public api that is not under the layout carrying its rate limit, as the
 * message somebody reads when they added one.
 *
 * being public is a decision typed onto the list above; being *metered* is not a decision at all
 * and must not become one. a route file whose name opts out of the layout — react router's flat
 * convention spells that with a trailing underscore on a segment — is served at the same address
 * with no charge against it, and the only difference a reader would see is one character in a
 * file name.
 */
function unmeteredApiRoutes(manifest: readonly RouteRecord[]): string[] {
	return manifest
		.filter((route) => apiRoute(route) && !under(route, API_LAYOUT))
		.map(
			(route) =>
				`${route.file} is served at ${route.path} and is not under ${API_LAYOUT}, so nothing charges the /api/v1 rate limit for it. Name it so it nests under that layout — see $lib/server/api/meter.ts.`
		);
}

/**
 * every route that is in neither category, as the message somebody reads when they added one.
 *
 * a function over a manifest rather than a loop over the real tree, so the rule can be shown to
 * fail: the tree this app has today is small enough that a sweep over it alone would pass whether
 * or not the rule works.
 */
function ungatedRoutes(manifest: readonly RouteRecord[], allowed: readonly string[]): string[] {
	return manifest
		.filter(
			(route) =>
				!under(route, PROTECTED_LAYOUT) &&
				route.file !== PREVIEW_PAGE &&
				!allowed.includes(route.file) &&
				!zapierRoute(route) &&
				!integrationsRoute(route) &&
				!connectorRoute(route)
		)
		.map(
			(route) =>
				`${route.file} is served at ${route.path} and is not under ${PROTECTED_LAYOUT}, so it is served to anyone. Move it under the protected layout, or add it to PUBLIC_ROUTE_FILES with the reason it is public.`
		);
}

/**
 * every screen served outside the protected layout that carries no `links` of its own, as the
 * message somebody reads when they added one.
 *
 * the operator stylesheet is delivered per surface rather than by the document: ./root.tsx imports
 * no sheet at all, because the donor's page renders into that same document and the form's four
 * sheets are unlayered while every operator declaration is layered (src/app.css). so a screen under
 * ./routes/_app.tsx inherits the sheet from the layout, and a screen outside it has to say so — a
 * forgotten one renders undressed, visibly, on one screen and on no other.
 *
 * the layout itself is held to it as well: `under` counts a layout as under itself, and being the
 * one file that dresses every screen beneath it is exactly what makes it the file that must.
 */
function undressedRoutes(manifest: readonly RouteRecord[], read: ReadModule): string[] {
	return manifest
		.filter(
			(route) => !route.ancestors.includes(PROTECTED_LAYOUT) && !DONOR_PAGES.includes(route.file)
		)
		.filter((route) => {
			const source = read(route.file) ?? '';
			return drawsAScreen(source) && !exportsLinks(source);
		})
		.map(
			(route) =>
				`${route.file} draws a screen at ${route.path} and no layout above it links a stylesheet, so it renders undressed. Add \`export const links = operatorLinks;\` from $lib/admin/operator-links.ts.`
		);
}

/** every name on a list with no route behind it. a stale entry is permission left lying around. */
function absentFromTree(named: readonly string[], manifest: readonly RouteRecord[]): string[] {
	const present = new Set(manifest.map((route) => route.file));
	return named.filter((file) => !present.has(file));
}

/** every route on the Zapier surface that is not under the layout checking the key. */
function uncheckedZapierRoutes(manifest: readonly RouteRecord[]): string[] {
	return manifest
		.filter((route) => zapierRoute(route) && !under(route, ZAPIER_LAYOUT))
		.map(
			(route) =>
				`${route.file} is served at ${route.path} and is not under ${ZAPIER_LAYOUT}, so nothing checks the Zapier key for it. Name it so it nests under that layout.`
		);
}

/** every route on the read API that is not under the layout checking the key. */
function uncheckedIntegrationsRoutes(manifest: readonly RouteRecord[]): string[] {
	return manifest
		.filter((route) => integrationsRoute(route) && !under(route, INTEGRATIONS_LAYOUT))
		.map(
			(route) =>
				`${route.file} is served at ${route.path} and is not under ${INTEGRATIONS_LAYOUT}, so nothing checks the API key for it. Name it so it nests under that layout.`
		);
}

/** a manifest a case composes, for showing that a rule above can fail. */
function route(file: string, path: string, ancestors: string[] = []): RouteRecord {
	return { file, path, ancestors };
}

describe('the rules the sweep runs on', () => {
	it('reports a route under neither the layout nor either list', () => {
		const manifest = [route('routes/exports.tsx', '/exports')];
		expect(ungatedRoutes(manifest, [])).toEqual([
			expect.stringContaining('routes/exports.tsx is served at /exports')
		]);
	});

	it('passes a route under the protected layout', () => {
		const manifest = [route('routes/_app.donors.tsx', '/donors', [PROTECTED_LAYOUT])];
		expect(ungatedRoutes(manifest, [])).toEqual([]);
	});

	it('passes a route somebody typed onto the allow-list', () => {
		const manifest = [route('routes/login.tsx', '/login')];
		expect(ungatedRoutes(manifest, ['routes/login.tsx'])).toEqual([]);
	});

	it('reports a name on a list with no route behind it', () => {
		const manifest = [route('routes/login.tsx', '/login')];
		expect(absentFromTree(['routes/gone.tsx'], manifest)).toEqual(['routes/gone.tsx']);
		expect(absentFromTree(['routes/login.tsx'], manifest)).toEqual([]);
	});

	it('reports a route on the public api that sits outside the metered layout', () => {
		// the flat-route spelling that does it: a trailing underscore on a segment opts a file out
		// of its parent layout while leaving the URL alone.
		const manifest = [
			route('routes/api.v1_.forms.$id.donations.ts', '/api/v1/forms/:id/donations')
		];
		expect(unmeteredApiRoutes(manifest)).toEqual([
			expect.stringContaining('routes/api.v1_.forms.$id.donations.ts is served at')
		]);
	});

	it('passes a route on the public api that is under it, and the layout itself', () => {
		const manifest = [
			route(API_LAYOUT, '/api/v1'),
			route('routes/api.v1.forms.$id.donations.ts', '/api/v1/forms/:id/donations', [API_LAYOUT])
		];
		expect(unmeteredApiRoutes(manifest)).toEqual([]);
	});

	it('reports a Zapier route that sits outside the checked layout', () => {
		const manifest = [route('routes/zapier_.me.ts', '/zapier/me')];
		expect(uncheckedZapierRoutes(manifest)).toHaveLength(1);
		expect(ungatedRoutes(manifest, [])).toEqual([]);
	});

	it('passes a Zapier route that is under it, and the layout itself', () => {
		const manifest = [
			route(ZAPIER_LAYOUT, '/zapier'),
			route('routes/zapier.me.ts', '/zapier/me', [ZAPIER_LAYOUT])
		];
		expect(uncheckedZapierRoutes(manifest)).toEqual([]);
	});

	it('reports a read API route that sits outside the checked layout', () => {
		const manifest = [route('routes/integrations.v1_.gifts.ts', '/integrations/v1/gifts')];
		expect(uncheckedIntegrationsRoutes(manifest)).toHaveLength(1);
		expect(ungatedRoutes(manifest, [])).toEqual([]);
	});

	it('passes a read API route that is under it, and the layout itself', () => {
		const manifest = [
			route(INTEGRATIONS_LAYOUT, '/integrations/v1'),
			route('routes/integrations.v1.gifts.ts', '/integrations/v1/gifts', [INTEGRATIONS_LAYOUT])
		];
		expect(uncheckedIntegrationsRoutes(manifest)).toEqual([]);
	});
});

describe('the route surface', () => {
	// the sweep finding nothing would make every assertion below vacuous, and a renamed routes
	// directory is exactly how that happens.
	it('finds a route tree, with the protected layout in it', () => {
		expect(routes.length).toBeGreaterThan(0);
		expect(routes.map((r) => r.file)).toContain(PROTECTED_LAYOUT);
	});

	it('serves nothing to anonymous callers but the files named here', () => {
		expect(ungatedRoutes(routes, PUBLIC_ROUTE_FILES)).toEqual([]);
	});

	// the sweep finding nothing would make the case below vacuous, the same way an empty route tree
	// would make the whole file vacuous — and a renamed api layout is exactly how that happens.
	/**
	 * the read API's two documents are linked from the dashboard and named inside each other by
	 * these constants, so a route file renamed without them leaves every link a 404.
	 */
	it('serves the read API’s documents at the addresses they are linked by', () => {
		const servedAt = (file: string) => routes.find((route) => route.file === file)?.path;

		expect(servedAt('routes/integrations.openapi[.]json.ts')).toBe(OPENAPI_PATH);
		expect(servedAt('routes/integrations.agent-prompt[.]md.ts')).toBe(AGENT_PROMPT_PATH);
	});

	it('has a public api, with its metered layout in it', () => {
		expect(routes.filter(apiRoute).length).toBeGreaterThan(0);
		expect(routes.map((r) => r.file)).toContain(API_LAYOUT);
	});

	it('meters every route it serves on the public api', () => {
		expect(unmeteredApiRoutes(routes)).toEqual([]);
	});

	it('names no route that is not there', () => {
		expect(absentFromTree(PUBLIC_ROUTE_FILES, routes)).toEqual([]);
	});

	it('checks the key for every route it serves on the Zapier surface', () => {
		expect(routes.map((r) => r.file)).toContain(ZAPIER_LAYOUT);
		expect(uncheckedZapierRoutes(routes)).toEqual([]);
	});

	it('checks the key for every route it serves on the read API', () => {
		expect(routes.map((r) => r.file)).toContain(INTEGRATIONS_LAYOUT);
		expect(uncheckedIntegrationsRoutes(routes)).toEqual([]);
	});

	it('checks the key for every route it serves on the connector surface', () => {
		expect(routes.map((r) => r.file)).toContain(CONNECTOR_LAYOUT);
		expect(uncheckedConnectorRoutes(routes)).toEqual([]);
	});

	// the home page is behind the login though all it does is forward to the first screen. stated
	// as its own case rather than left to the sweep, because its position is the one that looks
	// accidental: a home page outside the gate reads like where a home page goes.
	it('keeps the entrance behind the gate', () => {
		const entrance = routes.find((r) => r.file === 'routes/_app._index.tsx');
		expect(entrance?.path).toBe('/');
		expect(entrance ? under(entrance, PROTECTED_LAYOUT) : false).toBe(true);
	});

	// and `/admin` is behind it too, for the same reason and with the same content: nothing to
	// render and one forward to where the sections start.
	it('keeps the staff home behind the gate', () => {
		const home = routes.find((r) => r.file === 'routes/_app.admin._index.tsx');
		expect(home?.path).toBe('/admin');
		expect(home ? under(home, PROTECTED_LAYOUT) : false).toBe(true);
	});

	/**
	 * the accountant's file is served beside the screen that asks for it.
	 *
	 * the link to it is a plain anchor rather than the router's, so an address left under
	 * /admin/books would be a pointer at a screen that exports nothing —
	 * ./routes/_app.admin.donations.export.tsx is the one that asks for a range.
	 */
	it('serves the accountant\u2019s file beside the screen that asks for it', async () => {
		expect(await matchedFileAt('/admin/donations/export/journal')).toBe(
			'routes/_app.admin.donations.export_.journal.ts'
		);
		expect(await statusAt('/admin/books/journal')).toBe(404);
	});

	/**
	 * an address nothing claims matches no route, so it matches nothing under the protected layout
	 * either and the gate never runs for it — which is what puts the error page in front of a
	 * caller with no session and keeps a deployment whose database is not answering able to say
	 * so. ./root.tsx's `ErrorBoundary` is what renders it; the 404 here is the half a component
	 * cannot claim for itself.
	 *
	 * a single top-level segment is not one of those addresses: every one reaches a campaign's route,
	 * whose loader refuses what no campaign holds (./routes/$slug.db.spec.ts).
	 */
	it('answers an address matching no route with a 404, above every layout', async () => {
		expect(await statusAt('/admin/not-a-screen')).toBe(404);
		expect(await statusAt('/a/b')).toBe(404);
		expect(await statusAt('/winter-coat-drive/extra')).toBe(404);
		expect(routes.filter((r) => r.path === '/admin/not-a-screen' || r.path === '/a/b')).toEqual([]);
	});

	/** the page editor asks no model, so nothing answers a page's chat or its suggestions. */
	it.each(['chat', 'suggest'])('serves nothing at a page’s /%s', async (leaf) => {
		const address = `/admin/pages/0198c1d2-0000-7000-8000-000000000001/${leaf}`;
		expect(await matchedFileAt(address)).toBeNull();
		expect(await statusAt(address)).toBe(404);
	});

	it.each(['/winter-coat-drive', '/frm_something', '/.env'])(
		'hands the single segment %s to the campaign route',
		async (address) => {
			expect(await matchedFileAt(address)).toBe(CAMPAIGN_PAGE);
		}
	);

	/**
	 * every static top-level route this app serves still answers its own address.
	 *
	 * a dynamic top-level segment would match all of them, and what keeps them theirs is react
	 * router's own ranking rather than anything either file says — so it is asked of the matcher. a
	 * list of reserved words in a loader would be a second copy of this tree, wrong the moment a
	 * route is added.
	 *
	 * `/embed.js` is not here because it is not a route at all — static/ is copied whole into the
	 * client build and the worker serves it as an asset before routing (CLAUDE.md, ../vite.config.ts).
	 */
	it.each([
		{ address: '/login', file: 'routes/login.tsx' },
		{ address: '/join', file: 'routes/join.tsx' },
		{ address: '/forgot', file: 'routes/forgot.tsx' },
		{ address: '/reset', file: 'routes/reset.tsx' },
		{ address: '/admin', file: 'routes/_app.admin._index.tsx' },
		{ address: '/donate', file: DONOR_PAGE },
		{ address: '/preview/0198c1d2-0000-7000-8000-000000000001', file: PREVIEW_PAGE },
		{ address: API_BASE_PATH, file: API_LAYOUT }
	])('keeps $address on $file', async ({ address, file }) => {
		expect(await matchedFileAt(address)).toBe(file);
	});

	/**
	 * the two addresses of the QuickBooks connection, pinned to the constants the rest of the tree
	 * builds them from rather than to the file names.
	 *
	 * the same pin `PROCESSOR_CALLBACKS` above is, and for a failure of the same shape: the address
	 * the Connect press sends the deployer to and the `redirect_uri` sent to Intuit are both built
	 * from those constants, and the one registered in Intuit's developer dashboard is typed from them
	 * too. a route file renamed changes the path react router resolves and nothing else, so the
	 * constants would go on naming an address that is now a 404 — and what reports it is Intuit
	 * refusing the round trip on a deployment, with nothing here having gone red.
	 */
	it.each([
		{ address: QUICKBOOKS_CONNECT_PATH, file: 'routes/quickbooks.connect.tsx' },
		{ address: QUICKBOOKS_CALLBACK_PATH, file: 'routes/quickbooks.callback.tsx' }
	])('answers $address with $file', async ({ address, file }) => {
		expect(await matchedFileAt(address)).toBe(file);
	});
});

/**
 * the four spellings of a `middleware` export, because the sweep is worth only what it catches.
 * `export { staffGate as middleware }` is the one that reads as harmless.
 */
function exportsMiddleware(source: string): boolean {
	return [
		/\bexport\s+(?:const|let|var)\s+(?:client)?[Mm]iddleware\b/,
		/\bexport\s+(?:async\s+)?function\s+(?:client)?[Mm]iddleware\b/,
		/\bexport\s*\{[^}]*\bas\s+(?:client)?[Mm]iddleware\b/,
		/\bexport\s*\{[^}]*\b(?:client)?[Mm]iddleware\b[^}]*\}/
	].some((pattern) => pattern.test(source));
}

describe('reaching for middleware', () => {
	it.each([
		{ how: 'a const', source: 'export const middleware = [staffGate];' },
		{ how: 'a function', source: 'export async function middleware(args, next) {}' },
		{ how: 'a rename', source: 'export { staffGate as middleware };' },
		{ how: 'a plain re-export', source: 'export { middleware };' },
		{ how: 'the client half', source: 'export const clientMiddleware = [timing];' }
	])('is $how', ({ source }) => {
		expect(exportsMiddleware(source)).toBe(true);
	});

	it.each([
		{ what: 'a local of that name', source: 'const middleware = [staffGate];' },
		{ what: 'an import of one', source: "import { staffGate } from '$lib/server/auth/gate';" },
		{ what: 'a word that merely contains it', source: 'export const middlewares = [];' }
	])('is not $what', ({ source }) => {
		expect(exportsMiddleware(source)).toBe(false);
	});
});

describe('where middleware is mounted', () => {
	// the surface layouts, each covering one surface: the session gate over every screen behind the
	// login, the meter over every route on the public api, and a key check over every route Zapier
	// calls, another over every route of the read API and another over every route the connector
	// calls. any other name here is a route that took a decision one of those makes for a whole
	// surface, which is the shape they all exist to remove — but for the preview and the two donor
	// pages, which sit under no layout that could carry what they owe, and are held to it by the
	// cases below.
	it('is the surface layouts, and no other route', () => {
		const mounted = routes
			.filter((r) => exportsMiddleware(readFromDisk(r.file) ?? ''))
			.map((r) => r.file)
			.sort();
		expect(mounted).toEqual(
			[
				API_LAYOUT,
				INTEGRATIONS_LAYOUT,
				CONNECTOR_LAYOUT,
				PROTECTED_LAYOUT,
				ZAPIER_LAYOUT,
				PREVIEW_PAGE,
				DONOR_PAGE,
				CAMPAIGN_PAGE
			].sort()
		);
	});

	// a donor page reads what `/api/v1` bounds and more, so it is metered as that surface is, on a
	// bucket of its own ($lib/server/api/meter.ts, `meterDonorPage`). the meter alone, and on both.
	it.each([DONOR_PAGE, CAMPAIGN_PAGE])('is the donor page meter alone on %s', (file) => {
		expect(readFromDisk(file) ?? '').toMatch(
			/export const middleware: Route\.MiddlewareFunction\[\] = \[meterDonorPage\];/
		);
	});

	// the preview is one of the exceptions above, and what it mounts is the layout's own session gate
	// and nothing else — a gate of its own would be a second one to keep true.
	it('is the session gate alone on the preview, as it is on the protected layout', () => {
		expect(readFromDisk(PROTECTED_LAYOUT) ?? '').toMatch(
			/export const middleware: Route\.MiddlewareFunction\[\] = \[staffGate\];/
		);
		expect(readFromDisk(PREVIEW_PAGE) ?? '').toMatch(
			/export const middleware: Route\.MiddlewareFunction\[\] = \[staffGate\];/
		);
	});

	it('is never the root route, which every request passes through', () => {
		// including the payment processor's callback, whose body must be read exactly once by the
		// handler that owns it (CLAUDE.md). ./root.tsx says so in its own header; this is what
		// holds it.
		const source = readFromDisk(ROOT_ROUTE);
		expect(source).not.toBeNull();
		expect(exportsMiddleware(source ?? '')).toBe(false);
	});

	/**
	 * and each callback sits under nothing, so neither of the two mountings above can reach one.
	 *
	 * the other half of the same claim, and the half a name cannot carry: the two cases above say
	 * where a `middleware` may be, this one says the callbacks are under no layout that could hold
	 * one — asserted against the route config react router serves rather than against the file
	 * names that produced them, because `flatRoutes` nests by name and a layout added at
	 * `routes/api.ts` would adopt every callback without a character of any of them changing.
	 *
	 * what breaks if it does is in each callback's own header and is invisible in every other
	 * place: verification fails in production on every delivery, and the processor's own dashboard
	 * is the only thing that reports it. the runtime half — that the bytes reach the handler unread
	 * and are read once — is each route's own `.db.spec.ts`.
	 */
	it.each(Object.entries(PROCESSOR_CALLBACKS))(
		'is above no layout at all for %s',
		(file, address) => {
			const callback = routes.find((r) => r.file === file);
			expect(callback?.path).toBe(address);
			expect(callback?.ancestors).toEqual([]);
		}
	);
});

/**
 * whether a route module renders anything at all, which is what makes it a screen rather than a
 * wire endpoint. every route on `/api/v1` answers with a `Response` and has no default export, so
 * there is nothing on it for a stylesheet to dress.
 */
function drawsAScreen(source: string): boolean {
	return /\bexport\s+default\b/.test(source);
}

/** the same four spellings `exportsMiddleware` reads, for the export that carries the sheet. */
function exportsLinks(source: string): boolean {
	return [
		/\bexport\s+(?:const|let|var)\s+links\b/,
		/\bexport\s+(?:async\s+)?function\s+links\b/,
		/\bexport\s*\{[^}]*\bas\s+links\b/,
		/\bexport\s*\{[^}]*\blinks\b[^}]*\}/
	].some((pattern) => pattern.test(source));
}

describe('the stylesheet a screen outside the layout carries', () => {
	it.each([
		{ how: 'an alias of the helper', source: 'export const links = operatorLinks;' },
		{ how: 'a function of its own', source: 'export function links() { return operatorLinks(); }' },
		{ how: 'a rename', source: 'export { operatorLinks as links };' },
		{ how: 'a plain re-export', source: 'export { links };' }
	])('is $how', ({ source }) => {
		expect(exportsLinks(source)).toBe(true);
	});

	it.each([
		{ what: 'a local of that name', source: 'const links = operatorLinks();' },
		{
			what: 'an import of the helper',
			source: "import { operatorLinks } from '$lib/admin/operator-links';"
		},
		{ what: 'a word that merely contains it', source: 'export const linksFor = () => [];' }
	])('is not $what', ({ source }) => {
		expect(exportsLinks(source)).toBe(false);
	});

	it('reports a screen outside the layout that carries none', () => {
		const manifest = [route('routes/exports.tsx', '/exports')];
		expect(
			undressedRoutes(manifest, () => 'export default function Exports() { return null; }')
		).toEqual([expect.stringContaining('operatorLinks')]);
	});

	it('passes a screen under the layout, which the layout dresses', () => {
		const manifest = [route('routes/_app.donors.tsx', '/donors', [PROTECTED_LAYOUT])];
		expect(
			undressedRoutes(manifest, () => 'export default function Donors() { return null; }')
		).toEqual([]);
	});

	it('passes a route that renders nothing, which has no screen to dress', () => {
		const manifest = [route('routes/api.v1.forms.$id.donations.ts', '/api/v1/forms/:id/donations')];
		expect(undressedRoutes(manifest, () => 'export async function action() {}')).toEqual([]);
	});

	/**
	 * and the donor's pages and the preview carry none of it, which the sweep above cannot say for
	 * them: the donor's pages are excluded from it by name, and it passes the preview's `links`, the
	 * donor sheets. so a line adding the operator sheet to one would pass everything else in this
	 * file — and what that produces is not an exception on one screen: the operator reset zeroes
	 * `border` on `*` and `background` on every control, from a layer the form's own unlayered
	 * rules then outrank back. src/app.css argues both directions.
	 *
	 * the import rather than the name, because ./routes/donate.tsx's header names the helper to say
	 * it does not use it.
	 */
	it.each([...DONOR_PAGES, PREVIEW_PAGE])(
		'imports neither the helper nor the sheet on %s',
		(file) => {
			const source = readFromDisk(file) ?? '';
			expect(source).not.toBe('');
			expect(source).not.toMatch(/from '\$lib\/admin\/operator-links'/);
			expect(source).not.toMatch(/from '[^']*app\.css/);
		}
	);

	it('is carried by every screen this app serves outside the layout', () => {
		expect(routes.length).toBeGreaterThan(0);
		expect(undressedRoutes(routes, readFromDisk)).toEqual([]);
	});
});

/**
 * the auth API this app retired rather than ported.
 *
 * better-auth's router is never mounted and no route file claims any of the nine paths it
 * registers, so the surface is absent by the tree containing nothing — which is exactly why it is
 * asserted. what stands in its place is the server API: the login's action calls
 * `auth.api.signInStaff` and the gate calls `auth.api.getSession`, neither of which passes through
 * better-auth's router. $lib/server/auth/index.ts argues it and CLAUDE.md records it.
 *
 * the credential endpoint is the one worth naming. `POST /api/auth/sign-in/staff` takes a password
 * in a JSON body and answers anyone with `curl`; a route file that mounted it would be a
 * password-guessing surface added by a file name.
 */
describe('the auth API this deployment does not serve', () => {
	// without this the case below would pass against a matcher that answered 404 for everything —
	// an empty route tree, a resolver that threw, a helper mounting nothing. the public api's own
	// layout is a route this app does serve, and a served route is not a 404 whatever else it is.
	it('is asked with a matcher that can tell a served address from an absent one', async () => {
		expect(await statusAt(API_BASE_PATH)).not.toBe(404);
	});

	// a 404 and not a 500: an address nothing claims must read as an address this deployment never
	// had, rather than as a surface that is there and broken. and it settles, which is the other
	// half — a middleware chain left waiting on a route that is not there would hang the request.
	it('answers the staff credential endpoint with a 404', async () => {
		expect(await statusAt(`${RETIRED_AUTH_PREFIX}/sign-in/staff`)).toBe(404);
	});

	// and it is the prefix rather than that one path: `/get-session`, `/sign-out` and the six
	// others went with it, as did everything better-auth registers whether or not it is configured.
	it.each(['', '/get-session', '/sign-out', '/list-sessions', '/reset-password/some-token'])(
		'answers %s under the retired prefix with a 404',
		async (relative) => {
			expect(await statusAt(`${RETIRED_AUTH_PREFIX}${relative}`)).toBe(404);
		}
	);

	// the same claim over the manifest, which is the half a request cannot make: a route can be
	// served at an address no case here thought to ask for.
	it('resolves no route at any address under the retired prefix', () => {
		expect(
			routes.filter(
				(route) =>
					route.path === RETIRED_AUTH_PREFIX || route.path.startsWith(`${RETIRED_AUTH_PREFIX}/`)
			)
		).toEqual([]);
	});
});

/**
 * the address `scripts/doctor.js` posts its probe to, read off the script rather than spelled a
 * second time here.
 *
 * that script asks a deployed worker whether it can sign staff in, and the way it goes wrong
 * without anything failing is the address: a probe at an address this app does not serve answers
 * 404 for a healthy deployment and a broken one alike, so its whole report becomes a sentence
 * about the wrong thing. it posted to the retired prefix above for as long as that surface was
 * gone, and nothing could see it, because a path in a script is a string to every compiler in
 * this tree.
 */
function doctorProbePath(): string {
	const named = /const SIGN_IN_PATH = '([^']+)'/.exec(readFileSync('scripts/doctor.js', 'utf8'));
	if (!named?.[1]) throw new Error('scripts/doctor.js no longer names SIGN_IN_PATH');
	return named[1];
}

describe('the address the deployment doctor probes', () => {
	it('is a route this deployment serves', async () => {
		const probed = doctorProbePath();
		expect(probed.startsWith(RETIRED_AUTH_PREFIX)).toBe(false);
		expect(
			await statusAt(probed),
			`scripts/doctor.js posts to ${probed}, which no route in this app answers — its refusal would be a 404 on every deployment, healthy or not.`
		).not.toBe(404);
	});
});

/** the three ways a route would resolve a session of its own instead of taking the gate's. */
function resolvesItsOwnSession(source: string): boolean {
	return /\b(?:createAuth|resolveAuthSecret|getSession)\b/.test(source);
}

describe('the session the gate resolved', () => {
	it('is what the sweep below looks for, proven against the gate itself', () => {
		// without this, a typo'd pattern that matches nothing anywhere would report a clean tree
		// forever. the gate is the one module that must match.
		expect(resolvesItsOwnSession(readFromDisk('lib/server/auth/gate.ts') ?? '')).toBe(true);
	});

	it('is resolved once, by the gate, and not again by a route beneath it', () => {
		const offenders = routes
			.filter(
				(r) =>
					(r.file !== PROTECTED_LAYOUT && under(r, PROTECTED_LAYOUT)) || r.file === PREVIEW_PAGE
			)
			.filter((r) => resolvesItsOwnSession(readFromDisk(r.file) ?? ''))
			.map((r) => r.file);
		expect(
			offenders,
			`${offenders.join(', ')} resolves a session of its own, but the gate on ${PROTECTED_LAYOUT} already resolved one for this request — take it off the router context with \`context.get(staff)\` (src/context.ts).`
		).toEqual([]);
	});
});

/**
 * the three ways a route would charge the surface's own bucket instead of taking the layout's.
 *
 * the surface bucket only — `API_RATE_LIMITER` and the two functions that spend it. the tighter
 * per-endpoint buckets are deliberately charged by the code that answers them
 * ($lib/server/api/rate-limit.ts says why), so a sweep over "any limiter" would refuse the design
 * rather than hold it.
 */
function chargesTheSurfaceBucket(source: string): boolean {
	return /\b(?:refuseIfRateLimited|apiRateLimitKey|API_RATE_LIMITER)\b/.test(source);
}

describe('the limit the layout charged', () => {
	it('is what the sweep below looks for, proven against the meter itself', () => {
		// without this, a typo'd pattern that matches nothing anywhere would report a clean tree
		// forever. the meter is the one module that must match.
		expect(chargesTheSurfaceBucket(readFromDisk('lib/server/api/meter.ts') ?? '')).toBe(true);
	});

	it('is charged once, by the layout, and not again by a route beneath it', () => {
		const offenders = routes
			.filter((r) => r.file !== API_LAYOUT && under(r, API_LAYOUT))
			.filter((r) => chargesTheSurfaceBucket(readFromDisk(r.file) ?? ''))
			.map((r) => r.file);
		expect(
			offenders,
			`${offenders.join(', ')} charges the /api/v1 rate limit itself, but the meter on ${API_LAYOUT} already charged it for this request — and a limit an endpoint opts into is a limit the next endpoint forgets ($lib/server/api/meter.ts).`
		).toEqual([]);
	});
});

describe('the server tree and the browser bundle', () => {
	/** a module graph a case composes, so the gate can be shown to catch and to let through. */
	function tree(modules: Record<string, string>): ReadModule {
		return (file) => modules[file] ?? null;
	}

	it('reports a component that imports from the server tree', () => {
		const chain = reachesServerTree(
			'routes/_app.donors.tsx',
			tree({
				'routes/_app.donors.tsx': [
					"import { listDonors } from '$lib/server/donors/queries';",
					'export default function Donors() { return listDonors(); }'
				].join('\n'),
				'lib/server/donors/queries.ts': 'export function listDonors() {}'
			})
		);
		expect(chain).toEqual(['routes/_app.donors.tsx', 'lib/server/donors/queries.ts']);
	});

	it('lets a loader import from the server tree, which is the whole point of a route module', () => {
		const chain = reachesServerTree(
			'routes/_app.donors.tsx',
			tree({
				'routes/_app.donors.tsx': [
					"import { listDonors } from '$lib/server/donors/queries';",
					'export async function loader() { return listDonors(); }',
					'export default function Donors() { return null; }'
				].join('\n'),
				'lib/server/donors/queries.ts': 'export function listDonors() {}'
			})
		);
		expect(chain).toEqual([]);
	});

	it('follows a component through a module that is not a route', () => {
		// a module that is not a route has no export the framework strips, so all of it ships —
		// which is how a server import one file away from a component reaches the browser.
		const chain = reachesServerTree(
			'routes/_app.donors.tsx',
			tree({
				'routes/_app.donors.tsx': [
					"import { DonorTable } from '$lib/admin/DonorTable';",
					'export default function Donors() { return DonorTable(); }'
				].join('\n'),
				'lib/admin/DonorTable.tsx': [
					"import { listDonors } from '../server/donors/queries';",
					'export function DonorTable() { return listDonors(); }'
				].join('\n'),
				'lib/server/donors/queries.ts': 'export function listDonors() {}'
			})
		);
		expect(chain).toEqual([
			'routes/_app.donors.tsx',
			'lib/admin/DonorTable.tsx',
			'lib/server/donors/queries.ts'
		]);
	});

	it('follows a module-scope const, which a bundler does not drop with the export that used it', () => {
		const chain = reachesServerTree(
			'routes/_app.donors.tsx',
			tree({
				'routes/_app.donors.tsx': [
					"import { listDonors } from '$lib/server/donors/queries';",
					'const donors = listDonors();',
					'export async function loader() { return donors; }',
					'export default function Donors() { return null; }'
				].join('\n'),
				'lib/server/donors/queries.ts': 'export function listDonors() {}'
			})
		);
		expect(chain).toEqual(['routes/_app.donors.tsx', 'lib/server/donors/queries.ts']);
	});

	/**
	 * a resource route: no component, no `clientLoader`, nothing react router puts in a browser
	 * bundle at all. the module-scope `const` below is the case the sweep is otherwise strict
	 * about, and it is strict about it for a reason that does not reach here — a bundler keeps a
	 * module-scope binding after dropping the export that used it, but only in a module the client
	 * build still emits. this one it does not emit.
	 *
	 * it is the difference between the two endpoints on `/api/v1` and a route with a screen: those
	 * two export a `loader` and an `action` and nothing else, so the strict reading forced every
	 * helper they have into the body of a handler to get past a gate that had nothing to protect.
	 */
	it('passes a route that exports no component, which ships nothing to a browser', () => {
		const chain = reachesServerTree(
			'routes/api.v1.forms.$id.donations.ts',
			tree({
				'routes/api.v1.forms.$id.donations.ts': [
					"import { mintQuote } from '$lib/server/donations/quote';",
					'async function quote(request) { return mintQuote(request); }',
					'export async function action({ request }) { return quote(request); }',
					'export async function loader() { return new Response(null, { status: 405 }); }'
				].join('\n'),
				'lib/server/donations/quote.ts': 'export function mintQuote() {}'
			})
		);
		expect(chain).toEqual([]);
	});

	/**
	 * and the narrowing goes no further than that. any export react router does ship — a
	 * `clientLoader` here, a component in the case above it — puts the module in the browser
	 * bundle, and the module-scope reading applies to all of it again.
	 */
	it('reports a route with no component that still ships a client-side export', () => {
		const chain = reachesServerTree(
			'routes/api.v1.forms.$id.donations.ts',
			tree({
				'routes/api.v1.forms.$id.donations.ts': [
					"import { mintQuote } from '$lib/server/donations/quote';",
					'async function quote(request) { return mintQuote(request); }',
					'export async function action({ request }) { return quote(request); }',
					'export async function clientLoader() { return null; }'
				].join('\n'),
				'lib/server/donations/quote.ts': 'export function mintQuote() {}'
			})
		);
		expect(chain).toEqual([
			'routes/api.v1.forms.$id.donations.ts',
			'lib/server/donations/quote.ts'
		]);
	});

	it('passes over a type-only import, which is erased with the text it was written as', () => {
		const chain = reachesServerTree(
			'routes/_app.donors.tsx',
			tree({
				'routes/_app.donors.tsx': [
					"import type { Donor } from '$lib/server/donors/queries';",
					'export default function Donors(props: { donor: Donor }) { return null; }'
				].join('\n'),
				'lib/server/donors/queries.ts': 'export interface Donor {}'
			})
		);
		expect(chain).toEqual([]);
	});

	/** a route exporting an `action` that reaches the server tree, beside a component written in `body`. */
	function besideAnAction(body: string): ReadModule {
		return tree({
			'routes/_app.donors.tsx': [
				"import { Form } from 'react-router';",
				"import { saveDonor } from '$lib/server/donors/commands';",
				"const SAVE = '?index';",
				'export async function action() { return saveDonor(); }',
				body
			].join('\n'),
			'lib/server/donors/commands.ts': 'export function saveDonor() {}'
		});
	}

	it('reads a JSX attribute name as a label, not as the export it is spelled like', () => {
		const chain = reachesServerTree(
			'routes/_app.donors.tsx',
			besideAnAction(
				'export default function Donors() { return <Form method="post" action={SAVE} />; }'
			)
		);
		expect(chain).toEqual([]);
	});

	it('reads the name after a dot as a property, not as the export it is spelled like', () => {
		const chain = reachesServerTree(
			'routes/_app.donors.tsx',
			besideAnAction('export default function Donors(props) { return props.action ?? SAVE; }')
		);
		expect(chain).toEqual([]);
	});

	it('reads an object key as a property, not as the export it is spelled like', () => {
		const chain = reachesServerTree(
			'routes/_app.donors.tsx',
			besideAnAction('export default function Donors() { return { action: SAVE }; }')
		);
		expect(chain).toEqual([]);
	});

	it('follows a shorthand property, which reads the export it names', () => {
		const chain = reachesServerTree(
			'routes/_app.donors.tsx',
			besideAnAction('export default function Donors() { return { action }; }')
		);
		expect(chain).toEqual(['routes/_app.donors.tsx', 'lib/server/donors/commands.ts']);
	});

	/** the page header's slot names, read off the component so a rename to one of them lands here. */
	function pageHeaderSlots(): string[] {
		const file = createRequire(import.meta.url).resolve(
			'@better-giving/operator/components/shell/PageHeader'
		);
		const destructured = /export function PageHeader\(\{([^}]*)\}\)/.exec(
			readFileSync(file, 'utf8')
		);
		const props = destructured?.[1];
		if (props === undefined) throw new Error(`no destructured props to read in ${file}`);
		return props
			.split(',')
			.flatMap((slot) => slot.split(/[=:]/).slice(0, 1))
			.map((slot) => slot.trim())
			.filter((slot) => slot.length > 0);
	}

	/**
	 * the real header, every slot it has written as an attribute, beside an `action` that reaches
	 * the server tree. the slots are read off the header itself, so whatever it is given to draw,
	 * mounting it on a route with handlers reaches nothing.
	 */
	it('mounts the page header on a route that exports an action, and reaches nothing', () => {
		const slots = pageHeaderSlots();
		expect(slots).not.toHaveLength(0);
		const chain = reachesServerTree(
			'routes/_app.donors.tsx',
			tree({
				'routes/_app.donors.tsx': [
					"import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';",
					"import { saveDonor } from '$lib/server/donors/commands';",
					'export async function action() { return saveDonor(); }',
					`export default function Donors() { return <PageHeader ${slots
						.map((slot) => `${slot}={null}`)
						.join(' ')} />; }`
				].join('\n'),
				'lib/server/donors/commands.ts': 'export function saveDonor() {}'
			})
		);
		expect(chain).toEqual([]);
	});

	it('is not reachable from any route module in this app', () => {
		expect(routes.length).toBeGreaterThan(0);
		for (const { file } of routes) {
			expect(
				reachesServerTree(file),
				`${file} reaches $lib/server from an export react router ships to the browser, so the database client, the stripe client and this deployment's credentials go into the bundle a visitor downloads. Keep the server import to \`loader\`, \`action\`, \`middleware\` or \`headers\`, and hand the component serializable props.`
			).toEqual([]);
		}
	});
});
