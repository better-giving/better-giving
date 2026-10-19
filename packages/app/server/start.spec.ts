import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startServer } from './start.ts';

// the production half of the server, over a stand-in for build/server/index.js: what is under test
// is the order shutdown takes the scheduler, the deferred work and the database in, and a real
// build is a vite build no test run orders ahead of itself. the stand-in exports the two names
// ./start.ts reads from the bundle, and ../src/server/app.spec.ts holds the real entry to them.

interface CronProbe {
	readonly run: Promise<void>;
	readonly stop: () => void;
}

declare global {
	var cronProbe: CronProbe | undefined;
}

const BUNDLE = `
export function createApp() {
	return async () => new Response('stand-in');
}
export function startCron(runtime) {
	runtime.deferred.waitUntil(globalThis.cronProbe.run);
	return { stop: globalThis.cronProbe.stop };
}
`;

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'better-giving-start-'));
	mkdirSync(join(root, 'build/server'), { recursive: true });
	mkdirSync(join(root, 'build/client'));
	writeFileSync(join(root, 'build/server/index.js'), BUNDLE);
});

afterEach(() => {
	globalThis.cronProbe = undefined;
	rmSync(root, { recursive: true, force: true });
});

describe('shutdown', () => {
	it('stops the scheduler, then waits for a run in flight before closing the database', async () => {
		const order: string[] = [];
		let finish: () => void = () => {};
		const run = new Promise<void>((resolve) => {
			finish = resolve;
		}).then(() => {
			order.push('run ended');
		});
		globalThis.cronProbe = { run, stop: () => order.push('scheduler stopped') };
		const client = createClient({ url: ':memory:' });
		const close = client.close.bind(client);
		vi.spyOn(client, 'close').mockImplementation(() => {
			order.push('database closed');
			close();
		});

		const started = await startServer({
			root,
			mode: 'production',
			port: 0,
			host: '127.0.0.1',
			staticDir: join(root, 'build/client'),
			client,
			source: {}
		});
		const stopping = started.shutdown();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(order).toEqual(['scheduler stopped']);

		finish();
		await stopping;
		expect(order).toEqual(['scheduler stopped', 'run ended', 'database closed']);
	});
});
