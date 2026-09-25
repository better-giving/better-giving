import { describe, expect, it } from 'vitest';
import { isApiAddress } from './api-address';

describe('an API address box', () => {
	it('takes an https origin, with or without one trailing slash', () => {
		expect(isApiAddress('https://api.givechariot.com')).toBe(true);
		expect(isApiAddress('https://api-m.example.org/')).toBe(true);
	});

	it('refuses anything past the origin, and anything not https', () => {
		for (const typed of [
			'http://api.example.org',
			'https://api.example.org/v1',
			'https://api.example.org//',
			'https://api.example.org?x=1',
			'https://user@api.example.org',
			'api.example.org'
		]) {
			expect(isApiAddress(typed), typed).toBe(false);
		}
	});
});
