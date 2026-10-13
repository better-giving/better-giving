import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES } from '$lib/page/catalog';
import { page } from '$lib/server/db/schema';
import { ensureDonationPage } from '$lib/server/pages/donation-page';
import { connectorHarness, ORIGIN, under } from '../connector-routes.testing';
import * as unserved from './connector.v1.$';
import * as catalog from './connector.v1.blocks.catalog';
import * as campaign from './connector.v1.campaigns.$id._index';
import * as end from './connector.v1.campaigns.$id.end';
import * as publish from './connector.v1.campaigns.$id.publish';
import * as campaigns from './connector.v1.campaigns._index';
import * as donationPage from './connector.v1.donation-page._index';
import * as donationBlocks from './connector.v1.donation-page.blocks';
import * as donationReset from './connector.v1.donation-page.reset';
import * as hello from './connector.v1.hello';

// the page actions of `/connector/v1`: Publish and End on a campaign, the donation page's read,
// blocks and Reset, and the block catalog a chat writes blocks from.

const h = connectorHarness(() => ({
	campaigns: under('campaigns', campaigns),
	campaign: under('campaigns/:id', campaign),
	publish: under('campaigns/:id/publish', publish),
	end: under('campaigns/:id/end', end),
	donationPage: under('donation-page', donationPage),
	donationBlocks: under('donation-page/blocks', donationBlocks),
	donationReset: under('donation-page/reset', donationReset),
	catalog: under('blocks/catalog', catalog),
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
		const draft = JSON.parse(row?.draft ?? '{}') as { blocks: { type: string }[] };
		draft.blocks = draft.blocks.filter((b) => b.type !== 'donation-box');
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
		expect(problem.detail).toContain('exactly one donation box');
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

	it('reads the live donation page at /donate', async () => {
		const key = await connect();
		await ensureDonationPage(h.db);

		const response = await call('donationPage', '/donation-page', { key });

		expect(response.status).toBe(200);
		const read = (await response.json()) as Record<string, unknown> & {
			blocks: { type: string }[];
		};
		expect(read).toMatchObject({
			status: 'published',
			public_url: `${ORIGIN}/donate`,
			has_unpublished_changes: false,
			sharing: { message: null, channels: null },
			updated_at: expect.any(String)
		});
		expect(read.blocks.some((b) => b.type === 'donation-box')).toBe(true);
		expect(read).not.toHaveProperty('slug');
		expect(read).not.toHaveProperty('goal');
	});

	it('takes new blocks on its draft, and Reset puts the default back live', async () => {
		const key = await connect();
		await ensureDonationPage(h.db);
		const { blocks: current } = (await (
			await call('donationPage', '/donation-page', { key })
		).json()) as {
			blocks: { type: string }[];
		};

		const edited = await call('donationBlocks', '/donation-page/blocks', {
			method: 'PATCH',
			key,
			body: { blocks: current.filter((b) => b.type !== 'share') }
		});

		expect(edited.status).toBe(200);
		const after = (await edited.json()) as {
			blocks: { type: string }[];
			has_unpublished_changes: boolean;
		};
		expect(after.blocks.map((b) => b.type)).not.toContain('share');
		expect(after.has_unpublished_changes).toBe(true);

		const reset = await call('donationReset', '/donation-page/reset', {
			method: 'POST',
			key,
			body: { confirm: true }
		});

		expect(reset.status).toBe(200);
		const back = (await reset.json()) as {
			blocks: { type: string }[];
			has_unpublished_changes: boolean;
		};
		expect(back.blocks).toEqual(current);
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
			const { blocks: current } = (await (
				await call('donationPage', '/donation-page', { key })
			).json()) as { blocks: { type: string }[] };
			await call('donationBlocks', '/donation-page/blocks', {
				method: 'PATCH',
				key,
				body: { blocks: current.filter((b) => b.type !== 'share') }
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

	it('refuses blocks the page rule refuses, and a photo id no stored photo has', async () => {
		const key = await connect();
		await ensureDonationPage(h.db);
		const { blocks: current } = (await (
			await call('donationPage', '/donation-page', { key })
		).json()) as {
			blocks: { type: string; imageId?: string | null }[];
		};

		const noBox = await call('donationBlocks', '/donation-page/blocks', {
			method: 'PATCH',
			key,
			body: { blocks: current.filter((b) => b.type !== 'donation-box') }
		});
		const forged = await call('donationBlocks', '/donation-page/blocks', {
			method: 'PATCH',
			key,
			body: {
				blocks: [
					{
						id: 'photo',
						type: 'image',
						variant: 'wide',
						background: 'none',
						imageId: MISSING,
						alt: null
					},
					...current
				]
			}
		});

		expect(noBox.status).toBe(422);
		expect(await noBox.json()).toMatchObject({ code: 'invalid', errors: [{ path: 'blocks' }] });
		expect(forged.status).toBe(422);
		expect(((await forged.json()) as { detail: string }).detail).toContain('photos.upload_link');
	});

	it.each([
		['donationBlocks', '/donation-page/blocks', 'PATCH', { blocks: [] }],
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

describe('blocks.catalog', () => {
	it('describes every block a page may hold, each with the JSON Schema a block of it meets', async () => {
		const key = await connect();

		const response = await call('catalog', '/blocks/catalog', { key });

		expect(response.status).toBe(200);
		const { blocks } = (await response.json()) as {
			blocks: { type: string; description: string; schema: Record<string, unknown> }[];
		};
		expect(blocks.map((b) => b.type)).toEqual(BLOCK_TYPES);
		for (const entry of blocks) {
			expect(entry.description).not.toBe('');
			expect(entry.schema).toMatchObject({
				type: 'object',
				properties: { type: { const: entry.type } }
			});
		}
		expect(blocks.find((b) => b.type === 'hero')?.schema).toMatchObject({
			properties: { variant: { enum: ['wide', 'framed'] }, imageId: expect.any(Object) }
		});
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
				'donation_page.update_blocks',
				'donation_page.reset',
				'blocks.catalog'
			])
		);
		expect(actions).not.toContain('campaigns.unpublish');
	});

	it('answers an unpublish as unknown_action, since a live campaign leaves the air only by End', async () => {
		const key = await connect();
		const id = await made(key);

		const response = await call('unserved', `/campaigns/${id}/unpublish`, { method: 'POST', key });

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ code: 'unknown_action' });
	});
});
