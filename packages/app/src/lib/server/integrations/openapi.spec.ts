import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { WEBHOOK_EVENT_TYPES } from '../../webhooks/catalog';
import { DESTINATION_PAUSE_AFTER_MS, WEBHOOK_RETRY_SCHEDULE_MS } from '../webhooks/deliver';
import { readWranglerConfig } from '../wrangler-config.testing';
import officialSchema from './oas-3.1-schema.testing.json';
import { openApiDocument } from './openapi';
import { componentValidator } from './openapi.testing';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_CEILING } from './paging';
import { INTEGRATIONS_BASE_PATH, INTEGRATIONS_REFUSALS } from './surface';

// the OpenAPI document ./openapi.ts builds, held to the OpenAPI 3.1 schema.
//
// ./oas-3.1-schema.testing.json is the schema the OpenAPI Initiative publishes at
// https://spec.openapis.org/oas/3.1/schema/2022-10-07, vendored byte for byte but for biome's
// formatting (Apache-2.0, https://github.com/OAI/OpenAPI-Specification/blob/main/LICENSE). it
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
 * `integrations.v1.gifts.$id.ts` is `/gifts/{id}`.
 */
function servedPaths(): string[] {
	const routes = resolve(import.meta.dirname, '../../../routes');
	return readdirSync(routes)
		.map((file) => /^integrations\.v1\.(.+)\.tsx?$/.exec(file)?.[1])
		.filter((name): name is string => name !== undefined && !name.endsWith('.spec'))
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
	});

	it('describes every event the catalog holds, and the test post, and nothing else', () => {
		expect(Object.keys(document.webhooks).sort()).toEqual([...WEBHOOK_EVENT_TYPES, 'test'].sort());
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

	it('pages as the lists do', () => {
		const { limit } = document.components.parameters;
		expect(limit.schema).toMatchObject({ maximum: PAGE_SIZE_CEILING, default: DEFAULT_PAGE_SIZE });
	});

	it('answers each refusal code under exactly one status', () => {
		const documented = Object.values(document.components.responses).flatMap(
			(response) => response.content['application/json'].schema.properties.error.enum
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
