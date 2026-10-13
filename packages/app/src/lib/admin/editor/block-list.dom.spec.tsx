import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished, vi } from 'vitest';
import { type BlockRow, BlockList } from './settings-sheet';

// Settings' block list: a row per block, reading what it holds, and Illustration in place of that
// while a photo block's photo is an AI illustration.

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
	return host;
}

const ROWS: readonly BlockRow[] = [
	{ id: 'hero', label: 'Hero', summary: 'Kids trying on coats', illustration: true },
	{ id: 'title', label: 'Title', summary: 'Keep 300 kids warm this winter' },
	{ id: 'image', label: 'Image', summary: 'Coats on a rack', illustration: false }
];

const values = (host: HTMLElement) =>
	[...host.querySelectorAll('.adm-openrow__value')].map((value) => value.textContent);

it('reads Illustration, a plain word, in place of an illustrated photo’s summary', () => {
	const host = mount(<BlockList blocks={ROWS} onOpenBlock={() => {}} />);
	expect(values(host)).toEqual([
		'Illustration',
		'Keep 300 kids warm this winter',
		'Coats on a rack'
	]);
	expect(host.querySelectorAll('.adm-openrow__value .adm-state')).toHaveLength(1);
	expect(host.querySelector('.adm-openrow__value .adm-state')?.className).toBe('adm-state');
});

it('opens the illustrated block’s sheet as any row does', () => {
	const onOpenBlock = vi.fn();
	const host = mount(<BlockList blocks={ROWS} onOpenBlock={onOpenBlock} />);
	act(() => host.querySelector<HTMLButtonElement>('.adm-openrow')?.click());
	expect(onOpenBlock).toHaveBeenCalledExactlyOnceWith('hero');
});
