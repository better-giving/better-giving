import { createExecutionContext, env } from 'cloudflare:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createStaticHandler, type LoaderFunction } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_FORM } from '$lib/donate/copy';
import { defaultDonationPage } from '$lib/page/defaults';
import { parseRichText } from '$lib/rich-text/document';
import { readSetupState } from '$lib/server/config/setup-state';
import { createDb } from '$lib/server/db/client';
import { program } from '$lib/server/db/schema';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { readOrgStory, updateOrgStory } from '$lib/server/org/queries';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { requestContext } from '../request-context';
import type { Route } from './+types/donate';
import * as donatePage from './donate';

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
	{ id: ROUTE_ID, path: 'donate', loader: donatePage.loader as unknown as LoaderFunction }
]);

type LoaderData = Route.ComponentProps['loaderData'];

async function visit(
	vars: Record<string, string> = STRIPE
): Promise<{ status: number; data: LoaderData; headers: Headers }> {
	const answered = await handler.query(new Request(`${OWN}/donate`), {
		requestContext: requestContext(envWith(vars), createExecutionContext())
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

	it('reads a part it does not hold, or holds off the rule, as the default', async () => {
		await share({ channels: ['myspace'] });
		const answered = await visit();
		if (answered.data.kind !== 'page') throw new Error(`drew ${answered.data.kind}`);
		expect(answered.data.view.sharing.channels).toEqual(['facebook', 'email', 'copy-link']);
		expect(answered.data.view.sharing.message).toBe('Donate to Hope Foundation');
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
