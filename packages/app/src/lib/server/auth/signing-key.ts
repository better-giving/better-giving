import { eq } from 'drizzle-orm';
import type { Db } from '$lib/server/db/client';
import { authSigningKey } from '$lib/server/db/auth-schema';
import type { AuthEnv } from './env';

/**
 * where the session-cookie signing key comes from, and in what order.
 *
 * the point of this module is that a one-click deploy asks the operator for
 * `ADMIN_PASSWORD` and nothing else. the signing key is machine-minted by
 * `migrations/0000_initial_schema.sql` into `auth_signing_key`, so there is no second
 * value for a fork to generate, paste or lose.
 *
 * it is a row rather than a secret because of what it guards: cookie integrity only. it
 * is a tamper check over a session token whose authority is the `auth_session` row it
 * names, so anyone who can read it from D1 can already read the session tokens
 * themselves and gains nothing. that is what makes this the carve-out in CLAUDE.md's
 * "integration credentials are deploy-time secrets" rule rather than a breach of it —
 * `ADMIN_PASSWORD` and the Stripe keys grant capability outside the database, and this
 * does not. see the note above `authSigningKey` in `db/auth-schema.ts`.
 *
 * the ordering — env first — makes `BETTER_AUTH_SECRET` an emergency lever: setting or
 * changing it revokes every live session at once without touching the database.
 *
 * not derived from `ADMIN_PASSWORD`. deriving it (HKDF, or any single-pass KDF that
 * fits the 10 ms CPU cap) would make every signed session cookie an offline oracle for
 * the password: an attacker holding one cookie has a `(token, HMAC(key, token))` pair
 * and can test candidate passwords at two hash operations each. today `ADMIN_PASSWORD`
 * is only attackable online, which is the entire premise of ./credential.ts, and no
 * work factor can be added back inside 10 ms.
 */

/** the single row's primary key. the table's check constraint permits no other. */
const SIGNING_KEY_ID = 'default';

export type AuthSecretResolution =
	| { readonly ok: true; readonly secret: string; readonly source: 'env' | 'database' }
	| { readonly ok: false; readonly message: string };

/**
 * `BETTER_AUTH_SECRET` if set, else the `auth_signing_key` row, else a refusal that
 * names the fix.
 *
 * one D1 read, and only when the env override is absent. it is a read per request
 * because nothing built from a binding may be a module-scope singleton (CLAUDE.md) —
 * the row is immutable in practice, but caching it across requests would mean caching
 * it across deployments and databases too.
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
		return { ok: false, message: notConfiguredMessage(`the query failed (${describe(cause)})`) };
	}

	// `typeof` rather than trusting the declared type: the value crosses D1's serialization
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
			message: notConfiguredMessage(
				rows.length === 0
					? `no \`${SIGNING_KEY_ID}\` row exists`
					: `the \`${SIGNING_KEY_ID}\` row is empty`
			)
		};
	}

	return { ok: true, secret, source: 'database' };
}

/**
 * written for whoever reads the 5xx body — increasingly an agent, not a human at a
 * terminal — so it names the table, the reason, and the command that fixes it
 * (CLAUDE.md).
 *
 * it names no migration filename, and that is the one editing rule here. a filename is
 * squash-mutable — the chain under `migrations/` has been squashed before — and a stale
 * one does worse than dangle: the index it named is now a different, real file,
 * so the message sends its reader somewhere confidently wrong. what it names instead are
 * the two ways migrations are applied: the console's update press for a deployed database,
 * which applies them as it deploys, and the raw wrangler invocation for a local one, spelled
 * out of `wrangler.jsonc`'s own binding name and `migrations_dir`. `CONTRIBUTING.md` is where
 * the symptom ("every route 500s") is diagnosed.
 */
function notConfiguredMessage(reason: string): string {
	return (
		`No session-cookie signing key is available: \`auth_signing_key\` could not be read because ${reason}. ` +
		`The row is minted by an idempotent migration, so the fix is almost always to apply ` +
		`migrations to this database: the console (\`better-giving open\`) applies them to the ` +
		`deployed D1 when it updates this deployment, and ` +
		`\`pnpm wrangler d1 migrations apply DB --local\` applies them to a local one. ` +
		`As an override you can instead set the \`BETTER_AUTH_SECRET\` secret, which takes precedence ` +
		`over the row — see \`.dev.vars.example\`. ` +
		`If EVERY route is failing this way, see "Every route 500s" in \`CONTRIBUTING.md\`: the usual ` +
		`local cause is a changed \`database_id\` pointing \`--local\` at an empty database.`
	);
}

function describe(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
