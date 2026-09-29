import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { replaceRefusal } from '../editor/replace-photo';
import { LogoControl, type LogoControlProps } from './logo-control';

// the Organisation page's logo in each state it can stand in: none, a pick uploading, a pick
// refused, a logo placed, a save just landed and a removal just landed, each with Undo. the press,
// the refusal and the resize are ../editor/replace-photo.dom.spec.tsx's; what is held here is what
// the logo adds to them.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: ReactElement) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(node));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return { host, redraw: (next: ReactElement) => act(() => root.render(next)) };
}

const LOGO = '0192a4c1-0000-7000-8000-00000000000a';

const props = (over: Partial<LogoControlProps> = {}): LogoControlProps => ({
	imageId: LOGO,
	onResized: () => {},
	onRemove: () => {},
	...over
});

const buttons = (host: HTMLElement) =>
	[...host.querySelectorAll('button')].map((button) => button.textContent);
const report = (host: HTMLElement) => host.querySelector('fieldset > .adm-actions [role="status"]');

describe('the logo group', () => {
	it('is named Logo and described by where the logo stands', () => {
		const { host } = mount(<LogoControl {...props()} />);
		const group = host.querySelector('fieldset');
		const hint = document.getElementById(group?.getAttribute('aria-describedby') ?? '');

		expect(group?.querySelector('legend')?.textContent).toBe('Logo');
		expect(hint?.textContent).toContain('Atop the Donation page and every campaign.');
		expect(hint?.textContent).toContain('twice as wide as it is tall stands in for your name');
	});

	it('carries the caller’s placement on the group', () => {
		const { host } = mount(<LogoControl {...props({ className: 'is-placed' })} />);
		expect(host.querySelector('fieldset')?.className).toBe('adm-fieldset is-placed');
	});
});

describe('each state', () => {
	it('none: offers Add logo alone', () => {
		const { host } = mount(<LogoControl {...props({ imageId: null })} />);
		expect(buttons(host)).toEqual(['Add logo']);
		expect(host.querySelector('img')).toBeNull();
	});

	it('uploading: says so at the press, held, with no Remove', () => {
		const { host } = mount(<LogoControl {...props({ state: 'uploading' })} />);
		const press = host.querySelector('button');
		expect(buttons(host)).toEqual(['Uploading']);
		expect(press?.getAttribute('aria-disabled')).toBe('true');
	});

	it('refused: says why under the press', () => {
		const words = replaceRefusal('not-an-image');
		const { host } = mount(
			<LogoControl {...props({ imageId: null, state: { refused: words } })} />
		);
		const press = host.querySelector('button');
		expect(
			document.getElementById(press?.getAttribute('aria-describedby') ?? '')?.textContent
		).toBe(words);
	});

	it('placed: draws the logo whole by its id, with Replace logo and Remove, and no box', () => {
		const { host } = mount(<LogoControl {...props()} />);
		const art = host.querySelector('img');

		expect(art?.getAttribute('src')).toBe(`/image/${LOGO}`);
		expect(art?.className).toBe('adm-placed__art adm-placed__art--whole');
		expect(buttons(host)).toEqual(['Replace logo', 'Remove']);
		expect(host.querySelector('input:not([type="file"])')).toBeNull();
	});

	it('saved: reports at the logo with Undo', () => {
		const onUndo = vi.fn();
		const { host } = mount(<LogoControl {...props({ report: { landed: 'saved', onUndo } })} />);

		expect(report(host)?.textContent).toBe('Saved to every page.');
		const undo = [...host.querySelectorAll('button')].find((one) => one.textContent === 'Undo');
		act(() => undo?.click());
		expect(onUndo).toHaveBeenCalledOnce();
	});

	it('removed: reports the removal with Undo, and offers Add logo', () => {
		const { host } = mount(
			<LogoControl {...props({ imageId: null, report: { landed: 'removed', onUndo: () => {} } })} />
		);
		expect(report(host)?.textContent).toBe('Removed from every page.');
		expect(buttons(host)).toEqual(['Add logo', 'Undo']);
	});
});

describe('the report', () => {
	it('speaks from a region that was there before it', () => {
		const { host, redraw } = mount(<LogoControl {...props()} />);
		const region = report(host);
		expect(region?.textContent).toBe('');

		redraw(<LogoControl {...props({ report: { landed: 'saved', onUndo: () => {} } })} />);
		expect(report(host)).toBe(region);
		expect(region?.textContent).toBe('Saved to every page.');
	});

	it('holds Undo while it is in flight, keeping the focus on it', () => {
		const onUndo = vi.fn();
		const { host } = mount(
			<LogoControl {...props({ report: { landed: 'saved', onUndo, undoing: true } })} />
		);
		const undo = [...host.querySelectorAll('button')].find((one) => one.textContent === 'Undo');
		act(() => {
			undo?.focus();
			undo?.click();
		});

		expect(undo?.getAttribute('aria-disabled')).toBe('true');
		expect(onUndo).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(undo);
	});

	it('reads Redo when what landed was an Undo, and the press still calls onUndo', () => {
		const onUndo = vi.fn();
		const { host } = mount(
			<LogoControl {...props({ report: { landed: 'removed', onUndo, redo: true } })} />
		);
		const redo = [...host.querySelectorAll('button')].find((one) => one.textContent === 'Redo');

		expect(buttons(host)).not.toContain('Undo');
		act(() => redo?.click());
		expect(onUndo).toHaveBeenCalledOnce();
	});

	it('draws Redo with the redo mark and Undo with the undo mark', () => {
		const press = (host: HTMLElement, word: string) =>
			[...host.querySelectorAll('button')].find((one) => one.textContent === word);
		const drawn = (button: HTMLButtonElement | undefined) =>
			[...(button?.querySelector('svg')?.classList ?? [])].filter((name) =>
				/^lucide-(undo|redo)-2$/.test(name)
			);

		const { host, redraw } = mount(
			<LogoControl {...props({ report: { landed: 'saved', onUndo: () => {} } })} />
		);
		expect(drawn(press(host, 'Undo'))).toEqual(['lucide-undo-2']);

		redraw(
			<LogoControl {...props({ report: { landed: 'saved', onUndo: () => {}, redo: true } })} />
		);
		expect(drawn(press(host, 'Redo'))).toEqual(['lucide-redo-2']);
	});
});
