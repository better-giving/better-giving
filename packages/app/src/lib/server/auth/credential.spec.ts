import { MIN_ADMIN_PASSWORD_LENGTH } from '@better-giving/operator/admin-password';
import { describe, expect, it } from 'vitest';
import { readStaffCredential, staffCredentialMatches } from './credential';

const GOOD_PASSWORD = 'correct-horse-battery';

describe('readStaffCredential', () => {
	it('accepts a configured password', () => {
		const result = readStaffCredential({ ADMIN_PASSWORD: GOOD_PASSWORD });
		expect(result).toEqual({ ok: true, credential: { password: GOOD_PASSWORD } });
	});

	it('does not trim the password, because whitespace is part of a secret', () => {
		const padded = ` ${GOOD_PASSWORD} `;
		const result = readStaffCredential({ ADMIN_PASSWORD: padded });
		expect(result).toEqual({ ok: true, credential: { password: padded } });
	});

	// the load-bearing case: a fork that deploys without ever setting ADMIN_PASSWORD.
	// this must never authenticate anyone, and the message has to say what to do.
	//
	// where is asserted, not just its presence: the console is the operator's whole interface, so a
	// message that handed back a raw `wrangler` command would be a second vocabulary for someone who
	// only knows the first.
	it('refuses when ADMIN_PASSWORD is absent, naming the variable and the fix', () => {
		const result = readStaffCredential({});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain('ADMIN_PASSWORD is not set');
		expect(result.message).toContain('better-giving open');
		expect(result.message).toContain('Dashboard password');
		expect(result.message).not.toContain('wrangler');
		expect(result.message).toContain('.dev.vars');
	});

	// a secret takes effect on its own, which DEPLOY.md states under Secrets and scripts/doctor.js
	// says in both of its own advice lines. telling an operator to redeploy here would send them
	// through `pnpm run deploy`, which drags its one-way `d1 migrations apply --remote` along with
	// it — a schema migration run for a password change.
	it('tells the operator the secret applies immediately, and never to redeploy', () => {
		const result = readStaffCredential({});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain('immediately');
		expect(result.message).not.toContain('redeploy');
	});

	it('refuses an empty ADMIN_PASSWORD rather than matching an empty attempt', () => {
		const result = readStaffCredential({ ADMIN_PASSWORD: '' });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain('ADMIN_PASSWORD is set but empty');
	});

	it('refuses an ADMIN_PASSWORD shorter than the minimum', () => {
		const result = readStaffCredential({
			ADMIN_PASSWORD: 'x'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 1)
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain(`at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`);
		// the shared sentence is the operator's words; which variable and where to set it is this
		// wrapper's own half, and it is the half an agent reading a 5xx body needs.
		expect(result.message).toContain('ADMIN_PASSWORD');
	});

	it('refuses a whitespace-only ADMIN_PASSWORD, naming that specifically', () => {
		// long enough to clear the length check, so it needs its own branch.
		const result = readStaffCredential({ ADMIN_PASSWORD: ' '.repeat(MIN_ADMIN_PASSWORD_LENGTH) });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain('something other than spaces');
	});

	/**
	 * a Worker binding is not a string, and `wrangler types` will still declare one as
	 * `string`. reading one must not become a credential.
	 *
	 * without the `typeof` guard in `readStaffCredential` the value would reach `.length`,
	 * where `undefined < 12` is false and a truthy non-string sails through as a credential
	 * nothing could ever match. the guard refuses it in a branch of its own, which is what
	 * lets the message say which type arrived.
	 */
	it('refuses a non-string ADMIN_PASSWORD, naming the type it got', () => {
		const result = readStaffCredential({ ADMIN_PASSWORD: 42 } as never);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain('ADMIN_PASSWORD is set but is not a string (it is a number)');
	});

	it('refuses an object ADMIN_PASSWORD without stringifying it', () => {
		const result = readStaffCredential({ ADMIN_PASSWORD: { toString: () => 'x' } } as never);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain('is not a string');
	});

	/**
	 * an identifier is no part of the credential, so a stray one left in a fork's
	 * `.dev.vars` must not become one by accident — and its absence must not be a reason to
	 * refuse.
	 */
	it('ignores any identifier left in the env', () => {
		const result = readStaffCredential({
			ADMIN_PASSWORD: GOOD_PASSWORD,
			ADMIN_EMAIL: 'staff@example.org'
		} as never);
		expect(result).toEqual({ ok: true, credential: { password: GOOD_PASSWORD } });
	});
});

describe('staffCredentialMatches', () => {
	const credential = { password: GOOD_PASSWORD };

	it('matches the configured password', () => {
		expect(staffCredentialMatches(credential, { password: GOOD_PASSWORD })).toBe(true);
	});

	it('rejects a wrong password', () => {
		expect(staffCredentialMatches(credential, { password: 'nope' })).toBe(false);
	});

	it('rejects an empty password', () => {
		expect(staffCredentialMatches(credential, { password: '' })).toBe(false);
	});

	// nothing on this path folds case: `secretEquals` digests exactly what was posted. the
	// password is this app's entire credential entropy (./credential.ts), so a compare that
	// ignored case would give a guesser a chunk of it back.
	it('is case-sensitive', () => {
		expect(staffCredentialMatches(credential, { password: GOOD_PASSWORD.toUpperCase() })).toBe(
			false
		);
	});

	it('does not treat the password as a prefix or suffix match', () => {
		expect(staffCredentialMatches(credential, { password: GOOD_PASSWORD.slice(0, -1) })).toBe(
			false
		);
		expect(staffCredentialMatches(credential, { password: `${GOOD_PASSWORD}x` })).toBe(false);
	});

	it('does not trim the attempt', () => {
		expect(staffCredentialMatches(credential, { password: ` ${GOOD_PASSWORD} ` })).toBe(false);
	});
});
