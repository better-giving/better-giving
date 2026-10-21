import { eq } from 'drizzle-orm';
import { LOGS_SAY_WHY } from '$lib/deployment-logs';
import type { Db } from '$lib/server/db/client';
import { authSigningKey } from '$lib/server/db/auth-schema';
import type { AuthEnv } from './env';

/**
 * where the session-cookie signing key comes from, and in what order.
 *
 * `BETTER_AUTH_SECRET` is the key a running server signs with: it refuses to start
 * without it (`REQUIRED_ENV_VARS` in ../runtime/env.ts). behind it is a key
 * machine-minted by `migrations/0000_initial_schema.sql` into `auth_signing_key`, read
 * only where the env a caller hands in holds none.
 *
 * that row is the carve-out in AGENTS.md's "secrets are deploy-time" rule — a key the app
 * mints for itself — rather than a breach of it. see the note above `authSigningKey` in
 * `db/auth-schema.ts`.
 *
 * **what it signs is worth more than cookie integrity, and reading it out of the database is
 * not inert.** over a session cookie it is a tamper check on a token whose authority is the
 * `auth_session` row it names. but it also signs the short-lived address that begins a
 * QuickBooks connection, under a purpose label of its own so the two can never be read
 * as each other (`$lib/server/accounting/connect-link.ts`), and that address is minted
 * on Books for the deployer's session alone. whoever can forge one
 * connects **their own** company, and every gift this organisation takes is posted into
 * books they control. signing in at Intuit is not a second gate: the person signing in
 * is the one who forged the address. so the carve-out above is about where the value
 * comes from and never about the value being inert, and a change that widens what this
 * key signs widens what reading this database is worth.
 *
 * the ordering — env first — makes `BETTER_AUTH_SECRET` an emergency lever: changing it
 * revokes every live session at once, and voids every unspent connect
 * address with them, without touching the database.
 *
 * not derived from `ADMIN_PASSWORD`. deriving it would make every signed session cookie
 * an offline oracle for the password: an attacker holding one cookie has a
 * `(token, HMAC(key, token))` pair and can test candidate passwords against it offline.
 * today `ADMIN_PASSWORD` is only attackable online, which is the entire premise of
 * ./credential.ts.
 */

/** the single row's primary key. the table's check constraint permits no other. */
const SIGNING_KEY_ID = 'default';

export type AuthSecretResolution =
	| { readonly ok: true; readonly secret: string; readonly source: 'env' | 'database' }
	| { readonly ok: false; readonly cause: string };

/**
 * what any caller is told when the key cannot be read, wherever it is read. the refusal's `cause`
 * can quote the database's own error and is logged, never sent: the key is read before anybody is
 * signed in, so whoever reads this may be anonymous.
 *
 * it is written to be true of every arm that sends it, a database that throws before the key is
 * read included (src/routes/login.tsx), so it names what to do rather than what failed. like
 * `notConfiguredMessage`, and for the reason its comment gives, it names the commands that apply
 * migrations and no filename.
 */
export const SIGNING_KEY_UNREADABLE =
	'This deployment’s database is not ready, so no one can be signed in and no signed link can ' +
	'be checked. Update the database: `docker compose run --rm migrate`, or `pnpm db:migrate` from ' +
	'a checkout. ' +
	LOGS_SAY_WHY;

/**
 * `BETTER_AUTH_SECRET` if set, else the `auth_signing_key` row, else a refusal whose cause
 * names the fix.
 *
 * one database read, and only when the env override is absent. it is a read per request
 * because nothing built from configuration may be a module-scope singleton (AGENTS.md →
 * Runtime) — the row is immutable in practice, but caching it across requests would mean
 * caching it across deployments and databases too.
 */
export async function resolveAuthSecret(db: Db, env: AuthEnv): Promise<AuthSecretResolution> {
	const fromEnv = env.BETTER_AUTH_SECRET?.trim();
	if (fromEnv) return { ok: true, secret: fromEnv, source: 'env' };

	let rows: { value: string }[];
	try {
		rows = await db
			.select({ value: authSigningKey.value })
			.from(authSigningKey)
			.where(eq(authSigningKey.id, SIGNING_KEY_ID))
			.limit(1);
	} catch (cause) {
		// the failure a fresh fork actually hits is `no such table: auth_signing_key`,
		// because migrations have not been applied. anything else the driver can throw
		// leads to the same first thing to check, so both get the same message rather than
		// a raw drizzle error the operator has to interpret.
		return { ok: false, cause: notConfiguredMessage(`the query failed (${describe(cause)})`) };
	}

	// `typeof` rather than trusting the declared type: the value crosses the driver's serialization
	// boundary, so the declared `string` is a claim about the schema, not about what came
	// back — a column that is somehow null or numeric arrives as one. the failure mode of
	// trusting it is a `TypeError` on the auth hot path instead of the message below.
	const raw = rows[0]?.value;
	const secret = typeof raw === 'string' ? raw.trim() : '';

	// present-but-empty is treated as absent. an empty signing key would make every
	// cookie signature forgeable by anyone who knows the value is empty, which is
	// everyone reading this repo.
	if (!secret) {
		return {
			ok: false,
			cause: notConfiguredMessage(
				rows.length === 0
					? `no \`${SIGNING_KEY_ID}\` row exists`
					: `the \`${SIGNING_KEY_ID}\` row is empty`
			)
		};
	}

	return { ok: true, secret, source: 'database' };
}

/**
 * written for whoever reads the deployment's logs — increasingly an agent, not a human at a
 * terminal — so it names the table, the reason, and the command that fixes it
 * (CLAUDE.md). no caller sends it: `SIGNING_KEY_UNREADABLE` is what they answer with.
 *
 * it names no migration filename, and that is the one editing rule here. a filename is
 * squash-mutable — the chain under `migrations/` has been squashed before — and a stale
 * one does worse than dangle: the index it named is now a different, real file,
 * so the message sends its reader somewhere confidently wrong. what it names instead are
 * the two ways migrations are applied (AGENTS.md → Schema): the migrate service for a
 * deployment, and `pnpm db:migrate` from a checkout. `CONTRIBUTING.md` → Troubleshooting is where
 * a local database the migrations never reached is diagnosed.
 */
function notConfiguredMessage(reason: string): string {
	return (
		`No session-cookie signing key is available: \`auth_signing_key\` could not be read because ${reason}. ` +
		`The row is minted by an idempotent migration, so the fix is almost always to apply ` +
		`migrations to this database: \`docker compose run --rm migrate\` for a deployment, or ` +
		`\`pnpm db:migrate\` from a checkout. ` +
		`As an override you can instead set \`BETTER_AUTH_SECRET\` in \`.env\`, which takes ` +
		`precedence over the row (see \`.env.example\`). ` +
		`On a checkout, see Troubleshooting in \`CONTRIBUTING.md\`: the usual local cause is a ` +
		`\`DATABASE_URL\` naming a different file from the one you migrated.`
	);
}

function describe(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
