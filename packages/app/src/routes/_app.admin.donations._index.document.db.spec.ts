import type { Config } from '@react-router/dev/config';
import {
	createRequestHandler,
	type ServerBuild,
	UNSAFE_withComponentProps,
	UNSAFE_withErrorBoundaryProps
} from 'react-router';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import routerConfig from '../../react-router.config';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb } from '$lib/server/db/client';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { requestContext } from '../request-context';
import * as entryServer from '../entry.server';
import * as root from '../root';
import { finishSetup } from '../webhook-routes.testing';
import * as layout from './_app';
import * as donations from './_app.admin.donations._index';
import { client, run, stmt } from '$lib/server/db/database.testing';

// the gifts list as a document. the loader's json
// (./_app.admin.donations._index.db.spec.ts, through `queryRoute`) carries the instant and the
// zone and never the day, and the hydration payload repeats that instant, so a search of the
// whole document finds `2026-10-21` on a row whose visible day is empty.
//
// the build is assembled the way src/entry.server.db.spec.ts assembles one: those helpers are
// not exported, and `mountRoutes` answers json.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

/** 16:23 UTC, which is already the 22nd in Manila and still the 21st in Los Angeles. */
const CARD_AT = Date.parse('2026-10-21T16:23:00.000Z');

/** the UTC midnight `readAccountingDate` stores for a day an operator typed. */
const CHEQUE_AT = Date.parse('2026-10-22T00:00:00.000Z');

const DONOR_ID = '019fb300-0000-7000-8000-000000000041';
const CARD_ID = '019fb300-0000-7000-8000-000000000042';
const CHEQUE_ID = '019fb300-0000-7000-8000-000000000043';

type RouteModule = NonNullable<ServerBuild['routes'][string]>['module'];

interface Mounted {
	readonly id: string;
	readonly parentId?: string;
	readonly path?: string;
	readonly index?: true;
	readonly module: object;
}

function compiled(module: object): RouteModule {
	const exports = module as {
		readonly default?: Parameters<typeof UNSAFE_withComponentProps>[0];
		readonly ErrorBoundary?: Parameters<typeof UNSAFE_withErrorBoundaryProps>[0];
	};
	return {
		...module,
		...(exports.default && { default: UNSAFE_withComponentProps(exports.default) }),
		...(exports.ErrorBoundary && {
			ErrorBoundary: UNSAFE_withErrorBoundaryProps(exports.ErrorBoundary)
		})
	} as RouteModule;
}

function buildOf(mounted: readonly Mounted[]): ServerBuild {
	const { allowedActionOrigins }: Config = routerConfig;
	const routes: ServerBuild['routes'] = {};
	const clientRoutes: ServerBuild['assets']['routes'] = {};
	for (const route of mounted) {
		const module = compiled(route.module);
		const shape = {
			id: route.id,
			...(route.parentId !== undefined && { parentId: route.parentId }),
			...(route.path !== undefined && { path: route.path }),
			...(route.index && { index: true })
		};
		routes[route.id] = { ...shape, module };
		clientRoutes[route.id] = {
			...shape,
			hasAction: 'action' in module,
			hasLoader: 'loader' in module,
			hasClientAction: false,
			hasClientLoader: false,
			hasClientMiddleware: false,
			hasErrorBoundary: 'ErrorBoundary' in module,
			module: `/assets/${route.id.replace(/\W/g, '_')}.js`,
			clientActionModule: undefined,
			clientLoaderModule: undefined,
			clientMiddlewareModule: undefined,
			hydrateFallbackModule: undefined,
			imports: [],
			css: []
		};
	}
	return {
		entry: { module: entryServer },
		routes,
		assets: {
			entry: { module: '/assets/entry.client.js', imports: [] },
			routes: clientRoutes,
			url: '/assets/manifest.js',
			version: 'spec'
		},
		...(allowedActionOrigins !== undefined && { allowedActionOrigins }),
		publicPath: '/',
		assetsBuildDirectory: 'build/client',
		future: {},
		ssr: true,
		isSpaMode: false,
		prerender: [],
		routeDiscovery: { mode: 'lazy', manifestPath: '/__manifest' }
	};
}

const handle = createRequestHandler(
	buildOf([
		{ id: 'root', path: '', module: root },
		{ id: 'routes/_app', parentId: 'root', module: layout },
		{
			id: 'routes/_app.admin.donations._index',
			parentId: 'routes/_app',
			path: 'admin/donations',
			index: true,
			module: donations
		}
	]),
	'production'
);

let bindings: Env;
let session: string;

beforeAll(async () => {
	bindings = await finishSetup(PASSWORD);
	session = await signIn();
});

beforeEach(async () => {
	await run(stmt('delete from payment'));
	await run(stmt('delete from donation'));
	await run(stmt('delete from contact'));
	await run(
		stmt(
			`insert into contact (id, kind, display_name, attributes, created_at, updated_at)
		 values (?, 'individual', 'Ada Okafor', '{}', 0, 0)`,
			DONOR_ID
		)
	);
	await gift(CARD_ID, CARD_AT);
	await attempt(CARD_ID, '019fb300-0000-7000-8000-000000000044', 'card', 'stripe');
	await gift(CHEQUE_ID, CHEQUE_AT);
	await attempt(CHEQUE_ID, '019fb300-0000-7000-8000-000000000045', 'check', null);
});

async function signIn(): Promise<string> {
	const db = createDb(client);
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.cause);
	const auth = createAuth(
		db,
		{ ADMIN_PASSWORD: PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);
	const { headers } = await auth.api.signInStaff({
		body: { password: PASSWORD },
		headers: new Headers({ origin: ORIGIN }),
		returnHeaders: true
	});
	const cookies = headers.getSetCookie().map((value) => value.split(';', 1)[0]);
	expect(cookies.length).toBeGreaterThan(0);
	return cookies.join('; ');
}

async function gift(id: string, receivedAt: number) {
	await run(
		stmt(
			`insert into donation (id, contact_id, total_minor, currency, received_at, source, note,
		                       recurring_id, tribute_kind, tribute_honoree, program_id, created_at)
		 values (?, ?, 12345, 'USD', ?, 'Annual appeal', null, null, null, null, null, 0)`,
			id,
			DONOR_ID,
			receivedAt
		)
	);
}

async function attempt(donationId: string, id: string, method: string, provider: string | null) {
	await run(
		stmt(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
		                      provider, provider_txn_id, occurred_at, created_at, coin, coin_amount,
		                      parent_payment_id, provider_reference)
		 values (?, ?, 12345, 'USD', 'inbound', ?, 'succeeded', ?, ?, 0, 0, null, null, null, null)`,
			id,
			donationId,
			method,
			provider,
			provider === null ? null : `txn_${id}`
		)
	);
}

/** the gifts document, with `tz` set to `zone` or left off when `zone` is null. */
async function giftsDocument(zone: string | null): Promise<string> {
	const cookie = zone === null ? session : `${session}; tz=${encodeURIComponent(zone)}`;
	const response = await handle(
		new Request(`${ORIGIN}/admin/donations`, { headers: { cookie } }),
		requestContext({ env: bindings, deferred: createDeferredWork(), client })
	);
	const html = await response.text();
	expect(response.status, html.slice(0, 800)).toBe(200);
	expect(response.headers.get('content-type')).toMatch(/^text\/html/);
	return html;
}

/** the `<time>` in the row whose Paid with cell is `paidWith`. */
function rowTime(html: string, paidWith: 'Card' | 'Cheque'): { attrs: string; text: string } {
	const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? [];
	const row = rows.find((one) => one.includes(`>${paidWith}<`));
	expect(row, `no row paid with ${paidWith}`).toBeDefined();
	const time = /<time\b([^>]*)>([^<]*)<\/time>/.exec(row ?? '');
	expect(time, `no <time> in the ${paidWith} row`).not.toBeNull();
	return { attrs: time?.[1] ?? '', text: time?.[2] ?? '' };
}

function expectDay(html: string, paidWith: 'Card' | 'Cheque', day: string) {
	const time = rowTime(html, paidWith);
	expect(time.text).toBe(day);
	// react's `dateTime` prop is the `datetime` attribute. server render keeps the prop's case.
	expect(time.attrs.toLowerCase()).toContain(`datetime="${day}"`);
}

function expectEmptyDay(html: string, paidWith: 'Card' | 'Cheque') {
	const time = rowTime(html, paidWith);
	expect(time.text).toBe('');
	expect(time.attrs).not.toMatch(/datetime/i);
}

describe('the gifts document', () => {
	it('renders the card gift on 2026-10-22 when tz is Asia/Manila', async () => {
		expectDay(await giftsDocument('Asia/Manila'), 'Card', '2026-10-22');
	});

	it('renders the card gift’s day empty when no tz cookie is set', async () => {
		expectEmptyDay(await giftsDocument(null), 'Card');
	});

	it('renders the card gift’s day empty when tz is not a time zone', async () => {
		expectEmptyDay(await giftsDocument('Mars/Olympus'), 'Card');
	});

	it.each([['America/Los_Angeles'], [null], ['Mars/Olympus'], ['Asia/Manila']] as const)(
		'keeps the cheque on 2026-10-22 when tz is %s',
		async (zone) => {
			// Los Angeles would read that UTC midnight as 2026-10-21. the cheque stays on the day
			// the operator typed, which is what `timeZone: 'UTC'` on an in-hand row is for.
			expectDay(await giftsDocument(zone), 'Cheque', '2026-10-22');
		}
	);

	it('writes the viewer zone from the page, under the document nonce', async () => {
		const html = await giftsDocument(null);
		const head = html.slice(0, html.indexOf('</head>'));
		const charset = head.search(/<meta\s+charSet="utf-8"/i);
		// react emits the charset meta, then the viewport meta, ahead of an inline script.
		// the tag is still the first thing `Layout` writes after that meta.
		const script = /<script\b([^>]*)>([\s\S]*?document\.cookie[\s\S]*?)<\/script>/.exec(head);
		expect(charset).toBeGreaterThanOrEqual(0);
		expect(script).not.toBeNull();
		expect(script?.index ?? -1).toBeGreaterThan(charset);
		expect(script?.[1]).toMatch(/ nonce="[^"]+"/);
		const body = script?.[2] ?? '';
		expect(body).toMatch(/try\s*\{[\s\S]*\}\s*catch/);
		expect(body).toContain('encodeURIComponent');
		expect(body).toContain('tz=');
		expect(body).toContain('; Path=/; SameSite=Lax; Max-Age=31536000');
		expect(body).not.toContain('HttpOnly');
		expect(body).not.toContain('Secure');
	});
});
