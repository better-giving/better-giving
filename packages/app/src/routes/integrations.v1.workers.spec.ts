import { createExecutionContext, env } from 'cloudflare:test';
import { createRequestHandler, type ServerBuild } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { mintApiKey } from '$lib/server/integrations/keys';
import * as entryServer from '../entry.server';
import { requestContext } from '../request-context';
import { mountRoutes } from '../route-request.testing';
import * as surface from './integrations.v1';
import * as unserved from './integrations.v1.$';
import * as gifts from './integrations.v1.gifts';

// the addresses under `/integrations/v1` that no list answers: a path beneath the surface that no
// route serves, and react router's own `.data` address for a list. each is answered by the surface
// as JSON, behind the same key check as the lists.
//
// the `.data` cases go through `createRequestHandler`, the call ../worker.ts makes, because which
// requests take react router's single-fetch path is its server runtime's decision and not the
// route's: `queryRoute` (../route-request.testing.ts) never takes it. the build is assembled from
// the real modules, as ../entry.server.workers.spec.ts assembles its own.

const OWN = 'https://give.example.workers.dev';

let db: Db;
let caller = 0;
const address = () => `203.0.113.${caller}`;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from api_key').run();
	caller += 1;
});

async function keyed(): Promise<RequestInit> {
	const { key } = await mintApiKey(db, { name: 'CRM sync', kind: 'api' });
	return { headers: { authorization: `Bearer ${key}`, 'cf-connecting-ip': address() } };
}

type Refusal = { error: string; message: string; fix: string };

const surfaceRoute = mountRoutes([
	{ path: 'integrations/v1', module: surface },
	{ path: '*', module: unserved }
]);

describe('a path under the surface that no list serves', () => {
	it.each(['/integrations/v1/gifts/0192f000-0000-7000-8000-000000000001', '/integrations/v1/gift'])(
		'answers %s with a JSON 404 naming it and the lists',
		async (path) => {
			const response = await surfaceRoute(new Request(`${OWN}${path}`, await keyed()));

			expect(response.status).toBe(404);
			expect(response.headers.get('cache-control')).toBe('no-store');
			const body = (await response.json()) as Refusal;
			expect(body.error).toBe('not_found');
			expect(body.message).toContain(`\`${path}\``);
			expect(body.fix).toContain('GET /integrations/v1/gifts');
			expect(body.fix).toContain('GET /integrations/v1/donors');
			expect(body.fix).toContain('GET /integrations/v1/recurring-gifts');
		}
	);

	it('checks the key first', async () => {
		const response = await surfaceRoute(
			new Request(`${OWN}/integrations/v1/gift`, { headers: { 'cf-connecting-ip': address() } })
		);

		expect(response.status).toBe(401);
		expect(((await response.json()) as Refusal).error).toBe('missing_key');
	});
});

type RouteModule = NonNullable<ServerBuild['routes'][string]>['module'];

/**
 * a route module in the manifest's slot: the variance ../route-request.testing.ts's `MountedRoute`
 * describes, and a resource route has no `default` for the slot's type to find.
 */
const slotted = (module: object) => module as RouteModule;

const handle = createRequestHandler(
	{
		entry: { module: entryServer },
		routes: {
			'routes/integrations.v1': {
				id: 'routes/integrations.v1',
				path: 'integrations/v1',
				module: slotted(surface)
			},
			'routes/integrations.v1.gifts': {
				id: 'routes/integrations.v1.gifts',
				parentId: 'routes/integrations.v1',
				path: 'gifts',
				module: slotted(gifts)
			},
			'routes/integrations.v1.$': {
				id: 'routes/integrations.v1.$',
				parentId: 'routes/integrations.v1',
				path: '*',
				module: slotted(unserved)
			}
		},
		assets: {
			entry: { module: '/assets/entry.client.js', imports: [] },
			routes: {},
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
	},
	'production'
);

function send(path: string, init: RequestInit): Promise<Response> {
	return handle(new Request(`${OWN}${path}`, init), requestContext(env, createExecutionContext()));
}

describe('a list asked for at react router’s own `.data` address', () => {
	it('is the list itself at its own address, through the same handler', async () => {
		const response = await send('/integrations/v1/gifts', await keyed());

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ data: [] });
	});

	it.each([
		'/integrations/v1/gifts.data',
		'/integrations/v1/gifts.data?_routes=routes/integrations.v1.gifts'
	])('answers %s with a JSON 404 that no cache keeps', async (path) => {
		const response = await send(path, await keyed());

		expect(response.status).toBe(404);
		expect(response.headers.get('content-type')).toMatch(/^application\/json/);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const body = (await response.json()) as Refusal;
		expect(body.error).toBe('not_found');
		expect(body.message).toContain('`/integrations/v1/gifts.data`');
		expect(body.fix).toContain('GET /integrations/v1/gifts');
	});

	it('checks the key first', async () => {
		const response = await send('/integrations/v1/gifts.data', {
			headers: { 'cf-connecting-ip': address() }
		});

		expect(response.status).toBe(401);
		expect(response.headers.get('content-type')).toMatch(/^application\/json/);
	});
});
