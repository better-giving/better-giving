import type { SmtpFields } from '../email/smtp-config';

/**
 * the deploy-time variables the readiness check reads, and the one narrowing that gets
 * them out of the platform env.
 *
 * every field is optional for the same reason `AuthEnv`'s are — see the long note on
 * `readAuthEnv` in `../auth/env.ts`, which this module deliberately mirrors rather than
 * restates. the short version: `worker-configuration.d.ts` is generated from whatever
 * `.dev.vars` happens to exist on the machine that ran `wrangler types`, and that file is
 * gitignored, so `Env` types these as required `string`s on one developer's machine and
 * omits them entirely on a fresh clone. a reader whose whole job is telling a set value from an
 * unset one cannot be built on a type that claims nothing ever is.
 */
export interface ConfigEnv {
	/** Stripe's secret API key, from the org's own Stripe account. */
	readonly STRIPE_SECRET_KEY?: string;
	/**
	 * the matching publishable key, which is what the donation form is handed.
	 *
	 * not a credential: it is designed to sit in public HTML, and `/api/v1/forms/:id/config`
	 * serves it to any browser that asks. so an operator sets it as a Worker var and can read
	 * it back, where the secret key beside it is a secret and cannot be — DEPLOY.md draws that
	 * split for all thirteen. either arrives here as a string on the platform env, which is why
	 * nothing below this line distinguishes them.
	 */
	readonly STRIPE_PUBLISHABLE_KEY?: string;
	/** the signing secret of the org's own webhook endpoint. */
	readonly STRIPE_WEBHOOK_SECRET?: string;
	/** the mail host's submission hostname, e.g. `smtp.resend.com`. */
	readonly SMTP_HOST?: string;
	/**
	 * optional, and 465 is the only value it may take. absent means 465, which is why it is the
	 * one mail variable an operator never has to set — see `parseSmtpEndpoint` for why every
	 * other port, 587 included, is refused rather than dialled.
	 */
	readonly SMTP_PORT?: string;
	/** the SMTP account's username. for a vendor reached over SMTP, whatever it calls its login. */
	readonly SMTP_USERNAME?: string;
	/**
	 * the SMTP account's password — for a vendor, its API key.
	 *
	 * a field of its own rather than half of a URL, and that is what makes it safe to paste: no
	 * percent-encoding, no decoding, no character that has to be escaped. see
	 * `../email/smtp-config.ts` for why a combined connection URL cannot offer that.
	 */
	readonly SMTP_PASSWORD?: string;
	/**
	 * the donor-facing From address.
	 *
	 * deploy-time and not a settings row, even though it is not itself a credential:
	 * the address is authorised by the same third party that issued the SMTP password — SPF and
	 * DKIM are configured on the domain, with that provider — so an address an operator could
	 * change in /admin independently of the credential is an address that silently stops
	 * delivering. it is also not `org_profile.notification_email`, which is where operational
	 * mail arrives and is documented as never donor-facing.
	 */
	readonly MAIL_FROM?: string;
	/** the Turnstile widget's public sitekey, rendered into the donation form. */
	readonly TURNSTILE_SITE_KEY?: string;
	/** the Turnstile secret used server-side to verify a token. */
	readonly TURNSTILE_SECRET_KEY?: string;
}

/**
 * what sending mail cannot work without. `SMTP_PORT` is deliberately absent: it is optional
 * and defaults to 465, so demanding it would invent a setup step.
 *
 * there is no transport to choose, and that is why this is a flat list — do not add a
 * variable that selects one. every mail provider worth naming exposes SMTP submission with its
 * API credential as the password — Resend, SES, Mailgun, SendGrid and a self-hosted Postfix are
 * one code path — so such a setting has exactly one real value and one meaning "send nothing",
 * which is a deployment that silently sends no receipts while every screen calls it set up.
 * unconfigured mail is a hole, not a setting. a vendor arm would be a second delivery
 * implementation carrying a vendor SDK, which CLAUDE.md's boundary rules out anyway.
 *
 * shared by every reader of these variables and re-listed by none — a fifth required variable
 * added to one hand-written copy is a variable one of them reports and the other ignores.
 */
export const MAIL_SMTP_VARS = [
	'SMTP_HOST',
	'SMTP_USERNAME',
	'SMTP_PASSWORD',
	'MAIL_FROM'
] as const satisfies readonly (keyof ConfigEnv)[];

/**
 * the `SMTP_*` variables under the names the parser uses.
 *
 * the mapping lives here, once. a variable renamed on one side of a hand-written object literal
 * in two files is two readers disagreeing about which value is missing.
 */
export function smtpFields(env: ConfigEnv): SmtpFields {
	return {
		host: env.SMTP_HOST,
		port: env.SMTP_PORT,
		username: env.SMTP_USERNAME,
		password: env.SMTP_PASSWORD
	};
}

/**
 * the variable names this module reads, in the order they appear in .dev.vars.example.
 *
 * a closed list, and that is what keeps the console's session token out of every surface built on
 * `ConfigEnv`: `CONSOLE_TOKEN` is deliberately not here, so `readConfigEnv` below never copies it
 * out of the platform env and no reader of `ConfigEnv` can report it. adding it would make a
 * credential the console holds into a value the deployment prints back — see the header on
 * ../console/access.ts for why reporting it would be worse than useless anyway.
 */
export const CONFIG_VAR_NAMES = [
	'SMTP_HOST',
	'SMTP_PORT',
	'SMTP_USERNAME',
	'SMTP_PASSWORD',
	'MAIL_FROM',
	'TURNSTILE_SITE_KEY',
	'TURNSTILE_SECRET_KEY',
	'STRIPE_SECRET_KEY',
	'STRIPE_PUBLISHABLE_KEY',
	'STRIPE_WEBHOOK_SECRET'
] as const satisfies readonly (keyof ConfigEnv)[];

/**
 * platform env -> `ConfigEnv`, by structural narrowing from `unknown`.
 *
 * a value that is present but not a string is dropped rather than coerced. a binding is
 * not a string however `wrangler types` declares it, and `String(someBinding)` would
 * turn one into a plausible-looking configured value — which is the one thing an honest reader
 * may not do. absent is the truthful answer, and it is the state every caller already handles.
 *
 * a blank value is also absent, and the kept value is trimmed. `''` and `'   '` are both
 * truthy-adjacent enough to sail through a presence check — `'   '` literally is truthy —
 * and a trailing newline off a paste is the most common thing an operator does wrong. left
 * alone, one invisible character turns an unset value into a set one for every reader of these
 * names. it also collapses `''` and unset onto one answer, which they already meant.
 *
 * this is where this function diverges from `readAuthEnv`, deliberately, and the
 * asymmetry is not a bug to tidy up. `readAuthEnv` feeds `readStaffCredential`, which
 * compares its value against what someone typed — trimming there would silently change
 * the credential and accept a password nobody set, which is why that module says in as
 * many words that whitespace is part of a secret. nothing here is ever compared: these
 * values are read for presence and shape, and the two that leave the app leave it as
 * themselves.
 *
 * `SMTP_PASSWORD` is trimmed too, which is a real trade and not an oversight — it is the
 * one field here that is a credential, offered verbatim to an SMTP AUTH exchange. so a
 * password whose true value has leading or trailing whitespace cannot be configured
 * through this app. that is the cheaper half of the trade by a wide margin: no provider
 * mints a credential with surrounding whitespace (Resend, SES, Mailgun and SendGrid keys
 * are all URL-safe token alphabets), while a trailing newline off a paste or off a
 * `.deploy.vars` line is the single most common thing an operator does wrong — and
 * untrimmed it produces `535 authentication failed` against a credential that is
 * correct, which is the least debuggable failure this app can hand anyone. if a host
 * ever legitimately needs a padded password, the fix is a carve-out here with a test,
 * not a quiet removal of the trim for every variable.
 */
export function readConfigEnv(source: unknown): ConfigEnv {
	const bag: Record<string, unknown> =
		typeof source === 'object' && source !== null ? (source as Record<string, unknown>) : {};

	const env: { -readonly [K in keyof ConfigEnv]: string } = {};
	for (const name of CONFIG_VAR_NAMES) {
		const value = bag[name];
		if (typeof value !== 'string') continue;
		const trimmed = value.trim();
		if (trimmed !== '') env[name] = trimmed;
	}
	return env;
}
