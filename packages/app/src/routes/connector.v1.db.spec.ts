import { eq } from 'drizzle-orm';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
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
import { PHOTOS_MAX } from '$lib/page/catalog';
import { connectorCode, connectorKey, page, photoLink } from '$lib/server/db/schema';
import { pngHeader } from '$lib/server/images/headers.testing';
import { deleteNeverPublishedCampaign } from '$lib/server/pages/queries';
import { mintApiKey } from '$lib/server/integrations/keys';
import { connectorHarness, DEPLOYMENT, ORIGIN, under } from '../connector-routes.testing';
import { mountRoutes } from '../route-request.testing';
import { signInAsMember } from '../staff-session.testing';
import * as layout from './_app';
import * as connections from './_app.admin.integrations.connector';
import * as integrationsSurface from './integrations.v1';
import * as integrationsGifts from './integrations.v1.gifts';
import * as zapierSurface from './zapier';
import * as zapierMe from './zapier.me';
import * as unserved from './connector.v1.$';
import * as campaign from './connector.v1.campaigns.$id._index';
import * as content from './connector.v1.campaigns.$id.content';
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
	content: under('campaigns/:id/content', content),
	settings: under('campaigns/:id/settings', settings),
	uploadLink: under('photos/upload-link', uploadLink),
	unserved: under('*', unserved),
	connections: mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/integrations/connector', module: connections }
	]),
	photo: mountRoutes([{ path: 'photo/:token', module: photo }]),
	integrationsGifts: mountRoutes([
		{ path: 'integrations/v1', module: integrationsSurface },
		{ path: 'gifts', module: integrationsGifts }
	]),
	zapierMe: mountRoutes([
		{ path: 'zapier', module: zapierSurface },
		{ path: 'me', module: zapierMe }
	])
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

	it('lists the content actions under their names, and none of the block ones', async () => {
		const { actions } = (await (await call('hello', '/hello')).json()) as { actions: string[] };

		expect(actions).toEqual(
			expect.arrayContaining([
				'campaigns.update_content',
				'donation_page.update_content',
				'content.catalog'
			])
		);
		expect(actions).not.toContain('campaigns.update_blocks');
		expect(actions).not.toContain('donation_page.update_blocks');
		expect(actions).not.toContain('blocks.catalog');
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

	it('sends a Deny pressed after Allow back with no code', async () => {
		await pressAllow(h.deployer, 'allow');

		const back = new URL((await pressAllow(h.deployer, 'deny')).headers.get('location') ?? '');

		expect(back.searchParams.get('state')).toBe('st-123');
		expect(back.searchParams.get('error')).toBe('access_denied');
		expect(back.searchParams.has('code')).toBe(false);
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

	it('refuses a code already exchanged after Disconnect, and the old key stays refused', async () => {
		const allowed = await pressAllow(h.deployer, 'allow');
		const code = new URL(allowed.headers.get('location') ?? '').searchParams.get('code');
		const first = await call('exchange', '/exchange', { method: 'POST', body: { code } });
		const { key } = (await first.json()) as { key: string };
		expect((await call('campaigns', '/campaigns', { key })).status).toBe(200);
		await call('disconnect', '/disconnect', { method: 'POST', key });

		const again = await call('exchange', '/exchange', { method: 'POST', body: { code } });

		expect(again.status).toBe(400);
		expect(await again.json()).toMatchObject({ code: 'code_invalid' });
		expect(await h.db.select().from(connectorKey)).toHaveLength(1);
		const refused = await call('campaigns', '/campaigns', { key });
		expect(refused.status).toBe(401);
		expect(await refused.json()).toMatchObject({ code: 'key_refused' });
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

describe('a connector key on another surface', () => {
	const elsewhere = { [CLIENT_IP_HEADER]: '203.0.113.77' };

	it('is refused on /integrations/v1 as a key that is not one of its own', async () => {
		const key = await connect();
		const send = (presented: string) =>
			route('integrationsGifts')(
				new Request(`${ORIGIN}/integrations/v1/gifts`, {
					headers: { ...elsewhere, authorization: `Bearer ${presented}` }
				})
			);

		const response = await send(key);

		expect(response.status).toBe(401);
		const body = (await response.json()) as { error: string };
		expect(body.error).toBe('malformed_key');
		expect(body).toStrictEqual(await (await send('bgc_not-a-key')).json());
	});

	it('is refused on /zapier with the same 401 as no key', async () => {
		const key = await connect();
		const send = (authorization?: string) =>
			route('zapierMe')(
				new Request(`${ORIGIN}/zapier/me`, {
					headers: { ...elsewhere, ...(authorization === undefined ? {} : { authorization }) }
				})
			);

		const response = await send(`Bearer ${key}`);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual(await (await send()).json());
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

	it('reads a campaign as its layout and content, with no blocks and no share buttons, and a missing one as not_found', async () => {
		const key = await connect();
		const id = await made(key);

		const read = (await (await call('campaign', `/campaigns/${id}`, { key })).json()) as Record<
			string,
			unknown
		>;
		const missing = await call('campaign', '/campaigns/019fb300-0000-7000-8000-000000000999', {
			key
		});

		expect(read).toMatchObject({ layout: 'card', content: { heading: expect.any(String) } });
		expect(read).not.toHaveProperty('blocks');
		expect(read.sharing).toEqual({ message: null });
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

	it('writes the content keys it names and leaves the rest, null clearing one', async () => {
		const key = await connect();
		const id = await made(key);
		const story = {
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'Every coat is a warm night.' }] }
			]
		};

		const response = await call('content', `/campaigns/${id}/content`, {
			method: 'PATCH',
			key,
			body: {
				heading: 'Warm coats for winter',
				story,
				tiers: [{ amountMinor: 2500, buys: 'a coat for one child' }],
				faq: [{ question: 'Who gets them?', answer: story }]
			}
		});

		expect(response.status).toBe(200);
		const written = (await response.json()) as { layout: string; content: Record<string, unknown> };
		expect(written.content).toMatchObject({
			heading: 'Warm coats for winter',
			story,
			tiers: [{ amountMinor: 2500, buys: 'a coat for one child' }],
			faq: [{ question: 'Who gets them?' }]
		});
		expect(written.layout).toBe('letter');

		const cleared = await call('content', `/campaigns/${id}/content`, {
			method: 'PATCH',
			key,
			body: { tiers: null }
		});
		const after = (await cleared.json()) as { layout: string; content: Record<string, unknown> };
		expect(after.content).not.toHaveProperty('tiers');
		expect(after.content).toMatchObject({ heading: 'Warm coats for winter', story });
		const [row] = await h.db.select().from(page).where(eq(page.id, id));
		expect(row?.published).toBeNull();
	});

	it('clears a heading sent null to the empty string, the one key a page cannot be without', async () => {
		const key = await connect();
		const id = await made(key);
		const set = await call('content', `/campaigns/${id}/content`, {
			method: 'PATCH',
			key,
			body: { heading: 'Warm coats for winter' }
		});
		expect(((await set.json()) as { content: { heading: string } }).content.heading).toBe(
			'Warm coats for winter'
		);

		const cleared = await call('content', `/campaigns/${id}/content`, {
			method: 'PATCH',
			key,
			body: { heading: null }
		});

		expect(cleared.status).toBe(200);
		expect(((await cleared.json()) as { content: { heading: unknown } }).content.heading).toBe('');
	});

	it.each([
		['layout', { layout: 'feature' }],
		['blocks', { blocks: [] }],
		['palette', { palette: 'warm' }],
		['variant', { variant: 'wide' }]
	] as const)(
		'refuses a %s key, saying the page picks its own layout, and writes nothing',
		async (name, body) => {
			const key = await connect();
			const id = await made(key);
			const [before] = await h.db.select().from(page).where(eq(page.id, id));

			const response = await call('content', `/campaigns/${id}/content`, {
				method: 'PATCH',
				key,
				body: { heading: 'Changed', ...body }
			});

			expect(response.status).toBe(422);
			const problem = (await response.json()) as {
				code: string;
				detail: string;
				errors: { path: string }[];
			};
			expect(problem).toMatchObject({ code: 'invalid', errors: [{ path: name }] });
			expect(problem.detail).toContain('picks its whole layout from its content');
			const [after] = await h.db.select().from(page).where(eq(page.id, id));
			expect(after?.draft).toBe(before?.draft);
		}
	);

	it('refuses content the page rule refuses, with the path', async () => {
		const key = await connect();
		const id = await made(key);

		const response = await call('content', `/campaigns/${id}/content`, {
			method: 'PATCH',
			key,
			body: { tiers: [{ amountMinor: 0, buys: 'nothing' }] }
		});

		expect(response.status).toBe(422);
		expect(await response.json()).toMatchObject({
			code: 'invalid',
			errors: [{ path: 'tiers.0.amountMinor' }]
		});
	});

	it('refuses a cover photo id that no stored photo has', async () => {
		const key = await connect();
		const id = await made(key);

		const response = await call('content', `/campaigns/${id}/content`, {
			method: 'PATCH',
			key,
			body: { hero: { imageId: '019fb300-0000-7000-8000-000000000abc', alt: null } }
		});

		expect(response.status).toBe(422);
		expect(((await response.json()) as { detail: string }).detail).toContain('photos.upload_link');
	});

	it.each([
		['layout', { layout: 'feature' }],
		['look', { look: 'warm' }],
		['sharing', { sharing: null }],
		['sharing', { sharing: 'Hello' }],
		['sharing.tone', { sharing: { message: 'Hello', tone: 'warm' } }]
	] as const)(
		'refuses a settings body naming %s it does not set, and writes nothing',
		async (path, body) => {
			const key = await connect();
			const id = await made(key);
			const [before] = await h.db.select().from(page).where(eq(page.id, id));

			const response = await call('settings', `/campaigns/${id}/settings`, {
				method: 'PATCH',
				key,
				body: { goal: { amount: '100', currency: 'USD' }, ...body }
			});

			expect(response.status).toBe(422);
			expect(await response.json()).toMatchObject({ code: 'invalid', errors: [{ path }] });
			const [after] = await h.db.select().from(page).where(eq(page.id, id));
			expect(after?.draft).toBe(before?.draft);
			expect(after?.updatedAt).toEqual(before?.updatedAt);
		}
	);

	it('refuses an empty content body, and writes nothing', async () => {
		const key = await connect();
		const id = await made(key);
		const [before] = await h.db.select().from(page).where(eq(page.id, id));

		const response = await call('content', `/campaigns/${id}/content`, {
			method: 'PATCH',
			key,
			body: {}
		});

		expect(response.status).toBe(422);
		expect(((await response.json()) as { detail: string }).detail).toContain(
			'send at least one content key'
		);
		const [after] = await h.db.select().from(page).where(eq(page.id, id));
		expect(after?.updatedAt).toEqual(before?.updatedAt);
	});

	it.each([
		['a null photo', { photos: [null] }],
		['a photo with no id', { photos: [{ alt: null }] }],
		['a cover that is a string', { hero: 'cover.png' }]
	] as const)('refuses %s as the page rule does, not as a fault', async (_, body) => {
		const key = await connect();
		const id = await made(key);

		const response = await call('content', `/campaigns/${id}/content`, {
			method: 'PATCH',
			key,
			body
		});

		expect(response.status).toBe(422);
		expect(await response.json()).toMatchObject({ code: 'invalid' });
	});

	it('refuses a settings body that picks share channels, and keeps the message alone', async () => {
		const key = await connect();
		const id = await made(key);

		const channels = await call('settings', `/campaigns/${id}/settings`, {
			method: 'PATCH',
			key,
			body: { sharing: { message: 'Hello', channels: ['email'] } }
		});
		const message = await call('settings', `/campaigns/${id}/settings`, {
			method: 'PATCH',
			key,
			body: { sharing: { message: 'Hello' } }
		});

		expect(channels.status).toBe(422);
		expect(await channels.json()).toMatchObject({ errors: [{ path: 'sharing.channels' }] });
		expect(message.status).toBe(200);
		expect(await message.json()).toMatchObject({ sharing: { message: 'Hello' } });
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

	it('places one photo as the campaign’s cover, once', async () => {
		const key = await connect();
		const { id, url } = await linked(key);
		expect(url.origin).toBe(ORIGIN);

		const first = await upload(url);
		const second = await upload(url);

		expect(await first.json()).toEqual({ placed: true });
		expect(second.status).toBe(410);
		const read = (await (await call('campaign', `/campaigns/${id}`, { key })).json()) as {
			content: { hero?: { imageId: string } };
		};
		expect(read.content.hero?.imageId).toEqual(expect.any(String));
	});

	it('removes the cover when sent hero null', async () => {
		const key = await connect();
		const { id, url } = await linked(key);
		await upload(url);
		expect((await contentOf(key, id)).hero?.imageId).toEqual(expect.any(String));

		const response = await call('content', `/campaigns/${id}/content`, {
			method: 'PATCH',
			key,
			body: { hero: null }
		});

		expect(response.status).toBe(200);
		expect((await contentOf(key, id)).hero).toBeUndefined();
	});

	async function linkTo(key: string, id: string, extra: Record<string, unknown> = {}) {
		const response = await call('uploadLink', '/photos/upload-link', {
			method: 'POST',
			key,
			body: { target: { kind: 'campaign', id }, ...extra }
		});
		return {
			response,
			url: new URL(((await response.clone().json()) as { url?: string }).url ?? ORIGIN)
		};
	}

	const contentOf = async (key: string, id: string) =>
		(
			(await (await call('campaign', `/campaigns/${id}`, { key })).json()) as {
				content: { hero?: { imageId: string }; photos?: { imageId: string }[] };
			}
		).content;

	it('puts a second photo after the cover, and a slot of "cover" replaces the cover', async () => {
		const key = await connect();
		const { id, url } = await linked(key);
		await upload(url);
		const first = (await contentOf(key, id)).hero?.imageId;

		const beside = await linkTo(key, id);
		await upload(beside.url);
		const afterBeside = await contentOf(key, id);

		expect(afterBeside.hero?.imageId).toBe(first);
		expect(afterBeside.photos).toHaveLength(1);

		const cover = await linkTo(key, id, { slot: 'cover' });
		await upload(cover.url);
		const afterCover = await contentOf(key, id);

		expect(afterCover.hero?.imageId).not.toBe(first);
		expect(afterCover.photos).toHaveLength(1);
	});

	it('replaces the photo beside the cover that a numbered slot names', async () => {
		const key = await connect();
		const { id, url } = await linked(key);
		await upload(url);
		await upload((await linkTo(key, id)).url);
		const before = (await contentOf(key, id)).photos?.[0]?.imageId;

		await upload((await linkTo(key, id, { slot: '0' })).url);
		const after = await contentOf(key, id);

		expect(after.photos).toHaveLength(1);
		expect(after.photos?.[0]?.imageId).not.toBe(before);
	});

	it('adds a photo after the rest on a slot of "new", even with no cover', async () => {
		const key = await connect();
		const id = (
			(await (
				await call('campaigns', '/campaigns', { method: 'POST', key, body: { title: 'Coats' } })
			).json()) as { id: string }
		).id;

		const { response, url } = await linkTo(key, id, { slot: 'new' });
		await upload(url);
		const after = await contentOf(key, id);

		expect(response.status).toBe(201);
		expect(after.hero).toBeUndefined();
		expect(after.photos).toHaveLength(1);
	});

	it.each([
		['no slot', {}],
		['a slot of "new"', { slot: 'new' }],
		['a place past the photos', { slot: '8' }]
	])(
		'refuses a link with %s on a campaign whose cover and photos are full, and makes none',
		async (_, extra) => {
			const key = await connect();
			const { id } = await linked(key);
			await h.db.delete(photoLink);
			const [row] = await h.db.select().from(page).where(eq(page.id, id));
			const stored = (at: number) => ({
				imageId: `019fb300-0000-7000-8000-0000000001${String(at).padStart(2, '0')}`,
				alt: null
			});
			const full = {
				...JSON.parse(row?.draft ?? '{}'),
				hero: stored(99),
				photos: Array.from({ length: PHOTOS_MAX }, (_, at) => stored(at))
			};
			await h.db
				.update(page)
				.set({ draft: JSON.stringify(full) })
				.where(eq(page.id, id));

			const { response } = await linkTo(key, id, extra);

			expect(response.status).toBe(422);
			expect(((await response.json()) as { detail: string }).detail).toContain(
				`${PHOTOS_MAX} photos`
			);
			expect(await h.db.select().from(photoLink)).toEqual([]);
		}
	);

	it.each([
		['photo-1', 'slot is "cover"'],
		['block-3', 'slot is "cover"']
	])('refuses a link slot of %s, naming the slots there are', async (slot, saying) => {
		const key = await connect();
		const { id } = await linked(key);

		const { response } = await linkTo(key, id, { slot });

		expect(response.status).toBe(422);
		expect(((await response.json()) as { detail: string }).detail).toContain(saying);
		expect(await h.db.select().from(photoLink)).toHaveLength(1);
	});

	it('refuses a link for the donation page, which holds no photos', async () => {
		const key = await connect();

		const response = await call('uploadLink', '/photos/upload-link', {
			method: 'POST',
			key,
			body: { target: { kind: 'donation_page' } }
		});

		expect(response.status).toBe(422);
		expect(((await response.json()) as { detail: string }).detail).toContain('no photos');
		expect(await h.db.select().from(photoLink)).toEqual([]);
	});

	it('places a stored photo as the cover of another campaign by its id, which a made-up id cannot', async () => {
		const key = await connect();
		const { id, url } = await linked(key);
		await upload(url);
		const imageId = (await contentOf(key, id)).hero?.imageId ?? '';
		const other = (
			(await (
				await call('campaigns', '/campaigns', { method: 'POST', key, body: { title: 'Boots' } })
			).json()) as { id: string }
		).id;

		const response = await call('content', `/campaigns/${other}/content`, {
			method: 'PATCH',
			key,
			body: { hero: { imageId, alt: 'Coats on a rack' } }
		});

		expect(response.status).toBe(200);
		expect(((await response.json()) as { content: { hero: unknown } }).content.hero).toEqual({
			imageId,
			alt: 'Coats on a rack'
		});
	});

	it('names photos, not the cover, when the made-up id is among the photos', async () => {
		const key = await connect();
		const { id, url } = await linked(key);
		await upload(url);
		const hero = (await contentOf(key, id)).hero;

		const response = await call('content', `/campaigns/${id}/content`, {
			method: 'PATCH',
			key,
			body: { hero, photos: [{ imageId: '019fb300-0000-7000-8000-000000000abc', alt: null }] }
		});

		expect(response.status).toBe(422);
		expect(await response.json()).toMatchObject({ errors: [{ path: 'photos' }] });
	});

	it('is refused past its thirty minutes, and no photo lands in the draft', async () => {
		const key = await connect();
		const { id, url } = await linked(key);
		await h.db.update(photoLink).set({ expiresAt: new Date(Date.now() - 1) });

		const response = await upload(url);

		expect(response.status).toBe(410);
		const read = (await (await call('campaign', `/campaigns/${id}`, { key })).json()) as {
			content: { hero?: unknown };
		};
		expect(read.content.hero).toBeUndefined();
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
