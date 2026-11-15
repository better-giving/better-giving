import { describe, expect, it } from 'vitest';
import { giftLinkOrigin, giftPageUrl } from './links';

const TOKEN = 'abcdefghjkmnpqrstvwxyz0123456789';

describe('the address mail and the quote give a gift page', () => {
	it('is the pinned origin wherever one is pinned', () => {
		expect(
			giftLinkOrigin({ BETTER_AUTH_URL: 'https://give.example.org/' }, new URL('http://10.0.0.5/x'))
		).toBe('https://give.example.org');
	});

	it('is the request’s own host over https where nothing is pinned', () => {
		expect(giftLinkOrigin({}, new URL('http://give.example.org/api/v1/forms/x/donations'))).toBe(
			'https://give.example.org'
		);
	});

	it('is none for a run with no request and no pin', () => {
		expect(giftLinkOrigin({}, null)).toBeNull();
		expect(giftLinkOrigin({ BETTER_AUTH_URL: 'localhost:8787' }, null)).toBeNull();
	});

	it('is the pin for a run with no request', () => {
		expect(giftLinkOrigin({ BETTER_AUTH_URL: 'https://give.example.org' }, null)).toBe(
			'https://give.example.org'
		);
	});

	it('names the token under /gift', () => {
		expect(giftPageUrl('https://give.example.org', TOKEN)).toBe(
			`https://give.example.org/gift/${TOKEN}`
		);
	});
});
