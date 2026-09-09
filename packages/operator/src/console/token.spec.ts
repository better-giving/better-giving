import { describe, expect, it } from 'vitest';
import {
	CONSOLE_SESSION_SECONDS,
	CONSOLE_TOKEN_MIN_RANDOM,
	CONSOLE_TOKEN_VERSION,
	formatConsoleToken,
	mintConsoleToken,
	parseConsoleToken
} from './token';

// the grammar of a console session token, stated on its own and with no clock in it.
//
// this is the half of the check that both ends of the wire run: the console composes a token and
// the deployment reads one, and a second statement of the format is how a value one side mints
// becomes a value the other refuses. so the round trip is asserted here rather than the shape
// being written out twice.
//
// whether a token has expired is deliberately not a question this file asks — that needs a clock,
// and it is `packages/app/src/lib/server/console/access.spec.ts` where it is asked, with the clock
// passed in.

/** 43 characters, which is 32 bytes of base64url with no padding. */
const RANDOM = 'A'.repeat(CONSOLE_TOKEN_MIN_RANDOM);

/** an expiry with no sub-second part, so a round trip through whole seconds is lossless. */
const EXPIRES_AT = new Date('2026-08-19T12:00:00.000Z');

describe('the token a console mints', () => {
	it('is read back as the expiry and the random part that went in', () => {
		const parsed = parseConsoleToken(formatConsoleToken(EXPIRES_AT, RANDOM));
		expect(parsed).toStrictEqual({
			ok: true,
			token: { expiresAt: EXPIRES_AT, random: RANDOM }
		});
	});

	it('carries the version at the front and the expiry in the middle', () => {
		expect(formatConsoleToken(EXPIRES_AT, RANDOM)).toBe(
			`${CONSOLE_TOKEN_VERSION}.${EXPIRES_AT.getTime() / 1000}.${RANDOM}`
		);
	});

	/**
	 * a session is twelve hours, and the constant is asserted through the grammar rather than
	 * against itself: the console mints `now + CONSOLE_SESSION_SECONDS` and this deployment reads
	 * the expiry back out of the value, so the two halves have to agree about the unit.
	 */
	it('expires a session at twelve hours', () => {
		const minted = new Date('2026-08-19T00:00:00.000Z');
		const expiresAt = new Date(minted.getTime() + CONSOLE_SESSION_SECONDS * 1000);
		const parsed = parseConsoleToken(formatConsoleToken(expiresAt, RANDOM));
		expect(parsed.ok && parsed.token.expiresAt.toISOString()).toBe('2026-08-19T12:00:00.000Z');
	});
});

describe('a value that is not a token', () => {
	it.each([
		{ what: 'empty', value: '' },
		{ what: 'carrying no version prefix', value: `1755600000.${RANDOM}` },
		{ what: 'carrying another version prefix', value: `bg2.1755600000.${RANDOM}` },
		{ what: 'one dot short', value: `${CONSOLE_TOKEN_VERSION}.${RANDOM}` },
		{ what: 'one dot long', value: `${CONSOLE_TOKEN_VERSION}.1755600000.${RANDOM}.extra` },
		// what somebody types at a `wrangler secret put` prompt to see whether the check works.
		{ what: 'a word', value: 'test' }
	])('is refused as malformed when it is $what', ({ value }) => {
		expect(parseConsoleToken(value)).toStrictEqual({ ok: false, reason: 'malformed' });
	});

	/**
	 * the length is what stops a hand-set value from becoming a credential: `bg1.1.test` is a
	 * well-shaped token, and against 32 bytes of randomness a caller who learns a session exists
	 * still has nothing to guess.
	 */
	it.each([
		{ what: 'empty', random: '' },
		{ what: 'a word', random: 'test' },
		{ what: 'one character short', random: 'A'.repeat(CONSOLE_TOKEN_MIN_RANDOM - 1) }
	])('is refused when its random part is $what', ({ random }) => {
		expect(parseConsoleToken(`${CONSOLE_TOKEN_VERSION}.1755600000.${random}`)).toStrictEqual({
			ok: false,
			reason: 'random-too-short'
		});
	});

	it.each([
		{ what: 'empty', expiry: '' },
		{ what: 'not a number', expiry: 'soon' },
		{ what: 'signed', expiry: '-1755600000' },
		{ what: 'hexadecimal', expiry: '0x68a4c180' },
		{ what: 'padded with a space', expiry: ' 1755600000' },
		{ what: 'past what a date can hold', expiry: '999999999999999999' }
	])('is refused when its expiry is $what', ({ expiry }) => {
		expect(parseConsoleToken(`${CONSOLE_TOKEN_VERSION}.${expiry}.${RANDOM}`)).toStrictEqual({
			ok: false,
			reason: 'expiry-unreadable'
		});
	});
});

describe('minting one', () => {
	const NOW = new Date('2026-08-19T00:00:00.000Z');

	it('mints a value that reads back as a token', () => {
		const minted = mintConsoleToken(NOW);
		expect(parseConsoleToken(minted.token)).toStrictEqual({
			ok: true,
			token: { expiresAt: minted.expiresAt, random: minted.random }
		});
	});

	/**
	 * the floor is a refusal on the reading side, so a mint that came in under it would be a
	 * console writing a value the deployment it just wrote to will not accept.
	 */
	it('carries at least the random part a deployment will read as one', () => {
		expect(mintConsoleToken(NOW).random.length).toBeGreaterThanOrEqual(CONSOLE_TOKEN_MIN_RANDOM);
	});

	/** base64url and no padding: the grammar splits on dots, and `=` and `+` and `/` are not it. */
	it('spells the random part in base64url with nothing padding it', () => {
		expect(mintConsoleToken(NOW).random).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('ends the session twelve hours after the clock it was minted against', () => {
		const minted = mintConsoleToken(NOW);
		expect(minted.expiresAt.toISOString()).toBe('2026-08-19T12:00:00.000Z');
	});

	/**
	 * whole seconds, because that is what the format stores: an expiry the console held to the
	 * millisecond would disagree with the one the deployment reads back out of the same value.
	 */
	it('holds the expiry the deployment will read, to the second', () => {
		const minted = mintConsoleToken(new Date('2026-08-19T00:00:00.750Z'));
		expect(minted.expiresAt.getMilliseconds()).toBe(0);
		const parsed = parseConsoleToken(minted.token);
		expect(parsed.ok && parsed.token.expiresAt).toStrictEqual(minted.expiresAt);
	});

	it('mints a different secret every time', () => {
		expect(mintConsoleToken(NOW).random).not.toBe(mintConsoleToken(NOW).random);
	});
});
