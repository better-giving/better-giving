import { secretEquals } from '../secret-compare';
import { CONSOLE_TOKEN_MIN_RANDOM, parseConsoleToken } from '@better-giving/operator/console/token';

// the whole of the check that stands in front of the console surface: env narrowing, the format,
// the expiry, the compare, and the sentence each refusal answers with.
//
// what the check proves, stated honestly. not that the caller has Cloudflare account access right
// now — nothing proves that without calling Cloudflare — but **possession of a value only an
// account holder could have written, bounded in time**. two structural facts make that narrower
// than it reads: a Worker secret cannot be read back, so the value can only have been presented by
// whoever set it; and everything this surface can do is a strict subset of what somebody who can
// write a secret on this Worker can already do directly, which includes running arbitrary SQL
// against the production database and deploying new code. that is also why there is no password
// prompt here: `ADMIN_PASSWORD` is not a boundary against a caller who can already rewrite it, and
// asking for it would put a second credential in the console for nothing.
//
// the credential rides in `Authorization: Bearer` and never in a query parameter. a URL reaches
// observability logs, referrers and browser history; that header does not, and proxies commonly
// redact it.
//
// **it never reads the request body, and it must not start.** CLAUDE.md's rule is that the body is
// read exactly once, by the endpoint that owns it — which is why the Stripe webhook's signature
// still verifies. this check runs as the `middleware` on `src/routes/console.ts` (./gate.ts),
// above every route on the surface, so a signature over the body would mean that middleware
// reading bytes an endpoint has yet to parse. a bearer header keeps it body-blind, and that is the
// reason it is a header rather than a signature.
//
// it reads `platform.env` and one header, and touches no binding and no row — which is what the
// absent rate limiter on this surface rests on. see ./surface.ts, where that is written down.
//
// **`CONSOLE_TOKEN` is a secret and never a var**, for three independent reasons: a deployed var's
// value is readable back through the script-settings API and prints in `wrangler versions view`
// and in the dashboard, so a var token is recoverable by read-only account access and lands in
// screenshots; a secret survives `wrangler deploy` unconditionally where a var depends on
// `keep_vars: true` in packages/app/wrangler.jsonc, and this check must not be coupled to that
// flag; and only the console may ever hold this value.
//
// **the local-development exception, stated rather than left to be found.** against `wrangler dev`
// the token arrives from `.dev.vars`, which puts it on disk — the one place in this design a
// session credential is written to a file. it is scoped to a developer's own machine: `.dev.vars`
// is gitignored, no command uploads it (see `.dev.vars.example`), and a deployment reads its own
// secret and never that file. on a deployment there is no equivalent, because a Worker secret
// cannot be read back at all.
//
// every refusal is 401 and every one of them is about this deployment rather than about the
// caller: not one sentence here quotes a value off the wire, because the only value on the wire is
// a credential. the reasons are told apart on purpose (`no_session` against `session_mismatch`
// above all): someone who learns a session exists has gained nothing usable against 256 bits, and
// an operator debugging a connect has no other way to tell "the secret never arrived" from "the
// value is wrong".

/** what a caller proved, and the one fact about it worth carrying onward. */
export interface ConsoleSession {
	/**
	 * when this session stops being one, read out of the token itself.
	 *
	 * it rides in the response envelope so the console can warn before the session dies rather
	 * than discovering it on the next request. it is the only adjacent fact carried: the token is
	 * never a line of the setup report, because a line for it would be the one row that is always
	 * green — if the check had failed there would be no report — which teaches an operator to stop
	 * reading the column.
	 */
	readonly expiresAt: Date;
}

/**
 * why a request was refused, as the wire carries it.
 *
 * the vocabulary a machine reads is `error`; `message` and `fix` are for whoever is looking at the
 * body, which per CLAUDE.md is increasingly an agent rather than a person at a console — so each
 * one names the offending value and the command that changes it. the same three-member shape the
 * public api's refusals use, and for the same reason.
 */
export const CONSOLE_REFUSALS = [
	'no_bearer',
	'empty_bearer',
	'no_session',
	'session_not_a_string',
	'session_blank',
	'session_malformed',
	'session_too_weak',
	'session_expiry_unreadable',
	'session_expired',
	'session_mismatch'
] as const;
export type ConsoleRefusalCode = (typeof CONSOLE_REFUSALS)[number];

export interface ConsoleRefusal {
	readonly status: 401;
	readonly error: ConsoleRefusalCode;
	readonly message: string;
	readonly fix: string;
}

export type ConsoleAccess =
	| { readonly ok: true; readonly session: ConsoleSession }
	| { readonly ok: false; readonly refusal: ConsoleRefusal };

/** the one command that connects a console, named in every refusal that has a repair. */
const CONNECT = 'Run `better-giving open` to connect a session to this deployment.';

/**
 * may this request read and write this deployment's singletons?
 *
 * `now` is an argument rather than a clock read inside, so the whole refusal table above is a
 * plain spec with no fake timers — and so that the one comparison this function makes against real
 * time is visible at the call site rather than buried.
 *
 * the *stored* value is what is parsed, never the presented one. the two have to be equal for a
 * caller to get through, so asking the format questions of the value this deployment holds is the
 * same question asked of a value nobody outside the account could have chosen — and it is what
 * keeps a hand-set `test` from ever becoming a credential, whoever presents it.
 */
export function consoleAccess(env: unknown, headers: Headers, now: Date): ConsoleAccess {
	const presented = bearerValue(headers);
	if (presented === null)
		return refuse(
			'no_bearer',
			'This request carries no `Authorization: Bearer <token>` header. This is the operator ' +
				'console surface of this deployment, not the public API at `/api/v1`, and it serves ' +
				'nothing anonymously.',
			`${CONNECT} It prints the token to send, and the token goes in that header — never in a ` +
				'query parameter, which would put it in observability logs and referrers.'
		);

	if (presented === '')
		return refuse(
			'empty_bearer',
			'The `Authorization: Bearer` header is here and its value is empty, which is what an ' +
				'unset variable interpolated into it looks like.',
			`${CONNECT} Send the token it prints as the bearer value.`
		);

	const stored = tokenSlot(env);
	if (stored.kind === 'absent')
		return refuse(
			'no_session',
			'No console session: `CONSOLE_TOKEN` is not set on this deployment.',
			`${CONNECT} Nothing else sets it, and no other credential opens this surface.`
		);

	if (stored.kind === 'not-a-string')
		return refuse(
			'session_not_a_string',
			`\`CONSOLE_TOKEN\` is set on this deployment but is not a string (it is a ${stored.typeName}), ` +
				'so there is nothing here to compare against.',
			CONNECT
		);

	if (stored.value.trim() === '')
		return refuse(
			'session_blank',
			'`CONSOLE_TOKEN` is set on this deployment but is blank, which is what a blank paste into ' +
				'a secret prompt leaves behind.',
			CONNECT
		);

	const parsed = parseConsoleToken(stored.value);
	if (!parsed.ok) {
		if (parsed.reason === 'malformed')
			return refuse(
				'session_malformed',
				'`CONSOLE_TOKEN` on this deployment is not a session token: it does not read as ' +
					'`bg1.<expiry>.<random>`.',
				`It is set by the console, not by hand. ${CONNECT}`
			);
		if (parsed.reason === 'random-too-short')
			return refuse(
				'session_too_weak',
				`\`CONSOLE_TOKEN\` on this deployment carries a random part shorter than ${CONSOLE_TOKEN_MIN_RANDOM} ` +
					'characters, so it is not a minted session token and is not treated as a credential.',
				`It is set by the console, not by hand. ${CONNECT}`
			);
		return refuse(
			'session_expiry_unreadable',
			'`CONSOLE_TOKEN` on this deployment carries an expiry that is not a count of seconds, so ' +
				`there is no telling whether the session is live. This deployment's clock reads ` +
				`${now.toISOString()}.`,
			`It is set by the console, not by hand. ${CONNECT}`
		);
	}

	// `<` and not `<=`: the last instant of a session is still inside it.
	if (parsed.token.expiresAt.getTime() < now.getTime())
		return refuse(
			'session_expired',
			`The console session on this deployment ended at ${parsed.token.expiresAt.toISOString()}, ` +
				`and this deployment's clock reads ${now.toISOString()}.`,
			`${CONNECT} If those two times disagree by more than the session was ever meant to last, ` +
				'the clock on the machine that minted the token is what to check: the expiry is written ' +
				'there and read here.'
		);

	if (!secretEquals(presented, stored.value))
		return refuse(
			'session_mismatch',
			'The token presented is not the console session this deployment holds.',
			'A newer console session replaces the previous one, so connecting a second console ' +
				'invalidates the first — which is how a session is revoked. If you have just connected, ' +
				'this deployment may not have picked up the new value yet; keep asking. Otherwise ' +
				`${CONNECT.slice(0, 1).toLowerCase()}${CONNECT.slice(1)}`
		);

	return { ok: true, session: { expiresAt: parsed.token.expiresAt } };
}

/**
 * the bearer value, or `null` when the header is absent or carries another scheme.
 *
 * the scheme is matched case-insensitively because HTTP says schemes are, and the character after
 * it has to be whitespace or nothing at all — so `Bearerish …` is another scheme rather than this
 * one with a long value.
 *
 * a scheme with nothing after it comes back as the empty string rather than as no header, and the
 * difference is not academic: a `Headers` value is trimmed on the way in, so a caller that sent an
 * unset variable as its token arrives here as the bare word `Bearer` — which is a caller with an
 * empty credential, not a caller with no header, and the two get different sentences.
 */
function bearerValue(headers: Headers): string | null {
	const header = headers.get('authorization');
	if (header === null) return null;
	const scheme = 'bearer';
	const trimmed = header.trim();
	if (trimmed.slice(0, scheme.length).toLowerCase() !== scheme) return null;
	const rest = trimmed.slice(scheme.length);
	if (rest !== '' && rest.trimStart() === rest) return null;
	return rest.trim();
}

type TokenSlot =
	| { readonly kind: 'absent' }
	| { readonly kind: 'not-a-string'; readonly typeName: string }
	| { readonly kind: 'value'; readonly value: string };

/**
 * `CONSOLE_TOKEN` off the platform env, narrowed from `unknown` and keeping the three states apart.
 *
 * from `unknown` rather than from the generated `Env`, for the reason `readConfigEnv` in
 * ../config/env.ts is: `worker-configuration.d.ts` is written by `wrangler types` from whatever
 * happened to be set on the machine that ran it, and it is gitignored — so a type that claims this
 * is a `string` is a claim about one developer's machine. an env that is not an object at all is
 * `absent`, which is the truthful answer for a request that never had a platform env.
 *
 * present-but-not-a-string is kept as its own state rather than folded into absent, because the
 * `typeof` is the whole finding: the slot is filled with something that is not a credential, which
 * is a different errand from filling an empty one. nothing here trims, for the reason
 * `readStaffCredential` does not: the value is compared against what a caller sent, so trimming
 * would change the credential.
 *
 * this is also why `CONSOLE_TOKEN` never appears in the setup report. `readConfigEnv` reads only
 * `CONFIG_VAR_NAMES`, and this name is deliberately not among them — so the token is excluded from
 * every value that surface prints, structurally rather than by a filter somebody has to maintain.
 */
function tokenSlot(env: unknown): TokenSlot {
	if (typeof env !== 'object' || env === null) return { kind: 'absent' };
	const raw = (env as Record<string, unknown>).CONSOLE_TOKEN;
	if (raw === undefined) return { kind: 'absent' };
	if (typeof raw !== 'string') return { kind: 'not-a-string', typeName: typeof raw };
	return { kind: 'value', value: raw };
}

function refuse(error: ConsoleRefusalCode, message: string, fix: string): ConsoleAccess {
	return { ok: false, refusal: { status: 401, error, message, fix } };
}
