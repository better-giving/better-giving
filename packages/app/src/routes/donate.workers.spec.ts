import { createExecutionContext, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createStaticHandler, type LoaderFunction, type MiddlewareFunction } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_FORM } from '$lib/donate/copy';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { defaultDonationPage } from '$lib/page/defaults';
import { parseRichText } from '$lib/rich-text/document';
import { readSetupState } from '$lib/server/config/setup-state';
import { createDb } from '$lib/server/db/client';
import { page, program } from '$lib/server/db/schema';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { createImage } from '$lib/server/images/queries';
import type { OrgLook } from '$lib/server/org/presentation';
import {
	readOrgLogo,
	readOrgLook,
	readOrgSharing,
	readOrgStory,
	updateOrgLogo,
	updateOrgLook,
	updateOrgSharing,
	updateOrgStory
} from '$lib/server/org/queries';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { ORIGIN, signIn } from '../program-routes.testing';
import { requestContext } from '../request-context';
import { mountRoutes, queryDocument } from '../route-request.testing';
import * as layout from './_app';
import * as editor from './_app.admin.donation-page';
import * as surface from './api.v1';
import * as gifts from './api.v1.forms.$id.donations';
import type { Route } from './+types/donate';
import * as donatePage from './donate';
import type { Route as PreviewRoute } from './+types/preview.$pageId';
import * as preview from './preview.$pageId';

// the donation page at /donate, against the real D1 the pool binds.
//
// a workers spec because every answer here is decided from rows — the page, its owned settings row,
// the organisation's profile and story, the programs — and standing in for D1 would only prove the
// stand-in (CLAUDE.md). the loader runs through react router's own matcher, as
// ./login.workers.spec.ts argues, so the status a refusal carries is the framework's.

/** this deployment's own origin, which every request in this file is made to. */
const OWN = 'https://give.example.workers.dev';

/** a deployment whose Stripe pair is set and agrees, so the env is never what refuses. */
const STRIPE = {
	STRIPE_SECRET_KEY: 'sk_test_abc',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
	STRIPE_WEBHOOK_SECRET: 'whsec_abc'
};

const MISSION = 'We keep every family on Elm Street fed through the winter.';

const db = createDb(env.DB);

beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare('delete from page'),
		env.DB.prepare('delete from form'),
		env.DB.prepare('delete from program'),
		env.DB.prepare('delete from org_presentation'),
		env.DB.prepare('delete from org_profile')
	]);
	await writeOrgRow(env.DB, { tax_id: '12-3456789' });
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

/** the pool's env with the deploy-time values a case wants set, as a proxy rather than a copy. */
function envWith(values: Record<string, string>): Env {
	return new Proxy(env, {
		get: (target, property) =>
			typeof property === 'string' && property in values
				? values[property]
				: Reflect.get(target, property)
	}) as Env;
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
	headers: Record<string, string> = {}
): Promise<{ status: number; data: LoaderData; headers: Headers }> {
	const answered = await queryDocument(
		handler,
		new Request(`${OWN}/donate`, { headers }),
		requestContext(envWith(vars), createExecutionContext())
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

/** one block's section, by the block type the renderer stamps on it. */
function block(html: string, type: string): string {
	const found = new RegExp(`<section[^>]*data-block="${type}"[\\s\\S]*?</section>`).exec(html);
	return found?.[0] ?? '';
}

async function writeMission(text: string): Promise<void> {
	const { version } = await readOrgStory(db);
	const mission = parseRichText({
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
	});
	if (!mission.ok) throw new Error(`the fixture mission did not parse: ${mission.message}`);
	const written = await updateOrgStory(db, version, { mission: mission.doc, vision: null });
	if (written !== 'written') throw new Error('the fixture mission was not written');
}

async function saveOrgLook(look: OrgLook): Promise<void> {
	const { version } = await readOrgLook(db);
	expect(await updateOrgLook(db, version, look)).not.toBe('stale');
}

async function activePrograms(...names: string[]): Promise<void> {
	for (const name of names) await db.insert(program).values({ name });
}

async function donationPageRows(): Promise<number> {
	const row = await env.DB.prepare(
		`select count(*) as n from page where type = 'donation_page'`
	).first<{ n: number }>();
	return row?.n ?? 0;
}

describe('GET /donate on a fresh deployment', () => {
	it('draws the default page, the mission in About us and the active programs in the chooser', async () => {
		await writeMission(MISSION);
		await activePrograms('Food bank', 'Winter shelter');

		const answered = await visit();
		expect(answered.status).toBe(200);
		const html = markup(answered.data);
		expect(block(html, 'title')).toContain('Donate to Hope Foundation');
		expect(block(html, 'about-us')).toContain(MISSION);
		expect(block(html, 'program-chooser')).toContain('Food bank');
		expect(block(html, 'program-chooser')).toContain('Winter shelter');
		expect(await donationPageRows()).toBe(1);
	});
});

describe('the page /donate draws', () => {
	// the stored heading is empty, so the title is the organisation's name on the day it is drawn.
	it('greets donors by the organisation’s name as it stands, after a rename', async () => {
		await visit();
		await env.DB.prepare(`update org_profile set legal_name = 'Hope Foundation of Easton'`).run();
		const html = markup((await visit()).data);
		expect(block(html, 'title')).toContain('Donate to Hope Foundation of Easton');
	});

	it('shares its own address on this deployment, with the page title as the message', async () => {
		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.sharing).toEqual({
			channels: ['facebook', 'email', 'copy-link'],
			message: 'Donate to Hope Foundation',
			url: `${OWN}/donate`
		});
	});

	it('names the organisation in the tab', async () => {
		const answered = await visit();
		expect(donatePage.meta({ loaderData: answered.data } as unknown as Route.MetaArgs)).toEqual([
			{ title: 'Donate to Hope Foundation' }
		]);
	});

	it('names its cover photo, by id, as its share image once it has one', async () => {
		const photo = '0192a4c1-0000-7000-8000-000000000001';
		await visit();
		const withHero = {
			...defaultDonationPage(),
			blocks: [
				{
					id: 'hero',
					type: 'hero',
					variant: 'wide',
					background: 'none',
					imageId: photo,
					alt: null
				},
				...defaultDonationPage().blocks
			]
		};
		await env.DB.prepare(`update page set published = ? where type = 'donation_page'`)
			.bind(JSON.stringify(withHero))
			.run();

		const answered = await visit();
		expect(donatePage.meta({ loaderData: answered.data } as unknown as Route.MetaArgs)).toEqual([
			{ title: 'Donate to Hope Foundation' },
			{ property: 'og:image', content: `${OWN}/image/${photo}` }
		]);
	});

	/**
	 * the served config and never the row it was read from: a loader's value is serialized into the
	 * document, and the row carries `allowed_origins`.
	 */
	it('hands the browser the served config and not the settings row', async () => {
		await visit();
		await env.DB.prepare(`update form set allowed_origins = '["https://acme.org"]'`).run();
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
		const id = await createImage(
			db,
			{ kind: 'photo', contentType: 'image/png', width: 640, height: 160, alt: null },
			new Uint8Array([1])
		);
		expect(await updateOrgLogo(db, (await readOrgLogo(db)).version, id)).toHaveProperty('version');

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
		const chooser = block(markup(answered.data), 'program-chooser');
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
		expect(block(markup(answered.data), 'program-chooser')).toContain('Winter shelter');
		expect(answered.data.view.programPhotos).toEqual({});
		expect(markup(answered.data)).not.toContain(photo);
	});
});

describe('the organisation’s sharing on /donate', () => {
	async function share(sharing: unknown): Promise<void> {
		await env.DB.prepare(
			`insert into org_presentation (id, sharing, created_at, updated_at) values ('default', ?, 0, 0)`
		)
			.bind(JSON.stringify(sharing))
			.run();
	}

	it('offers its channels in its order, with its message, and lists its social links', async () => {
		await share({
			channels: ['whatsapp', 'x', 'copy-link'],
			message: 'Every meal counts this winter.',
			links: [{ label: 'Instagram', href: 'https://instagram.com/hopefoundation' }]
		});
		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.sharing).toEqual({
			channels: ['whatsapp', 'x', 'copy-link'],
			message: 'Every meal counts this winter.',
			url: `${OWN}/donate`
		});
		expect(answered.data.view.org.info.links).toEqual([
			{ label: 'Instagram', href: 'https://instagram.com/hopefoundation' }
		]);
	});

	// a link is typed by a person and drawn as an `href`, so anything but http(s) never reaches one.
	it('draws no social link that is not an http(s) address', async () => {
		await share({
			links: [
				{ label: 'Site', href: 'javascript:alert(1)' },
				{ label: 'Facebook', href: 'https://facebook.com/hope' }
			]
		});
		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.org.info.links).toEqual([
			{ label: 'Facebook', href: 'https://facebook.com/hope' }
		]);
	});

	it('follows each save of the sharing, in the order it was saved', async () => {
		const reorder = async (channels: ('x' | 'whatsapp' | 'email')[]) => {
			const { version } = await readOrgSharing(db);
			expect(await updateOrgSharing(db, version, { channels, message: null, links: [] })).toBe(
				'written'
			);
			const answered = await visit();
			if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
			return answered.data.view.sharing.channels;
		};

		expect(await reorder(['x', 'whatsapp', 'email'])).toEqual(['x', 'whatsapp', 'email']);
		expect(await reorder(['email', 'x', 'whatsapp'])).toEqual(['email', 'x', 'whatsapp']);
	});

	it('reads a part it does not hold, or holds off the rule, as the default', async () => {
		await share({ channels: ['myspace'] });
		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.sharing.channels).toEqual(['facebook', 'email', 'copy-link']);
		expect(answered.data.view.sharing.message).toBe('Donate to Hope Foundation');
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

describe('the look /donate is drawn in', () => {
	it('is the form’s own where neither the Organisation nor the page holds one', async () => {
		expect(seeds(markup((await visit()).data))).toEqual({
			shade: 'light',
			corner: 'soft',
			brandColour: null
		});
	});

	it('follows each save of the Organisation’s look while the page holds none of its own', async () => {
		await saveOrgLook({ shade: 'warm', corner: 'round', brandColour: '#1d6b4f' });
		expect(seeds(markup((await visit()).data))).toEqual({
			shade: 'warm',
			corner: 'round',
			brandColour: '#1d6b4f'
		});

		await saveOrgLook({ shade: 'cool', corner: 'square', brandColour: null });
		expect(seeds(markup((await visit()).data))).toEqual({
			shade: 'cool',
			corner: 'square',
			brandColour: null
		});
	});

	it('keeps the page’s own look through a save of the Organisation’s', async () => {
		await visit();
		await env.DB.prepare(`update page set published = ? where type = 'donation_page'`)
			.bind(
				JSON.stringify({
					...defaultDonationPage(),
					look: { shade: 'cool', corner: 'square', brandColour: '#6b2d8a' }
				})
			)
			.run();

		await saveOrgLook({ shade: 'warm', corner: 'round', brandColour: '#1d6b4f' });

		expect(seeds(markup((await visit()).data))).toEqual({
			shade: 'cool',
			corner: 'square',
			brandColour: '#6b2d8a'
		});
	});
});

describe('a published Donation page the read rule refuses', () => {
	async function publish(document: unknown): Promise<string> {
		await visit();
		await env.DB.prepare(`update page set published = ? where type = 'donation_page'`)
			.bind(JSON.stringify(document))
			.run();
		const row = await env.DB.prepare(
			`select form_id from page where type = 'donation_page'`
		).first<{
			form_id: string;
		}>();
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
			why: 'naming a block its type forbids',
			document: {
				...defaultDonationPage(),
				blocks: [
					...defaultDonationPage().blocks,
					{ id: 'goal', type: 'goal-bar', variant: 'bar', background: 'none' }
				]
			}
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
		expect(html).not.toContain('data-block=');
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
		await env.DB.prepare('delete from org_profile').run();
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
	/** every value the five set-up jobs read, with a password the sign-in path accepts. */
	const FINISHED = {
		...STRIPE,
		ADMIN_PASSWORD: 'a-long-enough-password',
		SMTP_HOST: 'smtp.example.org',
		SMTP_USERNAME: 'mailer',
		SMTP_PASSWORD: 'mail-secret',
		MAIL_FROM: 'gifts@example.org'
	};

	it('finishes set-up and answers /donate with no site row', async () => {
		await env.DB.prepare('delete from site').run();
		await env.DB.prepare(`update org_profile set notification_email = 'ops@example.org'`).run();

		const state = await readSetupState(db, envWith(FINISHED));
		expect(state?.lines.map((line) => [line.id, line.state])).toEqual([
			['password', 'ready'],
			['organisation', 'ready'],
			['payments', 'ready'],
			['smtp', 'ready'],
			['notifications', 'ready']
		]);
		expect((await visit(FINISHED)).status).toBe(200);
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

	beforeAll(async () => {
		session = await signIn(db);
	});

	/** a press on the Donation page's editor, drawn at the version the page holds now. */
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
			{ env }
		);
		expect(response.status).toBe(200);
	}

	/** the draft's donation settings saved from the editor's sheet: $200 to $20,000. */
	const saveSettings = (ticked: Record<string, string> = {}) =>
		press('page-settings', {
			program_mode: 'none',
			program_id: '',
			min_minor: '200',
			max_minor: '20000',
			'suggested_amounts[0]': '250',
			...ticked
		});

	async function documents() {
		const [row] = await db.select().from(page);
		if (!row) throw new Error('there is no Donation page to read');
		return { draft: JSON.parse(row.draft), published: JSON.parse(row.published ?? 'null') };
	}

	/** the draft's share message, as the chat or its sheet leaves it. */
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
					'cf-connecting-ip': `2001:db8:${1000 + callers}::1`
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

	it('draws the published page after Publish, and the page before it after Undo', async () => {
		await visit();
		await draftMessage('Keep Elm Street warm this winter.');

		await press('page-publish');
		expect((await drawn()).sharing.message).toBe('Keep Elm Street warm this winter.');

		await press('page-undo');
		expect((await drawn()).sharing.message).toBe('Donate to Hope Foundation');
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

	it('shows a look picked in the editor in the preview, and on /donate only once published', async () => {
		await visit();
		const today = { shade: 'light', corner: 'soft', brandColour: null };
		const picked = { shade: 'warm', corner: 'round', brandColour: '#b5462a' };

		await press('page-look', {
			look: 'custom',
			shade: 'warm',
			corner: 'round',
			brand_colour: '#b5462a'
		});
		expect(seeds(await previewed())).toEqual(picked);
		expect(seeds(markup((await visit()).data))).toEqual(today);

		await press('page-publish');
		expect(seeds(markup((await visit()).data))).toEqual(picked);
	});

	it('keeps drawing the published page through Discard changes', async () => {
		await visit();
		await draftMessage('Keep Elm Street warm this winter.');

		await press('page-discard');

		expect((await drawn()).sharing.message).toBe('Donate to Hope Foundation');
	});

	it('serves the draft’s donation settings only once published, and the ones before after Undo', async () => {
		const opened = (await drawn()).config;
		await saveSettings();
		expect((await drawn()).config).toEqual(opened);

		await press('page-publish');
		expect((await drawn()).config).toMatchObject({
			minAmountMinor: 20_000,
			maxAmountMinor: 2_000_000,
			suggestedAmountsMinor: [25_000]
		});

		await press('page-undo');
		expect((await drawn()).config).toEqual(opened);
	});

	it('draws the current default in the Organisation’s look and share message after Reset', async () => {
		const ORG_LOOK = { brandColour: '#225588', shade: 'cool', corner: 'soft' };
		await env.DB.prepare(
			`insert into org_presentation (id, look, sharing, created_at, updated_at) values ('default', ?, ?, 0, 0)`
		)
			.bind(JSON.stringify(ORG_LOOK), JSON.stringify({ message: 'Every meal counts this winter.' }))
			.run();
		await visit();
		const [row] = await db.select().from(page);
		if (!row) throw new Error('there is no Donation page to write');
		await db
			.update(page)
			.set({
				draft: JSON.stringify({
					...JSON.parse(row.draft),
					palette: 'bold',
					look: { brandColour: '#aa3300', shade: 'warm', corner: 'round' },
					shareMessage: 'Keep Elm Street warm this winter.',
					blocks: defaultDonationPage().blocks.filter((block) => block.type !== 'about-us')
				}),
				updatedAt: new Date(row.updatedAt.getTime() + 1_000)
			})
			.where(eq(page.id, row.id));
		await press('page-publish');
		expect((await drawn()).look).toMatchObject({ brandColour: '#aa3300' });

		await press('page-reset');

		const view = await drawn();
		expect(view.page.blocks).toEqual(defaultDonationPage().blocks);
		expect(view.page.palette).toBe(defaultDonationPage().palette);
		expect(view.look).toEqual(ORG_LOOK);
		expect(view.sharing.message).toBe('Every meal counts this winter.');
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
		'opens the box with “%s” only once a Done ticking it is published',
		async (_, box, switches, opening) => {
			await visit();
			await saveSettings({ [box]: 'on' });

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
		// a gift inside the bounds goes on to the challenge, which this env has no keys to verify.
		const passedBounds = {
			status: 503,
			message: 'This deployment cannot verify a challenge, so no donation can be accepted.'
		};
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
			const answered = await visit(STRIPE, { 'cf-connecting-ip': ip });
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
		await env.DB.prepare(`delete from page where type = 'donation_page'`).run();

		const refused = await visit(STRIPE, { 'cf-connecting-ip': '203.0.113.91' });

		expect(refused.status).toBe(429);
		expect(await donationPageRows()).toBe(0);
	});
});
