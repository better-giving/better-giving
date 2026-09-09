import { APIError } from 'better-auth/api';
import { asc, eq, ne } from 'drizzle-orm';
import type { Db } from '$lib/server/db/client';
import { authMemberInvitation, authUser } from '$lib/server/db/auth-schema';
import type { Auth } from './index';
import { isAddress, liveInvitations, normaliseEmail, revokeInvitation } from './invitations';
import { STAFF_USER_EMAIL, STAFF_USER_ID } from './staff-plugin';

// who can sign in besides the deployer, and the two things /admin/members does to that list.
//
// the deployer is not on it. their row is the fixed singleton at `STAFF_USER_ID`
// (./staff-plugin.ts) with no password in the database and no way to remove it, so it is not a
// member and it is not a row anybody manages — it is the deployment. showing it in a list beside
// rows with a remove button would invite exactly the press this module refuses.
//
// ./invitations.ts owns everything about becoming a member; this file owns the list, the way out,
// and the two ways a member's own password changes: `changeMemberPassword` for one who can sign in,
// and `requestPasswordReset` with `resetMemberPassword` for one who cannot. what the two modules
// share is what "live" means for an invitation and what an address is, both stated once, there.
//
// **nothing here sends mail and nothing here builds a link**, the same split ./invitations.ts's
// header states: `requestPasswordReset` hands the address and the token to the `send` the runtime
// carried, and the route that owns the press composes the address the mail carries.

/**
 * one line on /admin/members: a colleague who has accepted, or an invitation still outstanding.
 *
 * one type and one list rather than two, because the screen is one list — an invitation is a
 * person who is on their way in, and splitting them into two tables makes an operator read both to
 * answer "is Priya on here". `invited` is what the row is drawn differently by, and it is also what
 * `id` means: an `auth_user` id when it is false and an `auth_member_invitation` id when it is
 * true, which is the only thing `removeMember` needs to be told.
 *
 * `name` is null on an invitation because nobody has typed one yet — the name comes from the
 * redeem form, and inventing one from the address would put a guess on the screen next to real
 * ones.
 */
export interface MemberRow {
	readonly id: string;
	readonly email: string;
	readonly name: string | null;
	readonly invited: boolean;
}

/**
 * every colleague who can sign in, and every invitation that would still be accepted.
 *
 * one `batch()` for the two reads, so the screen costs one round trip rather than two. sorted in
 * memory rather than by the database: two selects cannot be ordered against each other in SQL
 * without a union, and the list is the handful of people who run one organisation's donations.
 *
 * an accepted invitation is not in the list and does not need to be — the `auth_user` row it
 * became is, at the same address.
 */
export async function listMembers(db: Db, now: Date): Promise<MemberRow[]> {
	const [members, invitations] = await db.batch([
		db
			.select({ id: authUser.id, email: authUser.email, name: authUser.name })
			.from(authUser)
			.where(ne(authUser.id, STAFF_USER_ID))
			.orderBy(asc(authUser.email)),
		db
			.select({ id: authMemberInvitation.id, email: authMemberInvitation.email })
			.from(authMemberInvitation)
			.where(liveInvitations(now))
			.orderBy(asc(authMemberInvitation.email))
	]);

	return [
		...members.map((row) => ({ ...row, invited: false })),
		...invitations.map((row) => ({ ...row, name: null, invited: true }))
	].sort((a, b) => a.email.localeCompare(b.email));
}

export type RemoveResult =
	| { readonly ok: true; readonly removed: 'member' | 'invitation' }
	/**
	 * `staff` — the deployer's row, which is the deployment rather than a member.
	 * `unknown` — no member and no live invitation under that id. a second press of the same
	 *   button is the ordinary way to reach it.
	 */
	| { readonly ok: false; readonly reason: 'staff' | 'unknown' };

/**
 * takes a colleague off the list, whether they had accepted or not.
 *
 * one id and two tables, tried in that order, because a `MemberRow` is one of two kinds and the
 * screen should not have to say which — the ids are uuidv7 from the same generator and no id is in
 * both tables.
 *
 * **removing a member ends their sessions immediately.** deleting the `auth_user` row cascades to
 * `auth_session` and `auth_account` (`db/auth-schema.ts`), and `session.cookieCache` is off
 * (./index.ts), so the next request they make resolves no session and the gate turns them away.
 * that is why the removal is a delete and not a flag: a flag would need every read path to
 * remember it.
 *
 * **the deployer is refused by name.** `STAFF_USER_ID` is a constant, so this is a comparison
 * rather than a query, and the row cannot be reached through the list either — `listMembers`
 * excludes it. both, because a route that took an id from a form is a route that can be posted an
 * id the list never showed.
 */
export async function removeMember(
	db: Db,
	input: { readonly id: string; readonly now: Date }
): Promise<RemoveResult> {
	if (input.id === STAFF_USER_ID) return { ok: false, reason: 'staff' };

	const deleted = await db
		.delete(authUser)
		.where(eq(authUser.id, input.id))
		.returning({ id: authUser.id });
	if (deleted.length > 0) return { ok: true, removed: 'member' };

	const revoked = await revokeInvitation(db, { id: input.id, now: input.now });
	return revoked ? { ok: true, removed: 'invitation' } : { ok: false, reason: 'unknown' };
}

export type MemberSignIn =
	| { readonly ok: true; readonly cookies: readonly string[] }
	/**
	 * `credential` — the address, the password, or both. one answer, always.
	 * `unavailable` — the auth layer refused for a reason about this deployment. already logged;
	 *   the login route says what it says about every other failure of its own.
	 */
	| { readonly ok: false; readonly reason: 'credential' | 'unavailable' };

/**
 * signs a member in. the deployer's password goes nowhere near this — that is `signInStaff`.
 *
 * **an unknown address and a wrong password are the same refusal**, which is better-auth's own
 * behaviour and is kept rather than unpacked: telling them apart would turn this form into a way
 * to ask whether a given person works here, on a deployment whose donation page names the
 * organisation.
 *
 * **it charges nothing.** the sign-in bucket is charged by the action that owns the press, on
 * `signInRateLimitKey` — one key for every way in, which is the whole point of that key not
 * moving with the path (../api/rate-limit.ts). a charge here would be a second one on the same
 * press.
 */
export async function signInMember(
	auth: Auth,
	input: {
		readonly email: string;
		readonly password: string;
		readonly headers: Headers;
	}
): Promise<MemberSignIn> {
	try {
		const { headers } = await auth.api.signInEmail({
			body: { email: input.email, password: input.password },
			headers: input.headers,
			returnHeaders: true
		});
		return { ok: true, cookies: headers.getSetCookie() };
	} catch (e) {
		// 401 is every wrong credential better-auth knows about — no such user, no credential
		// account, no password on it, wrong password — and it answers all four identically.
		if (e instanceof APIError && e.statusCode === 401) return { ok: false, reason: 'credential' };
		// a value that is not an address at all joins them rather than reading as a broken
		// deployment. better-auth refuses it 400 before any lookup, and the person at the form
		// typed it: a mistyped username is what lands here, since one box takes both and only the
		// exact deployer's identifier is routed to `signInStaff` before this is called
		// (`src/routes/login.tsx`).
		if (e instanceof APIError && e.body?.code === 'INVALID_EMAIL') {
			return { ok: false, reason: 'credential' };
		}
		if (e instanceof APIError) {
			console.error('member sign-in failed:', e.statusCode, e.body?.code, e.body?.message);
			return { ok: false, reason: 'unavailable' };
		}
		// not an APIError: the auth layer threw before it could shape a response. a database with
		// no `auth_account` table is what a fresh fork hits here.
		console.error('member sign-in failed before the auth layer could respond:', e);
		return { ok: false, reason: 'unavailable' };
	}
}

export type ResetRequest =
	| { readonly ok: true }
	/**
	 * `unavailable` — the auth layer refused for a reason about this deployment, or the instance
	 *   was built without a way to send. already logged; the sign-in page says what it says about
	 *   every other failure of its own. it is the only answer that is not `ok`.
	 */
	| { readonly ok: false; readonly reason: 'unavailable' };

/**
 * takes a request for a reset link and, where there is somebody to send one to, has it sent.
 *
 * **an address nobody here has is answered exactly as a member's is.** better-auth answers the two
 * identically and pads the unknown arm's timing itself, and the send is deferred rather than
 * awaited (`passwordReset.background` — ./index.ts) so the two take the same time as well. telling
 * them apart would turn this form into a way to ask whether a given person works here, on a
 * deployment whose donation page names the organisation.
 *
 * **the deployer's identifier is refused by name, before better-auth is asked, and answered `ok`
 * like everything else.** `auth.api.resetPassword` writes a `credential` account for a user that
 * has none, so a token minted against the fixed staff row would hand that identity the password
 * hash ./credential.ts says this deployment never stores — and the row is one an operator cannot
 * remove. the refusal here is what makes that unreachable; a value that is not an address at all
 * joins it, because the deployer's identifier is a username and would fail that test anyway.
 *
 * **it charges nothing.** the sign-in bucket is charged by the route that owns the press, on
 * `signInRateLimitKey` — one key for every way in (CLAUDE.md, ../api/rate-limit.ts) — for the
 * reason `signInMember` above charges nothing.
 */
export async function requestPasswordReset(
	auth: Auth,
	input: { readonly email: string }
): Promise<ResetRequest> {
	const email = normaliseEmail(input.email);
	if (email === normaliseEmail(STAFF_USER_EMAIL)) return { ok: true };
	if (!isAddress(email)) return { ok: true };

	try {
		await auth.api.requestPasswordReset({ body: { email } });
		return { ok: true };
	} catch (e) {
		if (e instanceof APIError) {
			if (e.body?.code === 'RESET_PASSWORD_DISABLED') {
				// the runtime carried no `passwordReset`, so `sendResetPassword` is unset and
				// better-auth refuses before it looks anything up. a route asked for a reset on an
				// instance it never gave a way to send — a wiring mistake, not anything the person
				// at the form did, and the log is where it is visible.
				console.error('a password reset was requested of an auth instance that cannot send.');
				return { ok: false, reason: 'unavailable' };
			}
			console.error(
				'a password reset request failed:',
				e.statusCode,
				e.body?.code,
				e.body?.message
			);
			return { ok: false, reason: 'unavailable' };
		}
		// not an APIError: the auth layer threw before it could shape a response. a database with no
		// `auth_verification` table is what a fork that skipped a migration hits here.
		console.error('a password reset request failed before the auth layer could respond:', e);
		return { ok: false, reason: 'unavailable' };
	}
}

export type PasswordReset =
	| { readonly ok: true }
	/**
	 * `link` — expired, already used, or never minted. one outcome on purpose, for
	 *   `redeemInvitation`'s reason.
	 * `password` — the new one is shorter or longer than better-auth will accept
	 *   (`MEMBER_PASSWORD_MIN_LENGTH`), and the link still works, so the screen can ask again.
	 * `unavailable` — the auth layer refused for a reason about this deployment. already logged.
	 */
	| { readonly ok: false; readonly reason: 'link' | 'password' | 'unavailable' };

/**
 * turns a token from a mailed link and a new password into a password the member can sign in with.
 *
 * **no session is minted.** the member signs in with what they just chose, and every session the
 * account held is gone before they do — `revokeSessionsOnPasswordReset` (./index.ts), which is why
 * there are no cookies on the success arm the way there are on `changeMemberPassword`'s. somebody
 * who has just proved they hold the mailbox should not leave a browser signed in that they no
 * longer control, and that includes the case this flow exists for: an account somebody else got
 * into.
 *
 * **expired, already used and never minted are one answer.** they are distinguished in better-auth's
 * own log line and nowhere else: an answer that told them apart would tell somebody feeding tokens
 * at this endpoint which of theirs had ever been real, and a member holding a dead link does the
 * same thing in all three cases — asks for another.
 *
 * **a short password leaves the link working.** better-auth measures the length before it consumes
 * the row, so the `password` arm is one the screen can put the member straight back into the form
 * for.
 */
export async function resetMemberPassword(
	auth: Auth,
	input: { readonly token: string; readonly newPassword: string }
): Promise<PasswordReset> {
	try {
		await auth.api.resetPassword({
			body: { token: input.token, newPassword: input.newPassword }
		});
		return { ok: true };
	} catch (e) {
		if (e instanceof APIError) {
			const code = e.body?.code;
			if (code === 'INVALID_TOKEN') return { ok: false, reason: 'link' };
			if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') {
				return { ok: false, reason: 'password' };
			}
			console.error('a password reset failed:', e.statusCode, code, e.body?.message);
			return { ok: false, reason: 'unavailable' };
		}
		// not an APIError: the auth layer threw before it could shape a response. a database with no
		// `auth_verification` table is what a fork that skipped a migration hits here.
		console.error('a password reset failed before the auth layer could respond:', e);
		return { ok: false, reason: 'unavailable' };
	}
}

export type PasswordChange =
	| {
			readonly ok: true;
			/** the `set-cookie` values the route appends, exactly as `signInMember`'s caller does. */
			readonly cookies: readonly string[];
	  }
	/**
	 * `current` — the current password is wrong. the only one of the four that is about a box on
	 *   the form rather than the other box or the account.
	 * `password` — the new one is shorter or longer than better-auth will accept
	 *   (`MEMBER_PASSWORD_MIN_LENGTH`), which is `redeemInvitation`'s `password` by the same two
	 *   codes.
	 * `deployer` — the staff session reached this. their password is a deploy-time secret with no
	 *   `auth_account` row behind it (./credential.ts), so there is nothing here to change and the
	 *   console is where it is changed.
	 * `unavailable` — the auth layer refused for a reason about this deployment. already logged;
	 *   the screen says what it says about every other failure of its own.
	 */
	| { readonly ok: false; readonly reason: 'current' | 'password' | 'deployer' | 'unavailable' };

/**
 * a signed-in member chooses a new password for themselves.
 *
 * the session in `headers` is who it is for — no address and no id is passed, so this cannot be
 * pointed at anybody else's account, and a caller holding a form body has no way to make it one.
 *
 * **every other session ends.** somebody changing their password wants the other browser signed
 * out, so `revokeOtherSessions` is on — and better-auth's own way of doing that deletes every
 * session the member held, the one that made this request included, then mints a replacement. that
 * is why `cookies` comes back on the success arm and why dropping it is not a saving: a route that
 * did not append it would sign the member out of the browser they are looking at.
 *
 * **a wrong current password is bounded, and by the sign-in bucket rather than one of this
 * screen's own.** the charge is the route that owns the press —
 * `src/routes/_app.admin.members_.password.tsx`, before it reads the body — and it is that bucket
 * because `signInRateLimitKey` has one payer per deployment and never moves with the path
 * (CLAUDE.md, ../api/rate-limit.ts): a guess at a member's credential is a guess whichever form
 * carries it, and a bucket of this screen's own would hand whoever holds a stolen session a fresh
 * budget beside the one the login already bounds. nothing is charged here, for the reason
 * `signInMember` above charges nothing — a charge in this module would be a second one on the same
 * press.
 */
export async function changeMemberPassword(
	auth: Auth,
	input: {
		readonly currentPassword: string;
		readonly newPassword: string;
		readonly headers: Headers;
	}
): Promise<PasswordChange> {
	try {
		const { headers } = await auth.api.changePassword({
			body: {
				currentPassword: input.currentPassword,
				newPassword: input.newPassword,
				revokeOtherSessions: true
			},
			headers: input.headers,
			returnHeaders: true
		});
		return { ok: true, cookies: headers.getSetCookie() };
	} catch (e) {
		if (e instanceof APIError) {
			const code = e.body?.code;
			if (code === 'INVALID_PASSWORD') return { ok: false, reason: 'current' };
			if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') {
				return { ok: false, reason: 'password' };
			}
			// better-auth looks for a `credential` account on the session's user and finds none for
			// the deployer, whatever was typed in the current-password box.
			if (code === 'CREDENTIAL_ACCOUNT_NOT_FOUND') return { ok: false, reason: 'deployer' };
			// a session-less call lands here as a 401, which is the gate above this screen having
			// been bypassed rather than anything the person at the form did.
			console.error('a member password change failed:', e.statusCode, code, e.body?.message);
			return { ok: false, reason: 'unavailable' };
		}
		// not an APIError: the auth layer threw before it could shape a response. a database with no
		// `auth_account` table is what a fresh fork hits here.
		console.error('a member password change failed before the auth layer could respond:', e);
		return { ok: false, reason: 'unavailable' };
	}
}
