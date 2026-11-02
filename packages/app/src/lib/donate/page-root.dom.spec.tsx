import { brandScaleCss, generateBrandScale } from '@better-giving/form/styles/radix-scale';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, type ReactElement, useState } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { brandScopeSelector, PageRoot } from './page-root';

// the brand scale's `<style>`, as the server sends it and as the client takes it over: the sheet
// goes out as plain children, so react's own `</style` guard stands between the generator and the
// document, and the markup the server sends is the sheet byte for byte and hydrates unchanged.

vi.mock('@better-giving/form/styles/radix-scale', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@better-giving/form/styles/radix-scale')>();
	return { ...actual, generateBrandScale: vi.fn(actual.generateBrandScale) };
});

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BRAND = '#1d6b4f';

const sheetFor = (scope: string, colour: string = BRAND) => {
	const scale = generateBrandScale(colour);
	if (scale === null) throw new Error('no scale');
	return brandScaleCss(brandScopeSelector(scope), scale);
};

describe('the brand scale sheet', () => {
	it('is sent by the server as the sheet itself, quotes and all', () => {
		const html = renderToString(
			<PageRoot brandColour={BRAND} layout="plain">
				{null}
			</PageRoot>
		);
		const scope = html.match(/data-brand-scope="([^"]+)"/)?.[1] ?? '';
		expect(scope).not.toBe('');
		expect(html).toContain(`<style>${sheetFor(scope)}</style>`);
	});

	it('hydrates over the server markup with no mismatch and keeps the same node', async () => {
		const element: ReactElement = (
			<PageRoot brandColour={BRAND} layout="plain">
				<p>Every kid starts winter warm.</p>
			</PageRoot>
		);
		const host = document.createElement('div');
		host.innerHTML = renderToString(element);
		document.body.appendChild(host);
		const served = host.querySelector('style');
		const sent = host.innerHTML;
		const recovered: unknown[] = [];
		const complained = vi.spyOn(console, 'error');
		onTestFinished(() => complained.mockRestore());
		const mounted = await act(async () =>
			hydrateRoot(host, element, { onRecoverableError: (error) => recovered.push(error) })
		);
		onTestFinished(() => {
			act(() => mounted.unmount());
			host.remove();
		});
		expect(recovered).toEqual([]);
		expect(complained).not.toHaveBeenCalled();
		expect(host.querySelector('style')).toBe(served);
		expect(host.innerHTML).toBe(sent);
	});

	it('is drawn through no raw-html sink', () => {
		const source = readFileSync(join(import.meta.dirname, 'page-root.tsx'), 'utf8');
		expect(source).not.toMatch(/dangerouslySetInnerHTML/);
	});

	it('is generated once per colour, not on every render of the page around it', () => {
		const generate = vi.mocked(generateBrandScale);
		let rerender: () => void = () => {};
		function Around() {
			const [, setTick] = useState(0);
			rerender = () => setTick((t) => t + 1);
			return (
				<PageRoot brandColour={BRAND} layout="plain">
					{null}
				</PageRoot>
			);
		}
		const host = document.createElement('div');
		document.body.appendChild(host);
		const root = createRoot(host);
		onTestFinished(() => {
			act(() => root.unmount());
			host.remove();
		});
		generate.mockClear();
		act(() => root.render(<Around />));
		const first = generate.mock.calls.length;
		act(() => rerender());
		act(() => rerender());
		expect(generate.mock.calls.length).toBe(first);
	});

	it('redraws the sheet for a changed colour, in the same scope, on the node it already had', () => {
		const OTHER = '#8e4ec6';
		const page = (colour: string) => (
			<PageRoot brandColour={colour} layout="plain">
				{null}
			</PageRoot>
		);
		const host = document.createElement('div');
		document.body.appendChild(host);
		const root = createRoot(host);
		onTestFinished(() => {
			act(() => root.unmount());
			host.remove();
		});
		act(() => root.render(page(BRAND)));
		const node = host.querySelector('style');
		const scope = host.querySelector('[data-brand-scope]')?.getAttribute('data-brand-scope') ?? '';
		expect(node?.textContent).toBe(sheetFor(scope, BRAND));

		act(() => root.render(page(OTHER)));

		expect(sheetFor(scope, OTHER)).not.toBe(sheetFor(scope, BRAND));
		expect(host.querySelector('style')).toBe(node);
		expect(host.querySelector('style')?.textContent).toBe(sheetFor(scope, OTHER));
		expect(host.querySelector('[data-brand-scope]')?.getAttribute('data-brand-scope')).toBe(scope);
		expect(
			(host.querySelector('[data-donate-root]') as HTMLElement).style.getPropertyValue(
				'--donate-primary'
			)
		).toBe(OTHER);
	});
});
