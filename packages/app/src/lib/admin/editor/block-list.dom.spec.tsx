import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished, vi } from 'vitest';
import { type BlockEdits, type BlockRow, BlockList } from './settings-sheet';

// Settings' block list: a row per block, reading what it holds; and, handed its presses, each row's
// moves and Remove named for the block and its place and held while a press is in flight, Remove
// asking first, the focus kept on the list once one lands and what it did said in the list's
// region, and a refusal said under the row pressed. what each press posts is
// ../../../routes/_app.admin.campaigns.$pageId.dom.spec.tsx's.

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

/** the button drawn with `words` in the card a press put up. */
function inCard(host: HTMLElement, words: string): HTMLButtonElement {
	const found = [...host.querySelectorAll('dialog button')].find(
		(one) => one.textContent === words
	);
	if (found === undefined) throw new Error(`the card drew no ${words}`);
	return found as HTMLButtonElement;
}

/** what the list's region says. */
const said = (host: HTMLElement) => host.querySelector('[role="status"]')?.textContent;

/** a press made and answered: in flight on the next draw, and landed on the one after, as `after`. */
function answered(
	redraw: (next: ReactElement) => void,
	after: readonly BlockRow[],
	over: Partial<BlockEdits> = {}
) {
	redraw(<BlockList blocks={placed(ROWS)} onOpenBlock={() => {}} edits={edits({ busy: true })} />);
	redraw(<BlockList blocks={placed(after)} onOpenBlock={() => {}} edits={edits(over)} />);
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
	act(() => named(host, 'Move Title down, 2 of 3').click());
	expect(onMove).toHaveBeenCalledExactlyOnceWith('title', 'down');

	redraw(
		<BlockList
			blocks={placed(ROWS)}
			onOpenBlock={() => {}}
			edits={edits({ onMove, onRemove, busy: true })}
		/>
	);
	expect(named(host, 'Move Title down, 2 of 3').getAttribute('aria-busy')).toBe('true');
	expect(named(host, 'Remove Photo, 3 of 3').getAttribute('aria-disabled')).toBe('true');
	act(() => named(host, 'Remove Photo, 3 of 3').click());
	expect(host.querySelector('dialog')).toBeNull();
	expect(onRemove).not.toHaveBeenCalled();
	const add = host.querySelector('[aria-haspopup="menu"]');
	expect(add?.getAttribute('aria-disabled')).toBe('true');
});

it('names each row’s presses for its block and its place, so two of one kind read apart', () => {
	const stories: BlockRow[] = [
		{ id: 's1', label: 'Story', summary: 'Last winter' },
		{ id: 's2', label: 'Story', summary: 'This winter' }
	];
	const { host } = mount(
		<BlockList blocks={placed(stories)} onOpenBlock={() => {}} edits={edits()} />
	);
	expect(
		[...host.querySelectorAll('.adm-blockrow > button:not(.adm-openrow)')].map((one) =>
			one.getAttribute('aria-label')
		)
	).toEqual([
		'Move Story down, 1 of 2',
		'Remove Story, 1 of 2',
		'Move Story up, 2 of 2',
		'Remove Story, 2 of 2'
	]);
});

it('says a landed move with the block’s new place, from a region there before it', () => {
	const { host, redraw } = mount(
		<BlockList blocks={placed(ROWS)} onOpenBlock={() => {}} edits={edits()} />
	);
	expect(said(host)).toBe('');
	act(() => named(host, 'Move Title up, 2 of 3').click());
	answered(
		redraw,
		[ROWS[1], ROWS[0], ROWS[2]].filter((row) => row !== undefined)
	);
	expect(said(host)).toBe('Title moved up, 1 of 3');
});

it('asks before removing a block: Cancel keeps it, Remove hands it over and says it went', () => {
	const onRemove = vi.fn();
	const { host, redraw } = mount(
		<BlockList blocks={placed(ROWS)} onOpenBlock={() => {}} edits={edits({ onRemove })} />
	);
	act(() => named(host, 'Remove Title, 2 of 3').click());
	expect(host.querySelector('dialog')?.textContent).toContain('Remove Title?');
	act(() => inCard(host, 'Cancel').click());
	expect(host.querySelector('dialog')).toBeNull();
	expect(onRemove).not.toHaveBeenCalled();

	act(() => named(host, 'Remove Title, 2 of 3').click());
	act(() => inCard(host, 'Remove').click());
	expect(host.querySelector('dialog')).toBeNull();
	expect(onRemove).toHaveBeenCalledExactlyOnceWith('title');

	answered(
		redraw,
		[ROWS[0], ROWS[2]].filter((row) => row !== undefined)
	);
	expect(said(host)).toBe('Title removed');
});

it('says a refused press under the row it was pressed on, and the press is described by it', () => {
	const refusal = 'Nothing was changed: this page has been saved since the editor was opened.';
	const { host, redraw } = mount(
		<BlockList blocks={placed(ROWS)} onOpenBlock={() => {}} edits={edits()} />
	);
	act(() => named(host, 'Move Title up, 2 of 3').click());
	answered(redraw, ROWS, { refusal });

	const press = named(host, 'Move Title up, 2 of 3');
	const line = document.getElementById(press.getAttribute('aria-describedby') ?? '');
	expect(line?.textContent).toBe(refusal);
	expect(line?.closest('.adm-blockrow')).toBe(press.closest('.adm-blockrow'));
	expect(said(host)).toBe(refusal);
});

it('puts the focus on the row that took a removed block’s place once the answer lands', () => {
	const { host, redraw } = mount(
		<BlockList blocks={placed(ROWS)} onOpenBlock={() => {}} edits={edits()} />
	);
	const remove = named(host, 'Remove Title, 2 of 3');
	act(() => {
		remove.focus();
		remove.click();
	});
	act(() => inCard(host, 'Remove').click());
	answered(
		redraw,
		[ROWS[0], ROWS[2]].filter((row) => row !== undefined)
	);

	expect(document.activeElement?.textContent).toBe('PhotoCoats on a rack');
});

it('keeps the focus on a moved block, on its other move where the one pressed ran out', () => {
	const { host, redraw } = mount(
		<BlockList blocks={placed(ROWS)} onOpenBlock={() => {}} edits={edits()} />
	);
	const up = named(host, 'Move Title up, 2 of 3');
	act(() => {
		up.focus();
		up.click();
	});
	answered(
		redraw,
		[ROWS[1], ROWS[0], ROWS[2]].filter((row) => row !== undefined)
	);

	expect(document.activeElement).toBe(named(host, 'Move Title down, 1 of 3'));
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
