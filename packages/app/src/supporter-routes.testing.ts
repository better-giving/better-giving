import {
	createStaticHandler,
	isRouteErrorResponse,
	type LoaderFunction,
	type MiddlewareFunction
} from 'react-router';
import { eq } from 'drizzle-orm';
import type { Db } from '$lib/server/db/client';
import { client, run, stmt } from '$lib/server/db/database.testing';
import { supporterPage } from '$lib/server/db/schema';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { createDeferredWork, type DeferredWork } from '$lib/server/runtime/deferred';
import { specRateLimiters } from '$lib/server/runtime/rate-limiter.testing';
import { emptySupporterTables } from '$lib/server/supporters/fundraiser.testing';
import { requestContext } from './request-context';
import { queryDocument } from './route-request.testing';
import { deployed, freshDeployment, ORIGIN } from './webhook-routes.testing';
import * as fundraiserPage from './routes/f.$slug';
import * as start from './routes/fundraise._index';
import * as open from './routes/fundraise.open';

// what the supporter route specs share: a deployment set up to take a gift, the routes under
// /fundraise called in-process as the server runtime calls them, a browser's cookie jar, and the
// public fundraiser page drawn through its meter. here rather than beside the routes for
// ./webhook-routes.testing.ts's reason: every file directly under ./routes/ is an address to
// `flatRoutes`, bar a spec.
//
// the supporter routes mount no middleware, so their `loader` and `action` are called directly with
// the context ./request-context.ts seeds, and a thrown redirect or 404 is the answer as the runtime
// would send it. the public page and /admin carry middleware, and go through react router's own
// handler (./route-request.testing.ts).

export { ORIGIN };

/** the ALTCHA payload the spec issuer clears; any other is refused as a rejected solution. */
export const SOLVED = 'solved-altcha-payload';

/** the limiters every request in one case charges, refilled by `freshSupporterDeployment`. */
let limiters = specRateLimiters();

/**
 * a deployment's bindings, Stripe's webhook secret among them so a served config takes a gift,
 * with an ALTCHA issuer that clears `SOLVED` and nothing else, on this case's limiters.
 */
export function supporterEnv(): Env {
	return {
		...deployed(),
		...limiters,
		STRIPE_WEBHOOK_SECRET: 'whsec_abc',
		ALTCHA: {
			challenge: async () => {
				throw new Error('no spec asks the issuer for a challenge');
			},
			verify: async (payload: string | undefined) =>
				payload === SOLVED
					? { ok: true }
					: { ok: false, reason: 'rejected', detail: 'not solved', operatorFix: null }
		}
	} as Env;
}

/**
 * every table these specs write emptied, the limiters full, and an organisation set up to take a
 * gift, with its served cadences kept so no read sends the fixture Stripe key anywhere.
 */
export async function freshSupporterDeployment(): Promise<void> {
	limiters = specRateLimiters();
	await emptySupporterTables();
	await freshDeployment();
	await run(
		stmt(`update org_profile set deductibility_statement = 'No goods or services were provided.'`)
	);
	await edgeCache().put(
		new Request(`${ORIGIN}/__recurring-cadences`),
		new Response(JSON.stringify(['one_time']), {
			headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
		})
	);
}

let callers = 0;

/** a request from an address of its own, so no case spends another's limiter bucket. */
export function request(
	path: string,
	init: { method?: string; cookie?: string; body?: FormData } = {}
): Request {
	callers += 1;
	const headers = new Headers({
		[CLIENT_IP_HEADER]: `198.51.100.${callers % 250}`,
		'sec-fetch-site': 'same-origin',
		origin: ORIGIN
	});
	if (init.cookie) headers.set('cookie', init.cookie);
	return new Request(`${ORIGIN}${path}`, {
		method: init.method ?? (init.body ? 'POST' : 'GET'),
		headers,
		...(init.body ? { body: init.body } : {})
	});
}

/** a form body, one key per box. */
export function form(fields: Record<string, string>): FormData {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) body.append(name, value);
	return body;
}

/** what a handler answered, as the runtime would send it. */
export type Answer = {
	readonly status: number;
	readonly headers: Headers;
	readonly location: string | null;
	/** the value a page is drawn from, or a response's body read as JSON where it is one. */
	readonly data: unknown;
};

type Handler = (args: never) => unknown;

/** a `data()` value, which carries its status and headers beside the value. */
function isDataWithInit(
	value: unknown
): value is { data: unknown; init: ResponseInit | null } & { type: 'DataWithResponseInit' } {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { type?: unknown }).type === 'DataWithResponseInit'
	);
}

async function answerOf(value: unknown): Promise<Answer> {
	if (value instanceof Response) {
		const text = await value.text();
		let data: unknown = text;
		try {
			data = JSON.parse(text);
		} catch {
			// a body that is no JSON is answered as its text.
		}
		return {
			status: value.status,
			headers: value.headers,
			location: value.headers.get('location'),
			data
		};
	}
	if (isDataWithInit(value)) {
		const headers = new Headers(value.init?.headers);
		return {
			status: value.init?.status ?? 200,
			headers,
			location: headers.get('location'),
			data: value.data
		};
	}
	if (isRouteErrorResponse(value)) {
		return { status: value.status, headers: new Headers(), location: null, data: value.data };
	}
	return { status: 200, headers: new Headers(), location: null, data: value };
}

/** the deferred work the last call handed on, to wait for a link's mail. */
export let lastWork: DeferredWork = createDeferredWork();

/** one call of a route module's `loader` or `action`, a throw answered as the runtime answers it. */
export async function call(
	handler: Handler,
	at: Request,
	params: Record<string, string> = {},
	env: Env = supporterEnv()
): Promise<Answer> {
	lastWork = createDeferredWork();
	const args = {
		request: at,
		params,
		url: new URL(at.url),
		pattern: '',
		context: requestContext({ env, deferred: lastWork, client })
	};
	try {
		return await answerOf(await (handler as (args: unknown) => unknown)(args));
	} catch (thrown) {
		if (thrown instanceof Response || isDataWithInit(thrown) || isRouteErrorResponse(thrown)) {
			return answerOf(thrown);
		}
		throw thrown;
	}
}

/** a browser's cookies: each `Set-Cookie` an answer carries kept, and one cleared dropped. */
export function cookieJar() {
	const held = new Map<string, string>();
	return {
		take(answer: Answer): void {
			for (const line of answer.headers.getSetCookie()) {
				const [pair = '', ...attributes] = line.split(';');
				const at = pair.indexOf('=');
				const name = pair.slice(0, at).trim();
				const cleared = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
				if (cleared || pair.slice(at + 1) === '') held.delete(name);
				else held.set(name, pair.slice(at + 1));
			}
		},
		header(): string {
			return [...held].map(([name, value]) => `${name}=${value}`).join('; ');
		},
		has(name: string): boolean {
			return held.has(name);
		}
	};
}

/** a donor page's route module, as react router mounts it: its meter, then its loader. */
type DonorPageModule = { readonly middleware: unknown; readonly loader: unknown };

/** a donor page at `pattern`, asked for at `path` as a browser asks, through the page's meter. */
export async function visitDonorPage(
	module: DonorPageModule,
	pattern: string,
	path: string
): Promise<{ status: number; data: { kind: string } & Record<string, unknown> }> {
	const handler = createStaticHandler([
		{
			id: 'page',
			path: pattern,
			middleware: module.middleware as MiddlewareFunction[],
			loader: module.loader as LoaderFunction
		}
	]);
	const drawn = await queryDocument(
		handler,
		request(path),
		requestContext({ env: supporterEnv(), deferred: createDeferredWork(), client })
	);
	return {
		status: drawn.statusCode,
		data: drawn.loaderData.page as { kind: string } & Record<string, unknown>
	};
}

/** `/f/{slug}`, as a donor's browser asks for it. */
export function visitFundraiser(slug: string) {
	return visitDonorPage(fundraiserPage, 'f/:slug', `/f/${slug}`);
}

/** the token a mailed link carries, read off the message's text. */
export function tokenIn(text: string): string {
	const found = /\/fundraise\/open\?token=([A-Za-z0-9_-]+)/.exec(text);
	if (!found?.[1]) throw new Error(`no sign-in link in: ${text}`);
	return found[1];
}

/** Start a fundraiser as a person fills it in, the challenge solved. */
export const STARTED = {
	intent: 'start',
	name: 'Maya Rivera',
	email: 'Maya@Example.org',
	title: 'Run for the shelter',
	goal: '500',
	story: 'I am running 10k for the shelter.',
	challenge: SOLVED
};

/** a start posted from a browser holding `jar`, with its confirm link's mail waited for. */
export async function postStart(jar: ReturnType<typeof cookieJar>, fields = STARTED) {
	const answer = await call(start.action, request('/fundraise', { body: form(fields) }));
	jar.take(answer);
	await lastWork.settled();
	return answer;
}

/**
 * a fundraiser started and its confirm link, the newest in `mailed`, opened: the supporter's
 * browser, the page, and its address and settings row.
 */
export async function liveFundraiser(
	db: Db,
	mailed: readonly { readonly text: string }[],
	fields = STARTED
) {
	const browser = cookieJar();
	await postStart(browser, fields);
	const token = tokenIn(mailed.at(-1)?.text ?? '');
	const opened = await call(open.loader, request(`/fundraise/open?token=${token}`));
	browser.take(opened);
	const pageId = opened.location?.split('/').at(-1) ?? '';
	const [row] = await db
		.select({ formId: supporterPage.formId, slug: supporterPage.slug })
		.from(supporterPage)
		.where(eq(supporterPage.id, pageId));
	if (!row) throw new Error('the fundraiser was not written');
	return { browser, pageId, token, ...row };
}
