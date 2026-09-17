import { describe, expect, it } from 'vitest';
import { depositQr } from './deposit-qr';

// the matrix `Deposit.qr` carries (packages/form/src/v1.ts): square, `'0'|'1'` only, no quiet zone.
// a renderer draws it module for module, so the corners are where a margin or an inversion shows.

const ADDRESS = 'TQrZ9wBzhYvVn1Kx3pBqWm8dZ2LwX7cF5e';

/** the 7×7 finder pattern every QR symbol carries in three corners. */
const FINDER = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];

describe('depositQr()', () => {
	it('is a square of dark and light modules, sized as a QR version is', () => {
		const { rows } = depositQr(ADDRESS);

		expect(rows.every((row) => row.length === rows.length && /^[01]+$/.test(row))).toBe(true);
		expect((rows.length - 17) % 4).toBe(0);
	});

	it('starts at the symbol’s own edge, with dark modules on the outside', () => {
		const { rows } = depositQr(ADDRESS);
		const size = rows.length;

		expect(rows.slice(0, 7).map((row) => row.slice(0, 7))).toEqual(FINDER);
		expect(rows.slice(0, 7).map((row) => row.slice(size - 7))).toEqual(FINDER);
		expect(rows.slice(size - 7).map((row) => row.slice(0, 7))).toEqual(FINDER);
	});

	it('encodes the address it was given', () => {
		expect(depositQr(ADDRESS).rows).not.toEqual(depositQr(`${ADDRESS}x`).rows);
		expect(depositQr(ADDRESS).rows).toEqual(depositQr(ADDRESS).rows);
	});
});
