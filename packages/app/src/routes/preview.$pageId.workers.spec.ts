import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb } from '$lib/server/db/client';
import { form, page as pageTable } from '$lib/server/db/schema';
import { parseFormInput } from '$lib/server/forms/form-input';
import { ownedFormInsert, readForm } from '$lib/server/forms/queries';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { BLOCK_FORMS } from '$lib/page/block-edit';
import { jpegHeader } from '$lib/server/images/headers.testing';
import { createImage } from '$lib/server/images/queries';
import { saveBlockForm } from '$lib/server/pages/blocks';
import { ensureDonationPage } from '$lib/server/pages/donation-page';
import { draftTurn } from '$lib/server/pages/draft';
import { answering } from '$lib/server/pages/page-row.testing';
import { readPage } from '$lib/server/pages/queries';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { NEW_FORM } from '$lib/forms/new-form';
import { defaultCampaign, defaultDonationPage } from '$lib/page/defaults';
import { mountRoutes } from '../route-request.testing';
import type { Route } from './+types/preview.$pageId';
import * as preview from './preview.$pageId';

// the editor's preview at /preview/{pageId}, against the real D1 the pool binds.
//
// the chain is mounted rather than the loader called (../route-request.testing.ts): the session gate
// is this route's own `middleware`, so a loader called on its own is a loader with no gate above it.
// which headers the document carries is ../entry.server.workers.spec.ts's, where documents are drawn.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

/** a deployment whose Stripe pair is set and agrees, so the env is never what refuses. */
const STRIPE = {
	STRIPE_SECRET_KEY: 'sk_test_abc',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
	STRIPE_WEBHOOK_SECRET: 'whsec_abc'
};

/** the pool's env with the Stripe pair set, as a proxy rather than a copy. */
const DEPLOYED = new Proxy(env, {
	get: (target, property) =>
		typeof property === 'string' && property in STRIPE
			? STRIPE[property as keyof typeof STRIPE]
			: Reflect.get(target, property)
}) as Env;

const db = createDb(env.DB);
const request = mountRoutes([{ path: 'preview/:pageId', module: preview }]);
let session: string;

beforeAll(async () => {
	session = await signIn();
});

beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare('delete from chat_turn'),
		env.DB.prepare('delete from page'),
		env.DB.prepare('delete from form'),
		env.DB.prepare('delete from org_profile')
	]);
	await writeOrgRow(env.DB, { tax_id: '12-3456789' });
	// the served cadences, warmed so the loader never sends the fixture key to Stripe
	// ($lib/server/forms/cadence-cache.ts).
	await edgeCache().put(
		new Request(`${ORIGIN}/__recurring-cadences`),
		new Response(JSON.stringify(['one_time', 'yearly']), {
			headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
		})
	);
});

/** a real session, as the `Cookie` header a browser would send back. */
async function signIn(): Promise<string> {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);
	const auth = createAuth(
		db,
		{ ADMIN_PASSWORD: PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);
	const { headers } = await auth.api.signInStaff({
		body: { password: PASSWORD },
		headers: new Headers({ origin: ORIGIN }),
		returnHeaders: true
	});
	return headers
		.getSetCookie()
		.map((value) => value.split(';', 1)[0])
		.join('; ');
}

describe('a signed-out request for a preview', () => {
	it('is sent to the sign-in carrying where it was going, and reads no page', async () => {
		const page = await ensureDonationPage(db);
		const answered = await request(new Request(`${ORIGIN}/preview/${page.id}`));
		expect(answered.status).toBe(303);
		expect(answered.headers.get('location')).toBe(
			`/login?next=${encodeURIComponent(`/preview/${page.id}`)}`
		);
	});
});

type LoaderData = Route.ComponentProps['loaderData'];
type DrawnPage = Extract<LoaderData, { kind: 'page' }>['view'];

/** what the preview's loader answers one signed-in request with. */
async function load(pageId: string): Promise<LoaderData> {
	const answered = await request(
		new Request(`${ORIGIN}/preview/${pageId}`, { headers: { cookie: session } }),
		{ env: DEPLOYED }
	);
	expect(answered.status).toBe(200);
	return (await answered.json()) as LoaderData;
}

/** the page the preview draws; a preview drawing anything else fails. */
async function open(pageId: string): Promise<DrawnPage> {
	const data = await load(pageId);
	if (data.kind !== 'page') throw new Error(`the preview drew ${data.kind}`);
	return data.view;
}

describe('the preview of a page whose draft is not what is published', () => {
	it('draws the draft, in preview', async () => {
		const page = await ensureDonationPage(db);
		const draft = defaultDonationPage();
		const title = draft.blocks.find((block) => block.type === 'title');
		if (title?.type !== 'title') throw new Error('the default page has no title');
		title.heading = 'Coats before the first frost';
		await env.DB.prepare('update page set draft = ? where id = ?')
			.bind(JSON.stringify(draft), page.id)
			.run();

		const view = await open(page.id);
		const drawn = view.page.blocks.find((block) => block.type === 'title');
		expect(drawn?.type === 'title' ? drawn.heading : null).toBe('Coats before the first frost');
		expect(view.preview).toBe(true);
	});

	it('opens the box as the draft’s switches say, where the published page’s are off', async () => {
		const page = await ensureDonationPage(db);
		const draft = {
			...defaultDonationPage(),
			switches: { openOnMonthly: true, dedicationOn: true }
		};
		await env.DB.prepare('update page set draft = ? where id = ?')
			.bind(JSON.stringify(draft), page.id)
			.run();

		expect((await open(page.id)).opening).toEqual({ monthly: true, dedication: true });
	});
});

/**
 * a campaign nobody has published: its settings row is made as a new form is, in `draft`, so it
 * takes no gift until the first Publish.
 */
async function neverPublishedCampaign(document: unknown): Promise<{ id: string; formId: string }> {
	const settings = parseFormInput({ ...NEW_FORM, name: 'Winter coat drive' });
	if (!settings.ok)
		throw new Error(`the fixture settings did not parse: ${JSON.stringify(settings)}`);
	const owned = ownedFormInsert(db, settings.value);
	const [, [made]] = await db.batch([
		owned.statement,
		db
			.insert(pageTable)
			.values({
				type: 'campaign',
				name: 'Winter coat drive',
				slug: 'winter-coat-drive',
				state: 'never_published',
				formId: owned.id,
				draft: JSON.stringify(document)
			})
			.returning({ id: pageTable.id })
	]);
	if (!made) throw new Error('inserting the fixture campaign returned no row');
	return { id: made.id, formId: owned.id };
}

describe('the donation box in a preview', () => {
	it('is drawn for a campaign whose settings row takes no gifts yet', async () => {
		const campaign = await neverPublishedCampaign(defaultCampaign());
		expect((await readForm(db, campaign.formId))?.status).toBe('draft');

		const { config } = await open(campaign.id);
		expect(config.formId).toBe(campaign.formId);
		expect(config.suggestedAmountsMinor).toEqual([2500, 5000, 10000]);
	});

	it('is drawn for a live campaign past its published end date, as for one End ended', async () => {
		const campaign = await neverPublishedCampaign(defaultCampaign());
		const published = { ...defaultCampaign(), endsAt: Date.now() - 1_000, endsZone: 'UTC' };
		await db.batch([
			db
				.update(pageTable)
				.set({ state: 'live', published: JSON.stringify(published) })
				.where(eq(pageTable.id, campaign.id)),
			db.update(form).set({ status: 'live' }).where(eq(form.id, campaign.formId))
		]);

		const { config } = await open(campaign.id);
		expect(config.formId).toBe(campaign.formId);
	});

	it('offers the donation settings the draft holds, over the row’s', async () => {
		const campaign = await neverPublishedCampaign(defaultCampaign());
		const row = await readForm(db, campaign.formId);
		if (row === null) throw new Error('the fixture campaign has no settings row');
		await env.DB.prepare('update page set draft = ? where id = ?')
			.bind(
				JSON.stringify({
					...defaultCampaign(),
					settings: {
						revenueAccountId: row.revenueAccountId,
						minMinor: 500,
						maxMinor: 50_000,
						currency: 'USD',
						programMode: 'none',
						programId: null,
						suggestedAmounts: [1500, 4000],
						allowedOrigins: []
					}
				}),
				campaign.id
			)
			.run();

		const { config } = await open(campaign.id);
		expect(config.suggestedAmountsMinor).toEqual([1500, 4000]);
		expect(config.minAmountMinor).toBe(500);
		expect(config.maxAmountMinor).toBe(50_000);
	});
});

describe('a picture the chat had drawn', () => {
	it('is marked an illustration where the draft places it, and no longer once a photo replaces it by hand', async () => {
		const campaign = await neverPublishedCampaign(defaultCampaign());
		let binary = '';
		for (const byte of jpegHeader(1024, 768)) binary += String.fromCharCode(byte);
		const AI = answering({
			say: 'Added a picture.',
			page: {
				kind: 'patch',
				ops: [{ op: 'replace', path: '/blocks/0/props/imageId', value: { illustrate: 'a van' } }]
			}
		});
		AI.run.mockImplementationOnce(async () => ({ image: btoa(binary) }));
		await draftTurn(
			db,
			{ ...env, AI },
			{
				pageId: campaign.id,
				message: 'no photo yet',
				imageIds: [],
				timeZone: 'UTC',
				now: Date.now()
			}
		);
		const hero = async () => (await open(campaign.id)).page.blocks[0];
		expect(await hero()).toMatchObject({ type: 'hero', illustration: true });

		const row = await readPage(db, campaign.id);
		if (row === null) throw new Error('the fixture campaign is gone');
		const photo = await createImage(
			db,
			{ kind: 'photo', contentType: 'image/webp', width: 4, height: 3, alt: null },
			new Uint8Array([1, 2, 3])
		);
		const body = new FormData();
		body.set(WHICH_FORM, BLOCK_FORMS.photo);
		body.set(RECORD_VERSION, String(row.updatedAt.getTime()));
		body.set('block_id', 'hero');
		body.set('image_id', photo);
		body.set('alt', 'Volunteers');
		await saveBlockForm(db, { type: 'campaign', id: campaign.id }, BLOCK_FORMS.photo, body, 'gone');

		expect(await hero()).toMatchObject({ type: 'hero', imageId: photo, illustration: false });
	});
});

describe('a draft the read rule refuses', () => {
	it('draws its donation box alone, and inert', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const campaign = await neverPublishedCampaign({});
		const data = await load(campaign.id);
		expect(data.kind).toBe('plain');
		const html = renderToStaticMarkup(
			createElement(preview.default, { loaderData: data } as unknown as Route.ComponentProps)
		);
		expect(html).toMatch(/^<div inert="">/);
		expect(html).toContain('$25');
	});
});
