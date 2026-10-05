import { SOCIAL_PLATFORMS, type SocialLink } from '@better-giving/operator/console/org';
import { SOCIAL_PLATFORM_NAMES } from '@better-giving/operator/console/social-links';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { OrgInfoBlock } from './org-info';
import type { BlockOf, OrgInfo } from './types';

// the org-info block's social links, mounted in both variants: each is its platform's mark, named
// for the platform and the new tab it opens in, and opens the address the organisation stored.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: ReactNode) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(node));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return host;
}

const HREFS: Record<SocialLink['platform'], string> = {
	facebook: 'https://www.facebook.com/northsideneighbors',
	instagram: 'https://www.instagram.com/northside',
	youtube: 'https://youtu.be/dQw4w9WgXcQ',
	linkedin: 'https://www.linkedin.com/company/northside-neighbors',
	tiktok: 'https://www.tiktok.com/@northside',
	x: 'https://x.com/northside'
};

const info = (socialLinks: readonly SocialLink[]): OrgInfo => ({
	legalName: 'Northside Neighbors',
	ein: '84-2913377',
	addressLines: ['40 Elm Street', 'Easton, PA 18042'],
	email: 'hello@northsideneighbors.org',
	socialLinks
});

const block = (variant: 'footer' | 'card'): BlockOf<'org-info'> => ({
	id: `b-${variant}`,
	type: 'org-info',
	variant,
	background: 'none'
});

describe.each(['footer', 'card'] as const)('org info, %s', (variant) => {
	const links = SOCIAL_PLATFORMS.map((platform) => ({ platform, href: HREFS[platform] }));

	it.each(SOCIAL_PLATFORMS)(
		'draws %s as its mark, named for the platform and the new tab',
		(platform) => {
			const host = mount(<OrgInfoBlock block={block(variant)} info={info(links)} />);
			const link = host.querySelector<HTMLAnchorElement>(`a[href="${HREFS[platform]}"]`);

			expect(link?.getAttribute('aria-label')).toBe(
				`${SOCIAL_PLATFORM_NAMES[platform]}, opens in a new tab`
			);
			expect(link?.getAttribute('target')).toBe('_blank');
			expect(link?.textContent).toBe('');
			const mark = link?.querySelector('svg');
			expect(mark?.getAttribute('class')).toContain(`tabler-icon-brand-${platform}`);
			expect(mark?.getAttribute('aria-hidden')).toBe('true');
			expect(mark?.getAttribute('stroke')).toBe('currentColor');
		}
	);

	it('keeps the links in the order the organisation holds them', () => {
		const host = mount(<OrgInfoBlock block={block(variant)} info={info([...links].reverse())} />);
		expect(
			[...host.querySelectorAll('.page-org-links a')].map((a) => a.getAttribute('aria-label'))
		).toEqual(
			['X', 'TikTok', 'LinkedIn', 'YouTube', 'Instagram', 'Facebook'].map(
				(name) => `${name}, opens in a new tab`
			)
		);
	});

	it('draws no row of links with none stored', () => {
		const host = mount(<OrgInfoBlock block={block(variant)} info={info([])} />);
		expect(host.querySelector('.page-org-links')).toBeNull();
	});
});
