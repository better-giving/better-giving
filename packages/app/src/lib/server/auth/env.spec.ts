import { describe, expect, it } from 'vitest';
import { type PinReading, pinnedOrigin, publishedOrigin } from './env';

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

describe('publishedOrigin()', () => {
	const UNSET: PinReading = { ok: true, origin: null };

	it('publishes the pinned origin, whatever host the request came in on', () => {
		const pinned: PinReading = { ok: true, origin: 'https://donate.example.org' };

		expect(publishedOrigin(new URL('https://give.example.workers.dev/x'), pinned)).toBe(
			'https://donate.example.org'
		);
	});

	it('publishes a pinned origin as https for any host but this machine', () => {
		const plain: PinReading = { ok: true, origin: 'http://donate.example.org:8080' };
		const local: PinReading = { ok: true, origin: 'http://localhost:5321' };

		expect(publishedOrigin(new URL('https://give.example.workers.dev/x'), plain)).toBe(
			'https://donate.example.org:8080'
		);
		expect(publishedOrigin(new URL('http://127.0.0.1:5321/x'), local)).toBe(
			'http://localhost:5321'
		);
	});

	it('publishes the request’s own origin where the pin names none', () => {
		const refused: PinReading = { ok: false, message: '`BETTER_AUTH_URL` is `localhost:8787`' };

		expect(publishedOrigin(new URL('https://give.example.org/x'), refused)).toBe(
			'https://give.example.org'
		);
		expect(publishedOrigin(new URL('https://give.example.org/x'), UNSET)).toBe(
			'https://give.example.org'
		);
	});

	it('publishes https for any host but this machine', () => {
		expect(
			publishedOrigin(new URL('http://give.example.org/integrations/openapi.json'), UNSET)
		).toBe('https://give.example.org');
		expect(publishedOrigin(new URL('http://give.example.workers.dev:8080/x'), UNSET)).toBe(
			'https://give.example.workers.dev:8080'
		);
	});

	it('keeps the scheme a local dev server answers on', () => {
		expect(publishedOrigin(new URL('http://localhost:5321/x'), UNSET)).toBe(
			'http://localhost:5321'
		);
		expect(publishedOrigin(new URL('http://127.0.0.1:5321/x'), UNSET)).toBe(
			'http://127.0.0.1:5321'
		);
	});
});
