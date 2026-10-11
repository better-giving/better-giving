import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished, vi } from 'vitest';
import { type BlockEdits, type BlockRow, BlockList } from './settings-sheet';

// Settings' block list: a row per block, reading what it holds; and, handed its presses, each row's
// moves and Remove held while a press is in flight, and the focus kept on the list once one lands.
// what each press posts is ../../../routes/_app.admin.campaigns.$pageId.dom.spec.tsx's.

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

const ROWS: readonly BlockRow[] = [
	{ id: 'hero', label: 'Cover photo', summary: 'Kids trying on coats' },
	{ id: 'title', label: 'Title', summary: 'Keep 300 kids warm this winter' },
	{ id: 'image', label: 'Photo', summary: 'Coats on a rack' }
];

/** `rows` as the loader draws them in that order, each with the presses its place allows. */
const placed = (rows: readonly BlockRow[]): BlockRow[] =>
	rows.map((row, at) => ({
		...row,
		movesUp: at > 0,
		movesDown: at < rows.length - 1,
		removable: true
	}));

function edits(over: Partial<BlockEdits> = {}): BlockEdits {
	return {
		onMove: () => {},
		onRemove: () => {},
		addable: [{ value: 'story', label: 'Story' }],
		onAdd: () => {},
		busy: false,
		...over
	};
}

const values = (host: HTMLElement) =>
	[...host.querySelectorAll('.adm-openrow__value')].map((value) => value.textContent);

function named(host: HTMLElement, name: string): HTMLButtonElement {
	const found = [...host.querySelectorAll('button')].find(
		(one) => one.getAttribute('aria-label') === name
	);
	if (found === undefined) throw new Error(`no ${name}`);
	return found;
}

it('reads each block’s summary, a photo’s among them', () => {
	const { host } = mount(<BlockList blocks={ROWS} onOpenBlock={() => {}} />);
	expect(values(host)).toEqual([
		'Kids trying on coats',
		'Keep 300 kids warm this winter',
		'Coats on a rack'
	]);
});

it('opens a row’s block sheet', () => {
	const onOpenBlock = vi.fn();
	const { host } = mount(<BlockList blocks={ROWS} onOpenBlock={onOpenBlock} />);
	act(() => host.querySelector<HTMLButtonElement>('.adm-openrow')?.click());
	expect(onOpenBlock).toHaveBeenCalledExactlyOnceWith('hero');
});

it('hands a row’s press over, and holds every press while one is in flight', () => {
	const onMove = vi.fn();
	const onRemove = vi.fn();
	const { host, redraw } = mount(
		<BlockList blocks={placed(ROWS)} onOpenBlock={() => {}} edits={edits({ onMove, onRemove })} />
	);
	act(() => named(host, 'Move Title down').click());
	expect(onMove).toHaveBeenCalledExactlyOnceWith('title', 'down');

	redraw(
		<BlockList
			blocks={placed(ROWS)}
			onOpenBlock={() => {}}
			edits={edits({ onMove, onRemove, busy: true })}
		/>
	);
	expect(named(host, 'Move Title down').getAttribute('aria-busy')).toBe('true');
	expect(named(host, 'Remove Photo').getAttribute('aria-disabled')).toBe('true');
	act(() => named(host, 'Remove Photo').click());
	expect(onRemove).not.toHaveBeenCalled();
});

it('puts the focus on the row that took a removed block’s place once the answer lands', () => {
	const { host, redraw } = mount(
		<BlockList blocks={placed(ROWS)} onOpenBlock={() => {}} edits={edits()} />
	);
	const remove = named(host, 'Remove Title');
	act(() => {
		remove.focus();
		remove.click();
	});
	redraw(<BlockList blocks={placed(ROWS)} onOpenBlock={() => {}} edits={edits({ busy: true })} />);
	const left = [ROWS[0], ROWS[2]].filter((row) => row !== undefined);
	redraw(<BlockList blocks={placed(left)} onOpenBlock={() => {}} edits={edits()} />);

	expect(document.activeElement?.textContent).toBe('PhotoCoats on a rack');
});

it('keeps the focus on a moved block, on its other move where the one pressed ran out', () => {
	const { host, redraw } = mount(
		<BlockList blocks={placed(ROWS)} onOpenBlock={() => {}} edits={edits()} />
	);
	const up = named(host, 'Move Title up');
	act(() => {
		up.focus();
		up.click();
	});
	redraw(<BlockList blocks={placed(ROWS)} onOpenBlock={() => {}} edits={edits({ busy: true })} />);
	const moved = [ROWS[1], ROWS[0], ROWS[2]].filter((row) => row !== undefined);
	redraw(<BlockList blocks={placed(moved)} onOpenBlock={() => {}} edits={edits()} />);

	expect(document.activeElement).toBe(named(host, 'Move Title down'));
});

it('offers Add a block over the blocks the page may be given', () => {
	const { host } = mount(
		<BlockList blocks={placed(ROWS)} onOpenBlock={() => {}} edits={edits()} />
	);
	expect(host.querySelector('[aria-haspopup="menu"]')?.textContent).toBe('Add a block');
	expect([...host.querySelectorAll('[role="menuitem"]')].map((one) => one.textContent)).toEqual([
		'Story'
	]);
});
