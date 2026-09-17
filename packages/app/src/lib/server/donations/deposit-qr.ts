import type { Deposit } from '@better-giving/form/v1';
import { encode } from 'uqr';

// the QR a donor scans for a crypto gift's address, as `Deposit.qr` in packages/form/src/v1.ts
// carries it: encoded here so the embed shipped into strangers' pages carries no encoder, and drawn
// by the element and the donation page as rects.
//
// it holds the address alone. the amount and the memo are text the donor reads beside it.

/**
 * the address as a module matrix: one string per row, `'1'` dark and `'0'` light, with no quiet zone.
 *
 * error correction `M` rather than the encoder's `L`: the symbol is scanned off a screen, often at an
 * angle, and an address is short enough that the larger version costs nothing a donor sees.
 */
export function depositQr(address: string): Deposit['qr'] {
	const { data } = encode(address, { ecc: 'M', border: 0 });
	return { rows: data.map((row) => row.map((dark) => (dark ? '1' : '0')).join('')) };
}
