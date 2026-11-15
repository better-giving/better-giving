import { expect, it } from 'vitest';
import { employerAnswer, giftToken } from './employer';
import { MAX_EMPLOYER } from './v1';

// node pool: the two readings the employer ask is gated on. the quote's `giftUrl` is untrusted json
// from the deployment that becomes an `href` on a stranger's page, and the donor's text is what the
// one write sends.

it('reads the token off a gift page address', () => {
	expect(giftToken('https://giving.example.org/gift/7Qk3-mVx9Lr2NpA4')).toBe('7Qk3-mVx9Lr2NpA4');
	expect(giftToken('http://localhost:5173/gift/abc_123')).toBe('abc_123');
});

it('refuses an address that is not a gift page on the web', () => {
	// the address becomes a link the donor presses, so a scheme other than the web's is a script
	// or a file on somebody else's page.
	expect(giftToken('javascript:alert(1)//gift/x')).toBeNull();
	expect(giftToken('data:text/html,/gift/x')).toBeNull();
	expect(giftToken('/gift/7Qk3')).toBeNull();
	expect(giftToken('https://giving.example.org/gifts/7Qk3')).toBeNull();
	expect(giftToken('https://giving.example.org/gift/')).toBeNull();
	expect(giftToken('https://giving.example.org/gift/a/b')).toBeNull();
	expect(giftToken('not a url')).toBeNull();
});

it('answers with the trimmed text, and with nothing for a blank box', () => {
	expect(employerAnswer('  Northwind Logistics ')).toBe('Northwind Logistics');
	expect(employerAnswer('')).toBeNull();
	expect(employerAnswer(' \t\n ')).toBeNull();
});

it('answers with nothing past the length the endpoint takes', () => {
	expect(employerAnswer('x'.repeat(MAX_EMPLOYER))).toHaveLength(MAX_EMPLOYER);
	expect(employerAnswer(` ${'x'.repeat(MAX_EMPLOYER)} `)).toHaveLength(MAX_EMPLOYER);
	expect(employerAnswer('x'.repeat(MAX_EMPLOYER + 1))).toBeNull();
});
