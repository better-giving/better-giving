import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished, vi } from 'vitest';
import { type BlockRow, BlockList } from './settings-sheet';

// Settings' block list: a row per block, reading what it holds, whatever else the editor's loader
// sends with the block.

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

// the hero as the loader reads it, still marked as a once-illustrated photo.
const hero = { id: 'hero', label: 'Hero', summary: 'Kids trying on coats', illustration: true };
const ROWS: readonly BlockRow[] = [
	hero,
	{ id: 'title', label: 'Title', summary: 'Keep 300 kids warm this winter' },
	{ id: 'image', label: 'Image', summary: 'Coats on a rack' }
];

const values = (host: HTMLElement) =>
	[...host.querySelectorAll('.adm-openrow__value')].map((value) => value.textContent);

it('reads each block’s summary, a photo’s among them, and never Illustration', () => {
	const host = mount(<BlockList blocks={ROWS} onOpenBlock={() => {}} />);
	expect(values(host)).toEqual([
		'Kids trying on coats',
		'Keep 300 kids warm this winter',
		'Coats on a rack'
	]);
	expect(host.textContent).not.toContain('Illustration');
});

it('opens a row’s block sheet', () => {
	const onOpenBlock = vi.fn();
	const host = mount(<BlockList blocks={ROWS} onOpenBlock={onOpenBlock} />);
	act(() => host.querySelector<HTMLButtonElement>('.adm-openrow')?.click());
	expect(onOpenBlock).toHaveBeenCalledExactlyOnceWith('hero');
});
