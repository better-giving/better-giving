import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { SiteFooter, type SiteFooterInfo } from './site-footer';

// the site footer, mounted: the legal line once, and each way to reach the organisation only where
// it has set one.

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
			['Facebook', 'https://facebook.com/greenfieldfoodbank']
		]);
		const social = links.slice(1);
		expect(social.map((a) => a.getAttribute('target'))).toEqual(['_blank', '_blank']);
		expect(social.map((a) => a.getAttribute('rel'))).toEqual([
			'noopener noreferrer',
			'noopener noreferrer'
		]);
		expect(social[0]?.getAttribute('aria-label')).toBe('Instagram, opens in a new tab');
	});

	it('draws a link only where the organisation has one', () => {
		const root = footer({ email: null, socialLinks: [{ platform: 'x', href: 'https://x.com/g' }] });
		expect([...(root?.querySelectorAll('a') ?? [])].map((a) => a.textContent)).toEqual(['X']);
	});

	it('draws no list where there are none', () => {
		expect(footer({ email: null, socialLinks: [] })?.querySelector('nav')).toBeNull();
	});
});

it('draws no footer where the organisation has set nothing at all', () => {
	expect(
		footer({ legalName: null, ein: null, addressLines: [], email: null, socialLinks: [] })
	).toBeNull();
});
