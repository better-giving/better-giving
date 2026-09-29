import { describe, expect, it } from 'vitest';
import { pinnedOrigin } from './env';

describe('pinnedOrigin', () => {
	it('answers null where no pin is set', () => {
		expect(pinnedOrigin({})).toBeNull();
		expect(pinnedOrigin({ BETTER_AUTH_URL: '  ' })).toBeNull();
	});

	it('reads a pin by its origin, dropping a trailing slash and a path', () => {
		expect(pinnedOrigin({ BETTER_AUTH_URL: ' https://donate.example.org/admin/ ' })).toBe(
			'https://donate.example.org'
		);
		expect(pinnedOrigin({ BETTER_AUTH_URL: 'http://localhost:8787/' })).toBe(
			'http://localhost:8787'
		);
	});

	// the first two parse, as a scheme named `localhost` or `donate.example.org` with an opaque
	// path, and their `.origin` is the string "null" — which a caller would print into an address.
	it.each([
		'localhost:8787',
		'donate.example.org:443',
		'donate.example.org',
		'ftp://donate.example.org'
	])('refuses %s, naming the variable and the value', (pin) => {
		expect(() => pinnedOrigin({ BETTER_AUTH_URL: pin })).toThrow(
			`\`BETTER_AUTH_URL\` is \`${pin}\``
		);
	});
});
