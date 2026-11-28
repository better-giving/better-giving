import { Shell } from '@better-giving/operator/components/shell/Shell';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished } from 'vitest';
import { currentDestination, DESTINATION_GROUPS } from './destinations';

// the two halves of ../../routes/_app.tsx's rail, joined: this surface resolves the address and
// the shell announces it. either half alone is answerable where it lives — ./destinations.spec.ts
// for the resolver, packages/operator/src/components/shell/Shell.dom.spec.tsx for the shell — and
// neither can see that what one returns is what the other takes at both kinds and for a section.
//
// what it holds is the defect the seam exists for: at /admin/forms/new the rail's Donation forms
// row is the section the reader is in, and a row announcing `page` there tells them the section
// is the screen. the same claim is made by whichever row the location bar actually names, so the
// two have to be told apart or the rail makes it twice.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * mounts `tree` into a document that lives as long as the case, and hands back its root element.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
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

/**
 * the sidebar this app draws for a reader standing at `pathname`, as ../../routes/_app.tsx does.
 *
 * `/admin/elsewhere` is the one address below that no route answers. it is here as the shape of an
 * address under none of the destinations, which is what a screen added under `/admin` outside every
 * section would be — `/admin` itself is the dashboard's own address and is a destination.
 */
function railAt(pathname: string): HTMLElement {
	const root = mount(
		<Shell
			orgName="Riverside Shelter"
			home={{ href: '/admin', label: 'Dashboard' }}
			groups={DESTINATION_GROUPS}
			current={currentDestination(pathname)}
			staff={{ name: 'Nadia Hart', email: 'nadia@riverside.example' }}
			onSignOut={() => {}}
		>
			screen
		</Shell>
	);
	const sidebar = root.querySelector<HTMLElement>('.ds-shell-sidebar');
	if (sidebar === null) throw new Error('the shell drew no sidebar');
	return sidebar;
}

/** the sidebar's row reading `label`, its parent's link for a parent. */
function row(root: HTMLElement, label: string): Element {
	const found = [...root.querySelectorAll('a.ds-nav-link:not(.ds-shell-rail-parent)')].find(
		(a) => a.querySelector('.ds-nav-label')?.textContent === label
	);
	if (found === undefined) throw new Error(`the rail drew no row reading ${label}`);
	return found;
}

/** what the row reading `label` claims, or null where it claims nothing. */
const claim = (root: HTMLElement, label: string) => row(root, label).getAttribute('aria-current');

it('claims the page on the row whose own address the reader is at', () => {
	const root = railAt('/admin/forms');

	expect(claim(root, 'Donation forms')).toBe('page');
});

it('claims nothing anywhere when the address is under none of the destinations', () => {
	// `currentDestination` resolves none, and the shell marks none: a rail that fell back to a
	// destination here would announce a screen that is not that section as being it. the dashboard
	// is the row this case exists to watch — its address is a prefix of every other one.
	const root = railAt('/admin/elsewhere');

	expect(claim(root, 'Dashboard')).toBe(null);
	expect(claim(root, 'Donation forms')).toBe(null);
	expect(claim(root, 'Donors')).toBe(null);
	expect(claim(root, 'Gifts')).toBe(null);
	expect(claim(root, 'Recurring gifts')).toBe(null);
});

it('claims only containment on the row a screen one level down sits under', () => {
	// three addresses in this app are one level below a section: /admin/forms/new,
	// /admin/forms/$id and /admin/recurring/$id.
	const root = railAt('/admin/forms/new');

	expect(claim(root, 'Donation forms')).toBe('true');
});

it('opens Settings over its sections and claims the page on the section the reader is at', () => {
	const root = railAt('/admin/settings/notifications');

	expect(row(root, 'Settings').getAttribute('aria-expanded')).toBe('true');
	expect(claim(root, 'Notifications')).toBe('page');
	expect(claim(root, 'Organisation details')).toBe(null);
	expect(claim(root, 'Mail')).toBe(null);
});

it('keeps Settings shut away from its sections', () => {
	expect(row(railAt('/admin/donors'), 'Settings').getAttribute('aria-expanded')).toBe('false');
});
