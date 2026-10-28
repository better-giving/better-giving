import { eq } from 'drizzle-orm';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RESUME_FORM_PARAM } from '@better-giving/form/embed/resume';
import {
	createStaticHandler,
	type LoaderFunction,
	type MiddlewareFunction,
	type ShouldRevalidateFunctionArgs
} from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_FORM, RESUMING_HEADING, STEP_HEADINGS } from '$lib/donate/copy';
import { shownStep } from '$lib/donate/shown-step.testing';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { defaultDonationPage } from '$lib/page/defaults';
import { createDb } from '$lib/server/db/client';
import { page, program } from '$lib/server/db/schema';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { createImage } from '$lib/server/images/image.testing';
import { putLogo } from '$lib/server/org/logo.testing';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { saveProfile } from '$lib/server/org/profile.testing';
import { ORIGIN, PASSWORD, signIn } from '../program-routes.testing';
import { requestContext } from '../request-context';
import { mountRoutes, queryDocument } from '../route-request.testing';
import { finishSetup } from '../webhook-routes.testing';
import * as layout from './_app';
import * as editor from './_app.admin.donation-page';
import * as surface from './api.v1';
import * as gifts from './api.v1.forms.$id.donations';
import type { Route } from './+types/donate';
import * as donatePage from './donate';
import type { Route as PreviewRoute } from './+types/preview.$pageId';
import * as preview from './preview.$pageId';
import { client, first, run, stmt } from '$lib/server/db/database.testing';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { readEnv } from '$lib/server/runtime/env';
import { specRateLimiters } from '$lib/server/runtime/rate-limiter.testing';

/** the deploy-time values a request reads, with none set and the spec limiters. */
const env = readEnv({}, specRateLimiters());

// the donation page at /donate, against a real database.
//
// a db spec because every answer here is decided from rows — the page, its owned settings row,
// the organisation's profile and story, the programs — and standing in for the database would only prove the
// stand-in (CONTRIBUTING.md → Tests). the loader runs through react router's own matcher, as
// ./login.db.spec.ts argues, so the status a refusal carries is the framework's.

/** this deployment's own origin, which every request in this file is made to. */
const OWN = 'https://give.example.workers.dev';

/** a deployment whose Stripe pair is set and agrees, so the env is never what refuses. */
const STRIPE = {
	STRIPE_SECRET_KEY: 'sk_test_abc',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
	STRIPE_WEBHOOK_SECRET: 'whsec_abc'
};

const MISSION = 'We keep every family on Elm Street fed through the winter.';

const db = createDb(client);

beforeEach(async () => {
	await client.batch([
		stmt('delete from page'),
		stmt('delete from form'),
		stmt('delete from program'),
		stmt('delete from org_profile')
	]);
	await writeOrgRow(client, { tax_id: '12-3456789' });
	await warmCadences();
});

/**
 * the address the served cadences are kept under, warmed before every read so the loader never
 * sends the fixture key to Stripe ($lib/server/forms/cadence-cache.ts).
 */
const CADENCE_KEY = new Request(`${OWN}/__recurring-cadences`);

async function warmCadences(): Promise<void> {
	await edgeCache().put(
		CADENCE_KEY,
		new Response(JSON.stringify(['one_time', 'yearly']), {
			headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
		})
	);
}

/** the spec env with the deploy-time values a case wants set. */
function envWith(values: Record<string, string>): Env {
	return { ...env, ...values } as Env;
}

const ROUTE_ID = 'donate';
const handler = createStaticHandler([
	{
		id: ROUTE_ID,
		path: 'donate',
		middleware: donatePage.middleware as unknown as MiddlewareFunction[],
		loader: donatePage.loader as unknown as LoaderFunction
	}
]);

type LoaderData = Route.ComponentProps['loaderData'];

async function visit(
	vars: Record<string, string> = STRIPE,
	headers: Record<string, string> = {},
	search = ''
): Promise<{ status: number; data: LoaderData; headers: Headers }> {
	const answered = await queryDocument(
		handler,
		new Request(`${OWN}/donate${search}`, { headers }),
		requestContext({ env: envWith(vars), deferred: createDeferredWork(), client })
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
		createElement(donatePage.default, { loaderData } as unknown as Route.ComponentProps)
	);
}

/** one area of the page, from its opening tag to the next area's, by the name the renderer stamps on it. */
function area(html: string, name: string): string {
	const start = html.indexOf(`data-area="${name}"`);
	if (start === -1) return '';
	const next = html.indexOf('data-area=', start + 1);
	return html.slice(start, next === -1 ? undefined : next);
}

async function activePrograms(...names: string[]): Promise<void> {
	for (const name of names) await db.insert(program).values({ name });
}

async function donationPageRows(): Promise<number> {
	const row = await first<{ n: number }>(
		stmt(`select count(*) as n from page where type = 'donation_page'`)
	);
	return row?.n ?? 0;
}

describe('GET /donate on a fresh deployment', () => {
	it('draws the default page, the mission in About us and the active programs in the chooser', async () => {
		await saveProfile(db, { mission: MISSION });
		await activePrograms('Food bank', 'Winter shelter');

		const answered = await visit();
		expect(answered.status).toBe(200);
		const html = markup(answered.data);
		expect(area(html, 'title')).toContain('Donate to Hope Foundation');
		expect(area(html, 'about')).toContain(MISSION);
		expect(area(html, 'chooser')).toContain('Food bank');
		expect(area(html, 'chooser')).toContain('Winter shelter');
		expect(await donationPageRows()).toBe(1);
	});

	it('draws the chooser once two programs are active, on a page made before any was', async () => {
		expect(area(markup((await visit()).data), 'chooser')).toBe('');

		await activePrograms('Food bank', 'Winter shelter');

		const chooser = area(markup((await visit()).data), 'chooser');
		expect(chooser).toContain('Food bank');
		expect(chooser).toContain('Winter shelter');
	});
});

describe('the organisation’s mission and vision on /donate', () => {
	it('are the profile’s, drawn in About us', async () => {
		await saveProfile(db, { mission: MISSION, vision: 'No family on Elm Street goes hungry.' });

		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.org).toMatchObject({
			mission: MISSION,
			vision: 'No family on Elm Street goes hungry.'
		});
		const about = area(markup(answered.data), 'about');
		expect(about).toContain(MISSION);
		expect(about).toContain('No family on Elm Street goes hungry.');
	});

	it('leave a vision the profile holds none of out', async () => {
		await saveProfile(db, { mission: MISSION });

		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.org).toMatchObject({ mission: MISSION, vision: null });
		expect(area(markup(answered.data), 'about')).not.toContain('Our vision');
	});

	it('draw no About us where the profile holds neither', async () => {
		await saveProfile(db);

		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.org).toMatchObject({ mission: null, vision: null });
		expect(area(markup(answered.data), 'about')).toBe('');
	});
});

describe('the page /donate draws', () => {
	// the stored heading is empty, so the title is the organisation's name on the day it is drawn.
	it('greets donors by the organisation’s name as it stands, after a rename', async () => {
		await visit();
		await run(stmt(`update org_profile set legal_name = 'Hope Foundation of Easton'`));
		const html = markup((await visit()).data);
		expect(area(html, 'title')).toContain('Donate to Hope Foundation of Easton');
	});

	it('shares its own address on this deployment, with the page title as the message', async () => {
		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.sharing).toEqual({
			message: 'Donate to Hope Foundation',
			url: `${OWN}/donate`
		});
	});

	it('names the organisation in the tab, and shares no image', async () => {
		const answered = await visit();
		expect(donatePage.meta({ loaderData: answered.data } as unknown as Route.MetaArgs)).toEqual([
			{ title: 'Donate to Hope Foundation' }
		]);
	});

	/**
	 * the served config and never the row it was read from: a loader's value is serialized into the
	 * document, and the row carries `allowed_origins`.
	 */
	it('hands the browser the served config and not the settings row', async () => {
		await visit();
		await run(stmt(`update form set allowed_origins = '["https://acme.org"]'`));
		const answered = await visit();
		expect(JSON.stringify(answered.data)).not.toContain('acme.org');
	});
});

/** the masthead the page opens with. */
function masthead(html: string): string {
	return /<header class="page-mast"[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
}

describe('the organisation’s logo on /donate', () => {
	it('stands atop the page by its id, at its stored size, once one is set', async () => {
		const id = await putLogo(db, { contentType: 'image/png', width: 640, height: 160 });

		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.logo).toEqual({ imageId: id, width: 640, height: 160 });
		const mast = masthead(markup(answered.data));
		expect(mast).toContain(`src="/image/${id}"`);
		expect(mast).toContain('width="640"');
		expect(mast).toContain('height="160"');
	});

	it('is not drawn where none is set, and the masthead names the organisation', async () => {
		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.logo).toBeNull();
		const mast = masthead(markup(answered.data));
		expect(mast).not.toContain('<img');
		expect(mast).toContain('Hope Foundation');
	});
});

describe('program photos on the /donate chooser', () => {
	it('are handed by program id for the programs that have one, and drawn by the photo’s id', async () => {
		const photo = await createImage(
			db,
			{ kind: 'photo', contentType: 'image/webp', width: 1600, height: 1067, alt: null },
			new Uint8Array([1])
		);
		const [food] = await db
			.insert(program)
			.values({ name: 'Food bank', imageId: photo })
			.returning({ id: program.id });
		await activePrograms('Winter shelter');

		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.programPhotos).toEqual({ [food?.id ?? '']: photo });
		const chooser = area(markup(answered.data), 'chooser');
		expect(chooser.match(/<img[^>]*src="\/image\/[^"]*"/g)).toEqual([
			expect.stringContaining(`src="/image/${photo}"`)
		]);
	});

	it('hand none for an archived program’s photo, beside a chooser that is drawn', async () => {
		const photo = await createImage(
			db,
			{ kind: 'photo', contentType: 'image/webp', width: 1600, height: 1067, alt: null },
			new Uint8Array([1])
		);
		await db.insert(program).values({
			name: 'Old roof fund',
			imageId: photo,
			status: 'archived',
			archivedAt: new Date()
		});
		await activePrograms('Food bank', 'Winter shelter');

		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(area(markup(answered.data), 'chooser')).toContain('Winter shelter');
		expect(answered.data.view.programPhotos).toEqual({});
		expect(markup(answered.data)).not.toContain(photo);
	});
});

describe('the organisation’s social links on /donate', () => {
	it('are the profile’s, in its order, in the org info block', async () => {
		await saveProfile(db, {}, [
			'https://instagram.com/hopefoundation',
			'https://facebook.com/hope'
		]);

		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.org.info.socialLinks).toEqual([
			{ platform: 'instagram', href: 'https://instagram.com/hopefoundation' },
			{ platform: 'facebook', href: 'https://facebook.com/hope' }
		]);
		const html = markup(answered.data);
		const info = html.slice(html.indexOf('<footer'));
		expect(info.indexOf('instagram.com/hopefoundation')).toBeLessThan(
			info.indexOf('facebook.com/hope')
		);
	});

	it('are none where the profile holds none', async () => {
		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.org.info.socialLinks).toEqual([]);
	});
});

describe('the share message /donate sends', () => {
	it('is the page’s own where it holds one', async () => {
		await visit();
		const row = await first<{ published: string }>(
			stmt(`select published from page where type = 'donation_page'`)
		);
		if (!row) throw new Error('the Donation page was not made');
		await run(
			stmt(
				`update page set published = ? where type = 'donation_page'`,
				JSON.stringify({ ...JSON.parse(row.published), shareMessage: 'Warm a family tonight.' })
			)
		);
		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.sharing.message).toBe('Warm a family tonight.');
	});
});

/** the brand colour the page root sets, read off the drawn page as the browser receives it. */
function brandColour(html: string): string | null {
	const root = /<div[^>]*data-donate-root[^>]*>/.exec(html)?.[0];
	if (root === undefined) throw new Error('the page drew no root');
	return /--donate-primary:([^;"]*)/.exec(root)?.[1] ?? null;
}

describe('the colour /donate is drawn in', () => {
	it('is the form’s own where the profile holds none', async () => {
		expect(brandColour(markup((await visit()).data))).toBeNull();
	});

	it('is the profile’s brand colour', async () => {
		await saveProfile(db, { brand_colour: '#1d6b4f' });
		expect(brandColour(markup((await visit()).data))).toBe('#1d6b4f');
	});
});

describe('a published Donation page the read rule refuses', () => {
	async function publish(document: unknown): Promise<string> {
		await visit();
		await run(
			stmt(`update page set published = ? where type = 'donation_page'`, JSON.stringify(document))
		);
		const row = await first<{
			form_id: string;
		}>(stmt(`select form_id from page where type = 'donation_page'`));
		if (!row) throw new Error('no Donation page was made');
		return row.form_id;
	}

	/** a spy on the log the refusal is written to, holding back what it prints. */
	function logged() {
		return vi.spyOn(console, 'error').mockImplementation(() => {});
	}

	it.each([
		{ why: 'missing its shape', document: {} },
		{
			why: 'holding a lede its type forbids',
			document: { ...defaultDonationPage(), lede: 'only a campaign has a lede' }
		}
	])('draws the donation box alone when $why, and logs it', async ({ document }) => {
		const formId = await publish(document);
		const log = logged();

		const answered = await visit();
		expect(answered.status).toBe(200);
		if (answered.data.kind !== 'plain') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.config.formId).toBe(formId);
		const html = markup(answered.data);
		expect(html).toContain('$25');
		expect(html).not.toContain('data-area="title"');
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining('fails the read rule'),
			expect.any(String)
		);
	});
});

describe('/donate where the served config refuses', () => {
	// the deployment is unfinished rather than the link wrong, and the donor is told the same thing
	// either way: there is nothing they can do about which of the two it is.
	it('draws the notice with a 404 nothing keeps, and names nobody in the tab', async () => {
		await run(stmt('delete from org_profile'));
		const answered = await visit();
		expect(answered.status).toBe(404);
		expect(answered.headers.get('cache-control')).toBe('no-store');
		expect(markup(answered.data)).toContain(NO_FORM);
		expect(donatePage.meta({ loaderData: answered.data } as unknown as Route.MetaArgs)).toEqual([
			{ title: 'Donate' }
		]);
	});
});

describe('a deployment with no website', () => {
	it('answers /donate with no site row', async () => {
		await run(stmt('delete from site'));

		expect((await visit()).status).toBe(200);
	});
});

describe('/donate after the editor’s presses', () => {
	const editorRoute = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/donation-page', module: editor }
	]);
	const previewRoute = mountRoutes([{ path: 'preview/:pageId', module: preview }]);
	const giftRoute = mountRoutes([
		{ path: 'api/v1', module: surface },
		{ path: 'forms/:id/donations', module: gifts }
	]);
	let session: string;
	/** the deployment the editor is pressed on: the organisation's row, processor keys and mail. */
	let finished: Env;

	beforeAll(async () => {
		session = await signIn(db);
	});

	beforeEach(async () => {
		finished = await finishSetup(PASSWORD);
	});

	/** a press on the Donation page's edit page, drawn at the version the page holds now. */
	async function press(which: string, fields: Record<string, string> = {}) {
		const [row] = await db.select().from(page);
		if (!row) throw new Error('there is no Donation page to press on');
		const body = new FormData();
		body.set(WHICH_FORM, which);
		body.set(RECORD_VERSION, String(row.updatedAt.getTime()));
		for (const [name, value] of Object.entries(fields)) body.set(name, value);
		const response = await editorRoute(
			new Request(`${ORIGIN}/admin/donation-page`, {
				method: 'POST',
				headers: { cookie: session },
				body
			}),
			{ env: finished }
		);
		expect(response.status).toBe(200);
	}

	/** the draft's donation settings saved from the edit page's Donation settings card: $200 to $20,000. */
	const saveSettings = () =>
		press('donation-page-giving', {
			program_mode: 'none',
			program_id: '',
			min_minor: '200',
			max_minor: '20000',
			'suggested_amounts[0]': '250'
		});

	async function documents() {
		const [row] = await db.select().from(page);
		if (!row) throw new Error('there is no Donation page to read');
		return { draft: JSON.parse(row.draft), published: JSON.parse(row.published ?? 'null') };
	}

	/** the draft's share message, as the editor's share message sheet leaves it. */
	async function draftMessage(message: string) {
		const [row] = await db.select().from(page);
		if (!row) throw new Error('there is no Donation page to write');
		await db
			.update(page)
			.set({
				draft: JSON.stringify({ ...JSON.parse(row.draft), shareMessage: message }),
				updatedAt: new Date(row.updatedAt.getTime() + 1_000)
			})
			.where(eq(page.id, row.id));
	}

	async function drawn() {
		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		return answered.data.view;
	}

	/** a network of its own for each gift, so the endpoint's meter never answers for the amount. */
	let callers = 0;
	/** what the gift endpoint answers a card gift of `amountMinor` on the Donation page's row. */
	async function giftOf(amountMinor: number): Promise<{ status: number; message: string }> {
		const { config } = await drawn();
		callers += 1;
		const response = await giftRoute(
			new Request(`${OWN}/api/v1/forms/${config.formId}/donations`, {
				method: 'POST',
				headers: {
					origin: OWN,
					accept: 'application/json',
					'content-type': 'application/json',
					[CLIENT_IP_HEADER]: `2001:db8:${1000 + callers}::1`
				},
				body: JSON.stringify({
					formId: config.formId,
					amountMinor,
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
			{ env: envWith(STRIPE) }
		);
		const { message } = (await response.json()) as { message: string };
		return { status: response.status, message };
	}

	it('draws the draft only once it is published', async () => {
		await visit();
		await draftMessage('Keep Elm Street warm this winter.');
		expect((await drawn()).sharing.message).toBe('Donate to Hope Foundation');

		await press('page-publish');
		expect((await drawn()).sharing.message).toBe('Keep Elm Street warm this winter.');
	});

	/** the page the editor's preview draws, as its document hands it to the browser. */
	async function previewed(): Promise<string> {
		const [row] = await db.select().from(page);
		if (!row) throw new Error('there is no Donation page to preview');
		await edgeCache().put(
			new Request(`${ORIGIN}/__recurring-cadences`),
			new Response(JSON.stringify(['one_time', 'yearly']), {
				headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
			})
		);
		const response = await previewRoute(
			new Request(`${ORIGIN}/preview/${row.id}`, { headers: { cookie: session } }),
			{ env: envWith(STRIPE) }
		);
		expect(response.status).toBe(200);
		const loaderData = (await response.json()) as PreviewRoute.ComponentProps['loaderData'];
		return renderToStaticMarkup(
			createElement(preview.default, { loaderData } as unknown as PreviewRoute.ComponentProps)
		);
	}

	it('shows the draft’s heading in the preview, and on /donate only once published', async () => {
		await visit();
		const [row] = await db.select().from(page);
		if (!row) throw new Error('there is no Donation page to write');
		await db
			.update(page)
			.set({
				draft: JSON.stringify({ ...JSON.parse(row.draft), heading: 'Give to Elm Street' }),
				updatedAt: new Date(row.updatedAt.getTime() + 1_000)
			})
			.where(eq(page.id, row.id));
		expect(area(await previewed(), 'title')).toContain('Give to Elm Street');
		expect(area(markup((await visit()).data), 'title')).toContain('Donate to Hope Foundation');

		await press('page-publish');
		expect(area(markup((await visit()).data), 'title')).toContain('Give to Elm Street');
	});

	it('keeps drawing the published page through Discard changes', async () => {
		await visit();
		await draftMessage('Keep Elm Street warm this winter.');

		await press('page-discard');

		expect((await drawn()).sharing.message).toBe('Donate to Hope Foundation');
	});

	it('serves the draft’s donation settings only once published', async () => {
		const opened = (await drawn()).config;
		await saveSettings();
		expect((await drawn()).config).toEqual(opened);

		await press('page-publish');
		expect((await drawn()).config).toMatchObject({
			minAmountMinor: 20_000,
			maxAmountMinor: 2_000_000,
			suggestedAmountsMinor: [25_000]
		});
	});

	it('draws the current default, with no heading of its own and sharing its title, after Reset', async () => {
		await saveProfile(db, { brand_colour: '#225588' });
		await visit();
		const [row] = await db.select().from(page);
		if (!row) throw new Error('there is no Donation page to write');
		await db
			.update(page)
			.set({
				draft: JSON.stringify({
					...JSON.parse(row.draft),
					heading: 'Give to Elm Street',
					shareMessage: 'Keep Elm Street warm this winter.'
				}),
				updatedAt: new Date(row.updatedAt.getTime() + 1_000)
			})
			.where(eq(page.id, row.id));
		await press('page-publish');
		expect((await drawn()).page.heading).toBe('Give to Elm Street');
		expect((await drawn()).sharing.message).toBe('Keep Elm Street warm this winter.');

		await press('page-reset');

		const view = await drawn();
		expect(view.page.heading).toBe(defaultDonationPage().heading);
		expect(view.look).toEqual({ brandColour: '#225588' });
		expect(view.sharing.message).toBe('Donate to Hope Foundation');
	});

	it.each([
		[
			'Open on monthly',
			'open_on_monthly',
			{ openOnMonthly: true, dedicationOn: false },
			{ monthly: true }
		],
		[
			'Dedication on by default',
			'dedication_on',
			{ openOnMonthly: false, dedicationOn: true },
			{ dedication: true }
		]
	])(
		'opens the box with “%s” only once a save ticking it is published',
		async (_, box, switches, opening) => {
			await visit();
			await press('donation-page-settings', { share_message: '', [box]: 'on' });

			const saved = await documents();
			expect(saved.draft.switches).toEqual(switches);
			expect(saved.published.switches).toEqual({ openOnMonthly: false, dedicationOn: false });
			expect((await drawn()).opening).toBeUndefined();

			await press('page-publish');
			expect((await drawn()).opening).toEqual(opening);
		}
	);

	it('checks a gift against the published donation settings, never the draft’s', async () => {
		await visit();
		await saveSettings();
		// $50 is inside the live $1–$10,000 and under the draft's $200; $15,000 the other way round.
		// a gift inside the bounds goes on to the spam check, which refuses it: this env sets no
		// turnstile keys, so the check is ALTCHA, and the gift carries no solution.
		const passedBounds = { status: 403, message: expect.stringContaining('`altchaPayload`') };
		const outside = (amount: number, range: string) => ({
			status: 400,
			message: `\`amountMinor\` is ${amount}, outside this form's range of ${range} minor units.`
		});
		expect(await giftOf(5_000)).toEqual(passedBounds);
		expect(await giftOf(1_500_000)).toEqual(outside(1_500_000, '100 to 1000000'));

		await press('page-publish');

		expect(await giftOf(5_000)).toEqual(outside(5_000, '20000 to 2000000'));
		expect(await giftOf(1_500_000)).toEqual(passedBounds);
	});
});

describe('the limit on GET /donate', () => {
	/** views the page from `ip` until refused, or fails loudly rather than asserting nothing. */
	async function untilRefused(ip: string) {
		for (let i = 0; i < 50; i++) {
			const answered = await visit(STRIPE, { [CLIENT_IP_HEADER]: ip });
			if (answered.status === 429) return answered;
		}
		throw new Error(`50 views from ${ip} and the limiter refused none of them`);
	}

	it('refuses a caller who has viewed too often with the plain notice', async () => {
		const refused = await untilRefused('203.0.113.90');

		expect(refused.data.kind).toBe('refused');
		expect(markup(refused.data)).toContain(NO_FORM);
		expect(refused.headers.get('retry-after')).toBe('60');
		expect(refused.headers.get('cache-control')).toBe('no-store');
	});

	// the page is made on first need, so a refused view that reached the loader would write one.
	it('refuses before the page is read or made', async () => {
		await untilRefused('203.0.113.91');
		await run(stmt(`delete from page where type = 'donation_page'`));

		const refused = await visit(STRIPE, { [CLIENT_IP_HEADER]: '203.0.113.91' });

		expect(refused.status).toBe(429);
		expect(await donationPageRows()).toBe(0);
	});
});

/** the id of the settings row the Donation page owns, made on first need by the visit. */
async function donationFormId(): Promise<string> {
	await visit();
	const row = await first<{
		form_id: string;
	}>(stmt(`select form_id from page where type = 'donation_page'`));
	if (!row) throw new Error('no Donation page was made');
	return row.form_id;
}

/** publishes a document the read rule refuses, so /donate draws the donation box alone. */
async function publishUnreadable(): Promise<void> {
	await visit();
	await run(stmt(`update page set published = '{}' where type = 'donation_page'`));
	vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('what /donate lets be kept', () => {
	// the amounts and settings drawn here are the page as it is now, and a kept copy would show a
	// donor figures the operator has since changed.
	it('lets nothing keep the drawn page', async () => {
		const answered = await visit();
		expect(answered.data.kind).toBe('page');
		expect(answered.headers.get('cache-control')).toBe('no-store');
	});

	it('lets nothing keep the donation box drawn alone', async () => {
		await publishUnreadable();
		const answered = await visit();
		expect(answered.data.kind).toBe('plain');
		expect(answered.headers.get('cache-control')).toBe('no-store');
	});
});

describe('a donor back on /donate from authorizing their gift', () => {
	// the stamp is all the server can see of a return — the token is the card's to claim once the
	// flow starts — and it is what keeps the first paint from showing an empty donation form to a
	// donor who may already have paid.
	it('draws the resume takeover rather than the amount step', async () => {
		const formId = await donationFormId();
		const answered = await visit(STRIPE, {}, `?${RESUME_FORM_PARAM}=${formId}`);
		expect(answered.data).toMatchObject({ resuming: true });
		const shown = shownStep(markup(answered.data));
		expect(shown).toContain(RESUMING_HEADING);
		expect(shown).not.toContain(STEP_HEADINGS[0]);
	});

	it('draws the takeover on the donation box drawn alone', async () => {
		const formId = await donationFormId();
		await publishUnreadable();
		const answered = await visit(STRIPE, {}, `?${RESUME_FORM_PARAM}=${formId}`);
		expect(answered.data).toMatchObject({ kind: 'plain', resuming: true });
		expect(shownStep(markup(answered.data))).toContain(RESUMING_HEADING);
	});

	// a return is claimed by the settings row it names and by nothing else: the stamp may have been
	// left on a link by a form embedded on the organisation's own site.
	it('draws the amount step for a stamp naming another form', async () => {
		await donationFormId();
		const answered = await visit(STRIPE, {}, `?${RESUME_FORM_PARAM}=frm_donorpage000002`);
		expect(answered.data).toMatchObject({ resuming: false });
		const shown = shownStep(markup(answered.data));
		expect(shown).toContain(STEP_HEADINGS[0]);
		expect(shown).not.toContain(RESUMING_HEADING);
	});

	it('draws the amount step where there is no stamp', async () => {
		const shown = shownStep(markup((await visit()).data));
		expect(shown).toContain(STEP_HEADINGS[0]);
		expect(shown).not.toContain(RESUMING_HEADING);
	});
});

describe('what re-reads /donate under a gift in progress', () => {
	/** react router's question about this route, for a move from /donate to `next`. */
	function asked(
		next: string,
		extra: Partial<ShouldRevalidateFunctionArgs> = {}
	): ShouldRevalidateFunctionArgs {
		return {
			currentUrl: new URL('/donate', OWN),
			currentParams: {},
			nextUrl: new URL(next, OWN),
			nextParams: {},
			defaultShouldRevalidate: true,
			...extra
		};
	}

	// the card builds its checkout from the config the loader returns and stops it when a new one
	// arrives, and this route draws one page whose settings row never changes under it.
	it('keeps the config for a navigation that stays on the page', () => {
		expect(donatePage.shouldRevalidate(asked('/donate?utm_source=mail'))).toBe(false);
	});

	it('keeps the config for a submission on the page', () => {
		const posted = asked('/donate', {
			formMethod: 'POST',
			formAction: '/donate',
			formData: new FormData(),
			actionStatus: 200
		});
		expect(donatePage.shouldRevalidate(posted)).toBe(false);
	});

	// a navigation after the card claimed a return leaves a stamped address behind, and a re-read
	// there would answer `resuming: false` under the takeover the flow is showing.
	it('keeps the config when the resume stamp leaves the address', () => {
		const stamped = asked('/donate', {
			currentUrl: new URL(`/donate?${RESUME_FORM_PARAM}=frm_donorpage000001`, OWN)
		});
		expect(donatePage.shouldRevalidate(stamped)).toBe(false);
	});

	it('keeps the config for a revalidate on the same address', () => {
		expect(donatePage.shouldRevalidate(asked('/donate'))).toBe(false);
	});
});
