import { createExecutionContext, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createStaticHandler, type LoaderFunction } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_FORM } from '$lib/donate/copy';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { NEW_FORM } from '$lib/forms/new-form';
import { defaultCampaign } from '$lib/page/defaults';
import { createDb } from '$lib/server/db/client';
import { page, program } from '$lib/server/db/schema';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { parseFormInput } from '$lib/server/forms/form-input';
import { ownedFormInsert } from '$lib/server/forms/queries';
import { createCampaign } from '$lib/server/pages/campaign';
import { expectRecordedAsAForm } from '$lib/server/pages/owned-settings-gift.testing';
import { endAsItStands } from '$lib/server/pages/page-row.testing';
import { gift } from '$lib/server/pages/settled-gifts.testing';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { readOrgLook, updateOrgLook } from '$lib/server/org/queries';
import { ORIGIN, signIn } from '../program-routes.testing';
import { requestContext } from '../request-context';
import { mountRoutes } from '../route-request.testing';
import type { Route } from './+types/$slug';
import * as campaignPage from './$slug';
import * as layout from './_app';
import * as editor from './_app.admin.campaigns.$pageId';
import * as surface from './api.v1';
import * as servedConfig from './api.v1.forms.$id.config';
import * as gifts from './api.v1.forms.$id.donations';

// a campaign at its own address, against the real D1 the pool binds.
//
// a workers spec for the reason ./donate.workers.spec.ts gives: every answer is decided from rows,
// and the loader runs through react router's own matcher so a refusal's status is the framework's.

/** this deployment's own origin, which every request in this file is made to. */
const OWN = 'https://give.example.workers.dev';

/** a deployment whose Stripe pair is set and agrees, so the env is never what refuses. */
const STRIPE = {
	STRIPE_SECRET_KEY: 'sk_test_abc',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
	STRIPE_WEBHOOK_SECRET: 'whsec_abc'
};

const SLUG = 'winter-coat-drive';

const db = createDb(env.DB);

beforeEach(async () => {
	// children first — every FK in this schema is `NO ACTION`, and the gift below names a form.
	await env.DB.batch([
		env.DB.prepare('delete from ledger_entry'),
		env.DB.prepare('delete from entry_group'),
		env.DB.prepare('delete from line_item'),
		env.DB.prepare('delete from payment'),
		env.DB.prepare('delete from donation'),
		env.DB.prepare('delete from page'),
		env.DB.prepare('delete from form'),
		env.DB.prepare('delete from org_presentation'),
		env.DB.prepare('delete from org_profile')
	]);
	await writeOrgRow(env.DB, { tax_id: '12-3456789' });
	// the served cadences, warmed so the loader never sends the fixture key to Stripe
	// ($lib/server/forms/cadence-cache.ts).
	await edgeCache().put(
		new Request(`${OWN}/__recurring-cadences`),
		new Response(JSON.stringify(['one_time', 'yearly']), {
			headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
		})
	);
});

/** the pool's env with the Stripe pair set, as a proxy rather than a copy. */
const stripeEnv = new Proxy(env, {
	get: (target, property) =>
		typeof property === 'string' && property in STRIPE
			? STRIPE[property as keyof typeof STRIPE]
			: Reflect.get(target, property)
}) as Env;

type Campaign = {
	readonly name?: string;
	readonly slug?: string | null;
	readonly state?: 'never_published' | 'live';
	readonly published?: unknown;
};

/** a campaign and the live settings row it owns, as publish leaves them; its owned form's id. */
async function campaign({
	name = 'Winter coat drive',
	slug = SLUG,
	state = 'live',
	published = defaultCampaign()
}: Campaign = {}): Promise<string> {
	const settings = parseFormInput({ ...NEW_FORM, name, status: 'live' });
	if (!settings.ok)
		throw new Error(`the fixture settings did not parse: ${JSON.stringify(settings)}`);
	const owned = ownedFormInsert(db, settings.value);
	await db.batch([
		owned.statement,
		db.insert(page).values({
			type: 'campaign',
			name,
			slug,
			state,
			formId: owned.id,
			draft: JSON.stringify(defaultCampaign()),
			published: state === 'never_published' ? null : JSON.stringify(published)
		})
	]);
	return owned.id;
}

const ROUTE_ID = 'campaign';
const handler = createStaticHandler([
	{ id: ROUTE_ID, path: ':slug', loader: campaignPage.loader as unknown as LoaderFunction }
]);

type LoaderData = Route.ComponentProps['loaderData'];

async function visit(
	address = `/${SLUG}`,
	on: Env = stripeEnv
): Promise<{ status: number; data: LoaderData; headers: Headers }> {
	const answered = await handler.query(new Request(`${OWN}${address}`), {
		requestContext: requestContext(on, createExecutionContext())
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

/** the page's own tree, from what the loader handed it; the cast is the props react router adds. */
function markup(loaderData: LoaderData): string {
	return renderToStaticMarkup(
		createElement(campaignPage.default, { loaderData } as unknown as Route.ComponentProps)
	);
}

/** one block's section, by the block type the renderer stamps on it. */
function block(html: string, type: string): string {
	const found = new RegExp(`<section[^>]*data-block="${type}"[\\s\\S]*?</section>`).exec(html);
	return found?.[0] ?? '';
}

describe('a published campaign at its address', () => {
	it('draws its blocks around one donation box, against its own settings row', async () => {
		const formId = await campaign();

		const answered = await visit();
		expect(answered.status).toBe(200);
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.config.formId).toBe(formId);
		const html = markup(answered.data);
		expect(block(html, 'title')).toContain('Winter coat drive');
		expect(html.match(/data-block="donation-box"/g)).toHaveLength(1);
		expect(answered.data.view.sharing.url).toBe(`${OWN}/${SLUG}`);
	});

	it('names the campaign in the tab', async () => {
		await campaign();
		const answered = await visit();
		expect(campaignPage.meta({ loaderData: answered.data } as unknown as Route.MetaArgs)).toEqual([
			{ title: 'Winter coat drive' }
		]);
	});

	it('names its cover photo, by id, as its share image', async () => {
		const photo = '0192a4c1-0000-7000-8000-000000000001';
		const published = defaultCampaign();
		published.blocks[0] = {
			id: 'hero',
			type: 'hero',
			variant: 'framed',
			background: 'none',
			imageId: photo,
			alt: null
		};
		await campaign({ published });
		const answered = await visit();
		expect(campaignPage.meta({ loaderData: answered.data } as unknown as Route.MetaArgs)).toEqual([
			{ title: 'Winter coat drive' },
			{ property: 'og:image', content: `${OWN}/image/${photo}` }
		]);
	});

	it('names no share image without a cover photo, a photo lower on the page included', async () => {
		const photo = '0192a4c1-0000-7000-8000-000000000001';
		const published = defaultCampaign();
		published.blocks[0] = {
			id: 'photo',
			type: 'image',
			variant: 'wide',
			background: 'none',
			imageId: photo,
			alt: null
		};
		await campaign({ published });
		const answered = await visit();
		expect(campaignPage.meta({ loaderData: answered.data } as unknown as Route.MetaArgs)).toEqual([
			{ title: 'Winter coat drive' }
		]);
	});

	it('takes a gift that records against its owned row, as a gift through a form', async () => {
		await campaign();
		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		await expectRecordedAsAForm(db, answered.data.view.config.formId);
	});
});

/** the seeds the page root sets, read off the drawn page as the browser receives them. */
function seeds(html: string) {
	const root = /<div[^>]*data-donate-root[^>]*>/.exec(html)?.[0];
	if (root === undefined) throw new Error('the page drew no root');
	return {
		shade: /data-shade="([^"]*)"/.exec(root)?.[1],
		corner: /data-corner="([^"]*)"/.exec(root)?.[1],
		brandColour: /--donate-primary:([^;"]*)/.exec(root)?.[1] ?? null
	};
}

describe('the look a published campaign is drawn in', () => {
	it('moves with a save of the Organisation’s, unless the campaign holds its own', async () => {
		const own = { shade: 'cool', corner: 'square', brandColour: '#6b2d8a' } as const;
		await campaign();
		await campaign({
			name: 'Spring fun run',
			slug: 'spring-fun-run',
			published: { ...defaultCampaign(), look: own }
		});

		const { version } = await readOrgLook(db);
		const saved = { shade: 'warm', corner: 'round', brandColour: '#1d6b4f' } as const;
		expect(await updateOrgLook(db, version, saved)).not.toBe('stale');

		expect(seeds(markup((await visit()).data))).toEqual(saved);
		expect(seeds(markup((await visit('/spring-fun-run')).data))).toEqual(own);
	});
});

describe('a published campaign with a goal', () => {
	it('draws its goal bar with what has settled through it, against the goal, to the day chosen', async () => {
		const owned = await campaign({
			published: {
				...defaultCampaign(),
				goalMinor: 500_000,
				// the end of 31 December in los angeles, on PST by then, UTC-8
				endsAt: Date.parse('2027-01-01T08:00:00Z') - 1,
				endsZone: 'America/Los_Angeles'
			}
		});
		await gift(db, owned, 12_500);
		await gift(db, owned, 40_000, false);

		const answered = await visit();

		const bar = block(markup(answered.data), 'goal-bar').replace(/<[^>]+>/g, '');
		expect(bar).toContain('$125 raised of $5,000');
		expect(bar).toContain('Ends December 31');
	});
});

describe('a published campaign the read rule refuses', () => {
	it.each([
		{ why: 'missing its shape', published: {} },
		{
			why: 'naming a block it does not know',
			published: {
				...defaultCampaign(),
				blocks: [...defaultCampaign().blocks, { id: 'x', type: 'marquee', background: 'none' }]
			}
		}
	])('draws its own donation box alone when $why, and logs it', async ({ published }) => {
		const formId = await campaign({ published });
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});

		const answered = await visit();
		expect(answered.status).toBe(200);
		if (answered.data.kind !== 'plain') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.config.formId).toBe(formId);
		const html = markup(answered.data);
		expect(html).toContain('$25');
		expect(html).not.toContain('data-block=');
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining('fails the read rule'),
			expect.any(String)
		);
	});
});

/** a campaign published and then ended, as End and the end date leave it; its owned form's id. */
async function endedCampaign(fixture: Campaign = {}): Promise<string> {
	const formId = await campaign(fixture);
	const [row] = await db.select({ id: page.id }).from(page).where(eq(page.formId, formId));
	if (!row) throw new Error('the fixture campaign is not there');
	await endAsItStands(db, row.id);
	return formId;
}

/** the element whose opening tag carries `attribute`, to its closing tag. */
function element(html: string, tag: string, attribute: string): string {
	const found = new RegExp(`<${tag}[^>]*${attribute}[^>]*>[\\s\\S]*?</${tag}>`).exec(html);
	return found?.[0] ?? '';
}

describe('an ended campaign at its address', () => {
	it('says it has ended and sends the donor on to /donate, with nothing to give through', async () => {
		await endedCampaign();

		const answered = await visit();
		expect(answered.status).toBe(200);
		expect(answered.headers.get('cache-control')).toBe('no-store');
		const html = markup(answered.data);
		expect(element(html, 'h1', '')).toContain('Winter coat drive has ended');
		const link = element(html, 'a', 'href="/donate"');
		expect(link).toContain('part="action"');
		expect(link).toContain('Donate to Hope Foundation');
		expect(html).toMatch(/^<div[^>]*data-donate-root/);
		expect(html).not.toContain('data-block=');
		expect(html).not.toContain('$25');
	});

	it('says in the tab that it has ended', async () => {
		await endedCampaign();
		const answered = await visit();
		expect(campaignPage.meta({ loaderData: answered.data } as unknown as Route.MetaArgs)).toEqual([
			{ title: 'Winter coat drive has ended' }
		]);
	});

	it('refuses a new gift against its settings row as an unpublished form refuses one', async () => {
		const ended = await endedCampaign();
		const settings = parseFormInput({ ...NEW_FORM, name: 'embedded appeal', status: 'draft' });
		if (!settings.ok) throw new Error('the fixture draft form did not parse');
		const draft = ownedFormInsert(db, settings.value);
		await draft.statement;

		const answers = await giftAnswers(ended);
		expect(answers).toEqual({
			config: { status: 409, error: 'form_not_published' },
			gift: { status: 409, error: 'form_not_published' }
		});
		expect(answers).toEqual(await giftAnswers(draft.id));
	});
});

/** the end of Dec 31, 2026 in New York: the instant a campaign ending that day ends. */
const ENDS_AT = Date.parse('2027-01-01T04:59:59.999Z');

/** a live campaign whose published page ends at `ENDS_AT`; its owned form's id. */
function endingCampaign(fixture: Campaign = {}): Promise<string> {
	return campaign({
		...fixture,
		published: { ...defaultCampaign(), endsAt: ENDS_AT, endsZone: 'America/New_York' }
	});
}

/** the clock every read in the test takes its `now` from. */
function clockAt(now: number) {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(now);
}

describe('a live campaign at its published end date', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('draws its page, and serves its donation box, up to its end instant', async () => {
		const formId = await endingCampaign();
		clockAt(ENDS_AT - 1);
		expect((await visit()).data.kind).toBe('page');
		expect((await giftAnswers(formId)).config.status).toBe(200);
	});

	it('draws its page when the request came in before its end instant, however long the reads take', async () => {
		await endingCampaign();
		// every read of the clock a millisecond on from the last, the first a millisecond short
		let reading = ENDS_AT - 1;
		vi.spyOn(Date, 'now').mockImplementation(() => reading++);

		expect((await visit()).data.kind).toBe('page');
	});

	it('answers from its end instant exactly as a campaign End ended', async () => {
		await endingCampaign();
		await endedCampaign({ slug: 'ended-by-end' });
		clockAt(ENDS_AT);

		const byDate = await visit();
		const ended = await visit('/ended-by-end');
		expect(byDate.data.kind).toBe('ended');
		expect(byDate.status).toBe(ended.status);
		expect(byDate.headers.get('cache-control')).toBe('no-store');
		expect(markup(byDate.data)).toBe(markup(ended.data));
	});

	it('refuses a new gift from its end instant exactly as a campaign End ended', async () => {
		const byDate = await endingCampaign();
		const byEnd = await endedCampaign({ slug: 'ended-by-end' });
		clockAt(ENDS_AT);

		const answers = await giftAnswers(byDate);
		expect(answers).toEqual({
			config: { status: 409, error: 'form_not_published' },
			gift: { status: 409, error: 'form_not_published' }
		});
		expect(answers).toEqual(await giftAnswers(byEnd));
	});

	it('ends nothing by an end date only its draft holds, however long past', async () => {
		const formId = await campaign();
		await db
			.update(page)
			.set({
				draft: JSON.stringify({
					...defaultCampaign(),
					endsAt: ENDS_AT,
					endsZone: 'America/New_York'
				})
			})
			.where(eq(page.formId, formId));
		clockAt(ENDS_AT + 365 * 86_400_000);
		expect((await visit()).data.kind).toBe('page');
		expect((await giftAnswers(formId)).config.status).toBe(200);
	});

	it('never ends by itself with no end date', async () => {
		const formId = await campaign();
		clockAt(Date.parse('2100-01-01T00:00:00Z'));
		expect((await visit()).data.kind).toBe('page');
		expect((await giftAnswers(formId)).config.status).toBe(200);
	});
});

/** the served config endpoint and the gift endpoint, each under the api surface's layout. */
const configRoute = mountRoutes([
	{ path: 'api/v1', module: surface },
	{ path: 'forms/:id/config', module: servedConfig }
]);
const giftRoute = mountRoutes([
	{ path: 'api/v1', module: surface },
	{ path: 'forms/:id/donations', module: gifts }
]);

/**
 * a caller of its own for each request, so no meter answers for the form: one `/64` each, since
 * that is one caller to the surface's and the quote's buckets ($lib/server/api/rate-limit.ts).
 */
let callers = 0;
function nextCaller(): string {
	callers += 1;
	return `2001:db8:59:${callers.toString(16)}::1`;
}

/** what the card on a donor page here is answered for `formId`: its config, then a gift. */
async function giftAnswers(formId: string) {
	const headers = () =>
		new Headers({
			origin: OWN,
			accept: 'application/json',
			'content-type': 'application/json',
			'cf-connecting-ip': nextCaller()
		});
	const config = await configRoute(
		new Request(`${OWN}/api/v1/forms/${formId}/config`, { headers: headers() }),
		{ env: stripeEnv }
	);
	const gift = await giftRoute(
		new Request(`${OWN}/api/v1/forms/${formId}/donations`, {
			method: 'POST',
			headers: headers(),
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
				turnstileToken: 'tok'
			})
		}),
		{ env: stripeEnv }
	);
	const code = async (response: Response) => ((await response.json()) as { error?: string }).error;
	return {
		config: { status: config.status, error: await code(config) },
		gift: { status: gift.status, error: await code(gift) }
	};
}

describe('an address no published campaign answers', () => {
	/** the refusal every one of these draws: a 404 nothing keeps, naming nobody. */
	function expectRefused(answered: Awaited<ReturnType<typeof visit>>): void {
		expect(answered.status).toBe(404);
		expect(answered.headers.get('cache-control')).toBe('no-store');
		expect(answered.data).toEqual({ kind: 'refused' });
		expect(markup(answered.data)).toContain(NO_FORM);
		expect(campaignPage.meta({ loaderData: answered.data } as unknown as Route.MetaArgs)).toEqual([
			{ title: 'Donate' }
		]);
	}

	it('refuses a campaign never published', async () => {
		await campaign({ state: 'never_published' });
		expectRefused(await visit());
	});

	it('refuses a slug no campaign holds', async () => {
		await campaign();
		expectRefused(await visit('/summer-fun-run'));
	});
});

describe('an address no campaign could hold', () => {
	/** the Stripe env with a database that fails the test on any use at all. */
	const unreadable = new Proxy(stripeEnv, {
		get: (target, property) =>
			property === 'DB'
				? new Proxy(env.DB, {
						get: () => () => {
							throw new Error('the loader read the database for an address no campaign holds');
						}
					})
				: Reflect.get(target, property)
	}) as Env;

	// the router matches in any case, so the capitals arrive here; a slug is lowercase, and the
	// address is refused rather than sent on to the one spelled the other way.
	it.each(['/.env', '/wp-login.php', '/api', '/Winter-Coat-Drive', `/${'a'.repeat(61)}`])(
		'refuses %s without reading the database',
		async (address) => {
			await campaign();
			const answered = await visit(address, unreadable);
			expect(answered.status).toBe(404);
			expect(answered.headers.get('cache-control')).toBe('no-store');
			expect(answered.data).toEqual({ kind: 'refused' });
		}
	);
});

describe('a campaign after its editor’s Publish', () => {
	const editorRoute = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/campaigns/:pageId', module: editor }
	]);
	let session: string;

	beforeAll(async () => {
		session = await signIn(db);
	});

	beforeEach(async () => {
		await env.DB.batch([
			env.DB.prepare('delete from chat_turn'),
			env.DB.prepare('delete from page'),
			env.DB.prepare('delete from form'),
			env.DB.prepare('delete from program')
		]);
	});

	/** a press on the campaign's editor, drawn at the version the page holds now. */
	async function press(pageId: string, which: string, fields: Record<string, string> = {}) {
		const [row] = await db.select().from(page).where(eq(page.id, pageId));
		if (!row) throw new Error(`no page ${pageId} to press on`);
		const body = new FormData();
		body.set(WHICH_FORM, which);
		body.set(RECORD_VERSION, String(row.updatedAt.getTime()));
		for (const [name, value] of Object.entries(fields)) body.set(name, value);
		const response = await editorRoute(
			new Request(`${ORIGIN}/admin/campaigns/${pageId}`, {
				method: 'POST',
				headers: { cookie: session },
				body
			}),
			{ env }
		);
		expect(response.status).toBe(200);
	}

	/** New campaign's create, with no line for the chat. */
	const create = (title: string) =>
		createCampaign(db, env, { title, line: '', timeZone: 'America/New_York', now: Date.now() });

	it('publishes a new campaign from “Winter coat drive” at /winter-coat-drive, gifts going to the program chosen', async () => {
		const [coats] = await db
			.insert(program)
			.values({ name: 'Winter coats' })
			.returning({ id: program.id });
		const { pageId } = await create('Winter coat drive');
		expect((await visit()).status).toBe(404);

		await press(pageId, 'page-first-publish', { gifts_go_to: coats?.id ?? '' });

		const answered = await visit('/winter-coat-drive');
		expect(answered.status).toBe(200);
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.config.program).toEqual({ mode: 'pinned', name: 'Winter coats' });
		expect(block(markup(answered.data), 'title')).toContain('Winter coat drive');
	});

	it('brings an ended campaign back at the next free address when its own was taken', async () => {
		const { pageId: ended } = await create('Winter coat drive');
		await press(ended, 'page-first-publish', { gifts_go_to: 'none' });
		await endAsItStands(db, ended);
		const { pageId: taker } = await create('Coats for kids');
		await press(taker, 'campaign-address', { slug: 'winter-coat-drive', takeover: 'on' });
		await press(taker, 'page-first-publish', { gifts_go_to: 'none' });

		await press(ended, 'page-publish');

		const back = await visit('/winter-coat-drive-2');
		expect(back.status).toBe(200);
		if (back.data.kind !== 'page') throw new Error(`drew ${back.data.kind}`);
		expect(block(markup(back.data), 'title')).toContain('Winter coat drive');
		const [row] = await db.select().from(page).where(eq(page.id, ended));
		expect(back.data.view.config.formId).toBe(row?.formId);
		const held = await visit('/winter-coat-drive');
		if (held.data.kind !== 'page') throw new Error(`drew ${held.data.kind}`);
		expect(block(markup(held.data), 'title')).toContain('Coats for kids');
	});
});
