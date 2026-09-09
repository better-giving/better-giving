import { ADMIN_USERNAME } from '@better-giving/operator/admin-password';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import * as z from 'zod';
import type { Db } from '$lib/server/db/client';
import { authUser, type AuthUser } from '$lib/server/db/auth-schema';
import type { AuthEnv } from './env';
import { readStaffCredential, staffCredentialMatches } from './credential';

/** the path `/sign-in/staff` sits at, relative to better-auth's `basePath`. */
export const STAFF_SIGN_IN_PATH = '/sign-in/staff';

/**
 * the one `auth_user` row, at a fixed id in every deployment.
 *
 * a uuidv7 constant rather than a lookup, for the same reason `POSTING_ACCOUNTS` in
 * `src/lib/server/db/accounts.ts` hardcodes its ids: the value is byte-identical in
 * every fork by decision, so a query to discover it buys nothing.
 *
 * it also fixes what would otherwise be a real hole. keyed on the identifier instead,
 * changing that identifier would mint a *second* user row and leave the old identity's
 * sessions valid, because they point at the old row. keyed on this constant, there is
 * exactly one staff row for the lifetime of the deployment.
 */
export const STAFF_USER_ID = '019fb1c4-3a51-7c9e-9f2a-6f0b7e5d84c1';

/**
 * what goes in better-auth's `email` field for the one staff row.
 *
 * a constant, not a deploy variable — that is the whole point (see the note at the top
 * of ./credential.ts). it is a username, not an address: nothing in this app mails it,
 * and nothing ever will — `requestPasswordReset` in ./members.ts refuses it by name
 * before the auth layer is asked, for reasons that have nothing to do with whether this
 * deployment can send mail.
 *
 * the value is `ADMIN_USERNAME` from `@better-giving/operator/admin-password`, which is
 * also what the deployer types into the sign-in box and what the console prints beside the
 * password box that sets the credential — one export behind all three. the two names are
 * one value with two readings: this one is the staff row's identifier, and that one is the
 * word somebody types.
 *
 * better-auth is fine with a non-address here, verified against 1.6.25 rather than
 * assumed. its `user.email` field is declared `{ type: "string", unique: true,
 * required: true }` with no validator (`@better-auth/core/dist/db/get-tables.mjs`), the
 * only email handling in the adapter is `toLowerCase()` on paths this plugin bypasses,
 * `/get-session` never reads the field, and `auth_user.email` is `text NOT NULL` with a
 * unique index and no check. the zod `.email()` validation lives only in the bodies of
 * `/sign-up/email` and `/sign-in/email`, which no route in this app serves — see the
 * note at the top of ./index.ts.
 */
export const STAFF_USER_EMAIL = ADMIN_USERNAME;

/** display name for the staff row. separate from the identifier: it reaches a screen. */
const STAFF_USER_NAME = 'Staff';

const signInStaffBody = z.object({
	password: z
		.string()
		.min(1)
		.meta({ description: 'The staff password — must equal the deployment’s ADMIN_PASSWORD' })
});

/**
 * `auth.api.signInStaff` — the deployer's way into this app. a member's is `signInMember` in
 * ./members.ts, and both are server-side calls from the login's own action.
 *
 * it replaces better-auth's `/sign-in/email` rather than configuring it, because
 * `/sign-in/email` verifies against a `password` column on an `account` row, and this
 * design never writes one. see ./credential.ts for why there is no hash to verify
 * against, and why the body carries a password and nothing else, and ./index.ts for
 * what that means for the schema.
 *
 * it is called server-side and only server-side: `auth.api.signInStaff({ body, headers })`
 * from the login's own action. there is no client counterpart and no HTTP surface either —
 * `STAFF_SIGN_IN_PATH` above is the path better-auth registers this endpoint at inside a
 * router no route in this app mounts (see the note at the top of ./index.ts).
 */
export function staffCredentialPlugin(deps: { readonly db: Db; readonly env: AuthEnv }) {
	const { db, env } = deps;

	return {
		id: 'staff-credential',
		endpoints: {
			signInStaff: createAuthEndpoint(
				STAFF_SIGN_IN_PATH,
				{
					method: 'POST',
					body: signInStaffBody,
					metadata: {
						openapi: {
							operationId: 'signInStaff',
							description:
								'Sign in the single staff account by comparing against the ADMIN_PASSWORD deploy-time secret'
						}
					}
				},
				async (ctx) => {
					const config = readStaffCredential(env);
					if (!config.ok) {
						// 500, not 401: nothing the caller sent is wrong. the body names the
						// variable and the command that sets it (CLAUDE.md — 4xx/5xx bodies are
						// read by agents). it does reveal to an anonymous caller that this
						// deployment is misconfigured; the alternative is a fork whose operator
						// cannot tell a wrong password from an unset one.
						throw new APIError('INTERNAL_SERVER_ERROR', {
							code: 'STAFF_CREDENTIAL_NOT_CONFIGURED',
							message: config.message
						});
					}

					if (!staffCredentialMatches(config.credential, ctx.body)) {
						// there is one secret and one account, so there is one thing this can
						// mean and nothing to disambiguate.
						throw new APIError('UNAUTHORIZED', {
							code: 'INVALID_STAFF_CREDENTIAL',
							message: 'Invalid password.'
						});
					}

					const user = await upsertStaffUser(db);
					const session = await ctx.context.internalAdapter.createSession(user.id);
					await setSessionCookie(ctx, { session, user });

					return ctx.json({
						// an explicit projection, so a column added to `auth_user` by a future
						// better-auth version is not published by accident.
						user: { id: user.id, email: user.email, name: user.name, image: user.image },
						session: { id: session.id, expiresAt: session.expiresAt }
					});
				}
			)
		},
		rateLimit: [
			{
				// better-auth's own limiter, over a router this deployment does not serve —
				// ./index.ts says why the knob is stated anyway, and why nothing here bounds
				// the sign-in this app performs. what does is the `SIGN_IN_RATE_LIMITER`
				// binding, charged by the login's action.
				pathMatcher: (path: string) => path === STAFF_SIGN_IN_PATH,
				window: 60,
				max: 5
			}
		]
	} satisfies BetterAuthPlugin;
}

/**
 * make sure the single staff row exists.
 *
 * every value it writes is a constant, the identifier included, so this is an upsert
 * only to stay first-sign-in-safe on a fresh database rather than to carry a rotating
 * deploy value into the row.
 *
 * one statement, and deliberately written through drizzle rather than
 * `internalAdapter.findUserByEmail` + `createUser`:
 *
 *   - better-auth's `create` refuses a caller-supplied `id`, so it cannot honour the
 *     fixed `STAFF_USER_ID` that makes this row a singleton.
 *   - find-then-create is two D1 round trips on a path that runs on every sign-in; an
 *     upsert is one, and D1 supports `RETURNING`.
 *   - there are no `databaseHooks` on `user` in this app, so nothing is being skipped.
 *
 * the cost of bypassing better-auth is that a column it adds to `user` in a future
 * version would not be written here. `auth.spec.ts` compares better-auth's declared
 * `user` fields against the drizzle table on every `pnpm test`, which is what turns
 * that from a production surprise into a failing test.
 */
async function upsertStaffUser(db: Db): Promise<AuthUser> {
	const now = new Date();
	const rows = await db
		.insert(authUser)
		.values({
			id: STAFF_USER_ID,
			name: STAFF_USER_NAME,
			email: STAFF_USER_EMAIL,
			// there is no verification flow and no address to verify in v0. holding the
			// deploy secret is a stronger proof of control over this deployment than a
			// confirmation click would be.
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: authUser.id,
			// `name` is not overwritten: if a later version lets staff set a display name,
			// signing in again must not reset it.
			set: { email: STAFF_USER_EMAIL, emailVerified: true, updatedAt: now }
		})
		.returning();

	const user = rows[0];
	if (!user) {
		throw new APIError('INTERNAL_SERVER_ERROR', {
			code: 'STAFF_USER_UPSERT_FAILED',
			message:
				'Signed in, but the auth_user row could not be written. Check that migrations have been applied to this database: the console (`better-giving open`) applies them to the deployed D1 when it updates this deployment, and `pnpm wrangler d1 migrations apply DB --local` applies them to a local one.'
		});
	}
	return user;
}
