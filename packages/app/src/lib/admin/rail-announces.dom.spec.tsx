import { AppShell } from '@better-giving/operator/components/shell/AppShell';
import { type ReactNode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished } from 'vitest';
import { currentDestination, DESTINATIONS } from './destinations';

// the two halves of ../../routes/_app.tsx's rail, joined: this surface resolves the address and
// the shell announces it. either half alone is answerable where it lives — ./destinations.spec.ts
// for the resolver, packages/operator/src/components/shell/AppShell.dom.spec.tsx for the shell —
// and neither can see that what one returns is what the other takes at both kinds.
//
// what it holds is the defect the seam exists for: at /admin/forms/new the rail's Donation forms
// cell is the section the reader is in, and a cell announcing `page` there tells them the section
// is the screen. the same claim is made by whichever cell the location bar actually names, so the
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
 * the rail this app draws for a reader standing at `pathname`, as ../../routes/_app.tsx does.
 *
 * `/admin/elsewhere` is the one address below that no route answers. it is here as the shape of an
 * address under none of the destinations, which is what a screen added under `/admin` outside every
 * section would be — `/admin` itself is the dashboard's own address and is a destination.
 */
function railAt(pathname: string): HTMLElement {
	return mount(
		<AppShell destinations={DESTINATIONS} current={currentDestination(pathname)}>
			screen
		</AppShell>
	);
}

/** what the rail cell reading `label` claims, or null where it claims nothing. */
function claim(root: HTMLElement, label: string): string | null {
	const found = [...root.querySelectorAll('.adm-rail__cells > a')].find(
		(a) => a.querySelector('.adm-dest__full')?.textContent === label
	);
	if (found === undefined) throw new Error(`the rail drew no cell reading ${label}`);
	return found.getAttribute('aria-current');
}

it('claims the page on the cell whose own address the reader is at', () => {
	const root = railAt('/admin/forms');

	expect(claim(root, 'Donation forms')).toBe('page');
});

it('claims nothing anywhere when the address is under none of the destinations', () => {
	// `currentDestination` resolves none, and the shell marks none: a rail that fell back to a
	// destination here would announce a screen that is not that section as being it. the dashboard
	// is the cell this case exists to watch — its address is a prefix of every other one.
	const root = railAt('/admin/elsewhere');

	expect(claim(root, 'Dashboard')).toBe(null);
	expect(claim(root, 'Donation forms')).toBe(null);
	expect(claim(root, 'Donors')).toBe(null);
	expect(claim(root, 'Gifts')).toBe(null);
	expect(claim(root, 'Recurring gifts')).toBe(null);
});

it('claims only containment on the cell a screen one level down sits under', () => {
	// three addresses in this app are one level below a section: /admin/forms/new,
	// /admin/forms/$id and /admin/recurring/$id.
	const root = railAt('/admin/forms/new');

	expect(claim(root, 'Donation forms')).toBe('true');
});
