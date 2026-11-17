import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../render.testing';
import { ActionMenu, type ShellLinkProps } from './ActionMenu.jsx';

// a press and its panel on menu-css: the panel is named by the press, its runs are parted by a
// separator, an internal row is drawn through the caller's link, and the keyboard walks it past
// nothing it should not.

async function press(key: string): Promise<void> {
	await act(async () => {
		document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
	});
}

function RouterishLink(props: ShellLinkProps) {
	return <a data-routed="" {...props} />;
}

const trigger = (
	<button type="button" className="ds-icon-bare" aria-label="More actions for Winter appeal" />
);

describe('an action menu', () => {
	it('is closed until pressed, and the press says it opens a menu', () => {
		const root = render(ActionMenu, {
			trigger,
			placement: 'below-end',
			runs: [[{ label: 'Edit', onSelect: () => {} }]]
		});

		const button = root.querySelector('button');
		expect(button?.getAttribute('aria-haspopup')).toBe('menu');
		expect(button?.getAttribute('aria-expanded')).toBe('false');
		expect(root.querySelector<HTMLElement>('.ds-menu')?.hidden).toBe(true);
	});

	it('parts its runs with a separator, marks a destructive row, and routes an internal link', async () => {
		const root = render(ActionMenu, {
			trigger,
			placement: 'below-end',
			link: RouterishLink,
			runs: [
				[
					{ label: 'Edit', href: '/admin/forms/1', internal: true, mark: 'pencil' },
					{ label: 'Preview', href: '/donate' }
				],
				[{ label: 'Delete form', destructive: true, onSelect: () => {} }]
			]
		});
		act(() => root.querySelector('button')?.focus());
		await press('ArrowDown');

		const panel = root.querySelector('.ds-menu');
		expect(panel?.getAttribute('role')).toBe('menu');
		expect(panel?.getAttribute('aria-labelledby')).toBe(root.querySelector('button')?.id);
		const children = [...(panel?.children ?? [])].map((child) =>
			child.tagName === 'HR' ? 'separator' : child.textContent
		);
		expect(children).toEqual(['Edit', 'Preview', 'separator', 'Delete form']);
		const [edit, preview, remove] = [...(panel?.querySelectorAll('[role="menuitem"]') ?? [])];
		expect(edit?.hasAttribute('data-routed')).toBe(true);
		expect(preview?.hasAttribute('data-routed')).toBe(false);
		expect(remove?.className).toBe('ds-menu-item ds-menu-item-destructive');
		expect(edit?.querySelector('.ds-lead-1lh > svg')).not.toBeNull();
	});

	it('runs the row Enter lands on and hands focus back to the press', async () => {
		const chosen = vi.fn();
		const root = render(ActionMenu, {
			trigger,
			placement: 'below-end',
			runs: [
				[
					{ label: 'Duplicate', onSelect: chosen },
					{ label: 'Archive', onSelect: () => {} }
				]
			]
		});
		const button = root.querySelector('button');
		act(() => button?.focus());

		await press('ArrowDown');
		await press('Enter');
		await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

		expect(chosen).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(button);
	});
});
