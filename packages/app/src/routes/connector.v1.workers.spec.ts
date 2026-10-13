import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
	CODE_TTL_MS,
	CONNECTOR_KEY_SHAPE,
	IDLE_KEY_REVOKE_MS,
	issueCode,
	LEFTOVER_KEEP_MS,
	listConnections,
	REVOKED_KEY_KEEP_MS,
	redeemCode,
	sweepConnectorLeftovers
} from '$lib/server/connector/keys';
import { CONNECTOR_ACTIONS, CONNECTOR_RETURN } from '$lib/server/connector/surface';
import { connectorCode, connectorKey, page, photoLink } from '$lib/server/db/schema';
import { pngHeader } from '$lib/server/images/headers.testing';
import { deleteNeverPublishedCampaign } from '$lib/server/pages/queries';
import { mintApiKey } from '$lib/server/integrations/keys';
import { connectorHarness, DEPLOYMENT, ORIGIN, under } from '../connector-routes.testing';
import { mountRoutes } from '../route-request.testing';
import { signInAsMember } from '../staff-session.testing';
import * as layout from './_app';
import * as connections from './_app.admin.integrations.connector';
import * as unserved from './connector.v1.$';
import * as campaign from './connector.v1.campaigns.$id._index';
import * as blocks from './connector.v1.campaigns.$id.blocks';
import * as settings from './connector.v1.campaigns.$id.settings';
import * as campaigns from './connector.v1.campaigns._index';
import * as disconnect from './connector.v1.disconnect';
import * as hello from './connector.v1.hello';
import * as uploadLink from './connector.v1.photos.upload-link';
import * as photo from './photo.$token';

// the walk the central connector's end-to-end run takes against a deployment, from this side:
// hello, the Allow screen, the code exchange, an action with the connected key, the connector
// letting its key go (revoke) and sweeping what is left (cleanup), and Disconnect pressed on the
// dashboard — then the edits and the photo link.

const h = connectorHarness(() => ({
	hello: under('hello', hello),
	disconnect: under('disconnect', disconnect),
	campaigns: under('campaigns', campaigns),
	campaign: under('campaigns/:id', campaign),
	blocks: under('campaigns/:id/blocks', blocks),
	settings: under('campaigns/:id/settings', settings),
	uploadLink: under('photos/upload-link', uploadLink),
	unserved: under('*', unserved),
	connections: mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/integrations/connector', module: connections }
	]),
	photo: mountRoutes([{ path: 'photo/:token', module: photo }])
}));
const { call, connect, pressAllow, route } = h;

describe('hello', () => {
	it('answers without a key, in the contract’s shape, with every action it serves', async () => {
		const response = await call('hello', '/hello');

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			service: 'better-giving',
			contract: 1,
			release: expect.any(String),
			name: 'Riverbank Trust',
			actions: [...CONNECTOR_ACTIONS]
		});
	});
});

describe('the Allow screen', () => {
	it('shows the deployer what the connection may do', async () => {
		const response = await route('allow')(
			new Request(`${ORIGIN}/admin/connector/allow?state=st-123`, {
				headers: { cookie: h.deployer }
			}),
			{ env: DEPLOYMENT.env }
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ orgName: 'Riverbank Trust', state: 'st-123' });
	});

	it('sends the browser to the connector’s fixed return with the state and a code', async () => {
		const response = await pressAllow(h.deployer, 'allow');

		expect(response.status).toBe(303);
		const back = new URL(response.headers.get('location') ?? '');
		expect(`${back.origin}${back.pathname}`).toBe(CONNECTOR_RETURN);
		expect(back.searchParams.get('state')).toBe('st-123');
		expect(back.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/);
		// no key exists until the connector redeems the code
		expect(await h.db.select().from(connectorKey)).toEqual([]);
	});

	it('sends Deny back as access_denied, with no code', async () => {
		const back = new URL((await pressAllow(h.deployer, 'deny')).headers.get('location') ?? '');

		expect(back.searchParams.get('error')).toBe('access_denied');
		expect(back.searchParams.has('code')).toBe(false);
		expect(await h.db.select().from(connectorCode)).toEqual([]);
	});

	it('names this deployment as the issuer of the return Allow sends', async () => {
		const back = new URL((await pressAllow(h.deployer, 'allow')).headers.get('location') ?? '');

		expect(back.searchParams.get('iss')).toBe(ORIGIN);
	});

	it('names the same issuer on the return Deny sends, with no code', async () => {
		const back = new URL((await pressAllow(h.deployer, 'deny')).headers.get('location') ?? '');

		expect(back.searchParams.get('iss')).toBe(ORIGIN);
		expect(back.searchParams.has('code')).toBe(false);
	});

	it('names the pinned published origin as the issuer, not the host the press arrived at', async () => {
		const pinned = { ...DEPLOYMENT.env, BETTER_AUTH_URL: 'https://donate.example.org/' };
		const body = new FormData();
		body.set('intent', 'allow');
		const response = await route('allow')(
			new Request(`${ORIGIN}/admin/connector/allow?state=st-123`, {
				method: 'POST',
				headers: { cookie: h.deployer, origin: ORIGIN, 'sec-fetch-site': 'same-origin' },
				body
			}),
			{ env: pinned }
		);

		expect(response.status).toBe(303);
		const back = new URL(response.headers.get('location') ?? '');
		expect(back.searchParams.get('iss')).toBe('https://donate.example.org');
	});

	it('is not there for a member', async () => {
		const member = await signInAsMember(h.db, DEPLOYMENT);
		const response = await pressAllow(member, 'allow');

		expect(response.status).toBe(404);
		expect(await h.db.select().from(connectorCode)).toEqual([]);
	});

	it('refuses a press posted from another site', async () => {
		const body = new FormData();
		body.set('intent', 'allow');
		const response = await route('allow')(
			new Request(`${ORIGIN}/admin/connector/allow?state=st-123`, {
				method: 'POST',
				headers: {
					cookie: h.deployer,
					origin: 'https://evil.example',
					'sec-fetch-site': 'cross-site'
				},
				body
			}),
			{ env: DEPLOYMENT.env }
		);

		expect(response.status).toBe(403);
	});
});

describe('the code exchange', () => {
	it('mints a connector key once, and refuses the code a second time', async () => {
		const code = await issueCode(h.db, 'staff');
		const first = await call('exchange', '/exchange', { method: 'POST', body: { code } });
		const second = await call('exchange', '/exchange', { method: 'POST', body: { code } });

		expect(first.status).toBe(200);
		const { key, name } = (await first.json()) as { key: string; name: string };
		expect(key).toMatch(CONNECTOR_KEY_SHAPE);
		expect(name).toBe('Riverbank Trust');
		expect(second.status).toBe(400);
		expect(await second.json()).toMatchObject({ code: 'code_invalid' });
	});

	it('mints one key between two redemptions of one code racing each other', async () => {
		const code = await issueCode(h.db, 'staff');

		const minted = await Promise.all([redeemCode(h.db, code), redeemCode(h.db, code)]);

		expect(minted.filter((m) => m !== null)).toHaveLength(1);
		const keys = await h.db.select().from(connectorKey);
		expect(keys).toHaveLength(1);
		expect(keys[0]?.allowedBy).toBe('staff');
	});

	it('refuses a code past its ten minutes', async () => {
		const code = await issueCode(h.db, 'staff', new Date(Date.now() - CODE_TTL_MS - 1));
		const response = await call('exchange', '/exchange', { method: 'POST', body: { code } });

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: 'code_invalid' });
	});

	it.each([{ code: 'not-a-code' }, {}, 'not json'])('refuses %j as code_invalid', async (body) => {
		const response = await call('exchange', '/exchange', { method: 'POST', body });

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: 'code_invalid' });
	});
});

describe('an action with the connected key', () => {
	it('lists the campaigns', async () => {
		const key = await connect();
		const made = await call('campaigns', '/campaigns', {
			method: 'POST',
			key,
			body: { title: 'Winter coats' }
		});
		expect(made.status).toBe(201);
		const { id } = (await made.json()) as { id: string };

		const response = await call('campaigns', '/campaigns', { key });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: [
				{
					id,
					title: 'Winter coats',
					status: 'draft',
					slug: 'winter-coats',
					public_url: null,
					goal: null,
					end_date: null,
					updated_at: expect.any(String)
				}
			],
			next_cursor: null
		});
	});

	it('narrows the list by status, and pages it', async () => {
		const key = await connect();
		for (const title of ['One', 'Two', 'Three']) {
			await call('campaigns', '/campaigns', { method: 'POST', key, body: { title } });
		}

		const first = (await (await call('campaigns', '/campaigns?limit=2', { key })).json()) as {
			data: { title: string }[];
			next_cursor: string | null;
		};
		const rest = (await (
			await call('campaigns', `/campaigns?limit=2&cursor=${first.next_cursor}`, { key })
		).json()) as { data: unknown[]; next_cursor: string | null };
		const published = (await (
			await call('campaigns', '/campaigns?status=published', { key })
		).json()) as {
			data: unknown[];
		};

		expect(first.data.map((c) => c.title)).toEqual(['Three', 'Two']);
		expect(rest.data).toHaveLength(1);
		expect(rest.next_cursor).toBeNull();
		expect(published.data).toEqual([]);
	});

	it('answers one key call after call, and records when it was last used', async () => {
		const key = await connect();
		for (let at = 0; at < 3; at += 1) {
			expect((await call('campaigns', '/campaigns', { key })).status).toBe(200);
		}
		const [row] = await h.db.select().from(connectorKey);
		expect(row?.lastUsedAt).not.toBeNull();
	});

	it.each([
		['no key', undefined],
		['a key it never issued', `bgc_${'A'.repeat(43)}`],
		['something that is no key', 'hello']
	])('refuses %s as key_refused', async (_what, key) => {
		const response = await call('campaigns', '/campaigns', key === undefined ? {} : { key });

		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: 'key_refused' });
	});

	it('refuses a read-API key, which is another surface’s', async () => {
		const { key } = await mintApiKey(h.db, { name: 'CRM', kind: 'api' });
		const response = await call('campaigns', '/campaigns', { key });

		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: 'key_refused' });
	});

	it('charges each key its own bucket, and answers past it with rate_limited', async () => {
		const key = await connect();
		let answered: Response | undefined;
		for (let at = 0; at < 10; at += 1) {
			answered = await call('campaigns', '/campaigns', { key, metered: true });
			if (answered.status === 429) break;
		}

		expect(answered?.status).toBe(429);
		expect(await answered?.json()).toMatchObject({ code: 'rate_limited' });
	});

	it('answers an action this release lacks as unknown_action', async () => {
		const key = await connect();
		const response = await call('unserved', '/forms', { key });

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ code: 'unknown_action' });
	});
});

describe('revoke and cleanup from the connector', () => {
	it('stops the key admitting anything once the connector lets it go', async () => {
		const key = await connect();
		const let_go = await call('disconnect', '/disconnect', { method: 'POST', key });

		expect(let_go.status).toBe(204);
		const after = await call('campaigns', '/campaigns', { key });
		expect(after.status).toBe(401);
		expect(await after.json()).toMatchObject({ code: 'key_refused' });
		const [row] = await h.db.select().from(connectorKey);
		expect(row?.revokedBy).toBe('connector');
	});

	it('sweeps codes and photo links spent or expired a day ago, and keeps the rest', async () => {
		const key = await connect();
		const { id } = (await (
			await call('campaigns', '/campaigns', { method: 'POST', key, body: { title: 'Coats' } })
		).json()) as { id: string };
		await call('uploadLink', '/photos/upload-link', {
			method: 'POST',
			key,
			body: { target: { kind: 'campaign', id } }
		});
		await issueCode(h.db, 'staff');
		const later = new Date(Date.now() + LEFTOVER_KEEP_MS + 60 * 60_000);

		await sweepConnectorLeftovers(h.db, later);

		expect(await h.db.select().from(connectorCode)).toEqual([]);
		expect(await h.db.select().from(photoLink)).toEqual([]);
		expect(await h.db.select().from(connectorKey)).toHaveLength(1);
		expect((await call('campaigns', '/campaigns', { key })).status).toBe(200);
	});

	it('sweeps a key a month after it was revoked, and never a live one', async () => {
		const kept = await connect();
		const cut = await connect();
		const { id } = (await (
			await call('campaigns', '/campaigns', { method: 'POST', key: cut, body: { title: 'Coats' } })
		).json()) as { id: string };
		await call('uploadLink', '/photos/upload-link', {
			method: 'POST',
			key: cut,
			body: { target: { kind: 'campaign', id } }
		});
		await call('disconnect', '/disconnect', { method: 'POST', key: cut });

		await sweepConnectorLeftovers(h.db, new Date(Date.now() + REVOKED_KEY_KEEP_MS - 60 * 60_000));
		expect(await h.db.select().from(connectorKey)).toHaveLength(2);

		await sweepConnectorLeftovers(h.db, new Date(Date.now() + REVOKED_KEY_KEEP_MS + 60 * 60_000));
		const left = await h.db.select().from(connectorKey);
		expect(left).toHaveLength(1);
		expect(left[0]?.revokedAt).toBeNull();
		expect(await h.db.select().from(photoLink)).toEqual([]);
		expect((await call('campaigns', '/campaigns', { key: kept })).status).toBe(200);
	});

	it('keeps a key used within ninety days, measured from its last use', async () => {
		const key = await connect();
		await h.db
			.update(connectorKey)
			.set({ createdAt: new Date(Date.now() - 2 * IDLE_KEY_REVOKE_MS) });
		expect((await call('campaigns', '/campaigns', { key })).status).toBe(200);
		const [used] = await h.db.select().from(connectorKey);
		const lastUsedAt = used?.lastUsedAt?.getTime() ?? 0;

		await sweepConnectorLeftovers(h.db, new Date(lastUsedAt + IDLE_KEY_REVOKE_MS - 60 * 60_000));

		expect((await h.db.select().from(connectorKey))[0]?.revokedAt).toBeNull();
		expect((await call('campaigns', '/campaigns', { key })).status).toBe(200);
		expect(await listConnections(h.db)).toHaveLength(1);
	});

	it('revokes a key unused for ninety days since its last use', async () => {
		const key = await connect();
		expect((await call('campaigns', '/campaigns', { key })).status).toBe(200);
		const [used] = await h.db.select().from(connectorKey);
		const lastUsedAt = used?.lastUsedAt?.getTime() ?? 0;

		await sweepConnectorLeftovers(h.db, new Date(lastUsedAt + IDLE_KEY_REVOKE_MS + 60 * 60_000));

		const refused = await call('campaigns', '/campaigns', { key });
		expect(refused.status).toBe(401);
		expect(await refused.json()).toMatchObject({ code: 'key_refused' });
		expect(await listConnections(h.db)).toEqual([]);
		expect((await h.db.select().from(connectorKey))[0]?.revokedBy).toBe('connector');
	});

	it('revokes a key never used ninety days after it was minted, and ends its open photo link', async () => {
		const key = await connect();
		const { id } = (await (
			await call('campaigns', '/campaigns', { method: 'POST', key, body: { title: 'Coats' } })
		).json()) as { id: string };
		await call('uploadLink', '/photos/upload-link', {
			method: 'POST',
			key,
			body: { target: { kind: 'campaign', id } }
		});
		const [minted] = await h.db.update(connectorKey).set({ lastUsedAt: null }).returning();
		const idleFrom = minted?.createdAt.getTime() ?? 0;
		const swept = new Date(idleFrom + IDLE_KEY_REVOKE_MS + 60 * 60_000);
		// a link still open at the sweep, so the expired-link delete does not take it first
		await h.db.update(photoLink).set({ expiresAt: new Date(swept.getTime() + 60 * 60_000) });

		await sweepConnectorLeftovers(h.db, new Date(idleFrom + IDLE_KEY_REVOKE_MS - 60 * 60_000));
		expect(await listConnections(h.db)).toHaveLength(1);

		await sweepConnectorLeftovers(h.db, swept);

		const refused = await call('campaigns', '/campaigns', { key });
		expect(refused.status).toBe(401);
		expect(await refused.json()).toMatchObject({ code: 'key_refused' });
		expect(await listConnections(h.db)).toEqual([]);
		const [row] = await h.db.select().from(connectorKey);
		expect(row?.revokedBy).toBe('connector');
		expect(row?.revokedAt).toEqual(swept);
		const [link] = await h.db.select().from(photoLink);
		expect(link?.usedAt).toEqual(swept);
	});

	it('deletes a never-published campaign that a photo link still names, and the link with it', async () => {
		const key = await connect();
		const { id } = (await (
			await call('campaigns', '/campaigns', { method: 'POST', key, body: { title: 'Coats' } })
		).json()) as { id: string };
		await call('uploadLink', '/photos/upload-link', {
			method: 'POST',
			key,
			body: { target: { kind: 'campaign', id } }
		});
		const [drawn] = await h.db.select().from(page).where(eq(page.id, id));

		expect(await deleteNeverPublishedCampaign(h.db, id, drawn?.updatedAt ?? new Date(0))).toBe(
			true
		);
		expect(await h.db.select().from(page).where(eq(page.id, id))).toEqual([]);
		expect(await h.db.select().from(photoLink)).toEqual([]);
	});
});

describe('Disconnect on the dashboard', () => {
	it('lists the connection and cuts its key at once', async () => {
		const key = await connect();
		const listed = (await (
			await route('connections')(
				new Request(`${ORIGIN}/admin/integrations/connector`, { headers: { cookie: h.deployer } }),
				{ env: DEPLOYMENT.env }
			)
		).json()) as { connections: { id: string; key: string }[] };
		expect(listed.connections).toHaveLength(1);
		const [shown] = listed.connections;
		expect(shown?.key).toBe(`${key.slice(0, 8)}…${key.slice(-4)}`);

		const body = new FormData();
		body.set('connection', shown?.id ?? '');
		const pressed = await route('connections')(
			new Request(`${ORIGIN}/admin/integrations/connector`, {
				method: 'POST',
				headers: { cookie: h.deployer, origin: ORIGIN, 'sec-fetch-site': 'same-origin' },
				body
			}),
			{ env: DEPLOYMENT.env }
		);

		expect(await pressed.json()).toEqual({ disconnected: true });
		const after = await call('campaigns', '/campaigns', { key });
		expect(after.status).toBe(401);
		expect(await after.json()).toMatchObject({ code: 'key_refused' });
		const [row] = await h.db.select().from(connectorKey);
		expect(row?.revokedBy).toBe('dashboard');
	});
});

describe('campaign edits', () => {
	async function made(key: string) {
		const response = await call('campaigns', '/campaigns', {
			method: 'POST',
			key,
			body: { title: 'Coats' }
		});
		return ((await response.json()) as { id: string }).id;
	}

	it('reads a campaign, and a missing one as not_found', async () => {
		const key = await connect();
		const id = await made(key);

		const read = (await (await call('campaign', `/campaigns/${id}`, { key })).json()) as {
			blocks: { type: string }[];
		};
		const missing = await call('campaign', '/campaigns/019fb300-0000-7000-8000-000000000999', {
			key
		});

		expect(read.blocks.some((b) => b.type === 'donation-box')).toBe(true);
		expect(missing.status).toBe(404);
		expect(await missing.json()).toMatchObject({ code: 'not_found' });
	});

	it('refuses a title that is blank', async () => {
		const key = await connect();
		const response = await call('campaigns', '/campaigns', {
			method: 'POST',
			key,
			body: { title: ' ' }
		});

		expect(response.status).toBe(422);
		expect(await response.json()).toMatchObject({ code: 'invalid', errors: [{ path: 'title' }] });
	});

	it('sets the goal, end date and sharing on the draft alone', async () => {
		const key = await connect();
		const id = await made(key);

		const response = await call('settings', `/campaigns/${id}/settings`, {
			method: 'PATCH',
			key,
			body: {
				goal: { amount: '5000', currency: 'USD' },
				end_date: '2099-12-31',
				time_zone: 'America/New_York',
				sharing: { message: 'Help us keep 300 kids warm' }
			}
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			goal: { amount: '5000.00', currency: 'USD' },
			end_date: '2099-12-31',
			time_zone: 'America/New_York',
			sharing: { message: 'Help us keep 300 kids warm' },
			status: 'draft'
		});
		const [row] = await h.db.select().from(page).where(eq(page.id, id));
		expect(row?.published).toBeNull();
	});

	it('asks for a time zone before it sets a first end date', async () => {
		const key = await connect();
		const id = await made(key);

		const response = await call('settings', `/campaigns/${id}/settings`, {
			method: 'PATCH',
			key,
			body: { end_date: '2099-12-31' }
		});

		expect(response.status).toBe(422);
		expect(await response.json()).toMatchObject({ errors: [{ path: 'time_zone' }] });
	});

	it('replaces the blocks, and refuses a page the page rule refuses with the path', async () => {
		const key = await connect();
		const id = await made(key);
		const { blocks: current } = (await (
			await call('campaign', `/campaigns/${id}`, { key })
		).json()) as {
			blocks: { type: string }[];
		};

		const kept = await call('blocks', `/campaigns/${id}/blocks`, {
			method: 'PATCH',
			key,
			body: { blocks: current.filter((b) => b.type !== 'share') }
		});
		const noBox = await call('blocks', `/campaigns/${id}/blocks`, {
			method: 'PATCH',
			key,
			body: { blocks: current.filter((b) => b.type !== 'donation-box') }
		});

		expect(kept.status).toBe(200);
		expect(
			((await kept.json()) as { blocks: { type: string }[] }).blocks.map((b) => b.type)
		).not.toContain('share');
		expect(noBox.status).toBe(422);
		expect(await noBox.json()).toMatchObject({ code: 'invalid', errors: [{ path: 'blocks' }] });
	});

	it('refuses a photo id that no stored photo has', async () => {
		const key = await connect();
		const id = await made(key);
		const { blocks: current } = (await (
			await call('campaign', `/campaigns/${id}`, { key })
		).json()) as {
			blocks: { type: string; imageId?: string | null }[];
		};
		const forged = current.map((b) =>
			b.type === 'hero' ? { ...b, imageId: '019fb300-0000-7000-8000-000000000abc' } : b
		);

		const response = await call('blocks', `/campaigns/${id}/blocks`, {
			method: 'PATCH',
			key,
			body: { blocks: forged }
		});

		expect(response.status).toBe(422);
		expect(((await response.json()) as { detail: string }).detail).toContain('photos.upload_link');
	});
});

describe('the photo link', () => {
	async function linked(key: string) {
		const id = (
			(await (
				await call('campaigns', '/campaigns', { method: 'POST', key, body: { title: 'Coats' } })
			).json()) as { id: string }
		).id;
		const response = await call('uploadLink', '/photos/upload-link', {
			method: 'POST',
			key,
			body: { target: { kind: 'campaign', id } }
		});
		expect(response.status).toBe(201);
		const { url } = (await response.json()) as { url: string; expires_at: string };
		return { id, url: new URL(url) };
	}

	function upload(url: URL): Promise<Response> {
		const body = new FormData();
		body.set('file', new Blob([pngHeader(40, 30)], { type: 'image/png' }), 'coats.png');
		return route('photo')(
			new Request(`${ORIGIN}${url.pathname}`, {
				method: 'POST',
				headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin' },
				body
			}),
			{ env: DEPLOYMENT.env }
		);
	}

	it('places one photo in the campaign’s empty hero, once', async () => {
		const key = await connect();
		const { id, url } = await linked(key);
		expect(url.origin).toBe(ORIGIN);

		const first = await upload(url);
		const second = await upload(url);

		expect(await first.json()).toEqual({ placed: true });
		expect(second.status).toBe(410);
		const { blocks: after } = (await (
			await call('campaign', `/campaigns/${id}`, { key })
		).json()) as {
			blocks: { type: string; imageId?: string | null }[];
		};
		expect(after.find((b) => b.type === 'hero')?.imageId).toEqual(expect.any(String));
	});

	it('stops working once the connection is disconnected', async () => {
		const key = await connect();
		const { url } = await linked(key);
		await call('disconnect', '/disconnect', { method: 'POST', key });

		const shown = (await (
			await route('photo')(new Request(`${ORIGIN}${url.pathname}`), { env: DEPLOYMENT.env })
		).json()) as { live: boolean };

		expect(shown.live).toBe(false);
		expect((await upload(url)).status).toBe(410);
	});
});
