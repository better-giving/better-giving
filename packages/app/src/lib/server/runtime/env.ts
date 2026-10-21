import { type Altcha, createAltcha } from '../api/altcha.ts';
import type { RateLimiters } from './rate-limiter';

// `Env`: the configuration a request reads through `context.get(platform).env`, built once when the
// process starts.
//
// a closed list of names, read from `process.env` and nothing else. a name off the list never reaches
// a loader, whatever the process environment holds. the readers narrow these values further
// themselves — ../config/env.ts's `readConfigEnv` and ../auth/env.ts's `readAuthEnv` — so this
// module copies and does not judge.

/**
 * every name `Env` carries as a string. `.env.example` names each of them.
 */
export const ENV_VAR_NAMES = [
	'BETTER_AUTH_SECRET',
	'BETTER_AUTH_URL',
	'ADMIN_PASSWORD',
	'SMTP_HOST',
	'SMTP_PORT',
	'SMTP_USERNAME',
	'SMTP_PASSWORD',
	'MAIL_FROM',
	'TURNSTILE_SITE_KEY',
	'TURNSTILE_SECRET_KEY',
	'STRIPE_SECRET_KEY',
	'STRIPE_PUBLISHABLE_KEY',
	'STRIPE_WEBHOOK_SECRET',
	'PAYPAL_CLIENT_ID',
	'PAYPAL_CLIENT_SECRET',
	'PAYPAL_API_URL',
	'PAYPAL_WEBHOOK_ID',
	'PAYPAL_CHARITY_RATE_APPROVED',
	'CHARIOT_API_KEY',
	'CHARIOT_API_URL',
	'CHARIOT_CONNECT_ID',
	'CHARIOT_WEBHOOK_SECRET',
	'NOWPAYMENTS_API_KEY',
	'NOWPAYMENTS_IPN_SECRET',
	'NOWPAYMENTS_OUTCOME_CURRENCY',
	'QUICKBOOKS_CLIENT_ID',
	'QUICKBOOKS_CLIENT_SECRET',
	'QUICKBOOKS_API_URL',
	'NONPROFITS_API_KEY'
] as const;

export type EnvVarName = (typeof ENV_VAR_NAMES)[number];

/**
 * the names the server refuses to start without, each with what it is for. every other name is
 * optional: what it switches on is simply not offered while it is unset.
 */
export const REQUIRED_ENV_VARS = {
	ADMIN_PASSWORD: 'the deployer’s sign-in password for /admin',
	BETTER_AUTH_SECRET: 'the key that signs sign-in sessions'
} as const satisfies Partial<Record<EnvVarName, string>>;

/** one line per required name `source` leaves unset or blank, naming it and never a value. */
export function missingRequiredEnv(source: Readonly<Record<string, string | undefined>>): string[] {
	return Object.entries(REQUIRED_ENV_VARS)
		.filter(([name]) => (source[name]?.trim() ?? '') === '')
		.map(([name, purpose]) => `${name} is not set — it is ${purpose}.`);
}

declare global {
	/**
	 * the configuration, in-process limiters and ALTCHA issuer one request reads, built by
	 * `readEnv`.
	 */
	interface Env extends RateLimiters {
		/** the process's ALTCHA issuer and replay set (../api/altcha.ts). */
		readonly ALTCHA: Altcha;
		readonly BETTER_AUTH_SECRET?: string;
		readonly BETTER_AUTH_URL?: string;
		readonly ADMIN_PASSWORD?: string;
		readonly SMTP_HOST?: string;
		readonly SMTP_PORT?: string;
		readonly SMTP_USERNAME?: string;
		readonly SMTP_PASSWORD?: string;
		readonly MAIL_FROM?: string;
		readonly TURNSTILE_SITE_KEY?: string;
		readonly TURNSTILE_SECRET_KEY?: string;
		readonly STRIPE_SECRET_KEY?: string;
		readonly STRIPE_PUBLISHABLE_KEY?: string;
		readonly STRIPE_WEBHOOK_SECRET?: string;
		readonly PAYPAL_CLIENT_ID?: string;
		readonly PAYPAL_CLIENT_SECRET?: string;
		readonly PAYPAL_API_URL?: string;
		readonly PAYPAL_WEBHOOK_ID?: string;
		readonly PAYPAL_CHARITY_RATE_APPROVED?: string;
		readonly CHARIOT_API_KEY?: string;
		readonly CHARIOT_API_URL?: string;
		readonly CHARIOT_CONNECT_ID?: string;
		readonly CHARIOT_WEBHOOK_SECRET?: string;
		readonly NOWPAYMENTS_API_KEY?: string;
		readonly NOWPAYMENTS_IPN_SECRET?: string;
		readonly NOWPAYMENTS_OUTCOME_CURRENCY?: string;
		readonly QUICKBOOKS_CLIENT_ID?: string;
		readonly QUICKBOOKS_CLIENT_SECRET?: string;
		readonly QUICKBOOKS_API_URL?: string;
		readonly NONPROFITS_API_KEY?: string;
	}
}

/** `Env` from `source` — `process.env` in the server — and the process's limiters and issuer. */
export function readEnv(
	source: Readonly<Record<string, string | undefined>>,
	limiters: RateLimiters,
	altcha: Altcha = createAltcha()
): Env {
	const vars: { -readonly [Name in EnvVarName]?: string } = {};
	for (const name of ENV_VAR_NAMES) {
		const value = source[name];
		if (value !== undefined) vars[name] = value;
	}
	return { ...vars, ...limiters, ALTCHA: altcha };
}
