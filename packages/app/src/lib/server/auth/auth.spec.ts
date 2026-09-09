import { describe, expect, it } from 'vitest';
import { getIp } from 'better-auth/api';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Db } from '$lib/server/db/client';
import * as schema from '$lib/server/db/schema';
import {
	authAccount,
	authMemberInvitation,
	authSession,
	authSigningKey,
	authUser,
	authVerification
} from '$lib/server/db/auth-schema';
import { createAuth, MEMBER_PASSWORD_MIN_LENGTH, PASSWORD_RESET_LIFETIME_SECONDS } from './index';

/**
 * these tests exist for the same reason `db/accounts.workers.spec.ts` does: two independent
 * descriptions of the same thing are drifting apart the moment nobody checks. here the
 * two are better-auth's own declaration of the schema and endpoints it needs, read off
 * a live instance, and what this repo actually provides.
 *
 * a better-auth upgrade that adds a column to `user`, renames `/get-session`, or starts
 * requiring a table this deployment does not have fails here, at `pnpm test`, instead of
 * in a nonprofit's production.
 */

/**
 * one operator-facing variable. `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are both
 * optional overrides now — the signing key is a D1 row (./signing-key.ts) and the origin
 * comes from the request — so the deployed shape of this env is one entry long.
 */
const TEST_ENV = { ADMIN_PASSWORD: 'correct-horse-battery' } as const;

/** stands in for the `auth_signing_key` row. 64 hex chars, as the migration mints. */
const TEST_SECRET = 'ab'.repeat(32);

const DEV_ORIGIN = 'http://localhost:5321';
const DEPLOYED_ORIGIN = 'https://donate.example.org';

/** `{} as Db` is enough: resolving the context does no I/O. */
function testAuth(
	env: Parameters<typeof createAuth>[1] = TEST_ENV,
	requestOrigin: string = DEV_ORIGIN
) {
	return createAuth({} as Db, env, { secret: TEST_SECRET, requestOrigin });
}

/** the drizzle tables backing the better-auth models this deployment keeps. */
const KEPT_MODELS = {
	user: authUser,
	session: authSession,
	account: authAccount,
	verification: authVerification
} as const;

/**
 * the two tables in the `auth_` namespace this app owns rather than better-auth
 * (`db/auth-schema.ts`). the prefix rule there promises that a future better-auth table cannot
 * land on one of them, and these are the names that promise is about.
 */
const OURS_IN_THE_AUTH_NAMESPACE = { authSigningKey, authMemberInvitation } as const;

/** every SQL table name reachable from the schema entry point, auth and domain alike. */
function schemaTableNames(): Set<string> {
	const names = new Set<string>();
	for (const value of Object.values(schema as unknown as Record<string, unknown>)) {
		if (is(value, SQLiteTable)) names.add(getTableName(value));
	}
	return names;
}

describe('createAuth configuration', () => {
	// the signing key is resolved before this point, by ./signing-key.ts, which is what
	// produces the operator-facing message. this guard only catches a caller that ignored
	// it — better-auth silently substitutes a built-in default secret for a falsy one.
	it('refuses an empty signing key, pointing at the resolver', () => {
		expect(() =>
			createAuth({} as Db, TEST_ENV, { secret: '  ', requestOrigin: DEV_ORIGIN })
		).toThrow(/empty signing key.*resolveAuthSecret/s);
	});

	// a misconfigured staff credential must not stop the app from starting — the donation
	// form has to keep working. it is `/sign-in/staff` that refuses. see credential.spec.ts.
	it('still builds when the staff credential is unset', () => {
		expect(() => testAuth({})).not.toThrow();
	});

	it('leaves baseURL unset so the origin is derived per request', async () => {
		const ctx = await testAuth().$context;
		expect(ctx.options.baseURL).toBe('');
	});

	it('pins baseURL when BETTER_AUTH_URL is set', async () => {
		const ctx = await testAuth({ ...TEST_ENV, BETTER_AUTH_URL: DEPLOYED_ORIGIN }).$context;
		expect(ctx.options.baseURL).toBe(DEPLOYED_ORIGIN);
	});

	it('trusts the loopback dev origins only when the request origin is itself loopback', async () => {
		const dev = await testAuth().$context;
		expect(dev.options.trustedOrigins).toEqual(['http://localhost:5321', 'http://localhost:8787']);

		// a deployed origin trusts exactly the origin it was reached on, which better-auth
		// adds itself per request — no localhost entry a page on a developer's machine
		// could POST from.
		const deployed = await testAuth(TEST_ENV, DEPLOYED_ORIGIN).$context;
		expect(deployed.options.trustedOrigins).toEqual([]);
	});

	it('lets a BETTER_AUTH_URL pin decide the trusted origins, not the request', async () => {
		// pinned to a deployed origin, a request arriving on loopback must not widen the list.
		const pinned = await testAuth({ ...TEST_ENV, BETTER_AUTH_URL: DEPLOYED_ORIGIN }, DEV_ORIGIN)
			.$context;
		expect(pinned.options.trustedOrigins).toEqual([]);
	});

	/**
	 * the guard on a deployment running with no `BETTER_AUTH_URL` pin.
	 *
	 * better-auth derives both the `Secure` attribute and the `__Secure-` cookie name
	 * prefix from one value, and with no `baseURL` string to read a scheme off it falls
	 * back to `NODE_ENV === 'production'` — which nothing sets in a deployed Worker. so
	 * `advanced.useSecureCookies` is stated explicitly, and this is what proves it took.
	 */
	it('secures the session cookie off the request scheme, not NODE_ENV', async () => {
		const deployed = await testAuth(TEST_ENV, DEPLOYED_ORIGIN).$context;
		expect(deployed.authCookies.sessionToken.attributes.secure).toBe(true);
		expect(deployed.authCookies.sessionToken.name).toMatch(/^__Secure-/);

		// http://localhost is the one case where it must be off: a browser refuses a
		// `__Secure-` cookie over plain http, so dev sign-in would silently never stick.
		const dev = await testAuth().$context;
		expect(dev.authCookies.sessionToken.attributes.secure).toBe(false);
		expect(dev.authCookies.sessionToken.name).not.toMatch(/^__Secure-/);
	});

	it('keeps the cookie httpOnly and lax on both', async () => {
		for (const origin of [DEV_ORIGIN, DEPLOYED_ORIGIN]) {
			const ctx = await testAuth(TEST_ENV, origin).$context;
			expect(ctx.authCookies.sessionToken.attributes.httpOnly).toBe(true);
			expect(ctx.authCookies.sessionToken.attributes.sameSite).toBe('lax');
		}
	});

	it('does not phone home', async () => {
		const ctx = await testAuth().$context;
		expect(ctx.options.telemetry?.enabled).toBe(false);
	});
});

/**
 * what these assert, and why it is not a log-only concern.
 *
 * better-auth's limiter keys its bucket on `createRateLimitKey(getIp(req, options) ??
 * 'no-trusted-ip', path)` (`better-auth/dist/api/rate-limiter/index.mjs`). when `getIp`
 * returns null every caller collapses into the single `no-trusted-ip|<path>` bucket — so
 * one attacker exhausts the budget for everyone, which on this deployment means locking
 * every operator out of the only login. that is a denial of service, not a warning.
 *
 * `getIp` is the exact function the limiter calls, so these run it against the real
 * options this factory produces rather than restating the config.
 *
 * note on the fallback: `getIp` returns `127.0.0.1` instead of null when
 * `NODE_ENV === 'test'`, so "did it resolve" cannot be asserted here as a null check.
 * what is asserted instead is the property that actually matters and that the fallback
 * cannot fake — two clients get two different keys. under the default header both
 * collapse to the same value, which is what makes these fail without the fix.
 */
describe('client IP resolution', () => {
	/** run the limiter's own resolver against the options this factory builds. */
	async function resolveIp(headers: Record<string, string>): Promise<string | null> {
		const ctx = await testAuth(TEST_ENV, DEPLOYED_ORIGIN).$context;
		return getIp(new Headers(headers), ctx.options);
	}

	// `cf-connecting-ip` is set by Cloudflare on every request that reaches a Worker and
	// is overwritten at the edge, so unlike `x-forwarded-for` it is single-valued and not
	// caller-supplied. it is named here rather than left to the default because the
	// default is `x-forwarded-for`, which Cloudflare appends to.
	it('reads the client IP from the header Cloudflare controls', async () => {
		const ctx = await testAuth().$context;
		expect(ctx.options.advanced?.ipAddress?.ipAddressHeaders).toEqual(['cf-connecting-ip']);
	});

	it('gives two clients two buckets instead of one shared one', async () => {
		const a = await resolveIp({ 'cf-connecting-ip': '203.0.113.7' });
		const b = await resolveIp({ 'cf-connecting-ip': '198.51.100.9' });

		expect(a).toBe('203.0.113.7');
		expect(b).toBe('198.51.100.9');
		expect(a).not.toBe(b);
	});

	/**
	 * the DoS, precisely. on the default `x-forwarded-for`, better-auth refuses a
	 * comma-separated chain outright unless `trustedProxies` is configured — and
	 * Cloudflare appends the real client IP to whatever the caller already sent. so a
	 * caller who sends any `x-forwarded-for` at all makes the header a two-token chain,
	 * `getIp` returns null, and every client on the deployment lands in one bucket. reading
	 * `cf-connecting-ip` first makes that unreachable: the value is not the caller's to set.
	 */
	it('cannot be pushed into the shared bucket by a caller-supplied forwarded chain', async () => {
		const spoofed = await resolveIp({
			'cf-connecting-ip': '203.0.113.7',
			'x-forwarded-for': '198.51.100.9, 203.0.113.7'
		});
		expect(spoofed).toBe('203.0.113.7');
	});

	/**
	 * the property, end to end, through better-auth's own router.
	 *
	 * the two tests above prove the resolver reads the right header. this one proves what
	 * that buys inside the router: one caller exhausting the `/sign-in/staff` budget must not
	 * lock out anybody else. without the `ipAddressHeaders` setting the last assertion here
	 * returns 429 — one caller spending every other caller's budget.
	 *
	 * no route mounts that router (./index.ts), so this is a claim about the instance and not
	 * about a surface this deployment answers. it is here because the setting it holds is
	 * still on the instance: `auth.handler` is called directly below, the only place in this
	 * repository that calls it at all.
	 *
	 * `{} as Db` is still enough: a wrong password is refused by ./credential.ts before
	 * the staff-row upsert, so nothing reaches the database. the rate limiter runs ahead
	 * of the endpoint either way.
	 */
	it('does not let one caller spend everybody else’s sign-in budget', async () => {
		const auth = testAuth(TEST_ENV, DEPLOYED_ORIGIN);

		const attempt = (ip: string) =>
			auth.handler(
				// better-auth's default `basePath` plus the staff plugin's own path. written out
				// rather than composed, because this app states neither: the base path was a
				// constant only the mounted surface justified, and it went with it.
				new Request(`${DEPLOYED_ORIGIN}/api/auth/sign-in/staff`, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						origin: DEPLOYED_ORIGIN,
						'cf-connecting-ip': ip,
						// what Cloudflare actually forwards once a caller sends an
						// `x-forwarded-for` of their own: it appends rather than replacing. on the
						// default header this two-token chain is what collapsed every caller into
						// one bucket.
						'x-forwarded-for': `198.51.100.1, ${ip}`
					},
					body: JSON.stringify({ password: 'not-the-admin-password' })
				})
			);

		const attacker = '203.0.113.7';
		const statuses: number[] = [];
		// the plugin's rule is 5 per 60s (./staff-plugin.ts), so the 6th is refused.
		for (let i = 0; i < 6; i++) statuses.push((await attempt(attacker)).status);

		expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
		expect(statuses[5]).toBe(429);

		// the operator, on a different address, is unaffected.
		expect((await attempt('198.51.100.99')).status).toBe(401);
	});
});

describe('model naming', () => {
	it('prefixes every better-auth model, including the ones with no table', async () => {
		const ctx = await testAuth().$context;
		expect(
			Object.fromEntries(Object.entries(ctx.tables).map(([k, t]) => [k, t.modelName]))
		).toEqual({
			user: 'authUser',
			session: 'authSession',
			account: 'authAccount',
			verification: 'authVerification'
		});
	});

	/**
	 * the collision this repo actually has. `account` is the accounting chart of accounts
	 * — 10 seeded rows, the substrate every ledger entry posts against. if any better-auth
	 * model resolved to the name `account`, the drizzle adapter would find that table in a
	 * wide schema map and start writing OAuth tokens into it.
	 */
	it('leaves no better-auth model resolving to a domain table name', async () => {
		const ctx = await testAuth().$context;
		const domainTableNames = new Set(
			[...schemaTableNames()].filter((name) => !name.startsWith('auth_'))
		);
		expect(domainTableNames).toContain('account');

		for (const [model, table] of Object.entries(ctx.tables)) {
			expect(domainTableNames.has(table.modelName), `${model} -> ${table.modelName}`).toBe(false);
		}
	});

	it('names every table it owns with the auth_ prefix', () => {
		for (const table of Object.values(KEPT_MODELS)) {
			expect(getTableName(table)).toMatch(/^auth_/);
		}
	});

	/**
	 * the other half of the prefix rule in `db/auth-schema.ts`: two tables sit in the `auth_`
	 * namespace that better-auth does not own, and a version that started declaring a model
	 * resolving to either would write into one of them.
	 *
	 * `auth_member_invitation` is the one this exists for. better-auth's organization plugin has a
	 * table called `invitation`, which under the prefix rule is `auth_invitation` — near enough
	 * that the naming was chosen around it, and near enough to be worth a failing test rather than
	 * a sentence.
	 */
	it('leaves no better-auth model resolving to a table this app owns', async () => {
		const ctx = await testAuth().$context;
		const ours = new Set(Object.keys(OURS_IN_THE_AUTH_NAMESPACE));
		for (const [model, table] of Object.entries(ctx.tables)) {
			expect(ours.has(table.modelName), `${model} -> ${table.modelName}`).toBe(false);
		}
	});
});

/**
 * the members' way in, as a set of knobs rather than as prose.
 *
 * every one of these is a security decision argued in ./index.ts, and every one of them is a line
 * somebody can delete without anything else failing. `enabled` in particular: the endpoints it
 * registers are unreachable because no route mounts the router, and it is the invitation in
 * ./invitations.ts that decides who may reach `signUpEmail` — so nothing about the shape of this
 * app reports it if the configuration underneath drifts.
 */
describe('email and password', () => {
	it('is enabled, so a member can be created and can sign in', async () => {
		const ctx = await testAuth().$context;
		expect(ctx.options.emailAndPassword?.enabled).toBe(true);
	});

	// the accept press lands a colleague signed in. off, better-auth returns a null token and the
	// redeem would have no cookies to set.
	it('signs a colleague in as they accept', async () => {
		const ctx = await testAuth().$context;
		expect(ctx.options.emailAndPassword?.autoSignIn).not.toBe(false);
	});

	/**
	 * the invitation link is the proof of the address, so a confirmation click afterwards would
	 * prove the same thing twice. `auth_verification` exists for the mailed reset and is not what
	 * decides this.
	 */
	it('does not require a separate email verification', async () => {
		const ctx = await testAuth().$context;
		expect(ctx.options.emailAndPassword?.requireEmailVerification).toBeFalsy();
		// `in` rather than a read: the options object is typed as the literal this factory
		// builds, so a key that is not there is not a property TypeScript will let a spec name.
		expect('emailVerification' in ctx.options).toBe(false);
	});

	/**
	 * the mailed reset exists on the one instance the route requesting it builds and on no other,
	 * which is the whole of what the optional `passwordReset` runtime buys. without it
	 * `sendResetPassword` is absent and better-auth refuses `/request-password-reset` with
	 * `RESET_PASSWORD_DISABLED` — so a route that forgot to wire a mailer cannot mint a token that
	 * nothing would ever send.
	 */
	it('can only send a reset link on an instance the route gave a way to send', async () => {
		const sendless = await testAuth().$context;
		expect('sendResetPassword' in (sendless.options.emailAndPassword ?? {})).toBe(false);
		expect(sendless.options.advanced?.backgroundTasks).toBeUndefined();

		const sending = await createAuth({} as Db, TEST_ENV, {
			secret: TEST_SECRET,
			requestOrigin: DEV_ORIGIN,
			passwordReset: { send: async () => {}, background: () => {} }
		}).$context;
		expect(typeof sending.options.emailAndPassword?.sendResetPassword).toBe('function');
		// the send is deferred rather than awaited, which is what makes the two arms of a request
		// take the same time. see ./index.ts.
		expect(typeof sending.options.advanced?.backgroundTasks?.handler).toBe('function');
	});

	/**
	 * two knobs the reset is wrong without. every session ending is off by default, and it is what
	 * makes a reset a recovery rather than a second key; the hour is a promise the mail makes in
	 * words (`packages/emails/src/templates/password-reset.tsx`), stated rather than inherited.
	 */
	it('ends every session on a reset and holds the link to an hour', async () => {
		const ctx = await testAuth().$context;
		expect(ctx.options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true);
		expect(ctx.options.emailAndPassword?.resetPasswordTokenExpiresIn).toBe(
			PASSWORD_RESET_LIFETIME_SECONDS
		);
	});

	// the deployer's minimum, not better-auth's 8 — a member reaches the same screens.
	it('holds a member to the deployer’s password minimum', async () => {
		const ctx = await testAuth().$context;
		expect(ctx.password.config.minPasswordLength).toBe(MEMBER_PASSWORD_MIN_LENGTH);
		expect(MEMBER_PASSWORD_MIN_LENGTH).toBeGreaterThan(8);
	});
});

/**
 * the table better-auth declares for `model`, or a failure naming the model.
 *
 * `ctx.tables` is keyed by better-auth's own model names, so a miss means the installed
 * version renamed or dropped a model that `KEPT_MODELS` still lists — a real upgrade
 * signal. without `noUncheckedIndexedAccess` the read is non-optional and the miss surfaces
 * as `Cannot read properties of undefined (reading 'fields')` instead.
 */
function mustDeclare<T extends Record<string, unknown>>(tables: T, model: string): T[keyof T] {
	const declared = tables[model as keyof T];
	if (!declared) {
		throw new Error(
			`better-auth declares no '${model}' table. KEPT_MODELS lists it — the installed better-auth renamed or removed the model, so update KEPT_MODELS and the drizzle schema together.`
		);
	}
	return declared;
}

describe('schema coverage', () => {
	/**
	 * the drizzle adapter indexes the table object by better-auth's field key (after any
	 * `fields` override), so this asserts on TS property names, not SQL column names.
	 */
	it.each(Object.entries(KEPT_MODELS))(
		'provides every column better-auth declares on %s',
		async (model, table) => {
			const ctx = await testAuth().$context;
			const declared = mustDeclare(ctx.tables, model);
			const columns = getTableColumns(table as never) as Record<
				string,
				{ notNull: boolean; hasDefault: boolean }
			>;

			// better-auth never lists `id` among the fields; it is always the primary key.
			expect(columns.id).toBeDefined();

			for (const [field, attributes] of Object.entries(declared.fields)) {
				const key = attributes.fieldName ?? field;
				const column = columns[key];
				expect(column, `${model}.${key} is missing from the drizzle table`).toBeDefined();
				if (!column) continue;

				if (attributes.required) {
					// a nullable column for a required field turns a better-auth bug into silent
					// bad data instead of a write that fails.
					expect(column.notNull, `${model}.${key} should be NOT NULL`).toBe(true);
				} else {
					// an optional field written into a NOT NULL column with no default is an
					// insert that fails at runtime.
					expect(
						column.notNull === false || column.hasDefault,
						`${model}.${key} is optional but NOT NULL without a default`
					).toBe(true);
				}
			}
		}
	);

	it('carries no columns better-auth does not know about', async () => {
		const ctx = await testAuth().$context;
		for (const [model, table] of Object.entries(KEPT_MODELS)) {
			const declared = mustDeclare(ctx.tables, model);
			const expected = new Set([
				'id',
				...Object.entries(declared.fields).map(([field, attr]) => attr.fieldName ?? field)
			]);
			for (const key of Object.keys(getTableColumns(table as never))) {
				expect(expected.has(key), `${model}.${key} is not part of better-auth's schema`).toBe(true);
			}
		}
	});
});
