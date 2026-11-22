/**
 * @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
 */
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { PublicPageCard } from './public-page';

// what the editor's Public page card holds for an active program and for an archived one, and what
// its copy control does. what renders and what it is named, never how it looks: layout is PM
// acceptance, and AGENTS.md keeps a browser spec off every /admin screen.

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

const URL = 'https://cedarfork.example/programs/0f8dK2mQ';
const PREVIEW = '/programs/0f8dK2mQ?preview=1';

const card = (archived: boolean) =>
	mount(<PublicPageCard name="Winter coats" url={URL} previewSrc={PREVIEW} archived={archived} />);

const openPage = (root: HTMLElement) =>
	[...root.querySelectorAll('a')].find((link) => link.textContent === 'Open page');

describe('an archived program', () => {
	it('says its page takes no gifts, offers Open page, and draws no slab or preview', () => {
		const root = card(true);

		expect(root.textContent).toContain(
			'This program is archived, so its page tells donors it isn’t taking gifts and offers the donate page.'
		);
		expect(openPage(root)?.getAttribute('href')).toBe(URL);
		expect(root.querySelector('.adm-slab')).toBeNull();
		expect(root.querySelector('iframe')).toBeNull();
		expect(root.textContent).not.toContain('Donors who open this link');
	});
});

describe('an active program', () => {
	it('draws the link in a slab named Link, with its copy control', () => {
		const root = card(false);

		expect(root.textContent).toContain(
			'Donors who open this link see the program and can give to it.'
		);
		const slab = root.querySelector('.adm-slab');
		expect(slab?.querySelector('pre')?.textContent).toBe(URL);
		expect(slab?.getAttribute('role')).toBe('group');
		expect(document.getElementById(slab?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
			'Link'
		);
		expect(slab?.querySelector('button')?.getAttribute('aria-label')).toBe('Copy link');
	});

	it('opens the page in a new tab', () => {
		const link = openPage(card(false));

		expect([
			link?.getAttribute('href'),
			link?.getAttribute('target'),
			link?.getAttribute('rel')
		]).toEqual([URL, '_blank', 'noopener']);
	});

	it('previews the saved page in a frame no tab stop reaches', () => {
		const root = card(false);
		const frame = root.querySelector('iframe');

		expect(root.textContent).toContain('How the page looks on a phone. It shows what is saved.');
		expect([
			frame?.getAttribute('src'),
			frame?.getAttribute('title'),
			frame?.getAttribute('tabindex')
		]).toEqual([PREVIEW, 'Preview of the Winter coats page', '-1']);
	});

	// a frame whose `src` changes navigates, and that navigation is a Back-button entry on the
	// editor's tab; a new frame is not.
	describe('drawn again after a save', () => {
		function redrawn(previewSrc: string): [Element | null, Element | null] {
			const root = document.createElement('div');
			document.body.appendChild(root);
			const mounted = createRoot(root);
			const draw = (src: string) =>
				act(() =>
					mounted.render(
						<PublicPageCard name="Winter coats" url={URL} previewSrc={src} archived={false} />
					)
				);
			onTestFinished(() => {
				act(() => mounted.unmount());
				root.remove();
			});
			draw(PREVIEW);
			const before = root.querySelector('iframe');
			draw(previewSrc);
			return [before, root.querySelector('iframe')];
		}

		it('draws a new frame when the preview’s address changed', () => {
			const [before, after] = redrawn('/programs/0f8dK2mQ?preview=2');
			expect(after?.getAttribute('src')).toBe('/programs/0f8dK2mQ?preview=2');
			expect(after).not.toBe(before);
		});

		it('keeps the same frame when the address did not change', () => {
			const [before, after] = redrawn(PREVIEW);
			expect(after).not.toBeNull();
			expect(after).toBe(before);
		});
	});
});

describe('copying the link', () => {
	let writeText: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		writeText = vi.fn(() => Promise.resolve());
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const control = (root: HTMLElement) => {
		const found = root.querySelector<HTMLButtonElement>('.adm-slab button');
		if (found === null) throw new Error('the card drew no copy control');
		return found;
	};
	const status = (root: HTMLElement) => root.querySelector('.adm-slab [aria-live="polite"]');

	async function press(root: HTMLElement) {
		await act(async () => {
			control(root).click();
			for (let tick = 0; tick < 10; tick++) await Promise.resolve();
		});
	}

	async function elapse(ms: number) {
		await act(async () => {
			vi.advanceTimersByTime(ms);
		});
	}

	it('puts the address on the clipboard, says Link copied, and returns after 2000ms', async () => {
		const root = card(false);

		await press(root);
		await elapse(0);
		expect(writeText).toHaveBeenCalledWith(URL);
		expect([
			control(root).getAttribute('aria-label'),
			control(root).getAttribute('data-done'),
			status(root)?.textContent
		]).toEqual(['Link copied', 'true', 'Link copied']);

		await elapse(1999);
		expect(control(root).getAttribute('aria-label')).toBe('Link copied');

		await elapse(1);
		expect([
			control(root).getAttribute('aria-label'),
			control(root).hasAttribute('data-done'),
			status(root)?.textContent
		]).toEqual(['Copy link', false, '']);
	});

	it('says the clipboard refused, as every copy control does, with the address still on the line', async () => {
		writeText.mockRejectedValue(new Error('permission refused'));
		const root = card(false);

		await press(root);
		await elapse(0);

		expect([
			control(root).getAttribute('aria-label'),
			control(root).hasAttribute('data-done'),
			status(root)?.textContent,
			root.querySelector('.adm-slab pre')?.textContent
		]).toEqual(['Copy blocked', false, 'Copy blocked', URL]);
	});
});
