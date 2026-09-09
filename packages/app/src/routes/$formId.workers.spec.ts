import { createExecutionContext, env } from 'cloudflare:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createStaticHandler, type LoaderFunction } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NO_FORM } from '$lib/donate/copy';
import { requestContext } from '../request-context';
import * as donorPage from './$formId';
import type { Route } from './+types/$formId';

// the donor's page, against the real D1 the pool binds.
//
// a workers spec because every answer this route gives is decided from rows — the form and the
// organisation's profile — and standing in for D1 would only prove the stand-in (CLAUDE.md).
//
// the loader is run through react router's own matcher rather than called, so `:formId` is bound
// the way the deployment binds it and the status a refusal carries is read off the context the
// framework builds rather than off the shape `data()` returns. ../route-request.testing.ts is not
// used here for the reason ./login.workers.spec.ts states: `queryRoute` answers with a handler's
// value and drops a `data()`'s status, which is the whole of what a refusal on this route carries.
// no `middleware` sits above this file, so nothing is skipped by not mounting a chain.
//
// the document itself is not assembled here. what a donor reads is the route's own two halves —
// the tree the component renders and the tab `meta` names — and ../root.tsx's `Layout` is what puts
// them in a `<head>` and a `<body>`; a spec that rebuilt that would be asserting against its own
// copy of the framework. which addresses reach this route at all is ../routes.spec.ts's, against
// the app's own route config.

/** the form these cases read, written by this file: no migration seeds one. */
const FORM_ID = 'frm_donorpage000001';

/** the one site the form names, which nothing on this page may hand to a browser. */
const ALLOWED = 'https://acme.org';

/** this deployment's own origin, which every request in this file is made to. */
const OWN = 'https://give.example.workers.dev';

/** a deployment whose Stripe pair is set and agrees, so the env is never what refuses. */
const STRIPE = {
	STRIPE_SECRET_KEY: 'sk_test_abc',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
	STRIPE_WEBHOOK_SECRET: 'whsec_abc'
};

/** the smaller of the two suggested amounts, as the card offers it: whole units, no cents. */
const PRESET = '$25';

let revenueAccountId: string;

beforeAll(async () => {
	const row = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	if (!row)
		throw new Error(
			'no 4110 account — has the chart of accounts in migrations/0000_initial_schema.sql moved?'
		);
	revenueAccountId = row.id;
});

beforeEach(async () => {
	await env.DB.prepare('delete from form').run();
	await env.DB.prepare('delete from org_profile').run();
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins,
		                   created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[2500,5000]', ?, 0, 0)`
	)
		.bind(FORM_ID, revenueAccountId, JSON.stringify([ALLOWED]))
		.run();
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, deductibility_statement,
		                          created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789',
		         'No goods or services were provided in exchange for this gift.', 0, 0)`
	).run();
	await warmCadences();
});

/**
 * the address the served cadences are kept under, which every case here writes before it reads.
 *
 * how often a gift may repeat comes off this deployment's processor account, and the loader reaches
 * it through the edge cache ($lib/server/forms/cadence-cache.ts). warming it is what keeps every
 * case below inside workerd: a cold entry would send the read to Stripe with the fixture key above,
 * which is a case that passes or fails on somebody else's uptime.
 */
const CADENCE_KEY = new Request(`${OWN}/__recurring-cadences`);
const CACHED_CADENCES = ['one_time', 'yearly'];

/** the zone's own store, which the ambient `CacheStorage` type has no name for. */
const edge = (globalThis as unknown as { caches: { default: Cache } }).caches.default;

async function warmCadences(): Promise<void> {
	await edge.put(
		CADENCE_KEY,
		new Response(JSON.stringify(CACHED_CADENCES), {
			headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
		})
	);
}

/**
 * the pool's env with the deploy-time values a case wants set, as a proxy rather than a copy:
 * `env` is the runtime's own object and spreading it would keep only whichever of its members
 * happen to be enumerable — the D1 binding among the ones at risk.
 */
function envWith(values: Record<string, string>): Env {
	return new Proxy(env, {
		get: (target, property) =>
			typeof property === 'string' && property in values
				? values[property]
				: Reflect.get(target, property)
	}) as Env;
}

/** the route, mounted at the path ../routes.spec.ts holds it to, under an id a case can read by. */
const ROUTE_ID = 'donor-page';
const handler = createStaticHandler([
	{ id: ROUTE_ID, path: ':formId', loader: donorPage.loader as unknown as LoaderFunction }
]);

/** what the component is handed: the loader's value with a `data()` already unwrapped from it. */
type LoaderData = Route.ComponentProps['loaderData'];

/** one address, answered: the status the framework settled on, the data, and the headers with it. */
async function visit(
	path: string,
	vars: Record<string, string> = STRIPE
): Promise<{ status: number; data: LoaderData; headers: Headers }> {
	const answered = await handler.query(new Request(`${OWN}${path}`), {
		requestContext: requestContext(envWith(vars), createExecutionContext())
	});
	if (answered instanceof Response) {
		throw new Error(`the loader short-circuited with a ${answered.status}`);
	}
	return {
		status: answered.statusCode,
		data: answered.loaderData[ROUTE_ID] as LoaderData,
		headers: answered.loaderHeaders[ROUTE_ID] ?? new Headers()
	};
}

/**
 * the page's own tree, rendered from what the loader handed it.
 *
 * the cast is the props react router injects around a route component — `params`, `matches` and the
 * rest — none of which this component reads. it is stated once here rather than at every case.
 */
function markup(loaderData: LoaderData): string {
	return renderToStaticMarkup(
		createElement(donorPage.default, { loaderData } as unknown as Route.ComponentProps)
	);
}

/** the tab, which is the other half of what a donor is shown and is not in the tree above. */
function title(loaderData: LoaderData): unknown {
	return donorPage.meta({ loaderData } as unknown as Route.MetaArgs);
}

describe('GET /{form_id}', () => {
	it('draws the card with the organisation above it', async () => {
		const answered = await visit(`/${FORM_ID}`);
		expect(answered.status).toBe(200);
		expect(markup(answered.data)).toContain('<h1 class="org-name">Hope Foundation</h1>');
	});

	it('names the organisation in the tab', async () => {
		const answered = await visit(`/${FORM_ID}`);
		expect(title(answered.data)).toEqual([{ title: 'Donate to Hope Foundation' }]);
	});

	// the whole reason the config is read server-side: a donor's first paint carries the amounts
	// rather than a skeleton the client fills in.
	it('has the offered amounts in the html before anything hydrates', async () => {
		const answered = await visit(`/${FORM_ID}`);
		expect(markup(answered.data)).toContain(PRESET);
	});

	// this page is the card rather than a host for the embedded element: no runtime is fetched and
	// no custom element is defined, so nothing here goes through `/embed.js`.
	it('loads no embed and defines no custom element', async () => {
		const answered = await visit(`/${FORM_ID}`);
		const html = markup(answered.data);
		expect(html).not.toContain('embed.js');
		expect(html).not.toContain('bg-donate');
		expect(html).not.toContain('customElements');
	});

	/**
	 * the served config and never the row it was read from.
	 *
	 * `readPublishedConfig` carries the `form` record out beside the config so the api endpoint can
	 * build its CORS headers from `allowed_origins` without a second query. a loader's return value
	 * is serialized into the document, so handing that record on would publish the list of sites
	 * this organisation's forms may be used on to anyone who opens the donation page.
	 */
	it('hands the browser the served config and not the form record', async () => {
		const answered = await visit(`/${FORM_ID}`);
		expect(JSON.stringify(answered.data)).not.toContain(ALLOWED);
	});
});

describe('an address that opens no form', () => {
	it('draws the notice for an id this deployment does not have', async () => {
		const answered = await visit('/frm_nosuchform00001');
		expect(answered.status).toBe(404);
		expect(markup(answered.data)).toContain(NO_FORM);
	});

	/**
	 * and for the requests every host on the internet receives whether or not anyone linked them.
	 *
	 * they are refused by the address guard before any row is read, which is what keeps a scanner's
	 * dictionary from being a query per entry against this deployment's database.
	 */
	it.each(['/.env', '/wp-login.php', '/favicon.png'])('draws it for %s too', async (path) => {
		const answered = await visit(path);
		expect(answered.status).toBe(404);
		expect(markup(answered.data)).toContain(NO_FORM);
	});

	// the amounts are in the html, so a cached document is a stale form. the edge cache in front of
	// the served config covers that endpoint alone.
	it('lets nothing keep the refusal', async () => {
		const answered = await visit('/frm_nosuchform00001');
		expect(answered.headers.get('cache-control')).toBe('no-store');
	});

	it('names nobody in the tab', async () => {
		const answered = await visit('/frm_nosuchform00001');
		expect(title(answered.data)).toEqual([{ title: 'Donate' }]);
	});

	/**
	 * a form this deployment holds but may not serve draws the same notice.
	 *
	 * every refusal `readPublishedConfig` states is written for an integrator reading a 4xx body,
	 * and this page's reader is a donor holding a link — so the ladder decides whether there is a
	 * card and says nothing else out here. the statuses those refusals carry on the wire are
	 * ./api.v1.forms.$id.config.ts's and stay there.
	 */
	it('draws it for a form that is still a draft', async () => {
		await env.DB.prepare(`update form set status = 'draft' where id = ?`).bind(FORM_ID).run();
		const answered = await visit(`/${FORM_ID}`);
		expect(answered.status).toBe(404);
		expect(markup(answered.data)).toContain(NO_FORM);
	});

	// the deployment is unfinished rather than the link wrong, and the donor is told the same thing
	// either way: there is nothing they can do about which of the two it is.
	it('draws it where the organisation has saved no details', async () => {
		await env.DB.prepare('delete from org_profile').run();
		const answered = await visit(`/${FORM_ID}`);
		expect(answered.status).toBe(404);
		expect(markup(answered.data)).toContain(NO_FORM);
	});
});
