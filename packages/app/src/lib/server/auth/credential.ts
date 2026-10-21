import { readAdminPassword } from '@better-giving/operator/admin-password';
import { RECREATE_APP } from '@better-giving/operator/deploy-split';
import { secretEquals } from '../secret-compare';
import type { AuthEnv } from './env';

/**
 * the v0 staff credential: one deploy-time var, compared in constant time.
 *
 * no password hash is ever written, no KDF ever runs, and no row stores a
 * credential: the value is a line in `.env`, compared as it stands. a seeded default
 * credential is out too. a migration is SQL and cannot compute a hash, so shipping one
 * would mean a literal hash committed to a public repo, byte-identical in every fork.
 *
 * rotation is therefore a new `ADMIN_PASSWORD` line in `.env`, which takes effect when the app
 * is recreated.
 *
 * for this credential there is deliberately no in-app change-password and no reset
 * flow, and a working mailer is not what decides that. a member has both — mail is
 * required and every deployment can send, and `requestPasswordReset` in ./members.ts
 * refuses this identifier by name before the auth layer is asked. the absence here
 * rests on three reasons, none of which is the transport:
 *
 *   - there is nothing to reset against. the credential is a deploy-time var, not a
 *     row. a reset flow writes a new value somewhere, and the only somewhere is the database —
 *     which is the stored password hash this module never writes.
 *   - there is no account to identify. one credential, no username (see below), and the
 *     one staff row is a fixed constant — so a reset link would be addressed to whatever
 *     mailbox happened to be typed, which is an unauthenticated way to mint a session.
 *   - and the mailbox it would use is an operator-editable settings row.
 *     `org_profile.notification_email` is changed from /admin, behind this very
 *     credential, so a reset flow pointed at it would turn one session into permanent
 *     access rather than a recovery path.
 *
 * the recovery mechanism is the operator, with a terminal. that is written down in
 * DEPLOY.md as a property of the design rather than a gap.
 *
 * revoking live sessions is a separate lever: rotating `BETTER_AUTH_SECRET`
 * invalidates every session cookie, because it is the key they are signed with. it
 * does not delete the `auth_session` rows, which stay as orphans until they expire.
 * rotating `ADMIN_PASSWORD` alone revokes nothing, since no session row is derived
 * from it.
 *
 * there is no username, and adding one back is a regression. an `ADMIN_EMAIL` var
 * compared alongside the password needs a careful both-sides-then-and compare to avoid
 * the username oracle that creates, and it is no secret anyway: an attacker aiming at a
 * named nonprofit's donation page guesses the org's contact address in a handful of
 * tries, so it contributes no real entropy while costing a deploy variable and a support
 * burden ("which address did I set?"). one field is the honest shape, and it leaves
 * nothing to enumerate. the identity the session is minted against is a fixed constant —
 * see ./staff-plugin.ts.
 *
 * what a usable value looks like is not decided here. the length minimum and the sentence
 * about a value under it are `@better-giving/operator/admin-password`'s, because the value is
 * typed into `.env` and there is no save on this deployment for a rule stated only here to be
 * applied at. this module stays what the sign-in path asks: it reads the value the app was
 * started with, through that reader, and decides what matching means.
 */

/** the configured staff credential. only ever held in memory, for one request. */
export interface StaffCredential {
	readonly password: string;
}

/** a sign-in attempt off the wire. */
export interface StaffAttempt {
	readonly password: string;
}

export type StaffCredentialConfig =
	| { readonly ok: true; readonly credential: StaffCredential }
	| { readonly ok: false; readonly message: string };

/**
 * `ADMIN_PASSWORD`, or a message naming what is wrong and how to fix it.
 *
 * missing and empty are both hard failures. there is no fallback value and no
 * "empty means empty" match: `''` would otherwise authenticate anyone who posts an
 * empty password, which is exactly the state a fork lands in if it deploys without
 * ever setting it. which values are refused, and the sentence saying what is wrong with it
 * (its `typeof`, or the minimum a value falls short of — never the value's own length), come
 * from the shared reader; what this function adds is the variable's name, where it is set, and
 * the closing period the reader's sentence sometimes leaves off.
 *
 * the message is written for whoever is reading the 4xx/5xx body — increasingly an
 * agent, not a human at a terminal — per CLAUDE.md.
 *
 * where it names is the `.env` line, and the recreate that makes it take effect.
 */
export function readStaffCredential(env: AuthEnv): StaffCredentialConfig {
	// `AuthEnv` types this `string | undefined`, and the reader takes `unknown` for exactly the
	// case that type is wrong about: a caller that builds one by hand with a cast.
	const reading = readAdminPassword(env.ADMIN_PASSWORD);

	if (!reading.ok) {
		const problem = reading.problem.endsWith('.') ? reading.problem : `${reading.problem}.`;
		return {
			ok: false,
			message:
				`Staff sign-in is refused because this deployment is misconfigured: ${problem} ` +
				'ADMIN_PASSWORD is a deploy-time var, not a settings row. Set `ADMIN_PASSWORD` in ' +
				`\`.env\`, then recreate the app: \`${RECREATE_APP}\`. There is no default credential, ` +
				`an empty password never matches, and no password is stored anywhere in the database.`
		};
	}

	return { ok: true, credential: { password: reading.password } };
}

/**
 * does an attempt match the configured credential?
 *
 * one comparison, because there is one credential — so the short-circuit hazard two compares
 * carry is unrepresentable here rather than merely avoided. it stays a named function
 * rather than an inline `secretEquals` at the call site so this file remains the only
 * place that decides what matching means.
 */
export function staffCredentialMatches(
	credential: StaffCredential,
	attempt: StaffAttempt
): boolean {
	return secretEquals(attempt.password, credential.password);
}
