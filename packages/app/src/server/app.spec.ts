import { createClient } from '@libsql/client';
import { MIN_ADMIN_PASSWORD_LENGTH } from '@better-giving/operator/admin-password';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COOKIE_SCHEME_HEADER, cookiesSecure } from '$lib/server/runtime/cookie-scheme';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { createApp, startCron, startRefusal } from './app';

// this module is the server bundle's entry (../../vite.config.ts), so what it exports is what
// ../../server/start.ts can reach in build/server/index.js.

const cron = vi.hoisted(() => ({ minute: vi.fn(async () => {}) }));

/** the request each call of the app handed the router, which answers nothing of its own. */
const routed = vi.hoisted(() => [] as Request[]);

vi.mock(import('react-router'), async (actual) => ({
	...(await actual()),
	createRequestHandler: () => async (request: Request) => {
		routed.push(request);
		return new Response(null, { status: 204 });
	}
}));

vi.mock(import('../cron-runs'), () => ({
	CRON_RUNS: { '* * * * *': cron.minute },
	allRun: vi.fn()
}));

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-19T11:59:30.000Z'));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the scheduled runs the bundle starts', () => {
	it('fire the cron table with the env, a database handle and the minute', async () => {
		const env = { BETTER_AUTH_URL: 'https://donate.example.org' } as unknown as Env;
		const deferred = createDeferredWork(vi.fn());
		const client = createClient({ url: ':memory:' });
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const scheduler = startCron({ env, deferred, client });
		await vi.advanceTimersByTimeAsync(60_000);
		await deferred.settled();
		scheduler.stop();
		client.close();

		expect(cron.minute).toHaveBeenCalledExactlyOnceWith(
			env,
			expect.objectContaining({ batch: expect.any(Function) }),
			new Date('2026-10-19T12:00:00.000Z')
		);
	});
});

describe('what the bundle refuses to start on', () => {
	it('refuses a set password sign-in would refuse, in sign-in’s words and never the value', () => {
		const short = 'p'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 1);
		const env = { ADMIN_PASSWORD: short } as unknown as Env;

		const refusal = startRefusal(env);

		expect(refusal).toContain(`at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`);
		expect(refusal).toContain('ADMIN_PASSWORD');
		expect(refusal).not.toContain(short);
	});

	it('refuses nothing where the password is one sign-in takes', () => {
		const env = { ADMIN_PASSWORD: 'correct-horse-battery' } as unknown as Env;

		expect(startRefusal(env)).toBeNull();
	});
});

describe('the scheme a cookie is written for', () => {
	/** the app over `env`, asked once at `url` with `headers`: the request the router was handed. */
	async function route(
		env: Record<string, string>,
		url: string,
		headers: Record<string, string> = {}
	) {
		routed.length = 0;
		const client = createClient({ url: ':memory:' });
		const app = createApp(
			{ env: env as unknown as Env, deferred: createDeferredWork(vi.fn()), client },
			undefined
		);
		await app(new Request(url, { headers }), '192.0.2.1');
		client.close();
		const [request] = routed;
		if (!request) throw new Error('the app routed nothing');
		return request;
	}

	it('is the https pin’s, for a request that arrived as plain http', async () => {
		const request = await route(
			{ BETTER_AUTH_URL: 'https://donate.example.org' },
			'http://donate.example.org/fundraise/open'
		);
		expect(cookiesSecure(request)).toBe(true);
	});

	it('is the request’s where nothing is pinned, whatever the caller claimed', async () => {
		const request = await route({}, 'http://donate.example.org/fundraise/open', {
			[COOKIE_SCHEME_HEADER]: 'https:'
		});
		expect(cookiesSecure(request)).toBe(false);
	});
});
