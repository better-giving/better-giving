import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { WEBHOOKS_PAGE_PATH } from '$lib/server/webhooks/paused-mail';
import { createDestination } from '$lib/server/webhooks/destinations';
import { freshDeployment, page, signInAsDeployer, signInAsMember } from '../webhook-routes.testing';
import * as screen from './_app.admin.integrations.webhooks._index';

// the Webhooks list's server half, against the real D1 the pool binds, through the protected
// layout: every destination with its address, how many events it takes and whether it is paused.

const SCREEN = '/admin/integrations/webhooks';

type Listed = {
	id: string;
	url: string;
	events: string;
	paused: boolean;
};
type Screen = { destinations: Listed[]; deleted: string | null };

let db: Db;
let deployer: string;
const list = page('admin/integrations/webhooks', screen);

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await freshDeployment();
	deployer = await signInAsDeployer(db);
});

async function made(url: string, events: Parameters<typeof createDestination>[1]['events']) {
	const created = await createDestination(db, { url, events });
	if (!created.ok) throw new Error(created.box);
	return created.destination.id;
}

async function visit(cookie = deployer): Promise<Screen> {
	const response = await list.get(SCREEN, cookie);
	expect(response.status).toBe(200);
	return (await response.json()) as Screen;
}

it('is the page the pause mail links to', () => {
	expect(WEBHOOKS_PAGE_PATH).toBe(SCREEN);
});

describe('GET /admin/integrations/webhooks', () => {
	it('lists each destination by address, with its events counted and whether it is paused', async () => {
		const first = await made('https://hooks.riverbanktrust.org/giving', [
			'gift.made',
			'gift.refunded',
			'donor.added'
		]);
		const second = await made('https://crm.example.net/webhooks/better-giving', [
			'gift.made',
			'gift.refunded',
			'gift.dispute_opened',
			'donor.added',
			'donor.updated',
			'recurring_gift.started',
			'recurring_gift.updated',
			'recurring_gift.charge_failed',
			'recurring_gift.ended'
		]);
		const third = await made('https://one.example.org/', ['donor.updated']);
		await env.DB.prepare('update webhook_destination set paused_at = 1 where id = ?')
			.bind(second)
			.run();

		expect((await visit()).destinations).toEqual([
			{
				id: first,
				url: 'https://hooks.riverbanktrust.org/giving',
				events: '3 events',
				paused: false
			},
			{
				id: second,
				url: 'https://crm.example.net/webhooks/better-giving',
				events: 'All events',
				paused: true
			},
			{ id: third, url: 'https://one.example.org/', events: '1 event', paused: false }
		]);
	});

	it('leaves a deleted destination off', async () => {
		const id = await made('https://hooks.riverbanktrust.org/giving', ['gift.made']);
		await env.DB.prepare('update webhook_destination set archived_at = 1 where id = ?')
			.bind(id)
			.run();

		expect((await visit()).destinations).toEqual([]);
	});

	it('never holds a signing secret', async () => {
		await made('https://hooks.riverbanktrust.org/giving', ['gift.made']);
		const secret = await env.DB.prepare('select signing_secret from webhook_destination').first<{
			signing_secret: string;
		}>();

		expect(await (await list.get(SCREEN, deployer)).text()).not.toContain(
			secret?.signing_secret.slice(6, 20)
		);
	});
});

describe('a member’s session', () => {
	it('gets not-found for the list', async () => {
		expect((await list.get(SCREEN, await signInAsMember(db))).status).toBe(404);
	});
});
