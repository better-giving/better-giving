import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { createDestination } from '$lib/server/webhooks/destinations';
import { destinationPagePath } from '$lib/server/webhooks/paused-mail';
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
// delivery run then posts, and the test, which a receiving system stood in for by `fetch` checks
// as it would any post.

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
	deliveries: {
		id: string;
		event: string;
		status: string;
		at: string;
		when: string;
		answer: number | null;
		attempts: number;
	}[];
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
	if (!created.ok) throw new Error(created.box);
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

it('is the page the pause mail links to', async () => {
	const { id } = await made();

	expect(destinationPagePath(id)).toBe(at(id));
	expect((await destination.get(destinationPagePath(id), deployer)).status).toBe(200);
});

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
const testing = () => formBody({ __form_id__: 'webhook-destination-test' });

type Post = { readonly url: string; readonly init: RequestInit; readonly body: string };

/** the receiving system: each post to `URL_` recorded, and answered by `answer`. */
function receiving(answer: () => Response | Error): Post[] {
	const posts: Post[] = [];
	vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
		posts.push({ url: String(input), init, body: String(init.body) });
		const answered = answer();
		if (answered instanceof Error) throw answered;
		return answered;
	});
	return posts;
}

/**
 * a receiver's check, by the Standard Webhooks algorithm as the spec states it
 * (https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md,
 * "Verifying signatures"), written without $lib/server/webhooks/sign.ts.
 */
async function verifies(secret: string, post: Post): Promise<boolean> {
	const headers = new Headers(post.init.headers);
	const id = headers.get('webhook-id');
	const timestamp = headers.get('webhook-timestamp');
	const signatures = headers.get('webhook-signature');
	if (id === null || timestamp === null || signatures === null) return false;
	if (Math.abs(Date.now() / 1_000 - Number(timestamp)) > 5 * 60) return false;
	const key = await crypto.subtle.importKey(
		'raw',
		Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0)),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify']
	);
	const content = new TextEncoder().encode(`${id}.${timestamp}.${post.body}`);
	for (const versioned of signatures.split(' ')) {
		const [version, signature] = versioned.split(',');
		if (version !== 'v1' || signature === undefined) continue;
		const mac = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
		if (await crypto.subtle.verify('HMAC', key, mac, content)) return true;
	}
	return false;
}

/** one delivery row for `destinationId`, recorded at `at`, standing where `row` says. */
async function delivery(
	destinationId: string,
	row: {
		status: 'pending' | 'delivered' | 'failed' | 'dropped';
		at: number;
		answer?: number;
		attempts?: number;
		event?: WebhookEvent;
	}
) {
	await env.DB.prepare(
		`insert into webhook_delivery (id, destination_id, event, subject_id, status, attempts,
		   next_attempt_at, last_status, delivered_at, created_at, updated_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	)
		.bind(
			`msg_${crypto.randomUUID()}`,
			destinationId,
			row.event ?? 'gift.made',
			crypto.randomUUID(),
			row.status,
			row.attempts ?? 0,
			row.at,
			row.answer ?? null,
			row.status === 'delivered' ? row.at : null,
			row.at,
			row.at
		)
		.run();
}

/** the destination's pause and its run of failures, as stored. */
async function standing(id: string) {
	return env.DB.prepare('select paused_at, failing_since from webhook_destination where id = ?')
		.bind(id)
		.first();
}

async function deliveryRows(): Promise<number> {
	const row = await env.DB.prepare('select count(*) as n from webhook_delivery').first<{
		n: number;
	}>();
	return row?.n ?? 0;
}

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
			saved: false,
			deliveries: []
		});
	});

	it('lists its latest fifty deliveries, newest first, with where each stands', async () => {
		const { id } = await made(['gift.made']);
		const other = await createDestination(db, {
			url: 'https://b.example.org/',
			events: ['gift.made']
		});
		if (!other.ok) throw new Error(other.box);
		const minute = (n: number) => Date.UTC(2026, 8, 28, 10, n);
		await delivery(other.destination.id, { status: 'delivered', at: minute(59), answer: 200 });
		for (let n = 0; n < 47; n++) {
			await delivery(id, { status: 'delivered', at: minute(n), answer: 200, attempts: 1 });
		}
		await delivery(id, {
			status: 'failed',
			at: minute(47),
			answer: 503,
			attempts: 9,
			event: 'donor.added'
		});
		await delivery(id, { status: 'dropped', at: minute(48), attempts: 0, event: 'gift.refunded' });
		await delivery(id, { status: 'pending', at: minute(49), answer: 500, attempts: 2 });
		await delivery(id, { status: 'pending', at: minute(50), attempts: 0 });

		const { deliveries } = await visit(id);

		expect(deliveries).toHaveLength(50);
		expect(deliveries.slice(0, 5)).toEqual([
			expect.objectContaining({
				event: 'gift.made',
				status: 'pending',
				answer: null,
				attempts: 0,
				when: '28 Sep 2026, 10:50 UTC',
				at: '2026-09-28T10:50:00.000Z'
			}),
			expect.objectContaining({
				event: 'gift.made',
				status: 'pending',
				answer: 500,
				attempts: 2,
				when: '28 Sep 2026, 10:49 UTC'
			}),
			expect.objectContaining({
				event: 'gift.refunded',
				status: 'dropped',
				answer: null,
				attempts: 0
			}),
			expect.objectContaining({ event: 'donor.added', status: 'failed', answer: 503, attempts: 9 }),
			expect.objectContaining({
				event: 'gift.made',
				status: 'delivered',
				answer: 200,
				attempts: 1,
				when: '28 Sep 2026, 10:46 UTC'
			})
		]);
		expect(deliveries.at(-1)?.when).toBe('28 Sep 2026, 10:01 UTC');
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

describe('POST /admin/integrations/webhooks/:id — send a test', () => {
	it('posts a test signed with the destination’s secret at once, and reports the answer', async () => {
		const { id, signingSecret } = await made(['gift.made']);
		const posts = receiving(() => new Response('ok'));

		const answer = await destination.post(at(id), deployer, testing());

		expect(answer.status).toBe(200);
		expect(await answer.json()).toEqual({ tested: { outcome: 'sent', status: 200 } });
		expect(posts.map((post) => post.url)).toEqual([URL_]);
		const [post] = posts as [Post];
		expect(await verifies(signingSecret, post)).toBe(true);
		expect(new Headers(post.init.headers).get('webhook-id')).toMatch(
			/^msg_test_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
		);
		expect(JSON.parse(post.body)).toEqual({
			type: 'test',
			timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
			data: { test: true, message: 'A test from your Better Giving dashboard.' }
		});
		expect(post.init.redirect).toBe('manual');
		expect(post.init.signal).toBeInstanceOf(AbortSignal);
		expect(await deliveryRows()).toBe(0);
	});

	it('reports a refusal, even the 410 a delivery pauses on, and leaves the destination as it was', async () => {
		const { id } = await made(['gift.made']);
		receiving(() => new Response('gone', { status: 410 }));

		const answer = await destination.post(at(id), deployer, testing());

		expect(await answer.json()).toEqual({ tested: { outcome: 'refused', status: 410 } });
		expect(await standing(id)).toEqual({ paused_at: null, failing_since: null });
	});

	it('reports no answer where the post never got one', async () => {
		const { id } = await made(['gift.made']);
		receiving(() => new TypeError('Network connection lost.'));

		const answer = await destination.post(at(id), deployer, testing());

		expect(await answer.json()).toEqual({ tested: { outcome: 'unanswered' } });
	});

	it('is not found for a deleted destination, and posts nothing', async () => {
		const { id } = await made(['gift.made']);
		await destination.post(at(id), deployer, deleting());
		const posts = receiving(() => new Response('ok'));

		expect((await destination.post(at(id), deployer, testing())).status).toBe(404);
		expect(posts).toEqual([]);
	});

	it('is sent to a paused destination, which stays paused and holding what it held', async () => {
		const { id } = await made(['gift.made']);
		await pause(id);
		await settleGift(db);
		const before = await standing(id);
		const posts = receiving(() => new Response('ok'));

		const answer = await destination.post(at(id), deployer, testing());

		expect(await answer.json()).toEqual({ tested: { outcome: 'sent', status: 200 } });
		expect(posts.map((post) => JSON.parse(post.body).type)).toEqual(['test']);
		expect(await standing(id)).toEqual(before);
		expect(await visit(id)).toMatchObject({ paused: true, held: 1 });
	});
});

describe('a member’s session', () => {
	it('gets not-found for the page and each press, and no press does anything', async () => {
		const member = await signInAsMember(db);
		const { id } = await made(['gift.made']);
		await pause(id);
		const posts = receiving(() => new Response('ok'));

		expect((await destination.get(at(id), member)).status).toBe(404);
		for (const body of [
			editing('https://a.example.org/', ['donor.added']),
			resuming(),
			deleting(),
			testing()
		]) {
			expect((await destination.post(at(id), member, body)).status).toBe(404);
		}
		expect(posts).toEqual([]);
		expect(await visit(id)).toMatchObject({ url: URL_, events: ['gift.made'], paused: true });
	});
});
