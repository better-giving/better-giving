import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { EndedCampaignPage } from './plain-page';
import type { SiteFooterInfo } from './site-footer';

// an ended campaign's screen, mounted: the site nav over it and the compact site footer under it,
// as every other donor page draws them.

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

const FOOTER: SiteFooterInfo = {
	legalName: 'Northside Neighbors Inc.',
	ein: '84-2917453',
	addressLines: ['410 Alder Street', 'Portland, OR 97214'],
	email: 'hello@northsideneighbors.org',
	socialLinks: []
};

const ended = (footer: SiteFooterInfo) =>
	mount(
		<EndedCampaignPage
			name="Winter coat drive"
			orgName="Northside Neighbors"
			look={{ brandColour: null }}
			footer={footer}
		/>
	);

describe('an ended campaign’s screen', () => {
	it('draws the compact site footer after its main, stating the organisation’s details', () => {
		const root = ended(FOOTER);
		const footer = root.querySelector('footer.ds-site-footer-compact');
		expect(footer?.textContent).toContain('Northside Neighbors Inc. · EIN 84-2917453');
		expect(footer?.querySelector('a')?.getAttribute('href')).toBe(
			'mailto:hello@northsideneighbors.org'
		);
		const main = root.querySelector('main');
		expect(main?.compareDocumentPosition(footer as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it('draws the footer with only the staff link where the organisation has set no details', () => {
		const none = { legalName: null, ein: null, addressLines: [], email: null, socialLinks: [] };
		const footer = ended(none).querySelector('footer.ds-site-footer-compact');
		expect(footer?.querySelector('p')).toBeNull();
		expect([...(footer?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))).toEqual([
			'/admin'
		]);
	});
});
