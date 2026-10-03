import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { createDb } from '$lib/server/db/client';
import { contact, donation, payment } from '$lib/server/db/schema';
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
	for (const table of ['api_key', 'payment', 'donation', 'contact'])
		await env.DB.prepare(`delete from ${table}`).run();
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

	it('names the pinned origin where the deployment pins one, whatever host it was asked at', async () => {
		const pinned = { ...env, BETTER_AUTH_URL: 'https://donate.example.org/' };

		const document = (await (
			await openapiRoute(new Request(`${OWN}/integrations/openapi.json`), { env: pinned })
		).json()) as { servers: { url: string }[] };
		const text = await (
			await promptRoute(new Request(`${OWN}/integrations/agent-prompt.md`), { env: pinned })
		).text();

		expect(document.servers[0]?.url).toBe('https://donate.example.org/integrations/v1');
		expect(text).toContain('https://donate.example.org/integrations/v1');
		expect(text).not.toContain(OWN);
	});

	it('may be cached by anyone for five minutes, and read from any page', async () => {
		const response = await openapiRoute(new Request(`${OWN}/integrations/openapi.json`));

		expect(response.headers.get('cache-control')).toBe('public, max-age=300');
		expect(response.headers.get('access-control-allow-origin')).toBe('*');
	});

	it('names https when asked over plain http, so no key is sent in the clear', async () => {
		const plain = OWN.replace('https:', 'http:');
		const response = await openapiRoute(new Request(`${plain}/integrations/openapi.json`));
		const document = (await response.json()) as { servers: { url: string }[] };

		expect(document.servers[0]?.url).toBe(`${OWN}/integrations/v1`);
	});
});

describe('GET /integrations/agent-prompt.md', () => {
	it('serves the prompt as markdown without a key, naming the address it was asked at', async () => {
		const response = await promptRoute(new Request(`${OWN}/integrations/agent-prompt.md`));

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('public, max-age=300');
		expect(response.headers.get('access-control-allow-origin')).toBe('*');
		expect(await response.text()).toContain(`${OWN}/integrations/openapi.json`);
	});

	it('names https when asked over plain http', async () => {
		const plain = OWN.replace('https:', 'http:');
		const text = await (
			await promptRoute(new Request(`${plain}/integrations/agent-prompt.md`))
		).text();

		expect(text).toContain(`${OWN}/integrations/v1/gifts`);
		expect(text).not.toContain(plain);
	});
});

describe('the keyed surface beside them', () => {
	it('still refuses a request that presents no key', async () => {
		const response = await giftsRoute(
			new Request(`${OWN}/integrations/v1/gifts`, { headers: { 'cf-connecting-ip': address() } })
		);

		expect(response.status).toBe(401);
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
		expect(((await response.json()) as { error: string }).error).toBe('missing_key');
	});
});

describe('the prompt, followed as written', () => {
	it('reads a page of gifts with a key the developer exported, and nothing else', async () => {
		const db = createDb(env.DB);
		const { key } = await mintApiKey(db, { name: 'Agent', kind: 'api' });
		const giftId = await seedGift();
		const text = await (
			await promptRoute(new Request(`${OWN}/integrations/agent-prompt.md`))
		).text();

		// the developer's export, as the prompt spells it, with the key in place of its placeholder.
		const exported = /export ([A-Z_]+)=bgk_…/.exec(text)?.[1];
		expect(exported).toBeDefined();
		const shell: Record<string, string> = { [exported ?? '']: key };
		// the one curl line the prompt gives, taken apart and expanded as a shell would.
		const curl = /^curl -H "([^"]+)" "([^"]+)"$/m.exec(text);
		expect(curl).not.toBeNull();
		const [, header = '', url = ''] = curl ?? [];
		const [name = '', value = ''] = header
			.replace(/\$([A-Z_]+)/g, (_, variable: string) => shell[variable] ?? '')
			.split(/:\s*/, 2);
		const response = await giftsRoute(
			new Request(url, { headers: { [name]: value, 'cf-connecting-ip': address() } })
		);

		expect(url).toBe(`${OWN}/integrations/v1/gifts`);
		expect(response.status).toBe(200);
		const page = (await response.json()) as { data: { id: string }[] };
		expect(page.data.map((gift) => gift.id)).toEqual([giftId]);
	});
});

/** a settled $50 cheque from Ada Okafor, and its id. */
async function seedGift(): Promise<string> {
	const db = createDb(env.DB);
	const contactId = uuidv7();
	const donationId = uuidv7();
	const paymentId = uuidv7();
	const at = new Date('2026-09-10T12:00:00.000Z');
	await db.batch([
		db.insert(contact).values({ id: contactId, kind: 'individual', displayName: 'Ada Okafor' }),
		db
			.insert(donation)
			.values({ id: donationId, contactId, totalMinor: 5_000, currency: 'USD', receivedAt: at }),
		db.insert(payment).values({
			id: paymentId,
			donationId,
			amountMinor: 5_000,
			currency: 'USD',
			direction: 'inbound',
			method: 'check',
			status: 'succeeded',
			provider: 'manual',
			occurredAt: at
		})
	]);
	return paymentId;
}
