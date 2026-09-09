import { describe, expect, it } from 'vitest';
import { MIN_ADMIN_PASSWORD_LENGTH, readAdminPassword } from './admin-password';

// node pool, no database and no browser: every arm is decidable from the candidate alone.
//
// it is asserted here rather than only through a caller because both ends call it. the deployment's
// own spec puts these arms through the reader that wraps them
// (`packages/app/src/lib/server/auth/credential.spec.ts`), so a rule that changed shape would be
// answerable in either package and stated in neither.

const AT_MINIMUM = 'x'.repeat(MIN_ADMIN_PASSWORD_LENGTH);

describe('a candidate dashboard password, read', () => {
	it('accepts a value exactly at the minimum', () => {
		// the boundary is taken off the constant rather than typed in, so raising the minimum
		// cannot leave a spec asserting the old one and still passing.
		expect(readAdminPassword(AT_MINIMUM)).toEqual({ ok: true, password: AT_MINIMUM });
	});

	it('hands the value back untrimmed, because whitespace is part of a secret', () => {
		const padded = ` ${AT_MINIMUM} `;
		expect(readAdminPassword(padded)).toEqual({ ok: true, password: padded });
	});

	it('refuses a value one character short, in the words of the box it was typed in', () => {
		const result = readAdminPassword('x'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 1));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.problem).toBe(`Must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`);
	});

	// the minimum is the rule and is stated; how far short this one fell is a measurement of the
	// candidate, and the sentence is printed under a box on a screen.
	it('states the minimum without measuring what it was handed', () => {
		const result = readAdminPassword('x'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 5));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.problem).not.toContain(String(MIN_ADMIN_PASSWORD_LENGTH - 5));
	});

	// a value an operator can type is answered in their words, and one only an env can hold names
	// the variable, because what reads that sentence is an agent holding a 5xx body.
	it('names no variable in either sentence a typed value can reach', () => {
		const short = readAdminPassword('x');
		const spaces = readAdminPassword(' '.repeat(MIN_ADMIN_PASSWORD_LENGTH));
		expect(short.ok).toBe(false);
		expect(spaces.ok).toBe(false);
		if (short.ok || spaces.ok) return;
		expect(short.problem).not.toContain('ADMIN_PASSWORD');
		expect(spaces.problem).not.toContain('ADMIN_PASSWORD');
	});

	it('refuses an absent value', () => {
		const result = readAdminPassword(undefined);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.problem).toBe('ADMIN_PASSWORD is not set.');
	});

	it('refuses an empty value rather than reading it as a credential', () => {
		const result = readAdminPassword('');
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.problem).toBe('ADMIN_PASSWORD is set but empty.');
	});

	it('refuses a whitespace-only value, naming that specifically', () => {
		// long enough to clear the length check, so it needs its own arm.
		const result = readAdminPassword(' '.repeat(MIN_ADMIN_PASSWORD_LENGTH));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.problem).toBe('Must be something other than spaces');
	});

	it('refuses a non-string value, naming the type it got', () => {
		const result = readAdminPassword(42);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.problem).toBe('ADMIN_PASSWORD is set but is not a string (it is a number).');
	});

	it('refuses an object without stringifying it', () => {
		const result = readAdminPassword({ toString: () => AT_MINIMUM });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.problem).toContain('is not a string');
	});

	// the sentence is printed under a box on the console and inside a 5xx body on the deployment,
	// and neither is a place to read a credential back.
	it('never quotes the candidate in the sentence', () => {
		const result = readAdminPassword('hunter2');
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.problem).not.toContain('hunter2');
	});
});
