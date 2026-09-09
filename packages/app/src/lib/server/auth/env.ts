/**
 * the deploy-time variables the auth layer reads, and the one narrowing that gets
 * them out of the platform env.
 *
 * every field is optional because that is the truth at runtime: a fork can deploy
 * without setting any of them, and the whole point of `readStaffCredential` and
 * `createAuth` is to say so loudly instead of falling back to a default.
 */
export interface AuthEnv {
	/**
	 * session-cookie signing key. no default, ever — but nothing an operator chooses.
	 * it is machine-minted once into `auth_signing_key` by
	 * `migrations/0000_initial_schema.sql`; see `resolveAuthSecret` in ./signing-key.ts.
	 */
	readonly BETTER_AUTH_SECRET?: string;
	/**
	 * optional override, unset by default. when unset, the origin is derived from each
	 * request — which is what makes a deployment answer correctly on workers.dev and on
	 * a custom domain at the same time. set it only to pin one canonical origin and stop
	 * trusting the others. see the `baseURL` note in ./index.ts.
	 */
	readonly BETTER_AUTH_URL?: string;
	/** the v0 staff sign-in password. compared, never stored, never hashed. */
	readonly ADMIN_PASSWORD?: string;
}

/** the variable names this module reads, in the order they appear in .dev.vars.example. */
export const AUTH_VAR_NAMES = [
	'BETTER_AUTH_SECRET',
	'BETTER_AUTH_URL',
	'ADMIN_PASSWORD'
] as const satisfies readonly (keyof AuthEnv)[];

/**
 * platform env -> `AuthEnv`, by structural narrowing from `unknown`.
 *
 * this is not ceremony, and it is deliberately not `declare global { interface Env }`
 * or a cast. `wrangler types` folds the keys of **`.dev.vars`** into the generated
 * `Env` as required `string`s, and `.dev.vars` is gitignored — so `Env` has
 * `ADMIN_PASSWORD: string` on a machine that has a `.dev.vars` and no such property
 * at all in a fresh clone, or anywhere else with no `.dev.vars`. two consequences:
 *
 *   1. `env.ADMIN_PASSWORD` type-checks for one developer and is a compile error for
 *      the next one. reading through this function instead keeps `pnpm check` giving
 *      the same answer everywhere.
 *   2. the generated `string` is a lie in production anyway — a value nobody set on
 *      the deployment is `undefined` at runtime, whatever the type says.
 *      `AuthEnv` models that, so the missing-variable paths cannot be dropped as
 *      unreachable.
 *
 * a value that is present but not a string is treated as absent, which is the same
 * failure the caller already has to handle.
 */
export function readAuthEnv(source: unknown): AuthEnv {
	const bag: Record<string, unknown> =
		typeof source === 'object' && source !== null ? (source as Record<string, unknown>) : {};

	const env: { -readonly [K in keyof AuthEnv]: string } = {};
	for (const name of AUTH_VAR_NAMES) {
		const value = bag[name];
		if (typeof value === 'string') env[name] = value;
	}
	return env;
}
