import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { createDestination } from '$lib/server/webhooks/destinations';
import type { WebhookEvent } from '$lib/webhooks/catalog';
import {
	deliverNow,
	formBody,
	freshDeployment,
	page,
	settleGift,
	signInAsDeployer,
	signInAsMember,
	withFlash
} from '../webhook-routes.testing';
import * as screen from './_app.admin.integrations.webhooks.$id';
import * as list from './_app.admin.integrations.webhooks._index';

// one destination's page, through the protected layout against the real D1: what it shows, and
// the three presses on it — the edit, the resume and the delete — carried through to what the
// delivery run then posts.

const LIST = '/admin/integrations/webhooks';
const URL_ = 'https://crm.example.net/webhooks/better-giving';

type Screen = {
	id: string;
	url: string;
	title: string;
	events: string[];
	signingSecret: string;
	paused: boolean;
	held: number;
	confirming: 'resume' | 'delete' | null;
	added: boolean;
	saved: boolean;
};

let db: Db;
let deployer: string;
const destination = page('admin/integrations/webhooks/:id', screen);
const listed = page('admin/integrations/webhooks', list);

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await freshDeployment();
	deployer = await signInAsDeployer(db);
});

async function made(events: readonly WebhookEvent[] = ['gift.made']) {
	const created = await createDestination(db, { url: URL_, events });
	if (!created.ok) throw new Error(created.detail);
	return created.destination;
}

async function pause(id: string) {
	await env.DB.prepare(
		'update webhook_destination set paused_at = ?, failing_since = ? where id = ?'
	)
		.bind(Date.now(), Date.now() - 1, id)
		.run();
}

const at = (id: string, search = '') => `${LIST}/${id}${search}`;

async function visit(id: string, search = '', cookie = deployer): Promise<Screen> {
	const response = await destination.get(at(id, search), cookie);
	expect(response.status).toBe(200);
	return (await response.json()) as Screen;
}

const editing = (url: string, events: readonly string[]) =>
	formBody({ __form_id__: 'webhook-destination-edit', url, events });
async function refusals(response: Response): Promise<Record<string, string[]> | undefined> {
	const answer = (await response.json()) as {
		form: { result: { error?: Record<string, string[]> } };
	};
	return answer.form.result.error;
}

const resuming = () => formBody({ __form_id__: 'webhook-destination-resume' });
const deleting = () => formBody({ __form_id__: 'webhook-destination-delete' });

describe('GET /admin/integrations/webhooks/:id', () => {
	it('shows the address, the events it takes and its signing secret', async () => {
		const { id, signingSecret } = await made(['donor.added', 'gift.made']);

		expect(await visit(id)).toEqual({
			id,
			url: URL_,
			title: 'crm.example.net/webhooks/better-giving',
			events: ['gift.made', 'donor.added'],
			signingSecret,
			paused: false,
			held: 0,
			confirming: null,
			added: false,
			saved: false
		});
	});

	it('reads paused, with how many events it is holding', async () => {
		const { id } = await made();
		await pause(id);
		await settleGift(db);
		await settleGift(db);

		expect(await visit(id)).toMatchObject({ paused: true, held: 2 });
	});

	it('asks to resume only a paused destination, and to delete any', async () => {
		const { id } = await made();

		expect((await visit(id, '?confirm=resume')).confirming).toBeNull();
		expect((await visit(id, '?confirm=delete')).confirming).toBe('delete');
		await pause(id);
		expect((await visit(id, '?confirm=resume')).confirming).toBe('resume');
	});

	it('is not found for an id no destination has, or one deleted', async () => {
		const { id } = await made();
		await env.DB.prepare('update webhook_destination set archived_at = 1 where id = ?')
			.bind(id)
			.run();

		expect((await destination.get(at(id), deployer)).status).toBe(404);
		expect(
			(await destination.get(at('019fb300-0000-7000-8000-00000000dead'), deployer)).status
		).toBe(404);
	});
});

describe('POST /admin/integrations/webhooks/:id — the edit', () => {
	it('stops the events taken off and starts the ones added, for the events after it', async () => {
		const { id } = await made(['gift.made']);

		const answer = await destination.post(at(id), deployer, editing(URL_, ['donor.added']));

		expect(answer.status).toBe(303);
		expect(answer.headers.get('location')).toBe(at(id));
		expect((await visit(id, '', withFlash(deployer, answer))).saved).toBe(true);
		await settleGift(db);
		expect(await deliverNow(db)).toEqual([{ url: URL_, type: 'donor.added' }]);
	});

	it('moves the address the next event is posted to', async () => {
		const { id } = await made(['gift.made']);

		await destination.post(
			at(id),
			deployer,
			editing('https://hooks.riverbanktrust.org/giving', ['gift.made'])
		);

		await settleGift(db);
		expect(await deliverNow(db)).toEqual([
			{ url: 'https://hooks.riverbanktrust.org/giving', type: 'gift.made' }
		]);
	});

	it('refuses a private host, and no events, at their boxes, and changes nothing', async () => {
		const { id } = await made(['gift.made']);

		const noEvents = await destination.post(
			at(id),
			deployer,
			editing('https://localhost:8787/hook', [])
		);
		const localHost = await destination.post(
			at(id),
			deployer,
			editing('https://localhost:8787/hook', ['gift.made'])
		);

		expect(noEvents.status).toBe(400);
		expect(await refusals(noEvents)).toEqual({ events: ['choose at least one'] });
		expect(localHost.status).toBe(400);
		expect(await refusals(localHost)).toEqual({
			url: [
				'must be reachable from the internet: localhost names the machine the post is sent from'
			]
		});
		expect(await visit(id)).toMatchObject({ url: URL_, events: ['gift.made'] });
	});
});

describe('POST /admin/integrations/webhooks/:id — the resume', () => {
	it('re-sends what the pause held, and says how many', async () => {
		const { id } = await made(['gift.made']);
		await pause(id);
		await settleGift(db);
		expect(await deliverNow(db)).toEqual([]);

		const answer = await destination.post(at(id), deployer, resuming());

		expect(answer.status).toBe(200);
		expect(await answer.json()).toEqual({ resumed: 1 });
		expect((await visit(id)).paused).toBe(false);
		expect(await deliverNow(db)).toEqual([{ url: URL_, type: 'gift.made' }]);
	});

	it('refuses one that is not paused, in words, with 409', async () => {
		const { id } = await made();

		const answer = await destination.post(at(id), deployer, resuming());

		expect(answer.status).toBe(409);
		expect((await refusals(answer))?.['']).toEqual([
			'This destination is not paused, so there was nothing to resume.'
		]);
	});
});

describe('POST /admin/integrations/webhooks/:id — the delete', () => {
	it('drops what it was still owed, and lands on the list naming it', async () => {
		const { id } = await made(['gift.made']);
		await pause(id);
		await settleGift(db);

		const answer = await destination.post(at(id), deployer, deleting());

		expect(answer.status).toBe(303);
		expect(answer.headers.get('location')).toBe(LIST);
		const landed = await listed.get(LIST, withFlash(deployer, answer));
		expect(await landed.json()).toEqual({ destinations: [], deleted: URL_ });
		const owed = await env.DB.prepare('select status, last_error from webhook_delivery').first();
		expect(owed).toEqual({ status: 'dropped', last_error: 'Its destination was deleted.' });
		expect((await destination.get(at(id), deployer)).status).toBe(404);
	});
});

describe('a member’s session', () => {
	it('gets not-found for the page and each press, and no press does anything', async () => {
		const member = await signInAsMember(db);
		const { id } = await made(['gift.made']);
		await pause(id);

		expect((await destination.get(at(id), member)).status).toBe(404);
		for (const body of [
			editing('https://a.example.org/', ['donor.added']),
			resuming(),
			deleting()
		]) {
			expect((await destination.post(at(id), member, body)).status).toBe(404);
		}
		expect(await visit(id)).toMatchObject({ url: URL_, events: ['gift.made'], paused: true });
	});
});
