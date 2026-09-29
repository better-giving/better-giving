import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import {
	deliverNow,
	formBody,
	freshDeployment,
	page,
	settleGift,
	signInAsDeployer,
	signInAsMember
} from '../webhook-routes.testing';
import * as screen from './_app.admin.integrations.webhooks.new';

// adding a destination, through the protected layout against the real D1: what the box refuses,
// and that a destination added here is sent the next event it takes.

const SCREEN = '/admin/integrations/webhooks/new';

let db: Db;
let deployer: string;
const add = page('admin/integrations/webhooks/new', screen);

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await freshDeployment();
	deployer = await signInAsDeployer(db);
});

function adding(url: string, events: readonly string[]): FormData {
	return formBody({ __form_id__: 'webhook-destination-add', url, events });
}

async function refusals(response: Response): Promise<Record<string, string[]> | undefined> {
	const answer = (await response.json()) as {
		form: { result: { error?: Record<string, string[]> } };
	};
	return answer.form.result.error;
}

async function destinations(): Promise<number> {
	const row = await env.DB.prepare('select count(*) as n from webhook_destination').first<{
		n: number;
	}>();
	return row?.n ?? 0;
}

describe('POST /admin/integrations/webhooks/new', () => {
	it('adds the destination, lands on its page, and sends it the next event it takes', async () => {
		const answer = await add.post(
			SCREEN,
			deployer,
			adding('https://hooks.riverbanktrust.org/giving', ['gift.made'])
		);

		expect(answer.status).toBe(303);
		const stored = await env.DB.prepare('select id from webhook_destination').first<{
			id: string;
		}>();
		expect(answer.headers.get('location')).toBe(`/admin/integrations/webhooks/${stored?.id}`);

		await settleGift(db);
		expect(await deliverNow(db)).toEqual([
			{ url: 'https://hooks.riverbanktrust.org/giving', type: 'gift.made' }
		]);
	});

	it('refuses an address that is not https at the box, saying why, and adds nothing', async () => {
		const answer = await add.post(
			SCREEN,
			deployer,
			adding('http://crm.example.net/hook', ['gift.made'])
		);

		expect(answer.status).toBe(400);
		expect(await refusals(answer)).toEqual({ url: ['must start with https://'] });
		expect(await destinations()).toBe(0);
	});

	it('refuses an address that does not parse as one, saying so rather than asking for https', async () => {
		const answer = await add.post(
			SCREEN,
			deployer,
			adding('https://exa mple.org/hook', ['gift.made'])
		);

		expect(answer.status).toBe(400);
		expect(await refusals(answer)).toEqual({
			url: ['isn’t a web address: check it for a space or a stray character']
		});
		expect(await destinations()).toBe(0);
	});

	it('refuses a private host at the box, naming why', async () => {
		const answer = await add.post(
			SCREEN,
			deployer,
			adding('https://192.168.1.20/hook', ['gift.made'])
		);

		expect(answer.status).toBe(400);
		expect(await refusals(answer)).toEqual({
			url: ['must be reachable from the internet: 192.168.1.20 is a private network address']
		});
		expect(await destinations()).toBe(0);
	});

	it('refuses a destination listening to nothing, and a blank address, at their boxes', async () => {
		const answer = await add.post(SCREEN, deployer, adding('  ', []));

		expect(answer.status).toBe(400);
		expect(await refusals(answer)).toEqual({
			url: ['required'],
			events: ['choose at least one']
		});
		expect(await destinations()).toBe(0);
	});
});

describe('a member’s session', () => {
	it('gets not-found for the page and the press, and the press adds nothing', async () => {
		const member = await signInAsMember(db);

		expect((await add.get(SCREEN, member)).status).toBe(404);
		expect(
			(
				await add.post(
					SCREEN,
					member,
					adding('https://hooks.riverbanktrust.org/giving', ['gift.made'])
				)
			).status
		).toBe(404);
		expect(await destinations()).toBe(0);
	});
});
