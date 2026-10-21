import { describe, expect, it } from 'vitest';
import { withForwardedProto } from './forwarded-proto';

/** a request as it reaches the server over plain HTTP, carrying `headers`. */
function arrived(headers: Record<string, string>, init: RequestInit = {}) {
	return new Request('http://donate.example.org/login?next=%2Fadmin', { ...init, headers });
}

describe('the scheme a request is read with', () => {
	it('is the connection’s when no proxy header is configured, whatever the caller sends', () => {
		const request = withForwardedProto(arrived({ 'x-forwarded-proto': 'https' }), undefined);

		expect(request.url).toBe('http://donate.example.org/login?next=%2Fadmin');
	});

	it('is the first x-forwarded-proto value when a proxy header is configured', () => {
		const request = withForwardedProto(
			arrived({ 'x-forwarded-proto': 'HTTPS, http' }),
			'x-forwarded-for'
		);

		expect(request.url).toBe('https://donate.example.org/login?next=%2Fadmin');
	});

	it('is the connection’s when the proxy sends no x-forwarded-proto', () => {
		const request = withForwardedProto(arrived({}), 'fly-client-ip');

		expect(request.url).toBe('http://donate.example.org/login?next=%2Fadmin');
	});

	it.each(['ftp', 'javascript', 'https:', ''])(
		'is the connection’s when x-forwarded-proto is %j',
		(value) => {
			const request = withForwardedProto(arrived({ 'x-forwarded-proto': value }), 'fly-client-ip');

			expect(request.url).toBe('http://donate.example.org/login?next=%2Fadmin');
		}
	);

	it('keeps the method, the headers and the body', async () => {
		const request = withForwardedProto(
			arrived(
				{ 'x-forwarded-proto': 'https', 'content-type': 'text/plain' },
				{
					method: 'POST',
					body: 'amount=10'
				}
			),
			'fly-client-ip'
		);

		expect(request.method).toBe('POST');
		expect(request.headers.get('content-type')).toBe('text/plain');
		expect(await request.text()).toBe('amount=10');
	});
});
