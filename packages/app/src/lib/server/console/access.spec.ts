import { describe, expect, it } from 'vitest';
import { consoleAccess } from './access';
import {
	CONSOLE_TOKEN_MIN_RANDOM,
	CONSOLE_TOKEN_VERSION,
	formatConsoleToken,
	mintConsoleToken
} from '@better-giving/operator/console/token';

// every way this surface refuses, one case each.
//
// the refusals are the surface: it answers a caller holding a value only an account holder could
// have written and nobody else, so what is worth stating is the whole list of ways a request is
// not that. all of them are 401 and none of them reads the database or calls a binding, which is
// the property the absent rate limiter rests on — a wrong token has to stay cheap.
//
// `now` is an argument and no timer is faked. the expiry lives inside the token, so "this session
// has ended" is one comparison between two values a test hands in, and a spec that moved a clock
// would be a spec about the clock.

/** 43 characters, which is what a minted random part is. */
const RANDOM = 'k'.repeat(CONSOLE_TOKEN_MIN_RANDOM);
/** a second one, so a mismatch is two real tokens rather than a token and a word. */
const OTHER_RANDOM = 'm'.repeat(CONSOLE_TOKEN_MIN_RANDOM);

const NOW = new Date('2026-08-19T09:00:00.000Z');
const IN_AN_HOUR = new Date('2026-08-19T10:00:00.000Z');
const AN_HOUR_AGO = new Date('2026-08-19T08:00:00.000Z');

const LIVE_TOKEN = formatConsoleToken(IN_AN_HOUR, RANDOM);

/** the headers a connected console sends. */
function bearer(value: string): Headers {
	return new Headers({ authorization: `Bearer ${value}` });
}

describe('a caller holding the session this deployment was connected with', () => {
	it('is let through, carrying when the session ends', () => {
		const access = consoleAccess({ CONSOLE_TOKEN: LIVE_TOKEN }, bearer(LIVE_TOKEN), NOW);
		expect(access).toStrictEqual({ ok: true, session: { expiresAt: IN_AN_HOUR } });
	});

	/**
	 * `Bearer` is a scheme and HTTP schemes are case-insensitive, so a client that sends `bearer`
	 * is sending the same header. refusing it would be this surface inventing a rule about how a
	 * standard header is spelled.
	 */
	it('is let through however the scheme is cased', () => {
		const access = consoleAccess(
			{ CONSOLE_TOKEN: LIVE_TOKEN },
			new Headers({ authorization: `bearer ${LIVE_TOKEN}` }),
			NOW
		);
		expect(access.ok).toBe(true);
	});

	/**
	 * the round trip across both halves, which is the whole reason the grammar is one module: what
	 * the console mints is what this check reads, and the two are asserted against each other here
	 * because this is the only side that holds the check. a mint written to a second statement of
	 * the format would pass every case in `@better-giving/operator/console/token`'s own spec and be
	 * refused by the deployment it was written to.
	 */
	it('is let through holding a token minted the way the console mints one', () => {
		const minted = mintConsoleToken(NOW);
		const access = consoleAccess(
			{ CONSOLE_TOKEN: minted.token },
			bearer(minted.token),
			new Date(NOW.getTime() + 1000)
		);
		expect(access).toStrictEqual({ ok: true, session: { expiresAt: minted.expiresAt } });
	});

	/** the last moment of a session is still inside it: the refusal is `past`, not `reached`. */
	it('is let through at the instant the session ends', () => {
		const access = consoleAccess({ CONSOLE_TOKEN: LIVE_TOKEN }, bearer(LIVE_TOKEN), IN_AN_HOUR);
		expect(access.ok).toBe(true);
	});
});

describe('a request carrying no usable credential', () => {
	/**
	 * the first refusal an unaimed request meets, and the one sentence on this surface written for
	 * somebody who arrived by accident: it says what this is and, because the mistake worth naming
	 * is confusing it with the one surface here that genuinely answers anonymous callers, what it
	 * is not.
	 */
	it('is refused when there is no Authorization header at all', () => {
		const access = consoleAccess({ CONSOLE_TOKEN: LIVE_TOKEN }, new Headers(), NOW);
		expect(access).toMatchObject({ ok: false, refusal: { status: 401, error: 'no_bearer' } });
		expect(access.ok === false && access.refusal.message).toContain('Authorization: Bearer');
		expect(access.ok === false && access.refusal.message).toContain('/api/v1');
	});

	it.each([
		{ how: 'another scheme', value: `Basic ${LIVE_TOKEN}` },
		{ how: 'no scheme', value: LIVE_TOKEN },
		{ how: 'a scheme that merely starts the same way', value: `Bearerish ${LIVE_TOKEN}` }
	])('is refused when the header carries $how', ({ value }) => {
		const access = consoleAccess(
			{ CONSOLE_TOKEN: LIVE_TOKEN },
			new Headers({ authorization: value }),
			NOW
		);
		expect(access).toMatchObject({ ok: false, refusal: { error: 'no_bearer' } });
	});

	/**
	 * separate from the header being absent, because it is a different mistake: a console that
	 * sent an unset variable produces exactly this, and "there is no header" would send whoever
	 * reads it looking for the header that is right there.
	 */
	it.each([
		{ what: 'empty', value: '' },
		{ what: 'whitespace', value: '   ' }
	])('is refused when the bearer value is $what', ({ value }) => {
		const access = consoleAccess({ CONSOLE_TOKEN: LIVE_TOKEN }, bearer(value), NOW);
		expect(access).toMatchObject({ ok: false, refusal: { status: 401, error: 'empty_bearer' } });
	});
});

describe('a deployment nobody has connected a console to', () => {
	/**
	 * distinguishable from a wrong token on purpose. somebody who learns a session exists has
	 * gained nothing they can use against 256 bits of randomness, and an operator debugging a
	 * connect needs to know whether the value arrived at the deployment at all.
	 */
	it('is refused as having no session, and says what mints one', () => {
		const access = consoleAccess({}, bearer(LIVE_TOKEN), NOW);
		expect(access).toMatchObject({ ok: false, refusal: { status: 401, error: 'no_session' } });
		expect(access.ok === false && access.refusal.message).toContain('CONSOLE_TOKEN');
		expect(access.ok === false && access.refusal.fix).toContain('better-giving open');
	});

	/**
	 * `worker-configuration.d.ts` types a binding as whatever `wrangler types` last saw, so a
	 * value that is present and is not a string reaches here typed as one. the `typeof` is in the
	 * message because it is the whole finding — the slot is filled with something that is not a
	 * credential.
	 */
	it('is refused when CONSOLE_TOKEN is present but not a string, naming what it is', () => {
		const access = consoleAccess({ CONSOLE_TOKEN: { limit: () => true } }, bearer(LIVE_TOKEN), NOW);
		expect(access).toMatchObject({ ok: false, refusal: { error: 'session_not_a_string' } });
		expect(access.ok === false && access.refusal.message).toContain('object');
	});

	/** what a blank paste into a `wrangler secret put` prompt leaves behind. */
	it.each([
		{ what: 'empty', value: '' },
		{ what: 'only whitespace', value: '\n' }
	])('is refused when CONSOLE_TOKEN is $what', ({ value }) => {
		const access = consoleAccess({ CONSOLE_TOKEN: value }, bearer(LIVE_TOKEN), NOW);
		expect(access).toMatchObject({ ok: false, refusal: { error: 'session_blank' } });
	});
});

describe('a session value nobody minted', () => {
	/**
	 * the stored value is what is read, never the presented one — they have to be equal for a
	 * caller to get through, so parsing the one this deployment holds is the same question asked
	 * of a value an attacker cannot choose. it is also what keeps these sentences free of anything
	 * off the wire.
	 */
	it.each([
		{ what: 'a word somebody typed', value: 'test' },
		{ what: 'another version', value: `bg2.1755600000.${RANDOM}` },
		{ what: 'missing its expiry', value: `${CONSOLE_TOKEN_VERSION}.${RANDOM}` }
	])('is refused when CONSOLE_TOKEN is $what', ({ value }) => {
		const access = consoleAccess({ CONSOLE_TOKEN: value }, bearer(LIVE_TOKEN), NOW);
		expect(access).toMatchObject({ ok: false, refusal: { error: 'session_malformed' } });
		expect(access.ok === false && access.refusal.fix).toContain('better-giving open');
	});

	/** the shape is right and there is nothing in it: `bg1.1.test` is not a credential. */
	it('is refused when CONSOLE_TOKEN carries too little randomness', () => {
		const short = `${CONSOLE_TOKEN_VERSION}.1755600000.test`;
		const access = consoleAccess({ CONSOLE_TOKEN: short }, bearer(short), NOW);
		expect(access).toMatchObject({ ok: false, refusal: { error: 'session_too_weak' } });
		expect(access.ok === false && access.refusal.message).toContain(
			String(CONSOLE_TOKEN_MIN_RANDOM)
		);
	});

	it('is refused when CONSOLE_TOKEN carries an expiry that is not a time', () => {
		const value = `${CONSOLE_TOKEN_VERSION}.whenever.${RANDOM}`;
		const access = consoleAccess({ CONSOLE_TOKEN: value }, bearer(value), NOW);
		expect(access).toMatchObject({ ok: false, refusal: { error: 'session_expiry_unreadable' } });
	});
});

describe('a session that has run out', () => {
	/**
	 * both times in one sentence, because the failure an operator cannot otherwise explain is
	 * clock skew: a console whose machine runs ahead mints an expiry this deployment reads as
	 * already past, and every connect then fails with the token being perfectly correct. the two
	 * values side by side are what turns that into something to look at.
	 */
	it('is refused, naming both the expiry and this deployment’s own clock', () => {
		const expired = formatConsoleToken(AN_HOUR_AGO, RANDOM);
		const access = consoleAccess({ CONSOLE_TOKEN: expired }, bearer(expired), NOW);
		expect(access).toMatchObject({ ok: false, refusal: { status: 401, error: 'session_expired' } });
		expect(access.ok === false && access.refusal.message).toContain(AN_HOUR_AGO.toISOString());
		expect(access.ok === false && access.refusal.message).toContain(NOW.toISOString());
	});

	/** the expiry is refused before the compare, so a live token against a dead session is dead. */
	it('is refused before the two values are compared at all', () => {
		const expired = formatConsoleToken(AN_HOUR_AGO, RANDOM);
		const access = consoleAccess({ CONSOLE_TOKEN: expired }, bearer(LIVE_TOKEN), NOW);
		expect(access).toMatchObject({ ok: false, refusal: { error: 'session_expired' } });
	});
});

describe('a token that is not this deployment’s session', () => {
	it('is refused as a mismatch', () => {
		const presented = formatConsoleToken(IN_AN_HOUR, OTHER_RANDOM);
		const access = consoleAccess({ CONSOLE_TOKEN: LIVE_TOKEN }, bearer(presented), NOW);
		expect(access).toMatchObject({
			ok: false,
			refusal: { status: 401, error: 'session_mismatch' }
		});
	});

	/**
	 * a second console supersedes the first, and that is the whole revocation mechanism: secrets
	 * cannot be read back, so every console mints its own value and connecting a new one makes the
	 * previous token wrong by construction. it arrives here as a plain mismatch.
	 */
	it('is refused when a newer console has replaced the value', () => {
		const superseded = formatConsoleToken(IN_AN_HOUR, RANDOM);
		const newer = formatConsoleToken(IN_AN_HOUR, OTHER_RANDOM);
		const access = consoleAccess({ CONSOLE_TOKEN: newer }, bearer(superseded), NOW);
		expect(access).toMatchObject({ ok: false, refusal: { error: 'session_mismatch' } });
	});

	/**
	 * the same refusal covers a request that landed on a Worker version still carrying the
	 * previous value, which is why the sentence names it: a console that has just written a secret
	 * has no way to tell "wrong token" from "not picked up yet", and it polls until this stops.
	 */
	it('says a newer session may not have been picked up yet', () => {
		const presented = formatConsoleToken(IN_AN_HOUR, OTHER_RANDOM);
		const access = consoleAccess({ CONSOLE_TOKEN: LIVE_TOKEN }, bearer(presented), NOW);
		expect(access.ok === false && access.refusal.fix).toContain('picked up');
	});

	/** every sentence on this surface is about the deployment; none of them quotes the wire. */
	it('quotes nothing the caller sent', () => {
		const presented = formatConsoleToken(IN_AN_HOUR, OTHER_RANDOM);
		const access = consoleAccess({ CONSOLE_TOKEN: LIVE_TOKEN }, bearer(presented), NOW);
		const said = access.ok === false && `${access.refusal.message} ${access.refusal.fix}`;
		expect(said).not.toContain(OTHER_RANDOM);
		expect(said).not.toContain(RANDOM);
	});
});

describe('the env this check reads', () => {
	/**
	 * the platform env of a request that never had one — `vite dev` without the adapter's proxy —
	 * arrives as `undefined`, and a check that read a member off it would throw where it should
	 * refuse.
	 */
	it.each([
		{ what: 'undefined', env: undefined },
		{ what: 'null', env: null },
		{ what: 'not an object', env: 'CONSOLE_TOKEN=…' }
	])('refuses rather than throwing when the env is $what', ({ env }) => {
		expect(consoleAccess(env, bearer(LIVE_TOKEN), NOW)).toMatchObject({
			ok: false,
			refusal: { error: 'no_session' }
		});
	});
});
