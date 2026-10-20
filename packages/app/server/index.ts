/**
 * the server: `pnpm start` in production, `pnpm dev` (with `--dev`) on a contributor's machine.
 *
 * reads `DATABASE_URL` (a `file:` URL naming the database file), `PORT` and `HOST` (production
 * only; 3000 and every interface by default) and `TRUSTED_PROXY_HEADER`
 * (../src/lib/server/runtime/client-ip.ts, forwarded-proto.ts), plus every name `Env` carries
 * (../src/lib/server/runtime/env.ts), and refuses to start without `REQUIRED_ENV_VARS` there.
 * migrations are not applied here: `pnpm db:migrate` runs them before the server starts
 * (AGENTS.md → Schema).
 *
 * SIGTERM and SIGINT stop the server gracefully: open requests finish, deferred work settles, the
 * database closes, and the process exits.
 */

import { resolve } from 'node:path';
import { openDatabase } from '../src/lib/server/db/open.ts';
import { missingRequiredEnv } from '../src/lib/server/runtime/env.ts';
import { startServer } from './start.ts';

/**
 * the port `pnpm dev` serves on, pinned rather than taken from `PORT` because the app spells the dev
 * address out: `trustedOrigins` in src/lib/server/auth/index.ts lists it, and better-auth refuses a
 * sign-in POST from an origin that is not in that list. a collision fails at `listen` instead of
 * moving the server to a port nothing expects. 5322 is packages/console-ui's dev server and 5323 is
 * packages/gallery's (each package's own vite.config.ts), so all three run side by side.
 */
const DEV_PORT = 5321;

const dev = process.argv.includes('--dev');
const root = resolve(import.meta.dirname, '..');

const missing = missingRequiredEnv(process.env);
if (missing.length > 0) {
	for (const line of missing) console.error(line);
	process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set — it names the database file, as a file: URL.');
	process.exit(1);
}

const client = await openDatabase(url);
const started = await startServer({
	root,
	mode: dev ? 'development' : 'production',
	port: dev ? DEV_PORT : Number(process.env.PORT ?? 3000),
	...(dev ? {} : { host: process.env.HOST ?? '0.0.0.0' }),
	staticDir: resolve(root, dev ? 'static' : 'build/client'),
	client,
	source: process.env
});
console.log(`listening on ${started.url}`);

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
	process.on(signal, () => {
		if (stopping) return;
		stopping = true;
		started.shutdown().then(
			() => process.exit(0),
			(error: unknown) => {
				console.error('shutdown failed', error);
				process.exit(1);
			}
		);
	});
}
