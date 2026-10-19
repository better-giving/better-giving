import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Client } from '@libsql/client';
import { createRequestListener } from '@remix-run/node-fetch-server';
import sirv from 'sirv';
import type { ViteDevServer } from 'vite';
import { readEnv } from '../src/lib/server/runtime/env.ts';
import { createDeferredWork } from '../src/lib/server/runtime/deferred.ts';
import {
	createRateLimiters,
	RATE_LIMITS,
	type RateLimit,
	type RateLimiterName
} from '../src/lib/server/runtime/rate-limiter.ts';
import type { App } from '../src/server/app.ts';
import { type HeaderRule, headersFor, parseHeaders } from './static-headers.ts';

// the HTTP server: static files first, then the router (../src/server/app.ts).
//
// in production the router is the built bundle at build/server/index.js and the static files are
// build/client/. in development the router is loaded through vite on every request, so an edit is
// the next request's code, and vite's own middleware serves the modules the browser asks for.

export interface StartOptions {
	/** this package's directory. */
	readonly root: string;
	readonly mode: 'development' | 'production';
	readonly port: number;
	readonly host?: string;
	/** the directory static files are served from, `_headers` at its root. */
	readonly staticDir: string;
	/** the database client, opened by the caller and closed by `shutdown`. */
	readonly client: Client;
	/** where `Env` is read from: `process.env`. */
	readonly source: Readonly<Record<string, string | undefined>>;
	/** the limiters' sizes: `RATE_LIMITS` unless a spec wants small buckets. */
	readonly rateLimits?: Readonly<Record<RateLimiterName, RateLimit>>;
}

export interface Started {
	/** the address the server listens on, e.g. `http://127.0.0.1:5321`. */
	readonly url: string;
	/**
	 * stops taking connections, lets every open request finish, waits for every piece of work
	 * handed to `waitUntil`, then closes the database client.
	 */
	shutdown(): Promise<void>;
}

/** where the header rules sit in the static directory. */
const RULES_PATH = '/_headers';

/** the methods a static file answers. anything else goes to the router. */
const STATIC_METHODS = new Set(['GET', 'HEAD']);

/**
 * the default a static file gets where `_headers` names no `cache-control`: kept, but revalidated
 * against its ETag on every use.
 */
const DEFAULT_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

export async function startServer(options: StartOptions): Promise<Started> {
	const { root, mode, client, source } = options;
	const deferred = createDeferredWork();
	const runtime = {
		env: readEnv(source, createRateLimiters(options.rateLimits ?? RATE_LIMITS)),
		deferred,
		client
	};
	const trustedProxyHeader = source.TRUSTED_PROXY_HEADER;

	const server = createServer();
	let vite: ViteDevServer | undefined;
	let app: () => Promise<App>;

	if (mode === 'development') {
		const { createServer: createViteServer } = await import('vite');
		const dev = await createViteServer({
			root,
			appType: 'custom',
			server: { middlewareMode: true, hmr: { server } }
		});
		vite = dev;
		app = async () => {
			const loaded = (await dev.ssrLoadModule(
				'/src/server/app.ts'
			)) as typeof import('../src/server/app.ts');
			return loaded.createApp(runtime, trustedProxyHeader);
		};
	} else {
		const built = (await import(
			pathToFileURL(join(root, 'build/server/index.js')).href
		)) as typeof import('../src/server/app.ts');
		const once = built.createApp(runtime, trustedProxyHeader);
		app = async () => once;
	}

	const routed = createRequestListener(async (request, peer) =>
		(await app())(request, peer.address || null)
	);
	const serveStatic = staticFiles(options.staticDir);

	server.on('request', (req: IncomingMessage, res: ServerResponse) => {
		const toRouter = () => {
			void routed(req, res);
		};
		// the rules file is read by the server and served by nobody, vite's public-directory
		// middleware included.
		if (pathnameOf(req) === RULES_PATH) return toRouter();
		const next = vite === undefined ? toRouter : () => vite?.middlewares(req, res, toRouter);
		serveStatic(req, res, next);
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(options.port, options.host, () => {
			server.off('error', reject);
			resolve();
		});
	});
	const { address, port } = server.address() as AddressInfo;
	const host = address.includes(':') ? `[${address}]` : address;

	return {
		url: `http://${host}:${port}`,
		async shutdown() {
			const closed = new Promise<void>((resolve) => server.close(() => resolve()));
			server.closeIdleConnections();
			await closed;
			await vite?.close();
			await deferred.settled();
			client.close();
		}
	};
}

/**
 * `dir`'s files, each with the headers `dir/_headers` gives its path. the file list is read once,
 * when the server starts.
 */
function staticFiles(
	dir: string
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
	const rulesFile = join(dir, RULES_PATH);
	const rules: HeaderRule[] = existsSync(rulesFile)
		? parseHeaders(readFileSync(rulesFile, 'utf8'))
		: [];
	const serve = sirv(dir, {
		etag: true,
		setHeaders(res, pathname) {
			res.setHeader('cache-control', DEFAULT_CACHE_CONTROL);
			for (const [name, value] of headersFor(rules, pathname)) res.setHeader(name, value);
		}
	});

	return (req, res, next) => {
		if (!STATIC_METHODS.has(req.method ?? '')) return next();
		serve(req, res, next);
	};
}

function pathnameOf(req: IncomingMessage): string {
	return new URL(req.url ?? '/', 'http://localhost').pathname;
}
