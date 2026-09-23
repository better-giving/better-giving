import { createExecutionContext, env } from 'cloudflare:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createStaticHandler, type LoaderFunction } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { CONNECT_LINK_LIFETIME_MS, mintConnectLink } from '$lib/server/accounting/connect-link';
import { INTUIT_AUTHORIZE_URL, QUICKBOOKS_PRODUCTION_URL } from '$lib/server/accounting/quickbooks';
import { requestContext } from '../request-context';
import * as connect from './quickbooks.connect';
import type { Route } from './+types/quickbooks.connect';

// the guarded way into Intuit's consent screen, answered inside workerd.
//
// a workers spec because the signing key the address is checked against is normally a row
// ($lib/server/auth/signing-key.ts) and the route resolves it the way the deployment does. what is
// asserted is the pair of answers this route has: a browser sent on to Intuit with a `state` it
// will be asked for on the way back, or a page saying the address is no longer good.
//
// the loader is run through react router's own matcher rather than called, so a refusal's status is
// read off the context the framework builds rather than off the shape `data()` returns — the same
// reason ./$formId.workers.spec.ts gives.

/** this deployment's signing key, set as the variable so a case can mint an address with it. */
const SECRET = 'a-signing-key-as-long-as-a-real-one-would-be';
const OWN = 'https://give.example.workers.dev';
/** the second hostname the same deployment answers on, and the one an operator pinned it to. */
const PINNED = 'https://donate.example.org';
/** the clock, because an address minted at a fixed date is expired by the time a case opens it. */
const NOW = new Date();

/** Intuit's app credentials as this deployment holds them, so the env is never what refuses. */
const INTUIT = {
	BETTER_AUTH_SECRET: SECRET,
	QUICKBOOKS_CLIENT_ID: 'ABCintuitClientId',
	QUICKBOOKS_CLIENT_SECRET: 'intuit-client-secret',
	QUICKBOOKS_API_URL: QUICKBOOKS_PRODUCTION_URL
};

/**
 * where Intuit's consent screen is, taken off the adapter rather than spelled.
 *
 * no Intuit address is written a second time anywhere in this repository
 * ($lib/server/accounting/sole-importer.spec.ts), and what this case is about is the route sending
 * the browser to the address the port builds — the address itself is that module's to pin.
 */
const INTUIT_CONSENT_ORIGIN = new URL(INTUIT_AUTHORIZE_URL).origin;

const ROUTE_ID = 'quickbooks-connect';
const handler = createStaticHandler([
	{ id: ROUTE_ID, path: 'quickbooks/connect', loader: connect.loader as unknown as LoaderFunction }
]);

/** the pool's env with this deployment's values, as a proxy rather than a copy. */
function envWith(values: Record<string, string | undefined>): Env {
	return new Proxy(env, {
		get: (target, property) =>
			typeof property === 'string' && property in values
				? values[property]
				: Reflect.get(target, property)
	}) as Env;
}

type LoaderData = Route.ComponentProps['loaderData'];

type Answered =
	| { readonly redirect: Response }
	| { readonly status: number; readonly data: LoaderData; readonly headers: Headers };

let link: string;

beforeAll(async () => {
	link = await mintConnectLink({ secret: SECRET, origin: OWN, now: NOW });
});

/** one address, opened. a redirect short-circuits the framework and comes back as the response. */
async function open(
	address: string,
	vars: Record<string, string | undefined> = INTUIT
): Promise<Answered> {
	const answered = await handler.query(new Request(address), {
		requestContext: requestContext(envWith(vars), createExecutionContext())
	});
	if (answered instanceof Response) return { redirect: answered };
	return {
		status: answered.statusCode,
		data: answered.loaderData[ROUTE_ID] as LoaderData,
		headers: answered.loaderHeaders[ROUTE_ID] ?? new Headers()
	};
}

/** the page drawn from what the loader handed it; the cast is the props react router injects. */
function markup(loaderData: LoaderData): string {
	return renderToStaticMarkup(
		createElement(connect.default, { loaderData } as unknown as Route.ComponentProps)
	);
}

/** an address whose expiry was pushed out without the signature being re-made. */
function altered(address: string): string {
	const url = new URL(address);
	url.searchParams.set('exp', String(NOW.getTime() + CONNECT_LINK_LIFETIME_MS * 10));
	return url.toString();
}

describe('GET /quickbooks/connect', () => {
	it('sends the browser to Intuit with a state it will be asked for on the way back', async () => {
		const answered = await open(link);
		if (!('redirect' in answered)) throw new Error(`no redirect: ${answered.status}`);

		const sent = new URL(answered.redirect.headers.get('location') ?? '');
		expect(sent.origin).toBe(INTUIT_CONSENT_ORIGIN);
		expect(sent.searchParams.get('client_id')).toBe(INTUIT.QUICKBOOKS_CLIENT_ID);
		expect(sent.searchParams.get('redirect_uri')).toBe(`${OWN}/quickbooks/callback`);

		const cookie = answered.redirect.headers.get('set-cookie') ?? '';
		expect(cookie).toContain(`=${sent.searchParams.get('state')};`);
		expect(cookie).toContain('HttpOnly');
	});

	// the same value the callback exchanges against, and Intuit compares the two byte for byte —
	// so a deployment answering on a second hostname sends the address it registered rather than
	// whichever one this browser opened.
	it('sends the address this deployment is pinned to as the one to come back to', async () => {
		const answered = await open(link, { ...INTUIT, BETTER_AUTH_URL: PINNED });
		if (!('redirect' in answered)) throw new Error(`no redirect: ${answered.status}`);

		const sent = new URL(answered.redirect.headers.get('location') ?? '');
		expect(sent.searchParams.get('redirect_uri')).toBe(`${PINNED}/quickbooks/callback`);
	});

	it('refuses an address whose expiry was pushed out', async () => {
		const answered = await open(altered(link));
		if ('redirect' in answered) throw new Error('an altered address was honoured');

		expect(answered.status).toBe(403);
		expect(answered.data.refusal).toBe('link');
		expect(answered.headers.get('set-cookie')).toBeNull();
		const page = markup(answered.data);
		expect(page).toContain('This link has expired');
		expect(page).toContain('Press Choose a company on the console for a new one.');
	});

	it('refuses an address carrying no signature at all', async () => {
		const bare = new URL(link);
		bare.searchParams.delete('sig');
		const answered = await open(bare.toString());
		if ('redirect' in answered) throw new Error('an unsigned address was honoured');

		expect(answered.status).toBe(403);
	});

	it('names the value to set where this deployment holds no Intuit client id', async () => {
		const answered = await open(link, { ...INTUIT, QUICKBOOKS_CLIENT_ID: undefined });
		if ('redirect' in answered) throw new Error('a deployment with no client id redirected');

		expect(answered.status).toBe(409);
		expect(answered.data.refusal).toBe('setup');
		const page = markup(answered.data);
		expect(page).toContain('This deployment has no QuickBooks credentials');
		expect(page).toContain(
			'Put your Intuit app’s credentials in on the console, then press Choose a company.'
		);
	});
});
