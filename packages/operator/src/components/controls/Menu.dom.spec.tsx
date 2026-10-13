import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../render.testing';
import { Menu, type MenuProps } from './Menu.jsx';

// a menu's press and its lines, operated from the keyboard: the press is named, opens from the
// keys the machine answers, walks its lines with the arrows, runs the line Enter lands on and hands
// the focus back to the press; Escape closes it with nothing run. a link line is a link. the roles
// and keys are ark's and are read here only as what an operator meets.

/** a key pressed wherever focus stands. async, because the machine settles on a microtask. */
async function press(key: string): Promise<void> {
	await act(async () => {
		document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
	});
}

function trigger(root: HTMLElement): HTMLButtonElement {
	const found = root.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
	if (found === null) throw new Error('the case drew no menu press');
	return found;
}

const list = (root: HTMLElement) => root.querySelector<HTMLElement>('[role="menu"]');
const highlighted = (root: HTMLElement) =>
	root.querySelector('[role="menuitem"][data-highlighted]')?.textContent;

function items(over: Partial<Record<'reset' | 'discard', () => void>> = {}): MenuProps['items'] {
	return [
		{ label: 'Open /donate', href: '/donate', newTab: true },
		{ label: 'Reset to default', onSelect: over.reset ?? (() => {}) },
		{ label: 'Discard changes', onSelect: over.discard ?? (() => {}) }
	];
}

describe('a menu mounted into a document', () => {
	it('is a press named for what it holds, closed until pressed', () => {
		const root = render(Menu, { label: 'More', items: items() });

		expect(trigger(root).getAttribute('aria-label')).toBe('More');
		expect(trigger(root).getAttribute('aria-expanded')).toBe('false');
		expect(list(root)?.hidden).toBe(true);
	});

	it('opens from the keyboard and runs the line Enter lands on, the focus back on the press', async () => {
		const discard = vi.fn();
		const reset = vi.fn();
		const root = render(Menu, { label: 'More', items: items({ discard, reset }) });
		act(() => trigger(root).focus());

		await press('ArrowDown');
		expect(trigger(root).getAttribute('aria-expanded')).toBe('true');
		expect(highlighted(root)).toBe('Open /donate (opens in a new tab)');

		await press('ArrowDown');
		await press('ArrowDown');
		expect(highlighted(root)).toBe('Discard changes');

		await press('Enter');
		await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

		expect(discard).toHaveBeenCalledOnce();
		expect(reset).not.toHaveBeenCalled();
		expect(trigger(root).getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(trigger(root));
	});

	it('closes on Escape with nothing run', async () => {
		const reset = vi.fn();
		const root = render(Menu, { label: 'More', items: items({ reset }) });
		act(() => trigger(root).focus());
		await press('ArrowDown');

		await press('Escape');

		expect(trigger(root).getAttribute('aria-expanded')).toBe('false');
		expect(reset).not.toHaveBeenCalled();
	});

	it('keeps a link line out of the tab sequence, so Tab stays in the list and the arrows walk across it', async () => {
		const reset = vi.fn();
		const root = render(Menu, { label: 'More', items: items({ reset }) });
		act(() => trigger(root).focus());
		await press('ArrowDown');
		const link = root.querySelector<HTMLAnchorElement>('a[role="menuitem"]');

		expect(link?.tabIndex).toBe(-1);
		const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
		await act(async () => {
			document.activeElement?.dispatchEvent(tab);
		});
		expect(tab.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(list(root));

		expect(highlighted(root)).toBe('Open /donate (opens in a new tab)');
		await press('ArrowDown');
		expect(highlighted(root)).toBe('Reset to default');
		await press('ArrowUp');
		expect(highlighted(root)).toBe('Open /donate (opens in a new tab)');

		await press('Escape');
		expect(trigger(root).getAttribute('aria-expanded')).toBe('false');
		expect(reset).not.toHaveBeenCalled();
	});

	it('stands open whatever is pressed when held open', async () => {
		const root = render(Menu, { label: 'More', items: items(), open: true });
		expect(list(root)?.hidden).toBe(false);

		act(() => list(root)?.focus());
		await press('Escape');

		expect(list(root)?.hidden).toBe(false);
	});

	it('draws a link line as a link, opening in a new tab where it says so', () => {
		const root = render(Menu, { label: 'More', items: items(), open: true });
		const link = root.querySelector<HTMLAnchorElement>('a[role="menuitem"]');

		expect(link?.getAttribute('href')).toBe('/donate');
		expect(link?.target).toBe('_blank');
		expect(link?.rel.split(' ')).toContain('noopener');
		expect(link?.textContent).toBe('Open /donate (opens in a new tab)');
	});
});
