// the drizzle adapter arrives through better-auth's own re-export, so the version is
// always exactly the one better-auth pinned, and it is one less dependency a fork has
// to trust.
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { betterAuth } from 'better-auth/minimal';
import { uuidv7 } from 'uuidv7';
import type { Db } from '$lib/server/db/client';
import { authAccount, authSession, authUser, authVerification } from '$lib/server/db/auth-schema';
import type { AuthEnv } from './env';
import { MEMBER_PASSWORD_MIN_LENGTH } from './invitations';
import { staffCredentialPlugin } from './staff-plugin';

export { readAuthEnv, type AuthEnv } from './env';
export { readStaffCredential, type StaffCredential } from './credential';
export {
	INVITATION_LIFETIME_MS,
	MEMBER_PASSWORD_MIN_LENGTH,
	inviteMember,
	normaliseEmail,
	readInvitation,
	redeemInvitation,
	revokeInvitation,
	type InvitationReading,
	type InviteResult,
	type RedeemResult
} from './invitations';
export {
	changeMemberPassword,
	listMembers,
	removeMember,
	requestPasswordReset,
	resetMemberPassword,
	signInMember,
	type MemberRow,
	type MemberSignIn,
	type PasswordChange,
	type PasswordReset,
	type RemoveResult,
	type ResetRequest
} from './members';
export { LOGIN_PATH, NEXT_PARAM, safeNext, signInDestination } from './next';
export { resolveAuthSecret, type AuthSecretResolution } from './signing-key';
export { STAFF_USER_EMAIL, STAFF_USER_ID } from './staff-plugin';

// this deployment serves no better-auth HTTP surface, and everything below is written against
// that.
//
// better-auth's router — `/sign-in/email`, `/request-password-reset`, `/reset-password`,
// `/get-session` and the rest, registered whether or not the flow behind it is configured — is
// reachable only through `auth.handler`, and no route in this app mounts it. `src/routes.ts`
// sweeps `src/routes/` and nothing there answers `/api/auth/*`, so every one of those endpoints is
// a 404 by the router never being asked. the mailed password reset is the case to read that
// against: it is a flow this deployment runs, `auth_verification` is a table this deployment has,
// and both of those endpoints are still 404s — the reset is reached through
// `auth.api.requestPasswordReset` and `auth.api.resetPassword` from a route's own action
// (./members.ts), which passes through no router at all.
//
// **it is also what makes `emailAndPassword` safe to enable.** turning it on registers
// `/sign-up/email` alongside the sign-in, and an open sign-up endpoint on a single-organisation
// deployment would be a stranger minting themselves a dashboard account. it is not open, because
// it is not served: the only caller is ./invitations.ts, which reaches `auth.api.signUpEmail`
// directly and only after a token from an invitation mail has been matched.
// `src/routes.spec.ts` is what holds that absence to a route tree somebody typed.
//
// what this app uses instead is the server API — `auth.api.signInStaff` for the deployer,
// `auth.api.signUpEmail` and `auth.api.signInEmail` for a member, `auth.api.requestPasswordReset`
// and `auth.api.resetPassword` for one who cannot sign in, `auth.api.getSession` and
// `auth.api.signOut` for everybody — called from a route's own action or middleware, which passes
// through no router at all. CLAUDE.md records the decision so a fork does not go looking for an
// API this app does not serve.
//
// the deployer's credential is outside all of it. it is a deploy-time secret with no hash and no
// row (./credential.ts), so there is nothing for a reset to write and nothing for a link to
// address — ./members.ts refuses that identifier by name before the auth layer is asked, and the
// console is where the value is changed.
//
// two ways in and one gate behind them. a member's session row is a session row like the
// deployer's, so ./gate.ts resolves it with no branch and every screen under `src/routes/_app.tsx`
// is reached the same way by either.

/**
 * the two values `createAuth` cannot read for itself, resolved per request.
 *
 * neither is a deploy-time secret, which is the whole point: a one-click deploy asks for
 * `ADMIN_PASSWORD` and nothing else.
 */
export interface AuthRuntime {
	/**
	 * the session-cookie signing key, from `resolveAuthSecret` — the `BETTER_AUTH_SECRET`
	 * override if set, else the `auth_signing_key` row. passed in rather than read here
	 * because the row read is async and `createAuth` is not.
	 */
	readonly secret: string;
	/**
	 * the origin this request arrived on, e.g. `event.url.origin`. it decides the
	 * trusted-origin list and the cookie `Secure` policy when no `BETTER_AUTH_URL` pin is
	 * set. see the long note in `createAuth`.
	 */
	readonly requestOrigin: string;
	/**
	 * how a mailed reset link reaches the member who asked for one. supplied by the route that
	 * requests a reset and by no other caller, which leaves `sendResetPassword` unset everywhere
	 * else and `auth.api.requestPasswordReset` refusing with `RESET_PASSWORD_DISABLED` there —
	 * `requestPasswordReset` in ./members.ts is what turns that into an answer.
	 *
	 * `send` is given the address and the token and composes nothing. the link is the route's to
	 * build, for the reason `inviteMember` returns a token rather than a url (./invitations.ts):
	 * this module never reads an origin it was not handed, and the token exists in that one call,
	 * in the mail, and in the recipient's address bar.
	 *
	 * `background` is the Worker's `ctx.waitUntil`. better-auth hands the send to it instead of
	 * awaiting it, so a request for an address this deployment has takes the same time as one for
	 * an address it does not — the timing is the whole of what the answer withholds. the isolate
	 * stays alive for the send because `waitUntil` is what keeps it alive.
	 */
	readonly passwordReset?: {
		send(input: { readonly email: string; readonly token: string }): Promise<void>;
		background(task: Promise<unknown>): void;
	};
}

/**
 * how long a mailed reset link works: an hour.
 *
 * the person is at their mailbox now — they pressed the button a moment ago and are waiting for the
 * message — so a link that outlives the sitting is a link sitting in an inbox being a way in. a
 * fresh one is one press, so the cost of it being too short is a press.
 *
 * the same hour is stated in the mail, `packages/emails/src/templates/password-reset.tsx`, and the
 * two change together.
 */
export const PASSWORD_RESET_LIFETIME_SECONDS = 60 * 60;

/** the auth instance, as `createAuth` returns it. */
export type Auth = ReturnType<typeof createAuth>;

/**
 * build the auth instance for one request.
 *
 * a factory, never a module-scope singleton. the D1 handle only exists on the bindings one
 * request arrived with, so the gate over the screens behind the login builds one per request
 * (./gate.ts) rather than importing an `auth`:
 *
 *   const db = context.get(database);                      // src/context.ts
 *   const env = readAuthEnv(context.get(platform).env);
 *   const key = await resolveAuthSecret(db, env);          // ./signing-key.ts
 *   const auth = createAuth(db, env, { secret: key.secret, requestOrigin: url.origin });
 *
 * it takes `Db`, not `D1Database` — nothing outside `db/client.ts` names the driver —
 * and it takes the env explicitly rather than reading `process.env`, whose population
 * from Worker bindings is a compatibility-date-dependent shim.
 *
 * `env` and `runtime` are parameters rather than reads for two different reasons. the
 * staff credential is a deploy-time value that only exists on the platform env, and
 * reading it implicitly would make this module untestable and its failure modes
 * unreachable — see ./env.ts. `runtime` carries the two values that are resolved per
 * request rather than configured: the signing key, which is normally a D1 row and so
 * cannot be read synchronously here, and the origin, which replaced the
 * `BETTER_AUTH_URL` var.
 */
export function createAuth(db: Db, env: AuthEnv, runtime: AuthRuntime) {
	// destructured so the two options below narrow inside their own closures.
	const { passwordReset } = runtime;
	const secret = runtime.secret.trim();
	if (!secret) {
		// a programming error by the time it reaches here — ./signing-key.ts is what turns
		// an absent key into an operator-facing message, and it never returns `ok` with an
		// empty one. this stays as a guard because of what an empty secret would do
		// silently: better-auth falls back to a built-in default when its own `secret` is
		// falsy, and a default cookie-signing key in a public repo is a session-forgery kit
		// identical in every fork. its guard against that default only throws when
		// `NODE_ENV === 'production'`, which nothing sets on Workers, so nothing downstream
		// would complain.
		throw new Error(
			'createAuth was given an empty signing key. Resolve it with `resolveAuthSecret` ' +
				'(src/lib/server/auth/signing-key.ts), which reports the operator-facing reason, ' +
				'and pass the value it returns.'
		);
	}

	/**
	 * the origin, and why it is not a secret.
	 *
	 * `BETTER_AUTH_URL` is an optional override that a one-click deploy never sets, because
	 * better-auth already derives the origin from the request when `baseURL` is absent: its
	 * handler resolves `getOrigin(request.url)` and then recomputes `trustedOrigins` from
	 * that, per request (`better-auth/dist/auth/base.mjs`). that costs nothing here — this
	 * factory is already per-request — and it avoids the asymmetry a fixed value carries,
	 * where a deployment reachable on both workers.dev and a custom domain serves
	 * cookie-bearing mutations on only one of them.
	 *
	 * the origin check still has teeth. it is not circular, because the two sides are
	 * independent facts: better-auth compares the request's `Origin`/`Referer` header
	 * (what page initiated the request) against the trusted list derived from
	 * `request.url` (which host the browser addressed). a cross-site POST from evil.com
	 * carries `Origin: https://evil.com` while `request.url` is still this deployment's
	 * host, so it is refused. defeating that needs `Origin == Host` and the victim's
	 * cookies, which browsers make mutually exclusive: the cookie jar and the Host come
	 * from the same hostname, so `Origin == Host` means the request came from this app.
	 * a spoofed `Host` from a script carries no session cookie and has nothing to hijack.
	 * the cross-site navigation login block does not consult the list at all — it keys on
	 * `Sec-Fetch-Site`/`Sec-Fetch-Mode`.
	 *
	 * what it does not cover is the form POST at `/login`: better-auth's own origin
	 * middleware runs on a request its router handled, and this deployment mounts no router
	 * — a direct `auth.api.*` call carries no `ctx.request` for it to read. what stands
	 * there instead is the session cookie's `sameSite: 'lax'` below, which a cross-site POST
	 * does not carry, and the sign-in bucket `signInRateLimitKey` charges (CLAUDE.md).
	 *
	 * **that is the accepted answer and not an omission waiting to be closed.** what `lax`
	 * leaves standing is login-CSRF, where the victim's browser is made to submit the
	 * attacker's own credentials and the victim ends up signed into the attacker's account —
	 * it needs no cookie from the victim, which is why the cookie attribute does not reach it.
	 * this deployment has one staff account, so a forced login lands the victim in the account
	 * whose password the attacker already holds; there is no second account to be confused
	 * into, and the donation page this project deploys carries no session at all — it is a
	 * static shell on an origin of its own, so nothing on it holds or reads this deployment's
	 * cookie (CLAUDE.md → Product surface). the control
	 * that would close it is a comparison of `Origin` against the request's own host, and
	 * CLAUDE.md bans exactly that reading: `Origin` is an attribution signal and never an
	 * authorization control. reopen this the day a deployment has a second account, which is
	 * the fact the argument turns on.
	 *
	 * `x-forwarded-host` is not consulted: better-auth honours forwarded headers only
	 * when `advanced.trustedProxyHeaders` is set, and it is not. that is also why
	 * `baseURL: { allowedHosts }` is deliberately unused — on 1.6.25 that path defaults
	 * `trustedProxyHeaders` to `true`, which would trust an attacker-supplied header.
	 */
	const configuredBaseURL = env.BETTER_AUTH_URL?.trim() || undefined;
	const effectiveOrigin = configuredBaseURL ?? runtime.requestOrigin;
	const isLoopback = isLoopbackOrigin(effectiveOrigin);

	return betterAuth({
		// `better-auth/minimal` instead of `better-auth`: the default entry point bundles
		// the built-in Kysely adapter, which this project never uses and which every
		// Worker isolate would otherwise pay for at startup.
		secret,
		// undefined unless an operator pinned one. see the note above.
		baseURL: configuredBaseURL,

		// with no `baseURL`, better-auth logs a warning about it at every context
		// creation — which is once per request here. `error` keeps everything that
		// reports an actual failure and drops that one line. it is the level knob, not
		// `disabled`, so a real error still reaches `pnpm run logs`.
		logger: { level: 'error' },

		database: drizzleAdapter(db, {
			provider: 'sqlite',

			/**
			 * the model map, and why it is narrow.
			 *
			 * the adapter resolves a model by looking the name up in this object, falling
			 * back to `db._.fullSchema` when no `schema` is passed. that fallback is the
			 * dangerous case: better-auth's `account` model would resolve to this repo's
			 * accounting chart of accounts, and better-auth would start writing OAuth
			 * tokens into the table every ledger entry posts against.
			 *
			 * naming the models explicitly makes that unrepresentable. the `account` key here
			 * is the drizzle table `auth_account`, never the chart of accounts, and the
			 * `modelName` overrides below mean better-auth is not looking for a bare `account`
			 * in the first place. every model better-auth declares has to be in this map: the
			 * adapter reads `config.schema[model]` with no fallback once a `schema` is passed,
			 * so a model that is missing throws `BetterAuthError` at the first write rather
			 * than resolving to something else.
			 *
			 * `transaction` is left at its default of `false`. see the note on `Db` in
			 * `db/client.ts`: D1 has no interactive transaction. at `false` the adapter
			 * never calls `db.transaction()` and better-auth runs the callback against the
			 * same non-transactional adapter, which is honest about what D1 provides. it is
			 * also why the sign-up ./invitations.ts performs cannot join the `batch()` that
			 * stamps the invitation, and why that module orders the two the way it does.
			 */
			schema: { authUser, authSession, authAccount, authVerification }
		}),

		/**
		 * model names. every better-auth model is renamed, not just the one that collides
		 * today — see the naming note at the top of `db/auth-schema.ts`.
		 *
		 * `account` is renamed because the collision is real — the default name resolves to
		 * this repo's accounting chart of accounts. the other three are renamed ahead of a
		 * collision rather than after one: `user`, `session` and `verification` are all names
		 * a growing fundraising schema can plausibly want, and the rule is that anything
		 * better-auth owns starts with `auth_` (`db/auth-schema.ts`).
		 */
		user: { modelName: 'authUser' },
		session: {
			modelName: 'authSession',
			// stated rather than inherited: this is a security knob a fork operator has to
			// be able to find. seven days, refreshed at most once a day.
			expiresIn: 60 * 60 * 24 * 7,
			updateAge: 60 * 60 * 24
			// `cookieCache` is deliberately not enabled. it would trade a D1 read per
			// request for a window in which a deleted session still authenticates. at one
			// staff member's request volume the read is free and immediate revocation is
			// worth more.
		},
		account: { modelName: 'authAccount' },
		verification: { modelName: 'authVerification' },

		/**
		 * the members' way in. the deployer's is `signInStaff` and does not pass through any of
		 * this — one bucket bounds both, at the login's own action (CLAUDE.md).
		 *
		 * **the hashing is better-auth's own scrypt at its own parameters, and it needs the paid
		 * Workers plan.** ./credential.ts argues that a KDF cannot run inside 10 ms of CPU and
		 * that a KDF tuned to fit is one an attacker brute-forces trivially; that is the **free**
		 * plan's budget and it binds the staff credential, which is why that one is still a
		 * deploy-time secret with no hash anywhere. paid is 30 s per invocation, which scrypt at
		 * N=16384, r=16 fits with room to spare — so a member's password is hashed properly
		 * rather than at a cost chosen to fit a limit. tuning it down here would be the failure
		 * that argument describes, not a saving. DEPLOY.md is where a fork reads which plan a
		 * deployment is on.
		 *
		 * `autoSignIn` is left at its default of `true`: accepting an invitation is one press,
		 * and a colleague who has just chosen a password should not be asked for it immediately.
		 *
		 * `requireEmailVerification` is off, and the invitation link is what it would otherwise
		 * buy. the address was proven before the account existed — nobody reaches the sign-up
		 * without a token that was mailed to it — so a confirmation click afterwards would prove
		 * the same thing twice.
		 *
		 * `sendResetPassword` is set only when the runtime carried a way to send, so the mailed
		 * reset exists on the one instance the route requesting it builds and on no other. what it
		 * is handed is the address and the token: better-auth's `url` is ignored, because it points
		 * at `/reset-password/:token` on a router this deployment does not mount, and the route
		 * that owns the press is what composes the link the mail carries. `resetMemberPassword` in
		 * ./members.ts is the other half, and `changeMemberPassword` beside it is the way a member
		 * who *can* sign in changes theirs.
		 *
		 * `revokeSessionsOnPasswordReset` is on, and it is the reason the reset mints no session:
		 * somebody who has just proved they hold the mailbox ends every session the account had,
		 * then signs in with what they chose. the default is off, which would leave whoever the
		 * reset was recovering from still signed in.
		 *
		 * `resetPasswordTokenExpiresIn` is seconds and better-auth's own default is the same hour;
		 * it is stated because the number is a promise the mail makes in words
		 * (`PASSWORD_RESET_LIFETIME_SECONDS` above), not a default to inherit.
		 *
		 * `minPasswordLength` comes from ./invitations.ts, which is where the number is decided
		 * and where the redeem screen reads it from too — a minimum a form does not state is one
		 * a colleague meets by being refused.
		 */
		emailAndPassword: {
			enabled: true,
			autoSignIn: true,
			requireEmailVerification: false,
			minPasswordLength: MEMBER_PASSWORD_MIN_LENGTH,
			revokeSessionsOnPasswordReset: true,
			resetPasswordTokenExpiresIn: PASSWORD_RESET_LIFETIME_SECONDS,
			...(passwordReset
				? {
						sendResetPassword: async ({ user, token }) => {
							await passwordReset.send({ email: user.email, token });
						}
					}
				: {})
		},

		advanced: {
			// better-auth hands the send here instead of awaiting it
			// (`runInBackgroundOrAwait`, `better-auth/dist/context/create-context.mjs`), which is
			// what keeps a request for an address this deployment has taking the same time as one
			// for an address it does not. absent, the send is awaited and the two arms are
			// distinguishable by a stopwatch.
			...(passwordReset
				? {
						backgroundTasks: { handler: (task: Promise<unknown>) => passwordReset.background(task) }
					}
				: {}),

			database: {
				// ids are text uuidv7 generated app-side project-wide (see db/schema.ts).
				// without this, better-auth's own generator would put a different id shape in
				// `auth_user`/`auth_session` than in every other table.
				generateId: () => uuidv7()
			},

			/**
			 * without this, per-IP throttling does not exist and one caller can lock out
			 * every other.
			 *
			 * better-auth keys its rate-limit bucket on
			 * `createRateLimitKey(getIp(req, options) ?? 'no-trusted-ip', path)`
			 * (`better-auth/dist/api/rate-limiter/index.mjs`). when `getIp` cannot resolve an
			 * address it logs "falling back to a single shared per-path bucket" and every
			 * caller collapses into that one bucket — so the 5-per-minute rule on
			 * `/sign-in/staff` becomes five attempts per minute for the whole deployment, and
			 * an attacker spending them locks the operator out of the only login. that is a
			 * denial of service on the one human surface, not a log line.
			 *
			 * the default header is `x-forwarded-for`, and it is the wrong one here
			 * specifically. `getIp` refuses a comma-separated chain outright unless
			 * `trustedProxies` is configured, because the leftmost token is caller-controlled
			 * behind an appending proxy (`@better-auth/core/dist/utils/ip.mjs`) — and
			 * Cloudflare appends to `x-forwarded-for` rather than replacing it. so any caller
			 * who sends the header at all makes it a two-token chain and forces the shared
			 * bucket on purpose.
			 *
			 * `cf-connecting-ip` is set by Cloudflare on every request into a Worker and
			 * overwritten at the edge, so it is single-valued and never the caller's to set —
			 * which is why it is named directly instead of listing proxies in
			 * `trustedProxies`. there is no correct value for that option here: the trusted
			 * hop is Cloudflare's edge, whose addresses are not a fixed list this repo could
			 * pin.
			 *
			 * this does not make the limiter a control — see the `rateLimit` note below, which
			 * also says why a knob for a router this deployment does not serve is stated at all.
			 * the counters are still per-isolate and in-memory. it makes the friction per-caller
			 * instead of global, which is the difference between throttling an attacker and
			 * handing them a lockout.
			 */
			ipAddress: {
				ipAddressHeaders: ['cf-connecting-ip']
			},

			/**
			 * stated explicitly, and it has to be.
			 *
			 * better-auth derives both the `Secure` attribute and the `__Secure-` cookie
			 * name prefix from one value, and with no `baseURL` string to read a scheme off
			 * it falls back to `NODE_ENV === 'production'`
			 * (`better-auth/dist/cookies/index.mjs`). nothing sets `NODE_ENV` in a deployed
			 * Worker — not wrangler, and not the bundler, since better-auth reads it through
			 * a proxy that no build-time replacement reaches. so dropping `BETTER_AUTH_URL`
			 * without this line would silently ship a session cookie with no `Secure` flag.
			 *
			 * `defaultCookieAttributes: { secure: true }` is not a substitute: it is spread
			 * after the derived value so it wins for the attribute, but the name prefix
			 * comes from this knob alone — and `__Secure-` is the half a browser enforces.
			 */
			useSecureCookies: !isLoopback,

			defaultCookieAttributes: {
				httpOnly: true,
				// 'lax', not 'strict': the sign-in form POSTs same-site, and 'strict' would
				// drop the session cookie on any top-level navigation into /admin from an
				// external link.
				sameSite: 'lax'
			}
		},

		/**
		 * the effective origin is trusted by better-auth automatically — per request when
		 * `baseURL` is unset. this list is only what makes local development work without
		 * weakening the deployed app.
		 *
		 * `pnpm dev` serves on 5321 and `pnpm preview`/`wrangler dev` on 8787 off the same
		 * `.dev.vars`, so a request arriving on either loopback port trusts both. 5321 is pinned
		 * in `packages/app/vite.config.ts`, and this list is a reason it is pinned: a dev server
		 * that drifted to another port would be an origin better-auth refuses the sign-in POST
		 * from.
		 *
		 * a deployed origin is never loopback, so a real deployment trusts exactly the origin
		 * it was reached on — no localhost entry that a page on a developer's machine could
		 * POST from.
		 */
		trustedOrigins: isLoopback ? ['http://localhost:5321', 'http://localhost:8787'] : [],

		rateLimit: {
			// every word below is about better-auth's own router, which this deployment does not
			// serve — see the top of this file. it is stated rather than dropped because the
			// instance still has a router and this is that router's own knob; a direct
			// `auth.api.*` call passes through none of it, so nothing here bounds the sign-in
			// this app actually performs.
			//
			// stated explicitly because the default is "production only", and a fork
			// running `pnpm preview` against real secrets should behave the same.
			//
			// `window`/`max` below are the general limit and do not govern sign-in. any path
			// starting with `/sign-in` is covered by better-auth's own built-in special rule
			// of 3 requests per 10 seconds, which is stricter and wins — verified by probe
			// (the 4th rapid `/sign-in/staff` returns 429). do not read `max: 100` as the
			// credential endpoint's budget. it is deliberately not restated as a
			// `customRules` entry: getting that shape wrong would silently replace the
			// stricter built-in with a weaker rule, which is the one failure mode worth
			// avoiding here. the cost is that an upstream change to that default is a
			// behaviour change this file does not pin.
			//
			// caveat worth knowing: this limiter is friction, not a control. counters live in
			// memory, and on Workers that memory is per-isolate and short-lived — a worker
			// restart resets it (also verified). better-auth additionally logs that
			// enforcement is best-effort when the storage has no atomic `consume`, so
			// concurrent requests can bypass the limit outright. what durably bounds the staff
			// sign-in is the `SIGN_IN_RATE_LIMITER` binding, charged at the one site that
			// compares `ADMIN_PASSWORD` — `signInRateLimitKey` in ../api/rate-limit.ts, spent by
			// the login's own action — with `ADMIN_PASSWORD`'s own length behind it (see
			// ./credential.ts).
			enabled: true,
			window: 60,
			max: 100
		},

		// this app is deployed by nonprofits onto their own infrastructure. it does not
		// phone home. (better-auth's default is already `false`; saying so keeps it that
		// way through an upgrade that changes the default.)
		telemetry: { enabled: false },

		// no plugin here copies better-auth's `set-cookie` anywhere. a caller that needs the
		// cookies an endpoint set asks for them — `auth.api.<endpoint>({ …, returnHeaders: true })`
		// hands back `{ headers, response }` — and appends them to the response it is returning.
		// `staffGate` in ./gate.ts is the one that does it for `getSession`'s rolling refresh.
		plugins: [staffCredentialPlugin({ db, env })]
	});
}

function isLoopbackOrigin(url: string): boolean {
	try {
		const hostname = new URL(url).hostname.toLowerCase();
		return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1';
	} catch {
		return false;
	}
}
