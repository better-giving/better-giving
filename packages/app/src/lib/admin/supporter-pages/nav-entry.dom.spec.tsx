import { Shell } from '@better-giving/operator/components/shell/Shell';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished } from 'vitest';
import { DESTINATION_GROUPS, destinationGroupsFor } from '../destinations';

// the Supporter pages row as the shell draws it: in the sidebar after Campaigns, and in the
// phone's drawer the same. ../destinations.spec.ts holds the entry's own fields.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(deployer: boolean): HTMLElement {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() =>
		root.render(
			<Shell
				orgName="Harbor Light"
				home={{ href: '/admin', label: 'Dashboard' }}
				groups={destinationGroupsFor(deployer)}
				current={{ label: 'Dashboard', kind: 'page' }}
				staff={{ name: 'Nadia Hart', email: 'nadia@harborlight.example' }}
				donationPage="/"
				editDonationPage="/admin/donation-page"
				onSignOut={() => {}}
			>
				<p>the screen</p>
			</Shell>
		)
	);
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return host;
}

/** the labels of the rows in `place`, in order: the sidebar or the drawer. */
const rows = (host: HTMLElement, place: '.ds-shell-sidebar' | '.ds-shell-drawer') =>
	[...host.querySelectorAll(`${place} nav[aria-label="Sidebar"] a.ds-nav-link`)].map(
		(a) => a.querySelector('.ds-nav-label')?.textContent
	);

it('draws Supporter pages right after Campaigns, at its own address', () => {
	const host = mount(true);
	const labels = rows(host, '.ds-shell-sidebar');
	const row = [...host.querySelectorAll('.ds-shell-sidebar a.ds-nav-link')].find(
		(a) => a.querySelector('.ds-nav-label')?.textContent === 'Supporter pages'
	);

	expect(row?.getAttribute('href')).toBe('/admin/supporter-pages');
	expect(labels.indexOf('Supporter pages')).toBe(labels.indexOf('Campaigns') + 1);
});

it('draws it in the phone’s drawer as in the sidebar', () => {
	const host = mount(true);

	expect(rows(host, '.ds-shell-drawer')).toContain('Supporter pages');
});

it('is drawn for a member as for the deployer, and leaves the deployer-only rows as they were', () => {
	const labels = rows(mount(false), '.ds-shell-sidebar');

	expect(labels).toContain('Supporter pages');
	expect(labels).not.toContain('Settings');
	expect(labels).not.toContain('Payments');
	expect(destinationGroupsFor(true)).toEqual(DESTINATION_GROUPS);
});
