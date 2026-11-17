import { describe, expect, it } from 'vitest';
import { ACCOUNT, mountScreen, ORG, one } from './area.testing';
import { SupporterShell, type SupporterOrg } from './shell';

// every supporter screen's frame closes on the compact site footer a donor page draws: the legal
// line once, and each way to reach the organisation only where it has set one.

const frame = (footer: Partial<SupporterOrg['footer']> = {}) =>
	mountScreen(() => (
		<SupporterShell org={{ ...ORG, footer: { ...ORG.footer, ...footer } }} account={ACCOUNT}>
			<h1>Your fundraisers</h1>
		</SupporterShell>
	));

describe('the supporter area’s site footer', () => {
	it('draws one footer, after the screen', () => {
		const { root } = frame();
		expect(root.querySelectorAll('footer')).toHaveLength(1);
		const footer = one(root, 'footer.ds-site-footer-compact');
		expect(
			one(root, 'main').compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('states the legal name, the EIN and the address on one line', () => {
		const { root } = frame({
			ein: '84-2917453',
			addressLines: ['410 Alder Street', 'Portland, OR 97214']
		});
		expect(one(root, 'footer p').textContent).toBe(
			'Harbor Light · EIN 84-2917453 · 410 Alder Street, Portland, OR 97214'
		);
	});

	it('draws no links where the organisation has set none', () => {
		const { root } = frame();
		const footer = one(root, 'footer');
		expect(footer.querySelector('nav')).toBeNull();
		expect(footer.querySelectorAll('a')).toHaveLength(0);
	});

	it('links the email, then each social link, where they are set', () => {
		const { root } = frame({
			email: 'hello@harborlight.org',
			socialLinks: [{ platform: 'instagram', href: 'https://instagram.com/harborlight' }]
		});
		const links = [...one(root, 'footer nav[aria-label="Footer"]').querySelectorAll('a')];
		expect(links.map((link) => link.getAttribute('href'))).toEqual([
			'mailto:hello@harborlight.org',
			'https://instagram.com/harborlight'
		]);
	});

	it('draws no footer where nothing is set', () => {
		const { root } = frame({ legalName: null });
		expect(root.querySelector('footer')).toBeNull();
	});
});
