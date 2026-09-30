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
	 *
	 * it settles two things outside auth, both through `pinnedOrigin` below: the address
	 * a QuickBooks connection is registered at and exchanged against, which Intuit
	 * compares byte for byte (../accounting/connect-link.ts), and the dashboard link in
	 * the mail a paused webhook destination sends from a cron run, which has no request
	 * to derive one from (../webhooks/paused-mail.ts).
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

/** what `BETTER_AUTH_URL` pins: an origin, null where it is unset, or why it names none. */
export type PinReading =
	| { readonly ok: true; readonly origin: string | null }
	| { readonly ok: false; readonly message: string };

/**
 * the one reading of the pin: every caller takes it, through `pinnedOrigin` or `publishedOrigin`
 * below where not directly.
 *
 * `.origin` and never the value as typed: an operator pastes the pin, and a trailing slash or a
 * path on it is not part of it. a pin that names no http(s) origin is refused, naming the value:
 * `localhost:8787` parses as a scheme called `localhost` whose `.origin` is the string "null", and
 * better-auth refuses such a `baseURL` itself — reading it off the Worker's `process.env` when it
 * is passed none — so no caller may read it as unset. the message marks names with backticks for
 * the screens that draw it (src/root.tsx, the console's QuickBooks section).
 */
export function readPin(env: AuthEnv): PinReading {
	const pinned = env.BETTER_AUTH_URL?.trim();
	if (!pinned) return { ok: true, origin: null };
	const url = URL.parse(pinned);
	if (url?.protocol !== 'https:' && url?.protocol !== 'http:') {
		return {
			ok: false,
			message:
				`\`BETTER_AUTH_URL\` is \`${pinned}\`, which names no http(s) origin. Set it to the ` +
				'address the deployment answers on, scheme included (`https://donate.example.org`), or ' +
				'unset it so the origin is read off each request (DEPLOY.md, .dev.vars.example).'
		};
	}
	return { ok: true, origin: url.origin };
}

/** `readPin`'s origin, throwing its message where the pin names none. */
export function pinnedOrigin(env: AuthEnv): string | null {
	const pin = readPin(env);
	if (!pin.ok) throw new Error(pin.message);
	return pin.origin;
}

/** the hosts a local dev server answers on, which keep the scheme they were asked at. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * the origin this deployment tells an integrator to call, for a request at `url`: the one
 * `BETTER_AUTH_URL` pins where `pin` (`readPin` above) names one, so an address read at another
 * host the deployment answers on — its workers.dev one, or behind a proxy that rewrites `Host` —
 * never bakes that host into an integrator's config. where none is pinned, or the pin names no
 * origin, the request's own. either is published as `https:` for every host but this machine, so
 * neither a page read over plain http nor an `http:` pin ever tells a reader to send a key over
 * it.
 */
export function publishedOrigin(url: URL, pin: PinReading): string {
	const origin = new URL(pin.ok && pin.origin !== null ? pin.origin : url.origin);
	return LOCAL_HOSTS.has(origin.hostname) ? origin.origin : `https://${origin.host}`;
}
