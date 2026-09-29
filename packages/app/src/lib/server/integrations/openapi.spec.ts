import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { WEBHOOK_EVENT_TYPES, WEBHOOK_TEST_TYPE } from '../../webhooks/catalog';
import type { PinReading } from '../auth';
import {
	DESTINATION_PAUSE_AFTER_MS,
	PAUSED_AT_ONCE_ON,
	WEBHOOK_POST_TIMEOUT_MS,
	WEBHOOK_RETRY_SCHEDULE_MS
} from '../webhooks/deliver';
import { signedHeaders } from '../webhooks/sign';
import { readWranglerConfig } from '../wrangler-config.testing';
import officialSchema from './oas-3.1-schema.testing.json';
import { openApiDocument, publishedOrigin, spokenDuration } from './openapi';
import { componentValidator } from './openapi.testing';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_CEILING, PARAMETERS } from './paging';
import { INTEGRATIONS_BASE_PATH, INTEGRATIONS_LISTS, INTEGRATIONS_REFUSALS } from './surface';

// the OpenAPI document ./openapi.ts builds, held to the OpenAPI 3.1 schema.
//
// ./oas-3.1-schema.testing.json is the schema the OpenAPI Initiative publishes at
// https://spec.openapis.org/oas/3.1/schema/2022-10-07, vendored byte for byte but for biome's
// formatting, under the Apache-2.0 licence THIRD_PARTY_NOTICES.md at the repository root carries. it
// checks the document's own shape and leaves each Schema Object to its dialect, so every
// component and webhook schema is compiled here as JSON Schema 2020-12 as well.
//
// and it is held to what it describes: the list routes that exist, the event catalog, the retry
// schedule and pause the delivery run reads, and the limits wrangler.jsonc binds. each of those
// changed on one side only is a case below that fails.
//
// ajv 8 resolves the schema's `$dynamicRef: "#meta"` against the whole document rather than the
// one `$dynamicAnchor: meta` it declares (`$defs/schema`), and so reads every Schema Object as an
// OpenAPI document. with that the only anchor and no dialect extending it, the reference is
// that one definition, and `asStaticRefs` spells it as the static `$ref` it resolves to.

const ORIGIN = 'https://give.example.org';
const document = openApiDocument(ORIGIN);

/** `schema` with each `$dynamicRef: "#meta"` as the `$ref` to the one anchor it names. */
function asStaticRefs(schema: unknown): unknown {
	if (Array.isArray(schema)) return schema.map(asStaticRefs);
	if (typeof schema !== 'object' || schema === null) return schema;
	return Object.fromEntries(
		Object.entries(schema).map(([keyword, value]) =>
			keyword === '$dynamicRef' && value === '#meta'
				? ['$ref', '#/$defs/schema']
				: [keyword, asStaticRefs(value)]
		)
	);
}

describe('openApiDocument()', () => {
	it('is an OpenAPI 3.1 document', () => {
		const ajv = new Ajv2020({ strict: false, allErrors: true });
		addFormats(ajv);
		const validate = ajv.compile(asStaticRefs(officialSchema) as object);

		expect(validate(document) ? [] : validate.errors).toEqual([]);
	});

	it.each(Object.keys(document.components.schemas))('writes %s as JSON Schema 2020-12', (name) => {
		expect(typeof componentValidator(document, name)).toBe('function');
	});
});

/**
 * the path under the read API's layout each route file beneath it serves, spelt as an OpenAPI path:
 * `integrations.v1.gifts.$id.ts` is `/gifts/{id}`. the splat, `integrations.v1.$.ts`, serves no
 * path: it is the 404 for every path nothing else serves.
 */
function servedPaths(): string[] {
	const routes = resolve(import.meta.dirname, '../../../routes');
	return readdirSync(routes)
		.map((file) => /^integrations\.v1\.(.+)\.tsx?$/.exec(file)?.[1])
		.filter((name): name is string => name !== undefined && name !== '$' && !name.endsWith('.spec'))
		.map((name) =>
			name
				.split('.')
				.map((segment) => (segment.startsWith('$') ? `/{${segment.slice(1)}}` : `/${segment}`))
				.join('')
		)
		.sort();
}

/** every block of limiters wrangler.jsonc declares, read the way rate-limit.config.spec.ts reads them. */
type Limiter = { name?: unknown; simple?: { limit?: unknown; period?: unknown } };
type Wrangler = {
	ratelimits?: Limiter[];
	env?: Record<string, { ratelimits?: Limiter[] } | undefined>;
};
const wrangler = readWranglerConfig() as Wrangler;
const LIMITER_BLOCKS = [
	{ where: 'the top level', limiters: wrangler.ratelimits },
	...Object.entries(wrangler.env ?? {}).map(([name, environment]) => ({
		where: `env.${name}`,
		limiters: environment?.ratelimits
	}))
];

describe('openApiDocument() against what it describes', () => {
	it('names this request’s own origin as the server, at the read API’s prefix', () => {
		expect(document.servers).toEqual([
			{ url: `${ORIGIN}${INTEGRATIONS_BASE_PATH}`, description: expect.any(String) }
		]);
	});

	it('describes every path a route file serves, and no path none serves', () => {
		expect(servedPaths()).toContain('/gifts');
		expect(Object.keys(document.paths).sort()).toEqual(servedPaths());
		expect([...INTEGRATIONS_LISTS].sort()).toEqual(servedPaths());
	});

	it('describes every event the catalog holds, and the test post, and nothing else', () => {
		expect(Object.keys(document.webhooks).sort()).toEqual(
			[...WEBHOOK_EVENT_TYPES, WEBHOOK_TEST_TYPE].sort()
		);
	});

	it('publishes the retry schedule the delivery run waits out', () => {
		const delivery = document['x-webhook-delivery'];
		expect(delivery.retry_schedule_seconds.map((seconds) => seconds * 1_000)).toEqual(
			WEBHOOK_RETRY_SCHEDULE_MS
		);
		expect(delivery.attempts).toBe(WEBHOOK_RETRY_SCHEDULE_MS.length + 1);
	});

	it('publishes the pause the delivery run applies', () => {
		expect(document['x-webhook-delivery'].pause_after_seconds * 1_000).toBe(
			DESTINATION_PAUSE_AFTER_MS
		);
	});

	it('says both in words, for whoever reads the prose', () => {
		const prose = document['x-webhook-delivery'].description;
		expect(prose).toContain('retried after 1 minute, 5 minutes, 30 minutes, 2 hours');
		expect(prose).toContain(`${DESTINATION_PAUSE_AFTER_MS / 3_600_000} hours is paused`);
	});

	it('publishes the pause at once on the status the delivery run pauses on', () => {
		expect(document['x-webhook-delivery'].paused_at_once_on).toBe(PAUSED_AT_ONCE_ON);
		expect(document['x-webhook-delivery'].description).toContain(
			`one answering ${PAUSED_AT_ONCE_ON} is paused at once`
		);
	});

	it('publishes how long a receiver has to answer, as the delivery run times it', () => {
		expect(document['x-webhook-delivery'].answer_within_seconds * 1_000).toBe(
			WEBHOOK_POST_TIMEOUT_MS
		);
		expect(document['x-webhook-delivery'].description).toContain(
			`Answer within ${WEBHOOK_POST_TIMEOUT_MS / 1_000} seconds`
		);
	});

	it('describes on every list the query parameters the lists read, and no other', () => {
		expect(
			Object.keys(document.components.parameters).filter((name) => !name.startsWith('webhook-'))
		).toEqual([...PARAMETERS]);
		for (const operation of Object.values(document.paths))
			expect(operation.get.parameters).toEqual(
				PARAMETERS.map((name) => ({ $ref: `#/components/parameters/${name}` }))
			);
	});

	it('describes on every post the headers the signing writes, and no other', async () => {
		const written = Object.keys(
			await signedHeaders({ secret: 'whsec_AAAA', id: 'msg_1', at: new Date(0), body: '{}' })
		);
		for (const webhook of Object.values(document.webhooks))
			expect(webhook.post.parameters).toEqual(
				written.map((name) => ({ $ref: `#/components/parameters/${name}` }))
			);
	});

	it('asks no API key of a post to a receiver', () => {
		for (const webhook of Object.values(document.webhooks))
			expect(webhook.post.security).toEqual([]);
		expect(document.security).toEqual([{ apiKey: [] }]);
	});

	it('closes no value set, so a client generated from it takes a value added later', () => {
		expect(keywordPaths(document, 'enum')).toEqual([]);
	});

	it('publishes every value set’s known values, and says it may gain more', () => {
		const sets = Object.values(document.components.schemas).flatMap((schema) =>
			Object.entries(
				(schema as { properties?: Record<string, { examples?: unknown; description?: string }> })
					.properties ?? {}
			).filter(([, property]) => property.examples !== undefined)
		);
		expect(sets.map(([name]) => name)).toEqual(
			expect.arrayContaining(['method', 'status', 'dedication_kind', 'consent', 'source'])
		);
		for (const [, property] of sets) expect(property.description).toContain('may gain values');
	});

	it('pages as the lists do', () => {
		const { limit } = document.components.parameters;
		expect(limit.schema).toMatchObject({ maximum: PAGE_SIZE_CEILING, default: DEFAULT_PAGE_SIZE });
	});

	it('answers each refusal code under exactly one status', () => {
		const documented = Object.values(document.components.responses).flatMap(
			(response) => response.content['application/json'].schema.properties.error.examples
		);
		expect([...documented].sort()).toEqual([...INTEGRATIONS_REFUSALS].sort());
	});

	it.each(LIMITER_BLOCKS)('publishes the rate limits $where binds', ({ limiters }) => {
		const bound = (name: string) => limiters?.find((entry) => entry.name === name)?.simple;
		const limits = document['x-rate-limits'];

		expect({ limit: limits.per_key.requests, period: limits.per_key.period_seconds }).toEqual(
			bound('INTEGRATIONS_KEY_RATE_LIMITER')
		);
		expect({
			limit: limits.per_address.requests,
			period: limits.per_address.period_seconds
		}).toEqual(bound('API_RATE_LIMITER'));
	});
});

/** the path to each place `keyword` is used as a keyword in `schema`, a property named it aside. */
function keywordPaths(schema: unknown, keyword: string, at = '#'): string[] {
	if (Array.isArray(schema))
		return schema.flatMap((item, index) => keywordPaths(item, keyword, `${at}/${index}`));
	if (typeof schema !== 'object' || schema === null) return [];
	return Object.entries(schema).flatMap(([name, value]) => [
		...(name === keyword && !at.endsWith('/properties') ? [`${at}/${name}`] : []),
		...keywordPaths(value, keyword, `${at}/${name}`)
	]);
}

describe('publishedOrigin()', () => {
	const UNSET: PinReading = { ok: true, origin: null };

	it('publishes the pinned origin, whatever host the request came in on', () => {
		const pinned: PinReading = { ok: true, origin: 'https://donate.example.org' };

		expect(publishedOrigin(new URL('https://give.example.workers.dev/x'), pinned)).toBe(
			'https://donate.example.org'
		);
	});

	it('publishes the request’s own origin where the pin names none', () => {
		const refused: PinReading = { ok: false, message: '`BETTER_AUTH_URL` is `localhost:8787`' };

		expect(publishedOrigin(new URL('https://give.example.org/x'), refused)).toBe(
			'https://give.example.org'
		);
		expect(publishedOrigin(new URL('https://give.example.org/x'), UNSET)).toBe(
			'https://give.example.org'
		);
	});

	it('publishes https for any host but this machine', () => {
		expect(
			publishedOrigin(new URL('http://give.example.org/integrations/openapi.json'), UNSET)
		).toBe('https://give.example.org');
		expect(publishedOrigin(new URL('http://give.example.workers.dev:8080/x'), UNSET)).toBe(
			'https://give.example.workers.dev:8080'
		);
	});

	it('keeps the scheme a local dev server answers on', () => {
		expect(publishedOrigin(new URL('http://localhost:5321/x'), UNSET)).toBe(
			'http://localhost:5321'
		);
		expect(publishedOrigin(new URL('http://127.0.0.1:5321/x'), UNSET)).toBe(
			'http://127.0.0.1:5321'
		);
	});
});

describe('spokenDuration()', () => {
	it('says whole minutes and whole hours in words', () => {
		expect(spokenDuration(60_000)).toBe('1 minute');
		expect(spokenDuration(72 * 3_600_000)).toBe('72 hours');
	});

	it('refuses a duration that is not whole minutes', () => {
		expect(() => spokenDuration(90_000)).toThrow(/whole minutes/);
	});
});
