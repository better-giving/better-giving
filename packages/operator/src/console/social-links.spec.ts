import { describe, expect, it } from 'vitest';
import { readSocialLink, readSocialLinks } from './social-links';

describe('a social link as typed', () => {
	it('is recognised by its host', () => {
		expect(readSocialLink('https://www.facebook.com/hopefoundation')).toEqual({
			ok: true,
			link: { platform: 'facebook', href: 'https://www.facebook.com/hopefoundation' }
		});
	});

	it.each([
		['https://fb.com/hope', 'facebook'],
		['https://m.facebook.com/hope', 'facebook'],
		['https://instagram.com/hope', 'instagram'],
		['https://www.youtube.com/@hope', 'youtube'],
		['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
		['https://www.linkedin.com/company/hope', 'linkedin'],
		['https://mobile.twitter.com/hope', 'x'],
		['https://twitter.com/hope', 'x'],
		['https://x.com/hope', 'x'],
		['https://www.tiktok.com/@hope', 'tiktok'],
		['https://WWW.Instagram.COM/hope', 'instagram'],
		['https://uk.linkedin.com/company/hope', 'linkedin'],
		['https://vm.tiktok.com/ZMabc123/', 'tiktok'],
		['https://business.facebook.com/hope', 'facebook'],
		['https://music.youtube.com/channel/hope', 'youtube']
	])('reads %s as %s', (typed, platform) => {
		const read = readSocialLink(typed);
		expect(read.ok && read.link.platform).toBe(platform);
	});

	it('is stored as https where it was typed with no scheme', () => {
		expect(readSocialLink('  youtu.be/dQw4w9WgXcQ ')).toEqual({
			ok: true,
			link: { platform: 'youtube', href: 'https://youtu.be/dQw4w9WgXcQ' }
		});
	});

	it.each([
		['http://facebook.com/hope', 'https://facebook.com/hope'],
		['https://x:y@facebook.com/hope', 'https://facebook.com/hope'],
		['https://facebook.com:8443/hope', 'https://facebook.com/hope'],
		[
			'http://me@www.instagram.com:8080/hope?igsh=1#top',
			'https://www.instagram.com/hope?igsh=1#top'
		]
	])('stores %s as %s: https, with no user, password or port', (typed, href) => {
		const read = readSocialLink(typed);
		expect(read.ok && read.link.href).toBe(href);
	});
});

describe('a social link refused', () => {
	it.each([
		'https://example.org',
		'ftp://facebook.com/hope',
		'https://facebook.com.evil.example/hope',
		'https://evilfacebook.com/hope',
		'https://notx.com/hope',
		'https://facebook.com@evil.example/hope',
		'javascript:alert(1)',
		'not an address'
	])('%s names the address and the six', (typed) => {
		expect(readSocialLink(typed)).toEqual({
			ok: false,
			error: `${typed} is not a Facebook, Instagram, YouTube, LinkedIn, TikTok or X address.`
		});
	});
});

describe('a social link past the cap', () => {
	it('is refused naming the cap, at 2001 characters and not at 2000', () => {
		const at = (length: number) => `https://facebook.com/${'h'.repeat(length - 21)}`;
		expect(readSocialLink(at(2000)).ok).toBe(true);
		expect(readSocialLink(at(2001))).toEqual({
			ok: false,
			error: 'This address is 2001 characters, over the 2000-character limit.'
		});
	});
});

describe('the list of social links as typed', () => {
	it('keeps the order typed and skips the blank boxes', () => {
		expect(
			readSocialLinks(['https://x.com/hope', '', '  ', 'https://www.facebook.com/hope'])
		).toEqual({
			ok: true,
			links: [
				{ platform: 'x', href: 'https://x.com/hope' },
				{ platform: 'facebook', href: 'https://www.facebook.com/hope' }
			]
		});
	});

	it('refuses a second address on one platform, naming the platform', () => {
		expect(
			readSocialLinks(['https://instagram.com/hope', 'https://www.instagram.com/hope.too'])
		).toEqual({
			ok: false,
			error: 'Instagram is listed twice. Keep one Instagram address.'
		});
	});

	it('names the first address it refuses', () => {
		expect(readSocialLinks(['https://example.org', 'https://example.net'])).toEqual({
			ok: false,
			error:
				'https://example.org is not a Facebook, Instagram, YouTube, LinkedIn, TikTok or X address.'
		});
	});
});
