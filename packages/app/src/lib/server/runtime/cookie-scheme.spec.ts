import { describe, expect, it } from 'vitest';
import { COOKIE_SCHEME_HEADER, cookiesSecure, stampCookieScheme } from './cookie-scheme';

/** a request as it reaches the server over plain HTTP, carrying `headers`. */
const arrived = (headers: Record<string, string> = {}) =>
	new Request('http://give.example.org/fundraise/open', { headers });

describe('whether a cookie is Secure', () => {
	it('is the pin’s scheme, whatever the connection’s', () => {
		const https = arrived();
		stampCookieScheme(https, 'https://give.example.org');
		expect(cookiesSecure(https)).toBe(true);

		const http = new Request('https://give.example.org/');
		stampCookieScheme(http, 'http://give.example.org');
		expect(cookiesSecure(http)).toBe(false);
	});

	it('is the request’s scheme where nothing is pinned, whatever the caller sent', () => {
		const request = arrived({ [COOKIE_SCHEME_HEADER]: 'https:' });
		stampCookieScheme(request, null);
		expect(cookiesSecure(request)).toBe(false);
		expect(cookiesSecure(new Request('https://give.example.org/'))).toBe(true);
	});
});
