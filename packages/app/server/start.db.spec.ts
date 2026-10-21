import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client } from '../src/lib/server/db/database.testing.ts';
import { type Started, startServer } from './start.ts';

// the server end to end: a real HTTP listener on an ephemeral port, the router loaded through vite
// the way `pnpm dev` loads it, against this spec file's migrated database file.
//
// the static directory is a temp copy rather than ../static/: the embed is built into that
// directory by `pnpm build`, which a test run does not order ahead of itself, while the rules file
// beside it is committed and copied in as it is.

const ROOT = resolve(import.meta.dirname, '..');
const EMBED = 'window.__embed = 1;\n';

let started: Started;
let staticDir: string;

beforeAll(async () => {
	staticDir = mkdtempSync(join(tmpdir(), 'better-giving-static-'));
	copyFileSync(join(ROOT, 'static/_headers'), join(staticDir, '_headers'));
	writeFileSync(join(staticDir, 'embed.js'), EMBED);

	started = await startServer({
		root: ROOT,
		mode: 'development',
		port: 0,
		host: '127.0.0.1',
		staticDir,
		client,
		source: {}
	});
	// the first request through the router is vite transforming the whole server graph, which
	// under a loaded suite outlasts a case's own timeout.
	await (await fetch(new URL('/login', started.url))).arrayBuffer();
}, 120_000);

afterAll(async () => {
	await started?.shutdown();
	rmSync(staticDir, { recursive: true, force: true });
}, 30_000);

const get = (path: string, init?: RequestInit) => fetch(new URL(path, started.url), init);

describe('the server', () => {
	it('answers /login through the router with the sign-in screen', async () => {
		const response = await get('/login');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toMatch(/^text\/html/);
		expect(await response.text()).toContain('<form');
	});

	it('serves /embed.js from the static directory with the headers _headers gives it', async () => {
		const response = await get('/embed.js');

		expect(response.status).toBe(200);
		expect(await response.text()).toBe(EMBED);
		expect(response.headers.get('cache-control')).toBe('public, max-age=300, must-revalidate');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('etag')).not.toBeNull();
	});

	it('answers a repeat read of /embed.js that names its ETag with a 304', async () => {
		const etag = (await get('/embed.js')).headers.get('etag') ?? '';

		expect((await get('/embed.js', { headers: { 'if-none-match': etag } })).status).toBe(304);
	});

	it('never serves the rules file itself', async () => {
		const response = await get('/_headers');

		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain('Cache-Control');
	});

	it('answers a method react router routes nowhere on the read API with its own 405', async () => {
		const response = await get('/integrations/v1/gifts', { method: 'PROPFIND' });

		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('GET, HEAD');
	});
});
