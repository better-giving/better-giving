import { describe, expect, it } from 'vitest';
import { CLIENT_IP_HEADER, clientIp, stampClientIp } from './client-ip';

const PEER = '10.0.0.5';

/** a request as it reaches the server, carrying `headers`, stamped from `peer` under `trusted`. */
function arrived(headers: Record<string, string>, trusted?: string, peer: string | null = PEER) {
	const request = new Request('https://donate.example.org/api/v1/forms/frm_a/config', { headers });
	stampClientIp(request, peer, trusted);
	return request;
}

describe('the client address a request is stamped with', () => {
	it('is the TCP peer when no proxy header is configured', () => {
		expect(clientIp(arrived({}))).toBe(PEER);
	});

	it('is the configured header’s value when it is set', () => {
		expect(clientIp(arrived({ 'fly-client-ip': '203.0.113.7' }, 'fly-client-ip'))).toBe(
			'203.0.113.7'
		);
	});

	it('is the right-most x-forwarded-for entry, the one the proxy appended', () => {
		const request = arrived(
			{ 'x-forwarded-for': '198.51.100.9, 192.0.2.1,  203.0.113.7 ' },
			'X-Forwarded-For'
		);
		expect(clientIp(request)).toBe('203.0.113.7');
	});

	it('is the TCP peer when the configured header is missing from the request', () => {
		expect(clientIp(arrived({}, 'fly-client-ip'))).toBe(PEER);
	});

	it('is the TCP peer when the configured header is blank', () => {
		expect(clientIp(arrived({ 'x-forwarded-for': ' , ' }, 'x-forwarded-for'))).toBe(PEER);
	});

	it.each([
		['x-forwarded-for', '203.0.113.7'],
		['x-real-ip', '203.0.113.7'],
		[CLIENT_IP_HEADER, '203.0.113.7']
	])('ignores a client-sent %s when no proxy header is configured', (name, value) => {
		expect(clientIp(arrived({ [name]: value }))).toBe(PEER);
	});

	it('ignores a client-sent stamp header when the proxy header is configured', () => {
		const request = arrived(
			{ [CLIENT_IP_HEADER]: '198.51.100.9', 'fly-client-ip': '203.0.113.7' },
			'fly-client-ip'
		);
		expect(clientIp(request)).toBe('203.0.113.7');
	});

	it('is null where there is neither a header nor a peer, whatever the caller sent', () => {
		expect(clientIp(arrived({ [CLIENT_IP_HEADER]: '198.51.100.9' }, undefined, null))).toBeNull();
	});
});
