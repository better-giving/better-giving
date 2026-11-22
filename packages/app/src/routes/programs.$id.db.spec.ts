import { eq } from 'drizzle-orm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RESUME_FORM_PARAM } from '@better-giving/form/embed/resume';
import { createStaticHandler, type LoaderFunction, type MiddlewareFunction } from 'react-router';
import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_FORM, PROGRAM_CLOSED_TITLE } from '$lib/donate/copy';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { createDb } from '$lib/server/db/client';
import { form, page, program } from '$lib/server/db/schema';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { createImage } from '$lib/server/images/image.testing';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { finishedDeployment } from '../page-routes.testing';
import { ORIGIN, signIn } from '../program-routes.testing';
import { requestContext } from '../request-context';
import { mountRoutes, queryDocument } from '../route-request.testing';
import type { Route } from './+types/programs.$id';
import * as layout from './_app';
import * as donationPageEditor from './_app.admin.donation-page';
import * as giftsListScreen from './_app.admin.donations._index';
import * as donatePage from './_index';
import * as surface from './api.v1';
import * as gifts from './api.v1.forms.$id.donations';
import * as programPage from './programs.$id';
import { client, run, stmt } from '$lib/server/db/database.testing';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { readEnv } from '$lib/server/runtime/env';
import { specRateLimiters } from '$lib/server/runtime/rate-limiter.testing';

/** the deploy-time values a request reads, with none set and the spec limiters. */
const env = readEnv({}, specRateLimiters());

// one program's public page at `/programs/{id}`, against a real database.
//
// a db spec for the reason ./_index.db.spec.ts gives: every answer is decided from rows, and the
// loader runs through react router's own matcher so a refusal's status is the framework's.

/** this deployment's own origin, which every request in this file is made to. */
const OWN = 'https://give.example.workers.dev';

/** a deployment whose Stripe pair is set and agrees, so the env is never what refuses. */
const STRIPE = {
	STRIPE_SECRET_KEY: 'sk_test_abc',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
	STRIPE_WEBHOOK_SECRET: 'whsec_abc'
};

const stripeEnv = { ...env, ...STRIPE } as Env;

const db = createDb(client);

beforeEach(async () => {
	await client.batch([
		stmt('delete from ledger_entry'),
		stmt('delete from entry_group'),
		stmt('delete from line_item'),
		stmt('delete from payment'),
		stmt('delete from gift_match'),
		stmt('delete from donation'),
		stmt('delete from contact'),
		stmt('delete from page'),
		stmt('delete from form'),
		stmt('delete from program'),
		stmt('delete from org_profile')
	]);
	await writeOrgRow(client, { tax_id: '12-3456789' });
	// the served cadences, warmed so the loader never sends the fixture key to Stripe
	// ($lib/server/forms/cadence-cache.ts).
	await edgeCache().put(
		new Request(`${OWN}/__recurring-cadences`),
		new Response(JSON.stringify(['one_time', 'yearly']), {
			headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
		})
	);
});

/** an active program, its id. */
async function activeProgram(
	values: { name?: string; description?: string | null; imageId?: string | null } = {}
): Promise<string> {
	const [row] = await db
		.insert(program)
		.values({ name: 'Winter coats', ...values })
		.returning({ id: program.id });
	if (!row) throw new Error('inserting the fixture program returned no row');
	return row.id;
}

/** a photo in the image store, its id. */
function photo(): Promise<string> {
	return createImage(
		db,
		{ kind: 'photo', contentType: 'image/webp', width: 1600, height: 1600, alt: null },
		new Uint8Array([1])
	);
}

const ROUTE_ID = 'program';
const handler = createStaticHandler([
	{
		id: ROUTE_ID,
		path: 'programs/:id',
		middleware: programPage.middleware as unknown as MiddlewareFunction[],
		loader: programPage.loader as unknown as LoaderFunction
	}
]);

type LoaderData = Route.ComponentProps['loaderData'];

async function visit(
	id: string,
	on: Env = stripeEnv,
	headers: Record<string, string> = {}
): Promise<{ status: number; data: LoaderData; headers: Headers }> {
	const answered = await queryDocument(
		handler,
		new Request(`${OWN}/programs/${id}`, { headers }),
		requestContext({ env: on, deferred: createDeferredWork(), client })
	);
	return {
		status: answered.statusCode,
		data: answered.loaderData[ROUTE_ID] as LoaderData,
		headers: answered.loaderHeaders[ROUTE_ID] ?? new Headers()
	};
}

/** the page's own tree, from what the loader handed it; the cast is the props react router adds. */
function markup(loaderData: LoaderData): string {
	return renderToStaticMarkup(
		createElement(programPage.default, { loaderData } as unknown as Route.ComponentProps)
	);
}

/** one area of the page, from its opening tag to the next area's, by the name the renderer stamps on it. */
function area(html: string, name: string): string {
	const start = html.indexOf(`data-area="${name}"`);
	if (start === -1) return '';
	const next = html.indexOf('data-area=', start + 1);
	return html.slice(start, next === -1 ? undefined : next);
}

describe('an active program at its address', () => {
	it('draws its photo, name and description beside one donation box', async () => {
		const image = await photo();
		const id = await activeProgram({
			description: 'Warm coats for every child.\n\nDropped at the school gate.',
			imageId: image
		});

		const answered = await visit(id);

		expect(answered.status).toBe(200);
		expect(answered.headers.get('cache-control')).toBe('no-store');
		if (answered.data.kind !== 'program') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.program).toEqual({
			id,
			name: 'Winter coats',
			description: 'Warm coats for every child.\n\nDropped at the school gate.',
			photoImageId: image
		});
		const html = markup(answered.data);
		expect(area(html, 'photo')).toContain(`src="/image/${image}"`);
		expect(html).toContain('<h1 class="page-program-name">Winter coats</h1>');
		expect(area(html, 'description')).toContain('Dropped at the school gate.');
		expect(html.match(/data-area="box"/g)).toHaveLength(1);
	});

	it('draws no image and no description block for a program with neither', async () => {
		const id = await activeProgram();

		const answered = await visit(id);

		if (answered.data.kind !== 'program') throw new Error(`drew ${answered.data.kind}`);
		const html = markup(answered.data);
		expect(html).not.toContain('data-area="photo"');
		expect(html).not.toContain('class="page-photo"');
		expect(html).not.toContain('data-area="description"');
	});

	it('serves the Donation page’s own settings row with no program, so the card offers no choice', async () => {
		// two active programs: the Donation page, its operator having chosen nothing, asks donors to
		// choose (`followedProgram` in $lib/server/pages/donation-page.ts).
		const id = await activeProgram();
		await activeProgram({ name: 'Food pantry' });

		const answered = await visit(id);

		if (answered.data.kind !== 'program') throw new Error(`drew ${answered.data.kind}`);
		const [donationPage] = await db.select().from(page).where(eq(page.type, 'donation_page'));
		expect(answered.data.config.formId).toBe(donationPage?.formId);
		expect(answered.data.config).not.toHaveProperty('program');
		expect(markup(answered.data)).not.toContain('data-area="chooser"');
	});

	it('shares its own address, and names the program in the tab', async () => {
		const image = await photo();
		const id = await activeProgram({ imageId: image });

		const answered = await visit(id);

		if (answered.data.kind !== 'program') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.sharing).toEqual({
			message: 'Give to Winter coats',
			url: `${OWN}/programs/${id}`
		});
		expect(programPage.meta({ loaderData: answered.data } as unknown as Route.MetaArgs)).toEqual([
			{ title: 'Winter coats' },
			{ property: 'og:image', content: `${OWN}/image/${image}` }
		]);
	});

	it('reads the resume stamp naming the Donation page’s settings row, and no other', async () => {
		const id = await activeProgram();
		const first = await visit(id);
		if (first.data.kind !== 'program') throw new Error(`drew ${first.data.kind}`);
		expect(first.data.resuming).toBe(false);

		const back = await visit(`${id}?${RESUME_FORM_PARAM}=${first.data.config.formId}`);
		const elsewhere = await visit(`${id}?${RESUME_FORM_PARAM}=frm_another`);

		expect(back.data).toMatchObject({ kind: 'program', resuming: true });
		expect(elsewhere.data).toMatchObject({ kind: 'program', resuming: false });
	});
});

describe('an address no active program answers', () => {
	it('answers an archived program and an id no program has with one 404 body, naming neither', async () => {
		const archived = await activeProgram({ name: 'Old roof fund' });
		await db
			.update(program)
			.set({ status: 'archived', archivedAt: new Date() })
			.where(eq(program.id, archived));

		const retired = await visit(archived);
		const unknown = await visit('019fb600-0000-7000-8000-0000000000ff');

		for (const answered of [retired, unknown]) {
			expect(answered.status).toBe(404);
			expect(answered.headers.get('cache-control')).toBe('no-store');
			expect(answered.data.kind).toBe('closed');
			expect(programPage.meta({ loaderData: answered.data } as unknown as Route.MetaArgs)).toEqual([
				{ title: 'Donate' }
			]);
		}
		expect(retired.data).toEqual(unknown.data);
		const html = markup(retired.data);
		expect(html).toBe(markup(unknown.data));
		expect(html).toContain(PROGRAM_CLOSED_TITLE);
		expect(html).not.toContain('Old roof fund');
		expect(html).not.toContain('data-area="box"');
	});
});

describe('where the Donation page’s served config refuses', () => {
	it('draws the plain notice over a program’s page, as it does over an unknown id', async () => {
		const id = await activeProgram();
		await visit(id);
		await run(stmt(`update form set status = 'draft'`));

		for (const address of [id, '019fb600-0000-7000-8000-0000000000ff']) {
			const answered = await visit(address);
			expect(answered.status).toBe(404);
			expect(answered.headers.get('cache-control')).toBe('no-store');
			expect(answered.data).toEqual({ kind: 'refused' });
			expect(markup(answered.data)).toContain(NO_FORM);
		}
	});

	/**
	 * `readPublishedConfig` serves a row with no rail rather than refusing it, so the notice here is
	 * `renderableConfig`'s ($lib/server/forms/published-config.ts). driven by warming the served rail
	 * list as ./api.v1.forms.$id.config.db.spec.ts does.
	 */
	it('draws the plain notice over a program’s page when the account is approved for no rail', async () => {
		const id = await activeProgram();
		const rails = new Request(`${OWN}/__offered-rails`);
		await edgeCache().put(
			rails,
			new Response('[]', {
				headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
			})
		);

		try {
			const answered = await visit(id);

			expect(answered.status).toBe(404);
			expect(answered.headers.get('cache-control')).toBe('no-store');
			expect(answered.data).toEqual({ kind: 'refused' });
			expect(markup(answered.data)).toContain(NO_FORM);
		} finally {
			// the entry outlives this case, and every case after it would be served no rail.
			await edgeCache().delete(rails);
		}
	});
});

describe('the limit on GET /programs/{id}', () => {
	it('refuses a caller who has viewed too often with the plain notice', async () => {
		const id = await activeProgram();
		const ip = '203.0.113.96';
		for (let i = 0; i < 50; i++) {
			const answered = await visit(id, stripeEnv, { [CLIENT_IP_HEADER]: ip });
			if (answered.status !== 429) continue;
			expect(answered.data).toEqual({ kind: 'refused' });
			expect(answered.headers.get('retry-after')).toBe('60');
			return;
		}
		throw new Error(`50 views from ${ip} and the limiter refused none of them`);
	});
});

/**
 * a gift made on a program's page, end to end: the operator sets the Donation page to "No program"
 * on its editor, a donor opens the program's page and the card posts the gift the way it does, and
 * the gift is in Gifts under that program.
 *
 * the gift route builds the real Stripe adapter and passes the real ALTCHA check, so the one call
 * leaving the process — Stripe's Create PaymentIntent — is answered by a scripted `fetch`
 * (`unstubGlobals` in $lib/server/runtime/rate-limiter.testing.ts removes it after the case).
 */
describe('a gift made on a program’s page', () => {
	const editorRoute = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/donation-page', module: donationPageEditor }
	]);
	const giftRoute = mountRoutes([
		{ path: 'api/v1', module: surface },
		{ path: 'forms/:id/donations', module: gifts }
	]);
	const giftsList = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/donations', module: giftsListScreen }
	]);

	let bindings: Env;
	let session: string;

	beforeEach(async () => {
		// the webhook secret is what a published page needs to be drawn (`settlementReady` in
		// $lib/server/payments/factory.ts), which `finishedDeployment` does not set.
		bindings = { ...(await finishedDeployment()), STRIPE_WEBHOOK_SECRET: 'whsec_spec' };
		session = await signIn(db);
		await edgeCache().put(
			new Request(`${ORIGIN}/__offered-rails`),
			new Response(JSON.stringify(['card']), {
				headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
			})
		);
	});

	/** a press on the Donation page's editor, drawn at the version the page holds now. */
	async function press(which: string, fields: Record<string, string> = {}): Promise<void> {
		const opened = await editorRoute(
			new Request(`${ORIGIN}/admin/donation-page`, { headers: { cookie: session } }),
			{ env: bindings }
		);
		const { version } = (await opened.json()) as { version: number };
		const body = new FormData();
		body.set(WHICH_FORM, which);
		body.set(RECORD_VERSION, String(version));
		for (const [name, value] of Object.entries(fields)) body.set(name, value);
		const pressed = await editorRoute(
			new Request(`${ORIGIN}/admin/donation-page`, {
				method: 'POST',
				headers: { cookie: session },
				body
			}),
			{ env: bindings }
		);
		expect(pressed.status).toBe(200);
	}

	/** Stripe's answer to Create PaymentIntent, and the requests that reached it. */
	function stripeAnswers(): string[] {
		const asked: string[] = [];
		vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(String(input), init);
			const { pathname } = new URL(request.url);
			asked.push(`${request.method} ${pathname}`);
			if (request.method === 'POST' && pathname === '/v1/payment_intents') {
				return Response.json({
					id: 'pi_programpage01',
					object: 'payment_intent',
					client_secret: 'pi_programpage01_secret_spec'
				});
			}
			return Response.json({ error: { message: 'unscripted' } }, { status: 500 });
		});
		return asked;
	}

	it('lists the gift in Gifts under the program, the Donation page set to “No program” and left so', async () => {
		const coats = await activeProgram();
		await activeProgram({ name: 'Food pantry' });
		await press('donation-page-giving', {
			program_mode: 'none',
			program_id: '',
			min_minor: '5',
			max_minor: '5,000',
			'suggested_amounts[0]': '25'
		});
		await press('page-publish');
		const [setting] = await db.select().from(form);
		expect(setting?.programMode).toBe('none');
		const stored = { page: await db.select().from(page), form: await db.select().from(form) };

		const opened = await queryDocument(
			handler,
			new Request(`${ORIGIN}/programs/${coats}`),
			requestContext({ env: bindings, deferred: createDeferredWork(), client })
		);
		const drawn = opened.loaderData[ROUTE_ID] as LoaderData;
		if (drawn.kind !== 'program') throw new Error(`drew ${drawn.kind}`);
		const { formId } = drawn.config;

		const asked = stripeAnswers();
		const issued = await bindings.ALTCHA.challenge();
		const solution = await solveChallenge({ challenge: issued, deriveKey });
		const given = await giftRoute(
			new Request(`${ORIGIN}/api/v1/forms/${formId}/donations`, {
				method: 'POST',
				headers: {
					origin: ORIGIN,
					accept: 'application/json',
					'content-type': 'application/json',
					[CLIENT_IP_HEADER]: '2001:db8:6100::1'
				},
				body: JSON.stringify({
					formId,
					amountMinor: 5_000,
					frequency: 'one_time',
					method: 'card',
					coversFee: false,
					email: 'ada@example.org',
					firstName: 'Ada',
					lastName: 'Okafor',
					consentedToContact: false,
					altchaPayload: btoa(JSON.stringify({ challenge: issued, solution })),
					pageProgramId: drawn.program.id
				})
			}),
			{ env: bindings }
		);
		expect(given.status).toBe(200);
		expect(asked).toEqual(['POST /v1/payment_intents']);

		const listed = await giftsList(
			new Request(`${ORIGIN}/admin/donations`, { headers: { cookie: session } }),
			{ env: bindings }
		);
		expect(listed.status).toBe(200);
		const { donations } = (await listed.json()) as {
			donations: { donorName: string; program: string | null }[];
		};
		expect(donations).toEqual([
			expect.objectContaining({ donorName: 'Ada Okafor', program: 'Winter coats' })
		]);
		expect({ page: await db.select().from(page), form: await db.select().from(form) }).toEqual(
			stored
		);
	});
});

describe('the Donation page beside a program’s page', () => {
	const donationPageHandler = createStaticHandler([
		{
			id: 'index',
			path: '/',
			middleware: donatePage.middleware as unknown as MiddlewareFunction[],
			loader: donatePage.loader as unknown as LoaderFunction
		}
	]);

	/** what `/` hands its page, less the instant it was read. */
	async function donationPageData() {
		const answered = await queryDocument(
			donationPageHandler,
			new Request(`${OWN}/`),
			requestContext({ env: stripeEnv, deferred: createDeferredWork(), client })
		);
		const { now: _now, ...drawn } = answered.loaderData.index as Record<string, unknown>;
		return { status: answered.statusCode, drawn };
	}

	it('is drawn as it was, its settings row untouched, after a program’s page is viewed', async () => {
		const id = await activeProgram();
		await activeProgram({ name: 'Food pantry' });
		const before = await donationPageData();
		const rows = async () => ({
			page: await db.select().from(page),
			form: await db.select().from(form)
		});
		const stored = await rows();

		await visit(id);

		expect(await rows()).toEqual(stored);
		expect(await donationPageData()).toEqual(before);
	});
});
