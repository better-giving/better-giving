import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '$lib/server/db/client';
import { mintApiKey } from '$lib/server/integrations/keys';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as prompt from './integrations.agent-prompt[.]md';
import * as openapi from './integrations.openapi[.]json';
import * as surface from './integrations.v1';
import * as gifts from './integrations.v1.gifts';

// the read API's two documents — the OpenAPI file and the agent prompt — served without a key, and
// the keyed surface beside them still refusing a request that presents none.
//
// the last case is the prompt's own promise, kept: an agent handed only the prompt and a key reads
// a page of gifts, by running the curl line the prompt gives it, as written.

const OWN = 'https://give.example.workers.dev';

const openapiRoute: RouteRequester = mountRoutes([
	{ path: 'integrations/openapi.json', module: openapi }
]);
const promptRoute: RouteRequester = mountRoutes([
	{ path: 'integrations/agent-prompt.md', module: prompt }
]);
const giftsRoute: RouteRequester = mountRoutes([
	{ path: 'integrations/v1', module: surface },
	{ path: 'gifts', module: gifts }
]);

/** a fresh address per case: the read API charges each request to its address. */
let caller = 0;
const address = () => `192.0.2.${caller}`;

beforeEach(async () => {
	await env.DB.prepare('delete from api_key').run();
	caller += 1;
});

describe('GET /integrations/openapi.json', () => {
	it('serves the document without a key, naming the address it was asked at', async () => {
		const response = await openapiRoute(new Request(`${OWN}/integrations/openapi.json`));

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toMatch(/^application\/json/);
		const document = (await response.json()) as { openapi: string; servers: { url: string }[] };
		expect(document.openapi).toBe('3.1.0');
		expect(document.servers[0]?.url).toBe(`${OWN}/integrations/v1`);
	});

	it('may be cached by anyone for five minutes', async () => {
		const response = await openapiRoute(new Request(`${OWN}/integrations/openapi.json`));

		expect(response.headers.get('cache-control')).toBe('public, max-age=300');
	});
});

describe('GET /integrations/agent-prompt.md', () => {
	it('serves the prompt as markdown without a key, naming the address it was asked at', async () => {
		const response = await promptRoute(new Request(`${OWN}/integrations/agent-prompt.md`));

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('public, max-age=300');
		expect(await response.text()).toContain(`${OWN}/integrations/openapi.json`);
	});
});

describe('the keyed surface beside them', () => {
	it('still refuses a request that presents no key', async () => {
		const response = await giftsRoute(
			new Request(`${OWN}/integrations/v1/gifts`, { headers: { 'cf-connecting-ip': address() } })
		);

		expect(response.status).toBe(401);
		expect(((await response.json()) as { error: string }).error).toBe('missing_key');
	});
});

describe('the prompt, followed as written', () => {
	it('reads a page of gifts with a key and nothing else', async () => {
		const { key } = await mintApiKey(createDb(env.DB), { name: 'Agent', kind: 'api' });
		const text = await (
			await promptRoute(new Request(`${OWN}/integrations/agent-prompt.md`))
		).text();

		// the one curl line the prompt gives, taken apart as a shell would read it.
		const curl = /^curl -H "([^"]+)" "([^"]+)"$/m.exec(text);
		expect(curl).not.toBeNull();
		const [, header = '', url = ''] = curl ?? [];
		const [name = '', value = ''] = header.split(/:\s*/, 2);
		const shellVariable = /\$([A-Z_]+)/.exec(value)?.[1] ?? '';
		const response = await giftsRoute(
			new Request(url, {
				headers: { [name]: value.replace(`$${shellVariable}`, key), 'cf-connecting-ip': address() }
			})
		);

		expect(url).toBe(`${OWN}/integrations/v1/gifts`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: [],
			next_cursor: null,
			resume_updated_since: null
		});
	});
});
