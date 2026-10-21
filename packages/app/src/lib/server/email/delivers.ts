import { MAIL_SMTP_VARS, readConfigEnv, type ConfigEnv } from '../config/env';

// whether this deployment's mail values are a host that delivers.
//
// `readConfigEnv` in ../config/env.ts has already dropped a blank and trimmed the rest, so a
// missing name and an empty one are the same answer: not configured. the four placeholders are
// the literals `.env.example` ships, and no other `example.org`. `mail.example.org` is a host
// this app treats as real-shaped (./factory.spec.ts). the host and the from-address are compared
// case-insensitively; the username and the password are the literal `REPLACE_ME`.
//
// this is not what `createEmailProvider` in ./factory.ts refuses. those four literals are
// syntactically a host, a login, a password and a from-address, and a provider is still built
// for them. the settings card and the served form config are what ask this, because the `smtp`
// line in ../config/readiness.ts counts a placeholder as set.

const PLACEHOLDER_HOST = 'smtp.example.org';
const PLACEHOLDER_FROM = 'donations@example.org';
const PLACEHOLDER_CREDENTIAL = 'REPLACE_ME';

function sameAddress(value: string | undefined, literal: string): boolean {
	return value?.toLowerCase() === literal;
}

function placeholder(env: ConfigEnv): boolean {
	return (
		sameAddress(env.SMTP_HOST, PLACEHOLDER_HOST) ||
		env.SMTP_USERNAME === PLACEHOLDER_CREDENTIAL ||
		env.SMTP_PASSWORD === PLACEHOLDER_CREDENTIAL ||
		sameAddress(env.MAIL_FROM, PLACEHOLDER_FROM)
	);
}

/** true only when every `MAIL_SMTP_VARS` name is set and none of them is still a placeholder. */
export function mailDelivers(source: unknown): boolean {
	const env = readConfigEnv(source);
	if (MAIL_SMTP_VARS.some((name) => !env[name])) return false;
	return !placeholder(env);
}
