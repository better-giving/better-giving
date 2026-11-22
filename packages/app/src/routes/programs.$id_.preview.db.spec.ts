import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createStaticHandler, type LoaderFunction, type MiddlewareFunction } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { PROGRAM_CLOSED_TITLE } from '$lib/donate/copy';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { insertProgram } from '../program-routes.testing';
import { requestContext } from '../request-context';
import { queryDocument } from '../route-request.testing';
import type { Route } from './+types/programs.$id_.preview';
import * as preview from './programs.$id_.preview';
import { client, stmt } from '$lib/server/db/database.testing';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { readEnv } from '$lib/server/runtime/env';
import { specRateLimiters } from '$lib/server/runtime/rate-limiter.testing';

// the program editor's preview of a program's page, at `/programs/{id}/preview`, against a real
// database: what it answers for each row. its framing headers are ../entry.server.db.spec.ts's.

const OWN = 'https://give.example.workers.dev';

const stripeEnv = {
	...readEnv({}, specRateLimiters()),
	STRIPE_SECRET_KEY: 'sk_test_abc',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
	STRIPE_WEBHOOK_SECRET: 'whsec_abc'
} as Env;

const ACTIVE = '019fb600-0000-7000-8000-0000000000a1';
const ARCHIVED = '019fb600-0000-7000-8000-0000000000a2';
const UNKNOWN = '019fb600-0000-7000-8000-0000000000a3';

beforeEach(async () => {
	await client.batch([
		stmt('delete from page'),
		stmt('delete from form'),
		stmt('delete from program'),
		stmt('delete from org_profile')
	]);
	await writeOrgRow(client, { tax_id: '12-3456789' });
	// the served cadences and rails, warmed so the loader never sends the fixture key to Stripe
	// ($lib/server/forms/cadence-cache.ts, $lib/server/forms/rail-cache.ts).
	await edgeCache().put(
		new Request(`${OWN}/__recurring-cadences`),
		new Response(JSON.stringify(['one_time']), {
			headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
		})
	);
	await edgeCache().put(
		new Request(`${OWN}/__offered-rails`),
		new Response(JSON.stringify(['card']), {
			headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
		})
	);
	await insertProgram({ id: ACTIVE, name: 'Winter coats', description: 'Warm coats.' });
	await insertProgram({ id: ARCHIVED, name: 'Summer camp', archived: true });
});

const ROUTE_ID = 'preview';
const handler = createStaticHandler([
	{
		id: ROUTE_ID,
		path: 'programs/:id/preview',
		middleware: preview.middleware as unknown as MiddlewareFunction[],
		loader: preview.loader as unknown as LoaderFunction
	}
]);

type LoaderData = Route.ComponentProps['loaderData'];

async function visit(id: string): Promise<{ status: number; data: LoaderData }> {
	const answered = await queryDocument(
		handler,
		new Request(`${OWN}/programs/${id}/preview`),
		requestContext({ env: stripeEnv, deferred: createDeferredWork(), client })
	);
	return { status: answered.statusCode, data: answered.loaderData[ROUTE_ID] as LoaderData };
}

function markup(loaderData: LoaderData): string {
	return renderToStaticMarkup(
		createElement(preview.default, { loaderData } as unknown as Route.ComponentProps)
	);
}

describe('the preview of an active program', () => {
	it('draws the program’s saved page with its donation box inert', async () => {
		const answered = await visit(ACTIVE);

		expect(answered.status).toBe(200);
		if (answered.data.kind !== 'program') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.program.name).toBe('Winter coats');
		// what the page would share is its public address, not the preview's.
		expect(answered.data.sharing.url).toBe(`${OWN}/programs/${ACTIVE}`);
		const html = markup(answered.data);
		expect(html).toContain('<h1 class="page-program-name">Winter coats</h1>');
		expect(html).toMatch(/<div inert="">/);
	});
});

describe('the preview of an id no active program answers', () => {
	it.each([
		{ which: 'an archived program', id: ARCHIVED },
		{ which: 'an id no program has', id: UNKNOWN }
	])('draws the closed screen under a 404 for $which', async ({ id }) => {
		const answered = await visit(id);

		expect(answered.status).toBe(404);
		expect(answered.data.kind).toBe('closed');
		const html = markup(answered.data);
		expect(html).toContain(PROGRAM_CLOSED_TITLE);
		expect(html).not.toContain('Summer camp');
	});
});
