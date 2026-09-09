import { describe, expect, it } from 'vitest';
import { LOGIN_PATH, NEXT_PARAM, safeNext } from './next';

// the open-redirect control on the sign-in, stated on its own.
//
// a node spec because the rule is pure string logic and touches no binding. it is asserted here
// rather than only through the route because what has to hold is a property of the function over
// every spelling of a hostile input, and a case per spelling routed through a form action would
// say the same thing at ten times the cost.
//
// the two modules that spend it are `./gate.ts`, which mints the parameter when it turns a
// request away, and `src/routes/login.tsx`, which reads it back — and neither of them re-states
// this rule, which is why widening it by a character here is enough to open the redirect.

describe('safeNext', () => {
	it('honours a path inside this deployment, query and all', () => {
		expect(safeNext('/admin/forms/abc?tab=x')).toBe('/admin/forms/abc?tab=x');
	});

	it('refuses a url naming another origin', () => {
		expect(safeNext('https://evil.example')).toBeNull();
	});

	it('refuses a protocol-relative url, which browsers read as another origin', () => {
		expect(safeNext('//evil.example')).toBeNull();
	});

	it('refuses a backslash in the authority position, which browsers read as a slash', () => {
		expect(safeNext('/\\evil.example')).toBeNull();
	});

	/**
	 * url parsing strips tabs and newlines before it resolves anything, so this arrives at a
	 * browser as `//evil.example`. it is the case a first-character check cannot see.
	 */
	it('refuses a tab smuggled between the slashes, which url parsing strips', () => {
		expect(safeNext('/\t/evil.example')).toBeNull();
	});

	it('refuses a newline smuggled between the slashes the same way', () => {
		expect(safeNext('/\n/evil.example')).toBeNull();
	});

	/**
	 * and the case an origin check alone cannot see, which is the other half. this resolves inside
	 * the origin — the dot segment is popped — and the path that comes back out is `//evil.example`,
	 * protocol-relative again by the time it is a `Location` header.
	 */
	it('refuses a dot segment that resolves back into an authority', () => {
		expect(safeNext('/..//evil.example')).toBeNull();
	});

	it('refuses a scheme that is not a url at all', () => {
		expect(safeNext('javascript:alert(1)')).toBeNull();
	});

	/** a bare host is a relative path to a url parser and a host to a reader. neither is honoured. */
	it('refuses a bare host', () => {
		expect(safeNext('evil.example')).toBeNull();
	});

	it('refuses an empty parameter, and the absence of one', () => {
		expect(safeNext('')).toBeNull();
		expect(safeNext(null)).toBeNull();
		expect(safeNext(undefined)).toBeNull();
	});

	/**
	 * the loop. the gate mints this parameter on a redirect to `/login`, so a sign-in that honoured
	 * `/login` would answer a successful sign-in with the form again — and `?next=/login` would do
	 * it on every attempt.
	 */
	it('refuses the login page itself, whatever it carries', () => {
		expect(safeNext(LOGIN_PATH)).toBeNull();
		expect(safeNext(`${LOGIN_PATH}?${NEXT_PARAM}=/admin`)).toBeNull();
		expect(safeNext(`${LOGIN_PATH}/`)).toBeNull();
	});

	/**
	 * and it is the login page that is refused, not every path that starts with those characters.
	 * a route named for it is a page like any other.
	 */
	it('honours a path that merely starts the same way', () => {
		expect(safeNext('/login-history')).toBe('/login-history');
	});

	/**
	 * the destination the gate actually mints, round-tripped through the encoding it is carried in.
	 * this is what a deep link inside `(app)` comes back as, and no case above states it end to end.
	 */
	it('honours a destination that has been through a query parameter', () => {
		const destination = '/admin/forms/abc/settings?tab=x&q=a b';
		const url = new URL(`https://give.example.workers.dev${LOGIN_PATH}`);
		url.searchParams.set(NEXT_PARAM, destination);

		expect(safeNext(url.searchParams.get(NEXT_PARAM))).toBe(
			'/admin/forms/abc/settings?tab=x&q=a%20b'
		);
	});
});
