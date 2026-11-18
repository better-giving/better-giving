import { describe, expect, it } from 'vitest';
import { RAIL_COOKIE, parseRail, railCookie } from './rail-preference';

describe('the rail preference cookie', () => {
	it('reads collapsed only from its own cookie saying so', () => {
		expect(parseRail(`theme=dark; ${RAIL_COOKIE}=collapsed; other=1`)).toBe(true);
		expect(parseRail(`${RAIL_COOKIE}=expanded`)).toBe(false);
		expect(parseRail(`${RAIL_COOKIE}=yes`)).toBe(false);
		expect(parseRail(`x${RAIL_COOKIE}=collapsed`)).toBe(false);
		expect(parseRail('theme=dark')).toBe(false);
		expect(parseRail('')).toBe(false);
		expect(parseRail(null)).toBe(false);
	});

	it('takes the first of two rail pairs, so a stale one ahead decides', () => {
		expect(parseRail(`${RAIL_COOKIE}=expanded; ${RAIL_COOKIE}=collapsed`)).toBe(false);
		expect(parseRail(`${RAIL_COOKIE}=collapsed; ${RAIL_COOKIE}=expanded`)).toBe(true);
	});

	it('does not unquote a value, so a quoted collapsed reads open', () => {
		expect(parseRail(`${RAIL_COOKIE}="collapsed"`)).toBe(false);
	});

	it('writes a year-long cookie on / that plain http keeps', () => {
		// on /, so a navigation's data request (/admin.data), outside /admin, carries it too
		expect(railCookie(true)).toBe(
			'bg_operator_rail=collapsed; Path=/; Max-Age=31536000; SameSite=Lax'
		);
		expect(railCookie(false)).toBe(
			'bg_operator_rail=expanded; Path=/; Max-Age=31536000; SameSite=Lax'
		);
	});

	it('reads back what it writes', () => {
		expect(parseRail(railCookie(true).split(';')[0] ?? null)).toBe(true);
		expect(parseRail(railCookie(false).split(';')[0] ?? null)).toBe(false);
	});
});
