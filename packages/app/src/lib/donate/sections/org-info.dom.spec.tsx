import { BrandMark } from '@better-giving/operator/components/status/BrandMark';
import { SOCIAL_PLATFORMS, type SocialLink } from '@better-giving/operator/console/org';
import { SOCIAL_PLATFORM_NAMES } from '@better-giving/operator/console/social-links';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { OrgInfo } from './org-info';
import type { OrgInfo as OrgInfoValues } from './types';

// the organisation footer, mounted: each detail stands apart as a list item, only the ways to reach
// the organisation stand in `address`, and each social link is its platform's own official file,
// named for the platform and the new tab it opens in, opening the address the organisation stored.

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

/** the file packages/operator draws for a network, which is the one the page has to draw. */
function fileOf(platform: Parameters<typeof BrandMark>[0]['platform']) {
	return mount(<BrandMark platform={platform} className="page-org-mark" />)
		.querySelector('img')
		?.getAttribute('src');
}

const HREFS: Record<SocialLink['platform'], string> = {
	facebook: 'https://www.facebook.com/northsideneighbors',
	instagram: 'https://www.instagram.com/northside',
	youtube: 'https://youtu.be/dQw4w9WgXcQ',
	linkedin: 'https://www.linkedin.com/company/northside-neighbors',
	tiktok: 'https://www.tiktok.com/@northside',
	x: 'https://x.com/northside'
};

const info = (socialLinks: readonly SocialLink[]): OrgInfoValues => ({
	legalName: 'Northside Neighbors',
	ein: '84-2913377',
	addressLines: ['40 Elm Street', 'Easton, PA 18042'],
	email: 'hello@northsideneighbors.org',
	socialLinks
});

describe('org info', () => {
	const links = SOCIAL_PLATFORMS.map((platform) => ({ platform, href: HREFS[platform] }));

	it.each(SOCIAL_PLATFORMS)(
		'draws %s as its mark, named for the platform and the new tab',
		(platform) => {
			const host = mount(<OrgInfo info={info(links)} />);
			const link = host.querySelector<HTMLAnchorElement>(`a[href="${HREFS[platform]}"]`);

			expect(link?.getAttribute('aria-label')).toBe(
				`${SOCIAL_PLATFORM_NAMES[platform]}, opens in a new tab`
			);
			expect(link?.getAttribute('target')).toBe('_blank');
			expect(link?.textContent).toBe('');
			const mark = link?.querySelector('img');
			expect(mark?.getAttribute('src')).toBe(fileOf(platform));
			expect(mark?.getAttribute('alt')).toBe('');
			expect(mark?.getAttribute('aria-hidden')).toBe('true');
			expect(mark?.getAttribute('class')).toBe('page-org-mark');
		}
	);

	it('keeps the links in the order the organisation holds them', () => {
		const host = mount(<OrgInfo info={info([...links].reverse())} />);
		expect(
			[...host.querySelectorAll('.page-org-links a')].map((a) => a.getAttribute('aria-label'))
		).toEqual(
			['X', 'TikTok', 'LinkedIn', 'YouTube', 'Instagram', 'Facebook'].map(
				(name) => `${name}, opens in a new tab`
			)
		);
	});

	it('draws no row of links with none stored', () => {
		const host = mount(<OrgInfo info={info([])} />);
		expect(host.querySelector('.page-org-links')).toBeNull();
	});

	it('stands each detail apart as a list item, never one run of text', () => {
		const host = mount(<OrgInfo info={info(links)} />);
		expect([...host.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
			'Northside Neighbors',
			'EIN 84-2913377',
			'40 Elm Street, Easton, PA 18042',
			'hello@northsideneighbors.org',
			''
		]);
	});

	it('holds only the ways to reach the organisation in its address', () => {
		const host = mount(<OrgInfo info={info(links)} />);
		const address = host.querySelector('address');
		expect(address?.textContent).not.toContain('Northside Neighbors');
		expect(address?.textContent).not.toContain('EIN');
		expect(address?.textContent).toContain('40 Elm Street');
		expect(address?.querySelector('a[href="mailto:hello@northsideneighbors.org"]')).not.toBeNull();
		expect(address?.querySelectorAll('.page-org-social')).toHaveLength(links.length);
	});

	it('draws no address with no way to reach the organisation set', () => {
		const host = mount(<OrgInfo info={{ ...info([]), addressLines: [], email: null }} />);
		expect(host.querySelector('address')).toBeNull();
		expect([...host.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
			'Northside Neighbors',
			'EIN 84-2913377'
		]);
	});

	describe('draws nothing for a detail the organisation has not set', () => {
		const items = (host: HTMLElement) =>
			[...host.querySelectorAll('li')].map((li) => li.textContent);

		it('leaves out the EIN when it is null', () => {
			const host = mount(<OrgInfo info={{ ...info([]), ein: null }} />);
			expect(host.textContent).not.toContain('EIN');
			expect(items(host)).toEqual([
				'Northside Neighbors',
				'40 Elm Street, Easton, PA 18042',
				'hello@northsideneighbors.org'
			]);
		});

		it('leaves out the address line item when there are no address lines', () => {
			const host = mount(<OrgInfo info={{ ...info([]), addressLines: [] }} />);
			expect(items(host)).toEqual([
				'Northside Neighbors',
				'EIN 84-2913377',
				'hello@northsideneighbors.org'
			]);
			expect(host.querySelector('address')).not.toBeNull();
		});

		it('leaves out the mailto link when the email is null', () => {
			const host = mount(<OrgInfo info={{ ...info([]), email: null }} />);
			expect(host.querySelector('a')).toBeNull();
			expect(items(host)).toEqual([
				'Northside Neighbors',
				'EIN 84-2913377',
				'40 Elm Street, Easton, PA 18042'
			]);
		});

		it('draws no address element when every detail past the name is unset', () => {
			const host = mount(
				<OrgInfo
					info={{
						legalName: 'Northside Neighbors',
						ein: null,
						addressLines: [],
						email: null,
						socialLinks: []
					}}
				/>
			);
			expect(host.querySelector('address')).toBeNull();
			expect(items(host)).toEqual(['Northside Neighbors']);
		});
	});

	it('draws a fully set organisation as one list item per detail, only contact inside address', () => {
		const host = mount(
			<OrgInfo
				info={info([
					{ platform: 'instagram', href: HREFS.instagram },
					{ platform: 'x', href: HREFS.x }
				])}
			/>
		);
		const address = host.querySelector('address');
		const inside = [...(address?.querySelectorAll('li') ?? [])];
		const outside = [...host.querySelectorAll('li')].filter((li) => !address?.contains(li));

		expect(outside.map((li) => li.textContent)).toEqual(['Northside Neighbors', 'EIN 84-2913377']);
		expect(inside).toHaveLength(3);
		expect(inside[0]?.textContent).toBe('40 Elm Street, Easton, PA 18042');
		expect(inside[1]?.querySelector('a')?.getAttribute('href')).toBe(
			'mailto:hello@northsideneighbors.org'
		);
		expect(inside[1]?.textContent).toBe('hello@northsideneighbors.org');
		expect(
			[...(inside[2]?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))
		).toEqual([HREFS.instagram, HREFS.x]);
	});
});
