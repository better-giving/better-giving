import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createDb, openDatabase } from '../db/client';
import { MIGRATIONS } from '../db/database.testing';
import { applyMigrations } from '../db/migrate';
import { saveProfile } from '../org/profile.testing';
import { setupWebhook } from './webhook-setup';

// `pnpm setup-webhook:chariot` as the script runs it: no onboarding handed in, so the profile is read
// from the database `DATABASE_URL` names and the directory is Chariot's own, over `fetch`. the
// script opens the database by its address, so this spec file's is one of its own at a `file:` URL
// rather than ../db/database.testing.ts's handle.

const dir = mkdtempSync(join(tmpdir(), 'better-giving-setup-webhook-'));
const DATABASE_URL = pathToFileURL(join(dir, 'deployment.db')).href;
const seeded = await openDatabase(DATABASE_URL);
await applyMigrations(seeded, MIGRATIONS);

afterAll(() => {
	seeded.close();
	rmSync(dir, { recursive: true, force: true });
});

const ORIGIN = 'https://give.example.org';

/**
 * Chariot as the run meets it, answering by method and path and recording each request, and the
 * body of each Create Connect. a request nothing here answers is an error, so a call the run was
 * not expected to make fails by its name.
 */
function chariot() {
	const requests: string[] = [];
	const connected: unknown[] = [];
	vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		const { origin, pathname, search } = new URL(request.url);
		requests.push(`${request.method} ${origin}${pathname}${search}`);
		switch (`${request.method} ${pathname}`) {
			case 'GET /v1/organizations/search':
				return Response.json({
					results: [
						{
							id: 'org_01jpjenf5q6cawy43yxfcrxhct',
							ein: '987654321',
							name: 'Hope Foundation',
							daf_eligible: true
						}
					]
				});
			case 'POST /v1/connects':
				connected.push(await request.json());
				return Response.json({ id: 'live_connect-1', active: true }, { status: 201 });
			case 'GET /v1/event_subscriptions':
				return Response.json({ results: [] });
			case 'POST /v1/event_subscriptions': {
				const { url, category } = (await request.json()) as { url: string; category: string };
				return Response.json({ id: 'sub-new', url, category, status: 'active' }, { status: 201 });
			}
			default:
				throw new Error(`unscripted request: ${request.method} ${request.url}`);
		}
	});
	return { requests, connected };
}

describe('setupWebhook for Chariot, as the script runs it', () => {
	it('connects the organisation by the EIN the database holds, at Chariot’s live address', async () => {
		await saveProfile(createDb(seeded), {
			tax_id: '98-7654321',
			notification_email: 'ops@hope.example'
		});
		const { requests, connected } = chariot();

		const result = await setupWebhook(['chariot'], {
			CHARIOT_API_KEY: 'notarealchariotkey',
			BETTER_AUTH_URL: ORIGIN,
			DATABASE_URL
		});

		expect(result).toEqual({
			ok: true,
			lines: [
				'CHARIOT_CONNECT_ID=live_connect-1',
				expect.stringMatching(/^CHARIOT_WEBHOOK_SECRET=[0-9a-f]{64}$/)
			],
			notices: []
		});
		expect(requests).toEqual([
			'GET https://api.givechariot.com/v1/organizations/search?q=987654321',
			'POST https://api.givechariot.com/v1/connects',
			'GET https://api.givechariot.com/v1/event_subscriptions?limit=100',
			'GET https://api.givechariot.com/v1/event_subscriptions?limit=100',
			'POST https://api.givechariot.com/v1/event_subscriptions'
		]);
		expect(connected).toEqual([
			{ organization_id: 'org_01jpjenf5q6cawy43yxfcrxhct', contact: { email: 'ops@hope.example' } }
		]);
	});
});
