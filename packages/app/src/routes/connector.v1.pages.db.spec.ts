import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { page } from '$lib/server/db/schema';
import { ensureDonationPage } from '$lib/server/pages/donation-page';
import { connectorHarness, ORIGIN, under } from '../connector-routes.testing';
import * as unserved from './connector.v1.$';
import * as catalog from './connector.v1.content.catalog';
import * as campaign from './connector.v1.campaigns.$id._index';
import * as end from './connector.v1.campaigns.$id.end';
import * as publish from './connector.v1.campaigns.$id.publish';
import * as campaigns from './connector.v1.campaigns._index';
import * as donationPage from './connector.v1.donation-page._index';
import * as donationContent from './connector.v1.donation-page.content';
import * as donationReset from './connector.v1.donation-page.reset';
import * as hello from './connector.v1.hello';

// the page actions of `/connector/v1`: Publish and End on a campaign, the donation page's read,
// content and Reset, and the content catalog a chat writes content from.

const h = connectorHarness(() => ({
	campaigns: under('campaigns', campaigns),
	campaign: under('campaigns/:id', campaign),
	publish: under('campaigns/:id/publish', publish),
	end: under('campaigns/:id/end', end),
	donationPage: under('donation-page', donationPage),
	donationContent: under('donation-page/content', donationContent),
	donationReset: under('donation-page/reset', donationReset),
	catalog: under('content/catalog', catalog),
	hello: under('hello', hello),
	unserved: under('*', unserved)
}));
const { call, connect } = h;

const MISSING = '019fb300-0000-7000-8000-000000000999';

async function made(key: string, title = 'Winter coats'): Promise<string> {
	const response = await call('campaigns', '/campaigns', { method: 'POST', key, body: { title } });
	return ((await response.json()) as { id: string }).id;
}

describe('campaigns.publish', () => {
	it('makes a draft campaign live at its address, keeping its own donation settings on gifts_go_to null', async () => {
		const key = await connect();
		const id = await made(key);

		const response = await call('publish', `/campaigns/${id}/publish`, {
			method: 'POST',
			key,
			body: { gifts_go_to: null }
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			id,
			status: 'published',
			public_url: `${ORIGIN}/winter-coats`,
			has_unpublished_changes: false
		});
		const read = await call('campaign', `/campaigns/${id}`, { key });
		expect(await read.json()).toMatchObject({ status: 'published' });
	});

	it('refuses a draft the page rule refuses, with the rule’s reason, and publishes nothing', async () => {
		const key = await connect();
		const id = await made(key);
		const [row] = await h.db.select().from(page).where(eq(page.id, id));
		const draft = JSON.parse(row?.draft ?? '{}') as Record<string, unknown>;
		draft.endsAt = Date.now() + 86_400_000;
		await h.db
			.update(page)
			.set({ draft: JSON.stringify(draft) })
			.where(eq(page.id, id));

		const response = await call('publish', `/campaigns/${id}/publish`, {
			method: 'POST',
			key,
			body: { gifts_go_to: null }
		});

		expect(response.status).toBe(422);
		const problem = (await response.json()) as { code: string; detail: string };
		expect(problem.code).toBe('invalid');
		expect(problem.detail).toContain('an end date names the time zone');
		const [after] = await h.db.select().from(page).where(eq(page.id, id));
		expect(after?.published).toBeNull();
	});

	it('refuses a first Publish that does not say where gifts go, asking the operator', async () => {
		const key = await connect();
		const id = await made(key);

		const response = await call('publish', `/campaigns/${id}/publish`, { method: 'POST', key });

		expect(response.status).toBe(422);
		const problem = (await response.json()) as {
			code: string;
			detail: string;
			errors: { path: string }[];
		};
		expect(problem).toMatchObject({ code: 'invalid', errors: [{ path: 'gifts_go_to' }] });
		expect(problem.detail).toContain('ask the operator');
		const [row] = await h.db.select().from(page).where(eq(page.id, id));
		expect(row?.published).toBeNull();
	});

	it('refuses gifts_go_to on a campaign already published', async () => {
		const key = await connect();
		const id = await made(key);
		await call('publish', `/campaigns/${id}/publish`, {
			method: 'POST',
			key,
			body: { gifts_go_to: null }
		});

		const again = await call('publish', `/campaigns/${id}/publish`, {
			method: 'POST',
			key,
			body: { gifts_go_to: null }
		});
		const plain = await call('publish', `/campaigns/${id}/publish`, { method: 'POST', key });

		expect(again.status).toBe(422);
		expect(await again.json()).toMatchObject({
			code: 'invalid',
			errors: [{ path: 'gifts_go_to' }]
		});
		expect(plain.status).toBe(200);
	});

	it('answers a campaign that is not there as not_found', async () => {
		const key = await connect();
		const response = await call('publish', `/campaigns/${MISSING}/publish`, {
			method: 'POST',
			key
		});

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ code: 'not_found' });
	});
});

describe('campaigns.end', () => {
	it('ends a published campaign', async () => {
		const key = await connect();
		const id = await made(key);
		await call('publish', `/campaigns/${id}/publish`, {
			method: 'POST',
			key,
			body: { gifts_go_to: null }
		});

		const response = await call('end', `/campaigns/${id}/end`, { method: 'POST', key });

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ id, status: 'ended' });
	});

	it('refuses a draft, which only Publish takes to donors', async () => {
		const key = await connect();
		const id = await made(key);

		const response = await call('end', `/campaigns/${id}/end`, { method: 'POST', key });

		expect(response.status).toBe(422);
		const problem = (await response.json()) as { code: string; detail: string };
		expect(problem.code).toBe('invalid');
		expect(problem.detail).toContain('only a published campaign can be ended');
	});
});

describe('the donation page', () => {
	it('is not_found until the dashboard has opened it once, and the connector makes none', async () => {
		const key = await connect();

		const response = await call('donationPage', '/donation-page', { key });

		expect(response.status).toBe(404);
		const problem = (await response.json()) as { code: string; detail: string };
		expect(problem.code).toBe('not_found');
		expect(problem.detail).toContain('dashboard');
		expect(await h.db.select().from(page)).toEqual([]);
	});

	it('reads the live donation page at /donate as its heading, with no blocks and no share buttons', async () => {
		const key = await connect();
		await ensureDonationPage(h.db);

		const response = await call('donationPage', '/donation-page', { key });

		expect(response.status).toBe(200);
		const read = (await response.json()) as Record<string, unknown>;
		expect(read).toMatchObject({
			status: 'published',
			public_url: `${ORIGIN}/donate`,
			has_unpublished_changes: false,
			sharing: { message: null },
			content: { heading: expect.any(String) },
			updated_at: expect.any(String)
		});
		expect(Object.keys(read.content as object)).toEqual(['heading']);
		for (const gone of ['blocks', 'slug', 'goal', 'layout']) expect(read).not.toHaveProperty(gone);
	});

	it('takes a new heading on its draft, and Reset puts the default back live', async () => {
		const key = await connect();
		await ensureDonationPage(h.db);
		const first = (await (await call('donationPage', '/donation-page', { key })).json()) as {
			content: { heading: string };
		};

		const edited = await call('donationContent', '/donation-page/content', {
			method: 'PATCH',
			key,
			body: { heading: 'Give to the Riverbank' }
		});

		expect(edited.status).toBe(200);
		const after = (await edited.json()) as {
			content: { heading: string };
			has_unpublished_changes: boolean;
		};
		expect(after.content.heading).toBe('Give to the Riverbank');
		expect(after.has_unpublished_changes).toBe(true);

		const reset = await call('donationReset', '/donation-page/reset', {
			method: 'POST',
			key,
			body: { confirm: true }
		});

		expect(reset.status).toBe(200);
		const back = (await reset.json()) as {
			content: { heading: string };
			has_unpublished_changes: boolean;
		};
		expect(back.content).toEqual(first.content);
		expect(back.has_unpublished_changes).toBe(false);
	});

	it.each([
		['no body', undefined],
		['confirm false', { confirm: false }],
		['confirm as the string "true"', { confirm: 'true' }]
	] as const)(
		'refuses a Reset with %s, asking the operator first, and changes nothing',
		async (_, body) => {
			const key = await connect();
			await ensureDonationPage(h.db);
			await call('donationContent', '/donation-page/content', {
				method: 'PATCH',
				key,
				body: { heading: 'Edited' }
			});
			const [before] = await h.db.select().from(page).where(eq(page.type, 'donation_page'));

			const response = await call('donationReset', '/donation-page/reset', {
				method: 'POST',
				key,
				body
			});

			expect(response.status).toBe(422);
			const problem = (await response.json()) as {
				code: string;
				detail: string;
				errors: { path: string }[];
			};
			expect(problem).toMatchObject({ code: 'invalid', errors: [{ path: 'confirm' }] });
			expect(problem.detail).toContain('ask the operator');
			const [after] = await h.db.select().from(page).where(eq(page.type, 'donation_page'));
			expect(after?.draft).toBe(before?.draft);
			expect(after?.published).toBe(before?.published);
			expect(after?.updatedAt).toEqual(before?.updatedAt);
		}
	);

	it('refuses a Reset whose body is not a JSON object', async () => {
		const key = await connect();
		await ensureDonationPage(h.db);

		const response = await call('donationReset', '/donation-page/reset', {
			method: 'POST',
			key,
			body: 'confirm'
		});

		expect(response.status).toBe(422);
		expect(await response.json()).toMatchObject({ code: 'invalid', errors: [{ path: '' }] });
	});

	it.each([
		['lede', { lede: 'A sentence' }],
		['story', { story: { type: 'doc', content: [] } }],
		['layout', { layout: 'feature' }],
		['blocks', { blocks: [] }]
	] as const)(
		'refuses %s on the donation page, whose content is its heading alone',
		async (name, body) => {
			const key = await connect();
			await ensureDonationPage(h.db);
			const [before] = await h.db.select().from(page).where(eq(page.type, 'donation_page'));

			const response = await call('donationContent', '/donation-page/content', {
				method: 'PATCH',
				key,
				body: { heading: 'Edited', ...body }
			});

			expect(response.status).toBe(422);
			expect(await response.json()).toMatchObject({ code: 'invalid', errors: [{ path: name }] });
			const [after] = await h.db.select().from(page).where(eq(page.type, 'donation_page'));
			expect(after?.draft).toBe(before?.draft);
		}
	);

	it.each([
		['donationContent', '/donation-page/content', 'PATCH', { heading: 'Hi' }],
		['donationReset', '/donation-page/reset', 'POST', { confirm: true }]
	] as const)(
		'answers %s not_found before the dashboard opens it',
		async (route, path, method, body) => {
			const key = await connect();

			const response = await call(route, path, { method, key, body });

			expect(response.status).toBe(404);
			expect(await response.json()).toMatchObject({ code: 'not_found' });
			expect(await h.db.select().from(page)).toEqual([]);
		}
	);
});

describe('content.catalog', () => {
	it('describes every content key with the JSON Schema of its value, and how the layout is picked', async () => {
		const key = await connect();

		const response = await call('catalog', '/content/catalog', { key });

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			content: { key: string; description: string; schema: Record<string, unknown> }[];
			layout: { description: string; story_threshold: number; feature_extras: number };
		};
		expect(body.content.map((c) => c.key)).toEqual([
			'heading',
			'lede',
			'story',
			'hero',
			'photos',
			'tiers',
			'faq'
		]);
		for (const entry of body.content) expect(entry.description).not.toBe('');
		expect(body.content.find((c) => c.key === 'tiers')?.schema).toMatchObject({
			type: 'array',
			maxItems: 6,
			items: { properties: { amountMinor: expect.any(Object), buys: expect.any(Object) } }
		});
		expect(body.content.find((c) => c.key === 'hero')?.schema).toMatchObject({
			type: 'object',
			properties: { imageId: expect.any(Object), alt: expect.any(Object) }
		});
		expect(body.layout).toMatchObject({ story_threshold: 320, feature_extras: 4 });
		expect(body.layout.description).toContain('never set');
		expect(body).not.toHaveProperty('blocks');
	});
});

describe('what this release serves', () => {
	it('lists the page actions in hello, and no unpublish', async () => {
		const { actions } = (await (await call('hello', '/hello')).json()) as { actions: string[] };

		expect(actions).toEqual(
			expect.arrayContaining([
				'campaigns.publish',
				'campaigns.end',
				'donation_page.get',
				'donation_page.update_content',
				'donation_page.reset',
				'content.catalog'
			])
		);
		expect(actions).not.toContain('campaigns.unpublish');
		expect(actions).not.toContain('donation_page.update_blocks');
		expect(actions).not.toContain('blocks.catalog');
	});

	it('answers an unpublish as unknown_action, since a live campaign leaves the air only by End', async () => {
		const key = await connect();
		const id = await made(key);

		const response = await call('unserved', `/campaigns/${id}/unpublish`, { method: 'POST', key });

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ code: 'unknown_action' });
	});
});
