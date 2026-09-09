import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from 'uuidv7';

// ---------------------------------------------------------------------------
// tables better auth owns. they are re-exported from ./schema.ts so drizzle-kit
// and ./client.ts see one schema, but they are not domain tables: their columns
// are dictated by better-auth's core schema, not by us, and
// `src/lib/server/auth/auth.spec.ts` is what stops the two from drifting across
// a better-auth upgrade.
//
// naming: every better-auth model is prefixed `auth_` in SQL and `auth`-camel in
// TS (`auth_user` / `authUser`). the prefix is a namespace, not a collision fix.
//   - better-auth's core schema includes a table named `account`. this repo already
//     has one — the accounting chart of accounts in ./schema.ts, 10 seeded rows,
//     self-referencing FK, the substrate every ledger entry posts against. it does
//     not move.
//   - renaming only the one that collides today just defers the problem: the domain
//     already holds `donation`, `payment`, `ledger_entry`, `entry_group` and `form`,
//     and better-auth's plugin tables include `organization`, `member`,
//     `invitation`, `passkey`, `jwks` and `rateLimit`. `user`, `session` and
//     `verification` are all names a growing fundraising schema can plausibly want.
//   - so the whole foreign namespace is prefixed once, and the rule is mechanical:
//     anything better-auth owns starts with `auth_`, nothing the domain owns does.
//     the next better-auth table cannot collide without someone breaking that rule.
//   - it also marks ownership, which matters in a fork someone else maintains:
//     `auth_*` is not theirs to model.
//
// which models exist here: `user`, `session`, `account` and `verification` —
// better-auth's whole core schema. the fourth is written by one flow only: the
// mailed password reset a member asks for, through
// `auth.api.requestPasswordReset` and `auth.api.resetPassword` called from a
// route's own action. no route mounts better-auth's router, so those endpoints
// answer nothing over HTTP and those two calls are the only way a row is ever
// written — `src/lib/server/auth/index.ts` argues it and `src/routes.spec.ts`
// holds it against the route tree. two tables in this file are ours rather than
// better-auth's — `auth_signing_key` and `auth_member_invitation`, both at the
// bottom — so read their doc comments before treating the `auth_` prefix as
// meaning "generated".
//
// `auth_account` holds a password hash while the deployer's credential has
// none, and the two are one argument read against two budgets.
// `src/lib/server/auth/credential.ts` argues that no KDF fits
// a 10 ms CPU budget, and that argument is the Workers **free** plan's and binds
// the staff credential only: the deployer's password is still a deploy-time
// secret compared in constant time with no hash anywhere. a member's password is
// hashed with better-auth's own scrypt, which needs the paid plan's 30 s budget
// — DEPLOY.md is where a fork reads which plan it is on.
//
// timestamps on the four better-auth tables carry no drizzle default and no
// `$onUpdateFn`. that is the opposite of the domain tables in ./schema.ts on
// purpose: better-auth writes `createdAt` and `updatedAt` itself on every insert
// and update, so a default here would be dead code and an `$onUpdateFn` would
// race the value better-auth just computed. the two tables this file owns are
// written by this app and say so at their own columns. the encoding is the
// project's throughout — integer unix ms UTC, never text ISO-8601.
// ---------------------------------------------------------------------------

/** ms-precision unix timestamp. */
const at = (name: string) => integer(name, { mode: 'timestamp_ms' });

/**
 * an identity a session points at: the deployer, and every colleague they invite.
 *
 * the deployer's row is the singleton at the fixed `STAFF_USER_ID` in
 * `src/lib/server/auth/staff-plugin.ts`, and it holds no credential in the
 * database at all — `ADMIN_PASSWORD` is a deploy-time secret compared in constant
 * time, so that row has no `auth_account` beside it and nothing here or there
 * stores a hash of it.
 *
 * every other row is a member, created by
 * `src/lib/server/auth/invitations.ts` when a colleague redeems an invitation.
 * a member's password hash is on their `auth_account` row below, never here.
 */
export const authUser = sqliteTable(
	'auth_user',
	{
		// no `$defaultFn`: the id comes from better-auth's `advanced.database.generateId`,
		// which `createAuth` sets to the same uuidv7 generator the domain tables use.
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		email: text('email').notNull(),
		emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
		image: text('image'),
		createdAt: at('created_at').notNull(),
		updatedAt: at('updated_at').notNull()
	},
	(t) => [
		// same reason as `boolCheck` in ./schema.ts: `mode: 'boolean'` is an affinity,
		// not a constraint — `2` inserts happily and drizzle maps it back to `false`.
		check('auth_user_email_verified_bool_check', sql`${t.emailVerified} in (0, 1)`),
		// better-auth treats `email` as unique and looks users up by it.
		uniqueIndex('auth_user_email_idx').on(t.email)
	]
);

/**
 * the session table. this is the whole reason better-auth is here: sessions are
 * DB-backed rows that can be revoked, not a self-contained signed token.
 *
 * `session.cookieCache` is deliberately left off in `createAuth`, so every request
 * resolves the session against this table and a delete here takes effect on the
 * next request.
 */
export const authSession = sqliteTable(
	'auth_session',
	{
		id: text('id').primaryKey(),
		// cascade is right here and wrong on the domain tables: a session is worthless
		// without its user, whereas an `account` with ledger entries under it must never
		// disappear because a parent row went away (see ./schema.ts).
		userId: text('user_id')
			.notNull()
			.references(() => authUser.id, { onDelete: 'cascade' }),
		// the value inside the signed session cookie. better-auth generates it; every
		// session lookup is by this column, so the unique index is the read path.
		token: text('token').notNull(),
		expiresAt: at('expires_at').notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		createdAt: at('created_at').notNull(),
		updatedAt: at('updated_at').notNull()
	},
	(t) => [
		uniqueIndex('auth_session_token_idx').on(t.token),
		// `list-sessions` and `revoke-sessions` filter by user. no index on `expires_at`:
		// better-auth filters by token and checks expiry in JS, so it would only cost writes.
		index('auth_session_user_id_idx').on(t.userId)
	]
);

/**
 * the credential a member signs in with.
 *
 * better-auth's `account` model, whose whole job in this deployment is the one row per member that
 * `/sign-up/email` writes with `providerId = 'credential'` and the scrypt hash in `password`. the
 * other nine columns are OAuth's — no social provider is configured and none is reachable (no
 * route mounts the router that would run a callback), and they are declared anyway because this
 * table is better-auth's shape and not ours to trim: `src/lib/server/auth/auth.spec.ts` compares
 * the two on every `pnpm test`, and a column left out is an insert that fails the day a version
 * starts writing it.
 *
 * the deployer has no row here. `ADMIN_PASSWORD` is a deploy-time secret and nothing hashes it —
 * see `src/lib/server/auth/credential.ts`, and the note at the top of this file for why a member's
 * password is hashed when the deployer's cannot be.
 *
 * cascade, for the reason `auth_session` cascades: a credential without the identity it belongs to
 * authenticates nobody, so removing a member takes it with them
 * (`src/lib/server/auth/members.ts`).
 */
export const authAccount = sqliteTable(
	'auth_account',
	{
		id: text('id').primaryKey(),
		/**
		 * the identifier at the provider. for a credential account better-auth writes the user's
		 * own id here, so it is not a second identity — the email on `auth_user` is what a sign-in
		 * looks up.
		 */
		accountId: text('account_id').notNull(),
		/** `'credential'` on every row this deployment writes. an OAuth link would name its provider. */
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => authUser.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: at('access_token_expires_at'),
		refreshTokenExpiresAt: at('refresh_token_expires_at'),
		scope: text('scope'),
		/**
		 * the scrypt hash better-auth computes, as `salt:key` hex. the plaintext never reaches this
		 * app's storage and never leaves the request it arrived on.
		 */
		password: text('password'),
		createdAt: at('created_at').notNull(),
		updatedAt: at('updated_at').notNull()
	},
	(t) => [
		// better-auth declares `userId` indexed and nothing else on this model. every read is
		// "the accounts for this user" — `findUserByEmail({ includeAccounts: true })` resolves the
		// user first and then reads this table by `user_id`.
		index('auth_account_user_id_idx').on(t.userId)
	]
);

/**
 * an outstanding password reset. better-auth's `verification` model, whose whole job in this
 * deployment is the mailed reset a member asks for: `auth.api.requestPasswordReset` writes a row
 * and `auth.api.resetPassword` consumes it, both called from a route's own action because no
 * route mounts better-auth's router (`src/lib/server/auth/index.ts`, `src/routes.spec.ts`). one
 * row is one outstanding reset link — `identifier` is `reset-password:<token>` carrying the token
 * exactly as it was mailed, `value` is the member's `auth_user.id`, and the row is deleted when
 * the link is used. the token is stored as sent rather than hashed like
 * `auth_member_invitation.token_hash` below, because better-auth looks the row up by the
 * identifier it was handed and this table is its shape, not ours.
 *
 * no foreign key on `value`, where a reader expects one: better-auth's own schema declares none,
 * and the cascade allowlist in `src/lib/server/db/strict.workers.spec.ts` stays at two. a link
 * outliving the member it names still sets no password — better-auth creates the credential row
 * it cannot find, and `auth_account.user_id`'s foreign key refuses an insert against a user who
 * is gone.
 */
export const authVerification = sqliteTable(
	'auth_verification',
	{
		id: text('id').primaryKey(),
		/** `reset-password:<token>`. every read of this table is by this column. */
		identifier: text('identifier').notNull(),
		/** the `auth_user.id` whose password the link resets. */
		value: text('value').notNull(),
		expiresAt: at('expires_at').notNull(),
		createdAt: at('created_at').notNull(),
		updatedAt: at('updated_at').notNull()
	},
	(t) => [
		// better-auth declares this column merely indexed and reads it with a `limit 1` ordered by
		// `created_at`, so two rows sharing an identifier would make "which reset is this" a query
		// with an ordering in it. unique instead: the token is 24 random characters, so a second
		// row under one identifier is a bug rather than a collision.
		uniqueIndex('auth_verification_identifier_idx').on(t.identifier)
	]
);

/**
 * the key that signs the session cookie. exactly one row, `id = 'default'`.
 *
 * the one thing in this file better auth does not own. it is not part of
 * better-auth's core schema and no plugin declares it; it sits in the `auth_`
 * namespace because it is auth infrastructure and reads next to the two tables it
 * serves. it cannot collide with a future better-auth model — the closest one is the
 * jwt plugin's `jwks`, which under the prefix rule would be `auth_jwks`.
 *
 * why a row and not a secret: a one-click deploy should ask an operator for
 * `ADMIN_PASSWORD` and nothing else. this value is machine-minted — generated by
 * `migrations/0000_initial_schema.sql` on the first deploy, never typed, shown or
 * configured by anyone — so it is the carve-out in CLAUDE.md's "secrets are
 * deploy-time" rule rather than an exception to it. `BETTER_AUTH_SECRET`, when set,
 * overrides it.
 *
 * what it guards: cookie integrity only. it is a tamper check over a value whose
 * authority lives in `auth_session` — a forged cookie still has to name a session row
 * that exists and has not expired. so it guards nothing that D1 access does not
 * already grant, which is what makes storing it here sound.
 *
 * rotation logs the admin out and does nothing else:
 *   pnpm wrangler d1 execute better-giving --remote --command "UPDATE auth_signing_key set value = '$(openssl rand -hex 32)' where id = 'default'"
 *
 * that generates the replacement on the operator's machine on purpose. the migration mints
 * the first one with `randomblob(32)`, because it runs before any Worker exists and D1's
 * PRNG is the only source there — read the entropy note at the bottom of
 * `migrations/0000_initial_schema.sql` before treating `randomblob` as a CSPRNG anywhere
 * else in this codebase.
 */
export const authSigningKey = sqliteTable(
	'auth_signing_key',
	{
		// not a uuidv7 and deliberately not `$defaultFn`: the row is a singleton the
		// migration writes, and the check below is what keeps it a singleton — a second
		// row cannot be inserted under any other id, so "which key is live" is never a
		// query with an ordering in it.
		id: text('id').primaryKey(),
		// 64 lowercase hex chars — 32 bytes from `hex(randomblob(32))`.
		value: text('value').notNull(),
		createdAt: at('created_at').notNull()
	},
	(t) => [check('auth_signing_key_id_check', sql`${t.id} = 'default'`)]
);

/**
 * an outstanding invitation to become a member. ours, not better-auth's.
 *
 * it sits in the `auth_` namespace for `auth_signing_key`'s reason — it is auth infrastructure and
 * reads next to the tables it serves — and it carries `member_` in the middle for that same doc
 * comment's other reason. `auth_invitation` is the name better-auth's own organization plugin
 * would take under the prefix rule at the top of this file, and a table of ours parked on it is
 * the one thing that rule exists to prevent. no better-auth model is named `memberInvitation`.
 *
 * the row is the invitation, and there is no separate state column: `accepted_at`, `revoked_at`
 * and `expires_at` between them say what has become of it, and **live** means all three are clear
 * — unaccepted, unrevoked, and not yet past. `src/lib/server/auth/invitations.ts` is the only
 * module that writes this table and is where every one of those transitions is argued.
 *
 * what is deliberately not here is the token. `token_hash` is a SHA-256 of it, so a stolen
 * database backup carries no working invitation link; the token itself exists in the mail and in
 * the recipient's address bar and nowhere else, and is never logged.
 */
export const authMemberInvitation = sqliteTable(
	'auth_member_invitation',
	{
		// a `$defaultFn` unlike the three tables above, because this one is written by this app
		// rather than by better-auth — the same uuidv7 the domain tables mint in ./schema.ts.
		id: text('id')
			.primaryKey()
			.$defaultFn(() => uuidv7()),
		/**
		 * lower-cased and trimmed by the module that writes it, which is what makes one address one
		 * invitation. the check holds the writer to it: better-auth lower-cases an email on every
		 * lookup, so a row written in mixed case would be an invitation whose address can never be
		 * matched against the `auth_user` row it becomes.
		 */
		email: text('email').notNull(),
		/** 64 lowercase hex characters — SHA-256 over the token in the link. */
		tokenHash: text('token_hash').notNull(),
		expiresAt: at('expires_at').notNull(),
		createdAt: at('created_at').notNull(),
		/**
		 * the `auth_user` who sent it, or null once that person is gone.
		 *
		 * deliberately no foreign key. a removed colleague must not take the invitations they sent
		 * with them — the person holding the link has done nothing wrong — so this is a pointer
		 * that is allowed to dangle rather than a reference with a cascade or a restriction behind
		 * it. it is read for display and never for a decision.
		 */
		invitedBy: text('invited_by'),
		acceptedAt: at('accepted_at'),
		revokedAt: at('revoked_at')
	},
	(t) => [
		// the read path: a redeem arrives holding a token and nothing else. unique because two
		// rows sharing a hash would make "which invitation is this" a query with an ordering in it.
		uniqueIndex('auth_member_invitation_token_hash_idx').on(t.tokenHash),
		check('auth_member_invitation_email_lower_check', sql`${t.email} = lower(${t.email})`),
		check('auth_member_invitation_token_hash_check', sql`length(${t.tokenHash}) = 64`)
	]
);

export type AuthUser = typeof authUser.$inferSelect;
export type NewAuthUser = typeof authUser.$inferInsert;
export type AuthSession = typeof authSession.$inferSelect;
export type NewAuthSession = typeof authSession.$inferInsert;
export type AuthAccount = typeof authAccount.$inferSelect;
export type AuthVerification = typeof authVerification.$inferSelect;
export type AuthSigningKey = typeof authSigningKey.$inferSelect;
export type AuthMemberInvitation = typeof authMemberInvitation.$inferSelect;
