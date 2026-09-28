import { type ReactNode, act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { BlockSheet } from './block-sheet';
import { EditorEntries, EditorShell } from './editor-shell';
import { GoalSheet } from './goal-sheet';
import { InPlaceName } from './in-place-name';
import { PicturePicker } from './pictures';
import { PreviewFrame } from './preview-frame';
import { PublishBar } from './publish-bar';
import { SettingsSheet } from './settings-sheet';

// the editor's parts, mounted so what a reader meets is looked at: the sheet a floating entry opens
// and the two ways out of it, the names a picture and the name box carry, where Reset to default is
// offered, the goal's figure in and out, and which messages the preview frame listens to. nothing
// here reads a class or a sentence's look — how the editor looks is left to a person looking at it.
//
// the tab ring kept inside a sheet and the page made inert behind it are the top layer's, which
// happy-dom does not have; what is asserted is that the sheet is shown as a modal and takes the
// focus, which is what puts the platform's trap in place.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
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

/** a tree inside a router, for a part whose way out is a link. */
function routed(tree: ReactNode): HTMLElement {
	const Stub = createRoutesStub([{ path: '/admin/editor', Component: () => tree }]);
	return mount(<Stub initialEntries={['/admin/editor']} />);
}

/** writes `text` into a box the way typing would, so react hears it. */
function typeInto(box: HTMLInputElement, text: string): void {
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, text);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

function button(root: Element, name: string): HTMLButtonElement {
	const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
		(one) => (one.getAttribute('aria-label') ?? one.textContent?.trim()) === name
	);
	if (found === undefined) throw new Error(`no button named ${name}`);
	return found;
}

describe('a sheet opened from a floating entry', () => {
	function Editor() {
		const [open, setOpen] = useState(false);
		return (
			<EditorShell
				bar={null}
				preview={null}
				entries={<EditorEntries onChat={() => {}} onSettings={() => setOpen(true)} />}
			>
				{open ? (
					<SettingsSheet
						onDismiss={() => setOpen(false)}
						blocks={[{ id: 'b1', label: 'Story', summary: 'Last winter…' }]}
						onOpenBlock={() => {}}
						layouts={[{ value: 'box-right', label: 'Box on the right' }]}
						layout="box-right"
						onLayout={() => {}}
						look={null}
						shareMessage={null}
						donationSettings="Donor chooses"
						onOpen={() => {}}
					/>
				) : null}
			</EditorShell>
		);
	}

	function opened(root: HTMLElement): { entry: HTMLButtonElement; sheet: HTMLDialogElement } {
		const entry = button(root, 'Settings');
		entry.focus();
		act(() => entry.click());
		const sheet = root.querySelector('dialog');
		if (sheet === null) throw new Error('the entry opened no sheet');
		return { entry, sheet };
	}

	it('is shown as a modal and takes the focus', () => {
		const { sheet } = opened(mount(<Editor />));
		expect(sheet.open).toBe(true);
		expect(document.activeElement).toBe(sheet);
	});

	it('goes on Escape and hands the focus back to the entry', () => {
		const root = mount(<Editor />);
		const { entry, sheet } = opened(root);
		act(() => sheet.dispatchEvent(new Event('cancel', { cancelable: true })));
		expect(root.querySelector('dialog')).toBeNull();
		expect(document.activeElement).toBe(entry);
	});

	it('goes on its X and hands the focus back to the entry', () => {
		const root = mount(<Editor />);
		const { entry, sheet } = opened(root);
		act(() => button(sheet, 'Close').click());
		expect(root.querySelector('dialog')).toBeNull();
		expect(document.activeElement).toBe(entry);
	});
});

describe('the pictures', () => {
	const layouts = [
		{ value: 'box-right', label: 'Box on the right' },
		{ value: 'banner', label: 'Banner' },
		{ value: 'column', label: 'One column' },
		{ value: 'cover', label: 'Cover photo' }
	];

	it('name every picture by its label, in one named group', () => {
		const root = mount(
			<PicturePicker
				legend="Layout"
				name="layout"
				set="layout"
				options={layouts}
				value="banner"
				onPick={() => {}}
			/>
		);
		const group = root.querySelector('[role="radiogroup"]');
		expect(group?.getAttribute('aria-label')).toBe('Layout');
		const radios = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
		expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual(
			layouts.map((layout) => layout.label)
		);
		expect(radios.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(['banner']);
	});

	it('draw each of the four layouts', () => {
		const root = mount(
			<PicturePicker
				legend="Layout"
				name="layout"
				set="layout"
				options={layouts}
				value="banner"
				onPick={() => {}}
			/>
		);
		const drawn = [...root.querySelectorAll('.adm-picture__art')].map(
			(art) => art.childElementCount > 0
		);
		expect(drawn).toEqual([true, true, true, true]);
	});

	it('hand a pick to the caller, and a block sheet posts its words without it', () => {
		const onPick = vi.fn();
		const onDone = vi.fn();
		const root = mount(
			<BlockSheet
				title="Story"
				block="story"
				variants={{
					options: [
						{ value: 'plain', label: 'Plain' },
						{ value: 'lede', label: 'Lede' }
					],
					value: 'plain',
					onPick
				}}
				text={{
					fields: <input name="heading" defaultValue="Why coats, why now" />,
					onDone,
					applying: false
				}}
				onDismiss={() => {}}
			/>
		);
		act(() => root.querySelector<HTMLInputElement>('input[value="lede"]')?.click());
		expect(onPick).toHaveBeenCalledWith('lede');

		act(() => button(root, 'Done').click());
		const [form] = onDone.mock.calls[0] ?? [];
		expect([...new FormData(form).entries()]).toEqual([['heading', 'Why coats, why now']]);
	});
});

describe('the name in place', () => {
	it('is a field with a name of its own', () => {
		const root = mount(<InPlaceName value="Winter coat drive" onRename={() => {}} />);
		const box = root.querySelector('input');
		expect(box?.getAttribute('aria-label')).toBe('Campaign name');
		expect(box?.value).toBe('Winter coat drive');
	});

	it('renames once on Enter and the blur after it', () => {
		const onRename = vi.fn();
		const root = mount(<InPlaceName value="Winter coat drive" onRename={onRename} />);
		const box = root.querySelector('input');
		if (box === null) throw new Error('no box');
		typeInto(box, '  Coats for kids ');
		act(() => box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
		act(() => box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
		expect(onRename.mock.calls).toEqual([['Coats for kids']]);
	});

	it('puts the stored name back when it is emptied and left', () => {
		const onRename = vi.fn();
		const root = mount(<InPlaceName value="Winter coat drive" onRename={onRename} />);
		const box = root.querySelector('input');
		if (box === null) throw new Error('no box');
		typeInto(box, '   ');
		act(() => box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
		expect(onRename).not.toHaveBeenCalled();
		expect(box.value).toBe('Winter coat drive');
	});
});

describe('the publish bar', () => {
	const bar = (reset: { hasEdits: boolean } | undefined) => (
		<PublishBar
			closeHref="/admin"
			page={{ kind: 'donation' }}
			state="live"
			livePath="/donate"
			publishing={false}
			republished={false}
			onPublish={() => {}}
			undoing={false}
			onUndo={() => {}}
			onDiscard={() => {}}
			reset={reset === undefined ? undefined : { ...reset, onReset: () => {} }}
		/>
	);
	const names = (root: HTMLElement) =>
		[...root.querySelectorAll('button')].map((one) => one.textContent?.trim());

	it('offers Reset to default only once the page has edits', () => {
		expect(names(routed(bar({ hasEdits: false })))).not.toContain('Reset to default');
		expect(names(routed(bar({ hasEdits: true })))).toContain('Reset to default');
	});

	it('offers no Reset to default on a campaign', () => {
		expect(names(routed(bar(undefined)))).not.toContain('Reset to default');
	});

	it('has its report region on the page before there is a refusal', () => {
		const region = routed(bar(undefined)).querySelector('[role="status"]');
		expect(region).not.toBeNull();
		expect(region?.textContent).toBe('');
	});
});

describe('the goal', () => {
	function goal(goalMinor: number | null, onDone: (minor: number | null) => void) {
		return mount(
			<GoalSheet
				goalMinor={goalMinor}
				currency="USD"
				onDone={onDone}
				applying={false}
				onDismiss={() => {}}
			/>
		);
	}
	const boxIn = (root: HTMLElement) => {
		const box = root.querySelector<HTMLInputElement>('dialog input');
		if (box === null) throw new Error('no goal box');
		return box;
	};

	it('is seeded from minor units and hands minor units back', () => {
		const onDone = vi.fn();
		const root = goal(1_500_000, onDone);
		const box = boxIn(root);
		expect(box.value).toBe('15000');
		typeInto(box, '20000.50');
		act(() => button(root, 'Done').click());
		expect(onDone).toHaveBeenCalledWith(2_000_050);
	});

	it('hands back no goal for an emptied box', () => {
		const onDone = vi.fn();
		const root = goal(1_500_000, onDone);
		typeInto(boxIn(root), '');
		act(() => button(root, 'Done').click());
		expect(onDone).toHaveBeenCalledWith(null);
	});

	it('refuses a figure it cannot read at the box and puts the caret there', () => {
		const onDone = vi.fn();
		const root = goal(null, onDone);
		const box = boxIn(root);
		typeInto(box, 'lots');
		act(() => button(root, 'Done').click());
		expect(onDone).not.toHaveBeenCalled();
		expect(box.getAttribute('aria-invalid')).toBe('true');
		expect(document.activeElement).toBe(box);
	});
});

describe('the preview frame', () => {
	function framed(onBlockClick: (id: string) => void) {
		const root = mount(
			<PreviewFrame src="about:blank" title="Preview" onBlockClick={onBlockClick} />
		);
		const frame = root.querySelector('iframe');
		if (frame === null) throw new Error('no frame');
		return frame;
	}
	const post = (data: unknown, origin: string, source: Window | null) =>
		act(() => {
			window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
		});

	it('is out of the tab order and named', () => {
		const frame = framed(() => {});
		expect(frame.tabIndex).toBe(-1);
		expect(frame.title).toBe('Preview');
	});

	it('hands on a block id its own page posted, and nothing else on the channel', () => {
		const onBlockClick = vi.fn();
		const frame = framed(onBlockClick);
		const own = window.location.origin;
		const message = { type: 'bg-page-block', id: 'b1' };

		post(message, 'https://elsewhere.example', frame.contentWindow);
		post(message, own, window);
		post({ type: 'something-else', id: 'b1' }, own, frame.contentWindow);
		post(message, own, frame.contentWindow);

		expect(onBlockClick.mock.calls).toEqual([['b1']]);
	});
});
