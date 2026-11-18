import { SOCIAL_PLATFORMS } from '@better-giving/operator/console/org';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { SiteFooter, type SiteFooterInfo } from './site-footer';

// the site footer, mounted: the legal line once, each way to reach the organisation only where it
// has set one, and the staff link at the end of the list everywhere.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(tree: ReactNode): HTMLElement {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

const INFO: SiteFooterInfo = {
	legalName: 'Greenfield Food Bank',
	ein: '84-2917453',
	addressLines: ['410 Alder Street, Suite 2', 'Portland, OR 97214'],
	email: 'hello@greenfieldfoodbank.org',
	socialLinks: [
		{ platform: 'instagram', href: 'https://instagram.com/greenfieldfoodbank' },
		{ platform: 'facebook', href: 'https://facebook.com/greenfieldfoodbank' }
	]
};

const footer = (over: Partial<SiteFooterInfo> = {}) =>
	mount(<SiteFooter info={{ ...INFO, ...over }} />).querySelector('footer');

describe('the legal line', () => {
	it('states the legal name, the EIN and the address once, in that order', () => {
		const root = footer();
		const lines = root?.querySelectorAll('p') ?? [];
		expect(lines).toHaveLength(1);
		expect(lines[0]?.textContent).toBe(
			'Greenfield Food Bank · EIN 84-2917453 · 410 Alder Street, Suite 2, Portland, OR 97214'
		);
	});

	it('leaves out what the organisation has not set', () => {
		expect(footer({ ein: null, addressLines: [] })?.querySelector('p')?.textContent).toBe(
			'Greenfield Food Bank'
		);
		expect(footer({ legalName: null })?.querySelector('p')?.textContent).toBe(
			'EIN 84-2917453 · 410 Alder Street, Suite 2, Portland, OR 97214'
		);
	});
});

describe('the ways to reach the organisation', () => {
	it('links the email, then each social link by its platform’s name, in a new tab', () => {
		const links = [...(footer()?.querySelectorAll('nav[aria-label="Footer"] a') ?? [])];
		expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
			['hello@greenfieldfoodbank.org', 'mailto:hello@greenfieldfoodbank.org'],
			['Instagram', 'https://instagram.com/greenfieldfoodbank'],
			['Facebook', 'https://facebook.com/greenfieldfoodbank'],
			['Staff sign in', '/admin']
		]);
		const social = links.slice(1, 3);
		expect(social.map((a) => a.getAttribute('target'))).toEqual(['_blank', '_blank']);
		expect(social.map((a) => a.getAttribute('rel'))).toEqual([
			'noopener noreferrer',
			'noopener noreferrer'
		]);
		expect(social[0]?.getAttribute('aria-label')).toBe('Instagram, opens in a new tab');
	});

	it('draws a link only where the organisation has one', () => {
		const root = footer({ email: null, socialLinks: [{ platform: 'x', href: 'https://x.com/g' }] });
		expect([...(root?.querySelectorAll('a') ?? [])].map((a) => a.textContent)).toEqual([
			'X',
			'Staff sign in'
		]);
	});
});

describe('the staff link', () => {
	const NOTHING = { legalName: null, ein: null, addressLines: [], email: null, socialLinks: [] };

	it('ends the list, a plain link to the dashboard', () => {
		const links = [...(footer()?.querySelectorAll('nav[aria-label="Footer"] li a') ?? [])];
		const last = links.at(-1);
		expect(last?.textContent).toBe('Staff sign in');
		expect(last?.getAttribute('href')).toBe('/admin');
		expect(last?.hasAttribute('target')).toBe(false);
		expect(last?.closest('li')?.nextElementSibling).toBeNull();
	});

	it('is drawn where the organisation has set nothing at all', () => {
		const root = footer(NOTHING);
		expect(root?.className).toBe('ds-site-footer-compact');
		expect(root?.querySelector('p')).toBeNull();
		expect([...(root?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))).toEqual([
			'/admin'
		]);
	});
});

describe('every social platform', () => {
	// literal names, not SOCIAL_PLATFORM_NAMES: a blank or wrong entry there must fail here
	const NAMES = {
		facebook: 'Facebook',
		instagram: 'Instagram',
		youtube: 'YouTube',
		linkedin: 'LinkedIn',
		tiktok: 'TikTok',
		x: 'X'
	} as const;

	it('is held to a name here, so a new platform fails until it is added', () => {
		expect([...SOCIAL_PLATFORMS].sort()).toEqual(Object.keys(NAMES).sort());
	});

	it.each(SOCIAL_PLATFORMS)('draws %s by its name, in a new tab, labelled so', (platform) => {
		const href = `https://example.org/${platform}`;
		const link = footer({ email: null, socialLinks: [{ platform, href }] })?.querySelector('a');
		expect(link?.textContent).toBe(NAMES[platform]);
		expect(link?.getAttribute('href')).toBe(href);
		expect(link?.getAttribute('target')).toBe('_blank');
		expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
		expect(link?.getAttribute('aria-label')).toBe(`${NAMES[platform]}, opens in a new tab`);
	});
});
