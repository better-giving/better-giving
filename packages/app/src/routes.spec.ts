import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { API_BASE_PATH } from '$lib/server/api/surface';
import { CONSOLE_BASE_PATH } from '$lib/server/console/surface';
import { PAYPAL_WEBHOOK_PATH } from '$lib/server/payments/webhook-address';
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
// what is at stake is not only the record screens. `GET /console` enumerates by name the
// deploy-time secrets a deployment has not set, in front of a public payment-initiating
// `/api/v1` — so that surface answered without its credential is reconnaissance against this
// deployment, which is why it is a category of its own below rather than a route somebody excused
// as public.
//
// how it works: the app's own route config, run. ./routes.testing.ts imports ./routes.ts and
// resolves it, so what is swept is what react router will serve rather than a spec's idea of which
// files are addresses. a runtime probe would only cover the paths a test happens to request, and
// the route that matters is the one nobody wrote a test for.
//
// every route is in one of three categories, and a name that no longer matches a file fails too,
// so a list cannot rot into permission for a route that was moved or deleted.
//
// the three, and the third is not a kind of public. a route is under the protected layout, in
// which case the gate redirects an anonymous caller to the login; or it is on PUBLIC_ROUTE_FILES
// below, which is a decision somebody typed next to the reason; or it is on the console surface,
// which is neither. `/console` is checked by a credential rather than by a session
// ($lib/server/console/access.ts), so it may not sit under the layout, where the gate would answer
// a wire caller with a 303 to an HTML login, and it may not be listed as public, which would be a
// lie this file then blesses.
//
// and it holds two more mountings on the same principle, one category over each. being public is a
// line somebody typed on the list below; being *metered* is not a decision and must not become
// one, so every route served under `/api/v1` is held to sitting under the layout that charges that
// surface's rate limit, and none of them may charge it again. the console's credential is held the
// same way, under the layout that checks it. the three rules are one rule about three surfaces:
// what a request owes is decided where the surface is, never per endpoint.

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
 * the payment processors' callbacks, with the address each answers on — the two routes in this app
 * that owe their position.
 *
 * every other route's placement decides what it inherits; theirs decides what they do not. the
 * delivery is verified against the raw body exactly as sent, and the body is read exactly once by
 * the handler that owns it (CLAUDE.md) — so a `middleware` anywhere above either of them that
 * touched the request would break verification in production and nowhere else. they are named here
 * so the case at the foot of `where middleware is mounted` can hold that neither has a layout above
 * it.
 *
 * the address is here beside the file rather than left to the name, because it is what an operator
 * pastes into a processor's dashboard: Stripe's is registered by this app and PayPal's is typed in
 * by hand, and the deployment tells an operator PayPal's over the console wire
 * (`src/routes/console.payments.ts`).
 *
 * each address is the constant the rest of the tree builds from rather than a second spelling of
 * it, which is what makes this the pin: a route file renamed changes the path react router resolves
 * and nothing else, so a literal here would agree with the rename and leave every caller of those
 * constants pointing at a 404.
 */
const PROCESSOR_CALLBACKS: Readonly<Record<string, string>> = {
	'routes/api.stripe.webhook.ts': STRIPE_WEBHOOK_PATH,
	'routes/api.paypal.webhook.ts': PAYPAL_WEBHOOK_PATH
};

/**
 * the donor's page, which is the one screen outside the layout that wears no operator stylesheet.
 *
 * it draws the donation form's own card and links the form's four sheets in its own `links`, and
 * those four are unlayered while every operator declaration is layered (src/app.css) — so a
 * document holding both would let one side outrank the other on properties only one of them sets.
 * it is named here so the sweep below can hold every *other* screen outside the layout to carrying
 * the operator sheet without holding this one to it.
 */
const DONOR_PAGE = 'routes/$formId.tsx';

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
	// the endpoint that takes the gift, submitted by a donor's browser on that same page. it is
	// unauthenticated for the same reason and owes all four: CORS from the form's own
	// `allowed_origins`, the limit from the layout above it plus a tighter bucket of its own, a
	// Turnstile token checked before any intent is minted, and the amount re-read from the form
	// record rather than taken from the body.
	'routes/api.v1.forms.$id.donations.ts',
	// the payment processors' callbacks, delivered by machines belonging to somebody else. they are
	// unauthenticated because there is no session a processor could hold and no page either is
	// answering: no origin to echo, no visitor to challenge, no form id in the path. what stands
	// in for all of it is the delivery being verified against the raw body, checked before anything
	// is parsed — which is also why neither is under a layout at all, held below.
	...Object.keys(PROCESSOR_CALLBACKS),
	// the donor's page, opened from a link the organisation published. it is unauthenticated
	// because a donor holds no session and never could — there is nobody for a gate here to ask
	// about. it initiates no payment itself and takes no submission: the gift goes through the
	// endpoint above it, same-origin, which owes all four of that surface's checks. and what its
	// loader hands the browser is the served config alone, never the `form` row it was read from —
	// that row carries `allowed_origins`.
	DONOR_PAGE
];

/**
 * every route file on the operator console's surface.
 *
 * the category is decided by the path a route is served at and this list is the cross-check: a
 * route under `/console` that nobody put here is a route somebody added to a credentialled surface
 * without saying so, and a name here with no route behind it is permission left lying around.
 *
 * what this surface is, and what it owes instead of a session, is written where it is enforced:
 * $lib/server/console/surface.ts for the headers it sends and the limiter it does not have,
 * $lib/server/console/access.ts for what the credential proves.
 */
const CONSOLE_ROUTE_FILES: readonly string[] = [
	// the surface's own layout, and its own address as well. the credential check is mounted on
	// this file for the whole surface at once, and `GET /console` is the deployment's report on
	// itself — the read both writes below answer with too.
	'routes/console.ts',
	// the list of sites this deployment's donation forms may be used on, written whole.
	'routes/console.sites.ts',
	// the organisation's legal identity, written whole.
	'routes/console.org.ts',
	// a test message, sent over this deployment's own transport with its own SMTP credentials.
	// no row moves, so it answers with a report of the press rather than with the deployment's.
	'routes/console.test-email.ts',
	// what a repeating gift is charged against on this deployment's own processor account: a read
	// that changes nothing, and the one press that provisions it. it answers on its own address, so
	// it is not in the report.
	'routes/console.recurring.ts',
	// which ways of paying each processor account this deployment holds keys for can charge, whether
	// what verifies its deliveries is what its endpoint was registered with, and what that endpoint is
	// subscribed to. readings of somebody else's accounts, all of them facts only this deployment can
	// state, and the press for the third is the file below.
	'routes/console.payments.ts',
	// the repair for the endpoint that reading reports on: subscribed to everything this app acts
	// on and switched back on, keeping the signing secret it has. a press and no read — where the
	// endpoint stands is the file above — and Stripe's alone, for the reason its own header states.
	'routes/console.webhook-repair.ts',
	// registering this deployment's own address and every site it lists on the processor account,
	// so a donor is drawn the wallet buttons. a press and no read — which hostnames the account
	// holds is on the payments reading two files above, and the hostnames are settled here rather
	// than sent, so nothing a caller says registers anything.
	'routes/console.wallet-domains.ts'
];

/**
 * the layout the console's credential check is mounted on, and being under it is what makes a
 * route on that surface checked.
 *
 * the third mounting of the same shape, and the reason all three are held rather than trusted: a
 * check each route called is allow-by-default, so the route somebody writes without the call is
 * served on a credentialled surface to anyone. $lib/server/console/gate.ts argues it; the sweeps
 * at the foot of this file are what hold it.
 */
const CONSOLE_LAYOUT = 'routes/console.ts';

let routes: RouteRecord[];
beforeAll(async () => {
	routes = await routeManifest();
});

/** whether a route is served on the operator console's wire surface rather than as a screen. */
function consoleRoute(route: RouteRecord): boolean {
	return route.path === CONSOLE_BASE_PATH || route.path.startsWith(`${CONSOLE_BASE_PATH}/`);
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
 * every route that is in none of the three categories, as the message somebody reads when they
 * added one.
 *
 * a function over a manifest rather than a loop over the real tree, so the rule can be shown to
 * fail: the tree this app has today is small enough that a sweep over it alone would pass whether
 * or not the rule works.
 */
function ungatedRoutes(manifest: readonly RouteRecord[], allowed: readonly string[]): string[] {
	return manifest
		.filter(
			(route) =>
				!under(route, PROTECTED_LAYOUT) && !allowed.includes(route.file) && !consoleRoute(route)
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
		.filter((route) => !route.ancestors.includes(PROTECTED_LAYOUT) && route.file !== DONOR_PAGE)
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

/** every console route somebody excused as public instead of leaving it to the credential. */
function consoleRoutesCalledPublic(
	manifest: readonly RouteRecord[],
	allowed: readonly string[]
): string[] {
	return manifest
		.filter((route) => consoleRoute(route) && allowed.includes(route.file))
		.map((route) => route.file);
}

/**
 * every route on the console surface that is not under the layout carrying its credential check,
 * as the message somebody reads when they added one.
 *
 * the same shape as `unmeteredApiRoutes` above and for the graver reason: a route file whose name
 * opts out of the layout — react router's flat convention spells that with a trailing underscore
 * on a segment — is served at the same address with nothing checking who asked, and the only
 * difference a reader would see is one character in a file name.
 */
function uncheckedConsoleRoutes(manifest: readonly RouteRecord[]): string[] {
	return manifest
		.filter((route) => consoleRoute(route) && !under(route, CONSOLE_LAYOUT))
		.map(
			(route) =>
				`${route.file} is served at ${route.path} and is not under ${CONSOLE_LAYOUT}, so nothing checks the console credential for it. Name it so it nests under that layout — see $lib/server/console/gate.ts.`
		);
}

/** every console route nobody named. */
function unnamedConsoleRoutes(
	manifest: readonly RouteRecord[],
	named: readonly string[]
): string[] {
	return manifest
		.filter((route) => consoleRoute(route) && !named.includes(route.file))
		.map((route) => route.file);
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

	it('reports a console route listed as public', () => {
		const manifest = [route('routes/console.sites.tsx', '/console/sites')];
		expect(consoleRoutesCalledPublic(manifest, ['routes/console.sites.tsx'])).toEqual([
			'routes/console.sites.tsx'
		]);
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

	it('reports a console route nobody named, and takes the credential as the gate', () => {
		const manifest = [route('routes/console.sites.tsx', '/console/sites')];
		expect(unnamedConsoleRoutes(manifest, [])).toEqual(['routes/console.sites.tsx']);
		// on the list it is a category of its own: neither gated nor public.
		expect(unnamedConsoleRoutes(manifest, ['routes/console.sites.tsx'])).toEqual([]);
		expect(ungatedRoutes(manifest, [])).toEqual([]);
	});

	it('reports a console route that sits outside the checked layout', () => {
		// the same flat-route spelling that unmeters an api route: a trailing underscore on a
		// segment opts a file out of its parent layout while leaving the URL alone.
		const manifest = [route('routes/console_.sites.ts', '/console/sites')];
		expect(uncheckedConsoleRoutes(manifest)).toEqual([
			expect.stringContaining('routes/console_.sites.ts is served at')
		]);
	});

	it('passes a console route that is under it, and the layout itself', () => {
		const manifest = [
			route(CONSOLE_LAYOUT, '/console'),
			route('routes/console.sites.ts', '/console/sites', [CONSOLE_LAYOUT])
		];
		expect(uncheckedConsoleRoutes(manifest)).toEqual([]);
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
	it('has a public api, with its metered layout in it', () => {
		expect(routes.filter(apiRoute).length).toBeGreaterThan(0);
		expect(routes.map((r) => r.file)).toContain(API_LAYOUT);
	});

	it('meters every route it serves on the public api', () => {
		expect(unmeteredApiRoutes(routes)).toEqual([]);
	});

	it('names no route that is not there', () => {
		expect(absentFromTree(PUBLIC_ROUTE_FILES, routes)).toEqual([]);
		expect(absentFromTree(CONSOLE_ROUTE_FILES, routes)).toEqual([]);
	});

	// the sweep finding nothing would make the two cases below vacuous, the same way an empty route
	// tree would make the whole file vacuous — and a renamed console layout is exactly how that
	// happens.
	it('has a console surface, with its checked layout in it', () => {
		expect(routes.filter(consoleRoute).length).toBeGreaterThan(0);
		expect(routes.map((r) => r.file)).toContain(CONSOLE_LAYOUT);
	});

	it('checks the credential for every route it serves on the console surface', () => {
		expect(uncheckedConsoleRoutes(routes)).toEqual([]);
	});

	it('names every route on the console surface', () => {
		expect(unnamedConsoleRoutes(routes, CONSOLE_ROUTE_FILES)).toEqual([]);
	});

	it('lists no console route as public', () => {
		expect(consoleRoutesCalledPublic(routes, PUBLIC_ROUTE_FILES)).toEqual([]);
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
	 * an address nothing claims matches no route, so it matches nothing under the protected layout
	 * either and the gate never runs for it — which is what puts the error page in front of a
	 * caller with no session and keeps a deployment whose database is not answering able to say
	 * so. ./root.tsx's `ErrorBoundary` is what renders it; the 404 here is the half a component
	 * cannot claim for itself.
	 *
	 * a single top-level segment is not one of those addresses. `/not-a-page` matches the
	 * donor's page, whose loader finds no form and draws its own notice with a 404 of its own
	 * (./routes/$formId.workers.spec.ts) — a donor holding a link that did not work is not shown the
	 * operator error panel. what still reaches the boundary is everything that segment cannot be:
	 * a path under a route that claims no such child, and any address of more than one segment.
	 */
	it('answers an address matching no route with a 404, above every layout', async () => {
		expect(await statusAt('/admin/not-a-screen')).toBe(404);
		expect(await statusAt('/a/b')).toBe(404);
		expect(routes.filter((r) => r.path === '/admin/not-a-screen' || r.path === '/a/b')).toEqual([]);
	});

	/**
	 * and a single segment reaches the donor's page whatever it holds, malformed included.
	 *
	 * the guard on the form id is the loader's rather than the router's, and it draws the same
	 * notice: `/.env` is a scanner asking, and answering it with the operator error panel would be
	 * putting /admin's dress on a stranger's screen to say the same 404.
	 */
	it('answers every single segment with the donor’s page', async () => {
		expect(await matchedFileAt('/frm_something')).toBe(DONOR_PAGE);
		expect(await matchedFileAt('/.env')).toBe(DONOR_PAGE);
	});

	/**
	 * every static top-level route this app serves still answers its own address.
	 *
	 * a dynamic top-level segment matches all of them, and what keeps them theirs is react router's
	 * own ranking rather than anything either file says — so it is asked of the matcher. nothing in
	 * ./routes/$formId.tsx names them and nothing there may: a list of reserved words in a loader
	 * would be a second copy of this tree, wrong the moment a route is added.
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
		{ address: API_BASE_PATH, file: API_LAYOUT },
		{ address: CONSOLE_BASE_PATH, file: CONSOLE_LAYOUT }
	])('keeps $address on $file', async ({ address, file }) => {
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
	// three layouts and nothing else, each covering one surface: the session gate over every screen
	// behind the login, the meter over every route on the public api, and the credential check over
	// every route on the operator console. a fourth name here is a route that took a decision one
	// of those three makes for a whole surface, which is the shape all three exist to remove.
	//
	// the console's is not the session gate and must never be confused for one. it reads a bearer
	// header against a value only an account holder could have written
	// ($lib/server/console/access.ts) and sets no session — so a caller it refuses gets a JSON 401
	// rather than the 303 to an HTML login the gate on the protected layout answers with, which is
	// the whole reason that surface may not sit under that layout.
	it('is the three surface layouts, and no other route', () => {
		const mounted = routes
			.filter((r) => exportsMiddleware(readFromDisk(r.file) ?? ''))
			.map((r) => r.file)
			.sort();
		expect(mounted).toEqual([API_LAYOUT, CONSOLE_LAYOUT, PROTECTED_LAYOUT].sort());
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
	 * `routes/api.ts` would adopt both routes without a character of either changing.
	 *
	 * what breaks if it does is in each callback's own header and is invisible in every other
	 * place: verification fails in production on every delivery, and the processor's own dashboard
	 * is the only thing that reports it. the runtime half — that the bytes reach the handler unread
	 * and are read once — is each route's own `.workers.spec.ts`.
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
 * wire endpoint. every route on `/api/v1` and every route on the console surface answers with a
 * `Response` and has no default export, so there is nothing on either for a stylesheet to dress.
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
		const manifest = [route('routes/console.sites.ts', '/console/sites')];
		expect(undressedRoutes(manifest, () => 'export async function action() {}')).toEqual([]);
	});

	/**
	 * and the donor's page carries none of it, which the sweep above cannot say for it.
	 *
	 * it is excluded from that sweep by name, so a line adding the operator sheet to it would pass
	 * everything else in this file — and what that produces is not an exception on one screen: the
	 * operator reset zeroes `border` on `*` and `background` on every control, from a layer the
	 * form's own unlayered rules then outrank back. src/app.css argues both directions.
	 *
	 * the import rather than the name, because the file's own header names the helper to say it does
	 * not use it.
	 */
	it('imports neither the helper nor the sheet on the donor’s page', () => {
		const source = readFromDisk(DONOR_PAGE) ?? '';
		expect(source).not.toBe('');
		expect(source).not.toMatch(/from '\$lib\/admin\/operator-links'/);
		expect(source).not.toMatch(/from '[^']*app\.css/);
	});

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
			.filter((r) => r.file !== PROTECTED_LAYOUT && under(r, PROTECTED_LAYOUT))
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

/**
 * the two things a route on the console surface may not do, as a sweep over its own source.
 *
 * both are absences, and an absence is what a spec over responses can only ever assert for the
 * routes it thought to ask about. what makes them properties of the surface is that they are swept
 * for: the credential is a bearer header, so a browser attaches it to nothing by itself and CSRF
 * is unrepresentable here rather than defended against — and that holds only while no route reads
 * a cookie. granting a preflight is the other half of the same decision: a page in a browser must
 * not be able to read an answer that names which of this deployment's secrets are set, and the way
 * to make sure of that is to hand it no header that would let it ($lib/server/console/surface.ts).
 *
 * identifiers and header names rather than English, because a sweep over source cannot tell a
 * comment from code and both of these are things the headers on this surface talk about.
 */
function grantsAPreflight(source: string): boolean {
	return /\bpreflightResponse\b|\bcorsHeaders\b|access-control-/i.test(source);
}

function readsACookie(source: string): boolean {
	return /\bgetSetCookie\b|['"`]set-cookie['"`]|['"`]cookie['"`]/i.test(source);
}

describe('what the console surface does not do', () => {
	it('is what the sweeps below look for, proven against the modules that do', () => {
		// without these, a typo'd pattern that matches nothing anywhere would report a clean
		// surface forever. the public api's CORS module grants preflights and the session gate
		// carries cookies, and each is the one module that must match.
		expect(grantsAPreflight(readFromDisk('lib/server/api/cors.ts') ?? '')).toBe(true);
		expect(readsACookie(readFromDisk('lib/server/auth/gate.ts') ?? '')).toBe(true);
	});

	it('answers no preflight and reads no cookie, on any route it serves', () => {
		const surface = routes.filter(consoleRoute);
		expect(surface.length).toBeGreaterThan(0);
		for (const { file } of surface) {
			const source = readFromDisk(file) ?? '';
			expect(
				grantsAPreflight(source),
				`${file} is on the console surface and hands a browser a CORS header, so a page on somebody's website could read which of this deployment's secrets are set ($lib/server/console/surface.ts).`
			).toBe(false);
			expect(
				readsACookie(source),
				`${file} is on the console surface and reads a cookie, but the credential here is a bearer header — a route that takes a cookie is a route a browser can be made to call on somebody's behalf ($lib/server/console/access.ts).`
			).toBe(false);
		}
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
	 * a slot on a shared component may not carry the name of an export react router strips.
	 *
	 * `collectIdentifiers` in ./routes.testing.ts adds every identifier it walks, a JSX attribute
	 * name included — so a route writing `action={…}` on a component reaches its own `action`
	 * handler from its component, and with it every `$lib/server/**` import the handler has. the
	 * failure that produces is the last case in this file, which reports D1 and the stripe client in
	 * the bundle a visitor downloads: a diagnosis pointing at nothing real. that over-reach is what
	 * makes the sweep safe, so the name moves rather than the sweep.
	 *
	 * the slots are read off the header itself, so renaming one back onto a stripped export fails
	 * here rather than on whichever screen next mounts it beside an `action`.
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
				`${file} reaches $lib/server from an export react router ships to the browser, so D1, the stripe client and this deployment's secrets go into the bundle a visitor downloads. Keep the server import to \`loader\`, \`action\`, \`middleware\` or \`headers\`, and hand the component serializable props.`
			).toEqual([]);
		}
	});
});
