import type { FormConfig } from '@better-giving/form/v1';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { EndedCampaignPage, PlainDonationPage } from './plain-page';
import { NAMELESS_FOOTER, SiteFooter, type SiteFooterInfo } from './site-footer';
import { StaffMarkerContext } from './staff-marker-context';

// an ended campaign's screen, mounted: the site nav over it and the compact site footer under it,
// as every other donor page draws them. and the plain donation page, which draws the footer it is
// given under its box.

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

	it('draws no footer where the organisation has set no details and no marker is present', () => {
		const none = { legalName: null, ein: null, addressLines: [], email: null, socialLinks: [] };
		expect(ended(none).querySelector('footer')).toBeNull();
	});
});

const CONFIG: FormConfig = {
	formId: 'ff000000-0000-4000-8000-000000000001',
	providers: [{ name: 'stripe', publishableKey: 'pk_test_spec' }],
	currency: 'usd',
	suggestedAmountsMinor: [1000, 2500, 5000],
	minAmountMinor: 500,
	maxAmountMinor: 500000,
	frequencies: ['one_time'],
	paymentMethods: ['card'],
	feeCoverage: 'optional',
	feeRules: {
		card: { percent: 0.029, fixedMinor: 30 },
		apple_pay: { percent: 0.029, fixedMinor: 30 },
		google_pay: { percent: 0.029, fixedMinor: 30 },
		ach: { percent: 0.008, fixedMinor: 0, capMinor: 500 },
		paypal: { percent: 0.0349, fixedMinor: 49 },
		venmo: { percent: 0.0349, fixedMinor: 49 },
		daf: { percent: 0.029, fixedMinor: 0, roundUpMinor: 100 },
		crypto: { percent: 0.01, fixedMinor: 0 },
		stock: { percent: 0, fixedMinor: 0 },
		ira_qcd: { percent: 0, fixedMinor: 0 }
	},
	locale: 'en-US',
	orgLegalName: 'Northside Neighbors',
	ein: '84-2913377',
	deductibilityStatement: 'Northside Neighbors is a 501(c)(3).',
	turnstileSiteKey: '1x00000000000000000000AA'
};

describe('the plain donation page', () => {
	it('draws a nameless footer after its main only for a browser carrying the marker', () => {
		const page = (
			<PlainDonationPage
				config={CONFIG}
				look={{ brandColour: null }}
				footer={<SiteFooter info={NAMELESS_FOOTER} />}
			/>
		);
		expect(mount(page).querySelector('footer')).toBeNull();

		const root = mount(<StaffMarkerContext value={true}>{page}</StaffMarkerContext>);
		const footer = root.querySelector('footer.ds-site-footer-compact');
		expect(footer?.querySelector('p')).toBeNull();
		const links = [...(footer?.querySelectorAll('a') ?? [])];
		expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
			['Console', '/admin']
		]);
		const main = root.querySelector('main');
		expect(main?.compareDocumentPosition(footer as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it('draws no footer where it is given none', () => {
		const root = mount(<PlainDonationPage config={CONFIG} look={{ brandColour: null }} />);
		expect(root.querySelector('footer')).toBeNull();
	});
});
