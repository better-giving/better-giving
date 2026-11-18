import { act } from 'react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
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

/** a link that routes as a router's does: the caller's click handler first, then its own, which
 * takes a plain click and keeps the document where it is. */
function routerLink(routed: (href: string) => void) {
	return function RoutingLink(props: ShellLinkProps) {
		return (
			// biome-ignore lint/a11y: a router's link is an anchor whose click handler routes; this stands in for one.
			<a
				data-routed=""
				{...props}
				// biome-ignore lint/a11y/useValidAnchor: the click handler is the router's, and the anchor keeps its href.
				onClick={(event) => {
					props.onClick?.(event);
					if (event.defaultPrevented || event.button !== 0) return;
					if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
					event.preventDefault();
					routed(props.href);
				}}
			/>
		);
	};
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

	describe('a link row', () => {
		/** opens the menu from the keyboard over an internal row and an external one. */
		async function opened(routed: (href: string) => void) {
			const root = render(ActionMenu, {
				trigger,
				placement: 'below-end',
				link: routerLink(routed),
				runs: [
					[
						{ label: 'Edit donation page', href: '/admin/donation-page', internal: true },
						{ label: 'Open donation page', href: '/donate' }
					]
				]
			});
			const button = root.querySelector('button');
			act(() => button?.focus());
			await press('ArrowDown');
			return { root, button };
		}
		/** every click that reaches an anchor in the document, kept so its outcome can be read after. */
		function clicksOnLinks() {
			const clicks: MouseEvent[] = [];
			const keep = (event: Event) => {
				if (event instanceof MouseEvent && (event.target as Element).closest('a[href]'))
					clicks.push(event);
			};
			window.addEventListener('click', keep, true);
			onTestFinished(() => window.removeEventListener('click', keep, true));
			return clicks;
		}
		const settle = () =>
			act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

		it('routes an internal row on a press, through the caller’s link', async () => {
			const routed = vi.fn();
			const { root, button } = await opened(routed);
			const edit = [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
				(item) => item.textContent === 'Edit donation page'
			);

			await act(async () => edit?.click());

			expect(routed).toHaveBeenCalledExactlyOnceWith('/admin/donation-page');
			expect(button?.getAttribute('aria-expanded')).toBe('false');
		});

		it.each(['Enter', ' '])(
			'routes an internal row on %j the way a press does, keeping the document',
			async (key) => {
				const routed = vi.fn();
				const clicks = clicksOnLinks();
				const { button } = await opened(routed);

				await press(key);
				await settle();

				expect(routed).toHaveBeenCalledExactlyOnceWith('/admin/donation-page');
				expect(clicks.map((click) => click.defaultPrevented)).toEqual([true]);
				expect(button?.getAttribute('aria-expanded')).toBe('false');
			}
		);

		it('follows an external row on Enter as a plain link, past the router', async () => {
			const routed = vi.fn();
			const clicks = clicksOnLinks();
			await opened(routed);

			await press('ArrowDown');
			await press('Enter');
			await settle();

			expect(routed).not.toHaveBeenCalled();
			expect(
				clicks.map((click) => (click.target as HTMLAnchorElement).getAttribute('href'))
			).toEqual(['/donate']);
			expect(clicks[0]?.defaultPrevented).toBe(false);
		});
	});
});
