import { AppShell } from '@better-giving/operator/components/shell/AppShell';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished } from 'vitest';
import { DESTINATION_GROUPS, destinationGroupsFor } from '../destinations';

// the Supporter pages cell as the shell draws it: in the column, left off the phone's bar, and on
// the More sheet a press on More opens. ../destinations.spec.ts holds the entry's own fields.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(deployer: boolean): HTMLElement {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() =>
		root.render(
			<AppShell
				org="Harbor Light"
				groups={destinationGroupsFor(deployer)}
				current="Dashboard"
				wayOut={null}
			>
				<p>the screen</p>
			</AppShell>
		)
	);
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return host;
}

const railCell = (host: HTMLElement, label: string) =>
	[...host.querySelectorAll('.adm-rail__cells a')].find(
		(a) => a.querySelector('.adm-dest__full')?.textContent === label
	) ?? null;

it('draws Supporter pages in the column, left to the More sheet on the bar', () => {
	const host = mount(true);
	const cell = railCell(host, 'Supporter pages');

	expect(cell?.getAttribute('href')).toBe('/admin/supporter-pages');
	expect(cell?.querySelector('.adm-dest__short')?.textContent).toBe('Supporter');
	expect(cell?.classList.contains('adm-dest--offbar')).toBe(true);
	expect(
		[...host.querySelectorAll('.adm-rail__cells a:not(.adm-dest--offbar)')].map(
			(a) => a.querySelector('.adm-dest__full')?.textContent
		)
	).toEqual(['Dashboard', 'Campaigns', 'Donors', 'Gifts']);
});

it('lists Supporter pages first on the More sheet, before Donation forms', async () => {
	const host = mount(true);
	const more = host.querySelector<HTMLButtonElement>('.adm-rail__more');
	await act(async () => more?.click());
	const sheet = document.querySelector('.adm-moresheet__cells');
	const labels = [...(sheet?.querySelectorAll('a') ?? [])].map(
		(a) => a.querySelector('.adm-dest__full')?.textContent
	);

	expect(labels[0]).toBe('Supporter pages');
	expect(labels).toContain('Donation forms');
	expect(labels.indexOf('Supporter pages')).toBeLessThan(labels.indexOf('Donation forms'));
});

it('is drawn for a member as for the deployer, and leaves the deployer-only cells as they were', () => {
	const host = mount(false);

	expect(railCell(host, 'Supporter pages')).not.toBeNull();
	expect(railCell(host, 'Settings')).toBeNull();
	expect(railCell(host, 'Payments')).toBeNull();
	expect(destinationGroupsFor(true)).toEqual(DESTINATION_GROUPS);
});
