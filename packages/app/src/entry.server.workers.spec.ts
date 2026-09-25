import { createExecutionContext, env } from 'cloudflare:test';
import {
	createRequestHandler,
	type ServerBuild,
	UNSAFE_withComponentProps,
	UNSAFE_withErrorBoundaryProps
} from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb } from '$lib/server/db/client';
import * as entryServer from './entry.server';
import { requestContext } from './request-context';
import * as root from './root';
import * as layout from './routes/_app';
import * as dashboard from './routes/_app.admin._index';
import * as donorPage from './routes/$formId';
import * as stripeWebhook from './routes/api.stripe.webhook';
import * as publicApi from './routes/api.v1';
import * as servedConfig from './routes/api.v1.forms.$id.config';
import * as login from './routes/login';

// the headers every answer this deployment draws a document for carries, and the ones it does not.
//
// a workers spec over a whole request rather than over `handleRequest`, because which answers are
// documents is react router's decision and not this app's: a resource route's `Response` and a
// `.data` answer never reach ./entry.server.tsx at all, so the only way to hold "a json answer
// carries no policy" is to send the request through the same `createRequestHandler` ./worker.ts
// calls. the build it is handed is assembled here from the real modules — entry, root and each
// route — because the one `virtual:react-router/server-build` names is written by the vite plugin
// and this pool runs no build (../vitest.workers.config.ts).
//
// the route ids and paths below are what `@react-router/fs-routes` resolves those files to; which
// file is served at which address is ./routes.spec.ts's, against the app's own route config.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

/** the pool's bindings with the staff credential set, so a session can be signed in. */
const DEPLOYED = { ...env, ADMIN_PASSWORD: PASSWORD };

type RouteModule = NonNullable<ServerBuild['routes'][string]>['module'];

interface Mounted {
	readonly id: string;
	readonly parentId?: string;
	readonly path?: string;
	readonly index?: true;
	readonly module: object;
}

/**
 * a route module as the vite plugin compiles it: the default export and the error boundary are
 * wrapped in the adapters that hand them `loaderData`, `params` and `error` as props. without them
 * a screen renders with no props at all.
 */
function compiled(module: object): RouteModule {
	const exports = module as {
		readonly default?: Parameters<typeof UNSAFE_withComponentProps>[0];
		readonly ErrorBoundary?: Parameters<typeof UNSAFE_withErrorBoundaryProps>[0];
	};
	return {
		...module,
		...(exports.default && { default: UNSAFE_withComponentProps(exports.default) }),
		...(exports.ErrorBoundary && {
			ErrorBoundary: UNSAFE_withErrorBoundaryProps(exports.ErrorBoundary)
		})
	} as RouteModule;
}

/**
 * a server build over the given route modules, with a client manifest that names a module url for
 * each so `<Scripts>` emits what it emits in the deployment.
 *
 * the cast in `compiled` is the one ./route-request.testing.ts describes: a typed route module is
 * narrower than the manifest's slot, and it is sound exactly when the module is mounted at the path
 * its file name spells.
 */
function buildOf(mounted: readonly Mounted[]): ServerBuild {
	const routes: ServerBuild['routes'] = {};
	const clientRoutes: ServerBuild['assets']['routes'] = {};
	for (const route of mounted) {
		const module = compiled(route.module);
		// left off rather than set to `undefined`, under `exactOptionalPropertyTypes`.
		const shape = {
			id: route.id,
			...(route.parentId !== undefined && { parentId: route.parentId }),
			...(route.path !== undefined && { path: route.path }),
			...(route.index && { index: true })
		};
		routes[route.id] = { ...shape, module };
		clientRoutes[route.id] = {
			...shape,
			hasAction: 'action' in module,
			hasLoader: 'loader' in module,
			hasClientAction: false,
			hasClientLoader: false,
			hasClientMiddleware: false,
			hasErrorBoundary: 'ErrorBoundary' in module,
			module: `/assets/${route.id.replace(/\W/g, '_')}.js`,
			clientActionModule: undefined,
			clientLoaderModule: undefined,
			clientMiddlewareModule: undefined,
			hydrateFallbackModule: undefined,
			imports: [],
			css: []
		};
	}
	return {
		entry: { module: entryServer },
		routes,
		assets: {
			entry: { module: '/assets/entry.client.js', imports: [] },
			routes: clientRoutes,
			url: '/assets/manifest.js',
			version: 'spec'
		},
		publicPath: '/',
		assetsBuildDirectory: 'build/client',
		future: {},
		ssr: true,
		isSpaMode: false,
		prerender: [],
		routeDiscovery: { mode: 'lazy', manifestPath: '/__manifest' }
	};
}

const handle = createRequestHandler(
	buildOf([
		{ id: 'root', path: '', module: root },
		{ id: 'routes/_app', parentId: 'root', module: layout },
		{
			id: 'routes/_app.admin._index',
			parentId: 'routes/_app',
			path: 'admin',
			index: true,
			module: dashboard
		},
		{ id: 'routes/login', parentId: 'root', path: 'login', module: login },
		{ id: 'routes/$formId', parentId: 'root', path: ':formId', module: donorPage },
		{ id: 'routes/api.v1', parentId: 'root', path: 'api/v1', module: publicApi },
		{
			id: 'routes/api.v1.forms.$id.config',
			parentId: 'routes/api.v1',
			path: 'forms/:id/config',
			module: servedConfig
		},
		{
			id: 'routes/api.stripe.webhook',
			parentId: 'root',
			path: 'api/stripe/webhook',
			module: stripeWebhook
		}
	]),
	'production'
);

function send(path: string, init?: RequestInit): Promise<Response> {
	return handle(
		new Request(`${ORIGIN}${path}`, init),
		requestContext(DEPLOYED, createExecutionContext())
	);
}

/** a signed-in staff session, as the cookie header a browser would send with it. */
async function signIn(): Promise<string> {
	const db = createDb(env.DB);
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);
	const auth = createAuth(
		db,
		{ ADMIN_PASSWORD: PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);
	const { headers } = await auth.api.signInStaff({
		body: { password: PASSWORD },
		headers: new Headers({ origin: ORIGIN }),
		returnHeaders: true
	});
	return headers
		.getSetCookie()
		.map((value) => value.split(';', 1)[0])
		.join('; ');
}

let session: string;

beforeAll(async () => {
	session = await signIn();
});

/** a policy as its directives, each name mapped to its source list. */
function directives(policy: string | null): Map<string, readonly string[]> {
	expect(policy).not.toBeNull();
	const parsed = new Map<string, readonly string[]>();
	for (const directive of (policy ?? '').split(';')) {
		const [name, ...sources] = directive.trim().split(/\s+/);
		if (name) parsed.set(name, sources);
	}
	return parsed;
}

/** the nonce the policy's `script-src` names. */
function policyNonce(policy: Map<string, readonly string[]>): string {
	const nonces = (policy.get('script-src') ?? []).flatMap((source) => {
		const found = /^'nonce-([^']+)'$/.exec(source);
		return found?.[1] === undefined ? [] : [found[1]];
	});
	expect(nonces).toHaveLength(1);
	return nonces[0] ?? '';
}

/** every `<script>` opening tag in a document. */
function scriptTags(html: string): string[] {
	return html.match(/<script\b[^>]*>/g) ?? [];
}

/**
 * what every document carries whichever policy it is drawn under: the directives no route widens,
 * the framing header, and the policy's nonce on every script the document draws.
 */
async function expectLocked(
	response: Response,
	policy: Map<string, readonly string[]>,
	nonce: string
): Promise<void> {
	expect(policy.get('object-src')).toEqual(["'none'"]);
	expect(policy.get('base-uri')).toEqual(["'none'"]);
	expect(policy.get('form-action')).toEqual(["'self'"]);
	expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
	expect(response.headers.get('x-frame-options')).toBe('DENY');

	const scripts = scriptTags(await response.text());
	expect(scripts.length).toBeGreaterThan(0);
	for (const tag of scripts) expect(tag).toContain(` nonce="${nonce}"`);
}

/** a document answer's policy and framing headers, held to the dashboard's strict set. */
async function expectStrictDocument(response: Response): Promise<void> {
	expect(response.status).toBe(200);
	expect(response.headers.get('content-type')).toMatch(/^text\/html/);

	const policy = directives(response.headers.get('content-security-policy'));
	const nonce = policyNonce(policy);
	expect(policy.get('default-src')).toEqual(["'self'"]);
	expect(policy.get('script-src')).toEqual(["'self'", `'nonce-${nonce}'`]);
	expect(policy.get('img-src')).toEqual(["'self'", 'data:']);
	expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
	expect(response.headers.get('referrer-policy')).toBe('same-origin');
	await expectLocked(response, policy, nonce);
}

describe('a dashboard document', () => {
	it('carries the strict policy, and its nonce is the one on every script it draws', async () => {
		await expectStrictDocument(await send('/admin', { headers: { cookie: session } }));
	});
});

describe('two documents', () => {
	it('are given different nonces', async () => {
		const nonces = await Promise.all(
			[send('/login'), send('/login')].map(async (answer) =>
				policyNonce(directives((await answer).headers.get('content-security-policy')))
			)
		);
		expect(nonces[0]).not.toBe(nonces[1]);
	});
});

describe('a sign-in document', () => {
	it('carries the strict policy, and its nonce is the one on every script it draws', async () => {
		await expectStrictDocument(await send('/login'));
	});
});

describe('the donor page', () => {
	// an id no form carries: the page draws its refusal, under the same route and so the same
	// policy as a form it can draw.
	const answer = () => send('/frm_nosuchform');

	it('allows the processors the card loads, and scripts only by origin or by the nonce', async () => {
		const response = await answer();
		expect(response.status).toBe(404);
		expect(response.headers.get('content-type')).toMatch(/^text\/html/);

		const policy = directives(response.headers.get('content-security-policy'));
		const nonce = policyNonce(policy);
		expect(policy.get('default-src')).toEqual(["'self'"]);
		expect(policy.get('script-src')).toEqual([
			"'self'",
			`'nonce-${nonce}'`,
			'https://js.stripe.com',
			'https://*.js.stripe.com',
			'https://www.paypal.com',
			'https://c.paypal.com',
			'https://cdn.givechariot.com',
			'https://challenges.cloudflare.com'
		]);
		expect(policy.get('connect-src')).toEqual([
			"'self'",
			'https://api.stripe.com',
			'https://www.paypal.com',
			'https://api-m.paypal.com',
			'https://c.paypal.com'
		]);
		expect(policy.get('frame-src')).toEqual([
			'https://js.stripe.com',
			'https://*.js.stripe.com',
			'https://hooks.stripe.com',
			'https://www.paypal.com',
			'https://history.paypal.com',
			'https://account.venmo.com',
			'https://secure.dafpay.com',
			'https://challenges.cloudflare.com'
		]);
		expect(policy.get('img-src')).toEqual([
			"'self'",
			'data:',
			'https://www.paypalobjects.com',
			'https://cdn.givechariot.com',
			'https://nowpayments.io'
		]);
		expect(policy.get('font-src')).toEqual(["'self'", 'https://cdn.givechariot.com']);
		expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
		expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		await expectLocked(response, policy, nonce);
	});

	it('lets no inline script run but by the nonce', async () => {
		const policy = directives((await answer()).headers.get('content-security-policy'));
		expect(policy.get('script-src')).not.toContain("'unsafe-inline'");
		expect(policy.get('script-src')).not.toContain("'unsafe-eval'");
		expect(policy.has('script-src-elem')).toBe(false);
		expect(policy.has('script-src-attr')).toBe(false);
	});
});

/** every header ./document-policy.ts sets on a document, none of which an endpoint's answer carries. */
const DOCUMENT_ONLY = ['content-security-policy', 'x-frame-options', 'referrer-policy'];

describe('an answer that is not a document', () => {
	// each is a resource route, whose `Response` react router hands back without calling
	// ./entry.server.tsx: the public api is read from integrators' pages and the webhook by a
	// processor, and a policy on either governs nothing.
	it('from the public api carries no policy', async () => {
		const response = await send('/api/v1/forms/frm_nosuchform/config', {
			headers: { origin: 'https://acme.org' }
		});
		expect(response.headers.get('content-type')).toMatch(/json/);
		for (const name of DOCUMENT_ONLY) expect(response.headers.has(name)).toBe(false);
	});

	it('from a processor webhook carries no policy', async () => {
		const response = await send('/api/stripe/webhook', { method: 'POST', body: '{}' });
		expect(response.status).toBeGreaterThanOrEqual(400);
		expect(response.headers.get('content-type') ?? '').not.toMatch(/html/);
		for (const name of DOCUMENT_ONLY) expect(response.headers.has(name)).toBe(false);
	});
});
