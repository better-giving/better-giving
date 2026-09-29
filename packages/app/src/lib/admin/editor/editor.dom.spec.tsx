import { type ReactNode, act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { editorBlocks } from '$lib/page/block-edit';
import { BLOCK_TYPES, type Block, type Page } from '$lib/page/catalog';
import { defaultCampaign, defaultDonationPage } from '$lib/page/defaults';
import { PageView } from '$lib/donate/page-view';
import { ChatSheet } from '../chat/chat-sheet';
import { AddressSheet } from './address-sheet';
import { BlockSheet } from './block-sheet';
import { EditorEntries, EditorShell } from './editor-shell';
import { GoalSheet } from './goal-sheet';
import { InPlaceName } from './in-place-name';
import { PicturePicker } from './pictures';
import { PreviewFrame } from './preview-frame';
import { PublishBar } from './publish-bar';
import { SettingsSheet } from './settings-sheet';

// the editor's parts, mounted so what a reader meets is looked at: the sheet each floating entry
// opens and the ways out of it, the groups Settings draws only when handed, the names a picture and
// the name box carry and a drawing for every variant the catalog offers, where Reset to default and
// Open are offered and which presses the bar draws without a handler, the address's save and its
// refusal at Save, the goal's figure in and out, and which messages the preview frame listens to.
// nothing here reads a class or a sentence's look — how the editor looks is left to a person
// looking at it.
//
// the tab ring kept inside a sheet and the page made inert behind it are the top layer's, which
// happy-dom does not have; what is asserted is that the sheet is shown as a modal and takes the
// focus, which is what puts the platform's trap in place.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** a tree mounted, and a way to draw the same root again with new props. */
function mountable(tree: ReactNode): { root: HTMLElement; redraw: (next: ReactNode) => void } {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return { root, redraw: (next) => act(() => mounted.render(next)) };
}

function mount(tree: ReactNode): HTMLElement {
	return mountable(tree).root;
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

describe('the chat sheet opened from its floating entry', () => {
	function Editor() {
		const [open, setOpen] = useState(false);
		return (
			<EditorShell
				bar={null}
				preview={null}
				entries={<EditorEntries onChat={() => setOpen(true)} onSettings={() => {}} />}
			>
				{open ? (
					<ChatSheet
						messages={[]}
						isRunning={false}
						onSend={() => {}}
						onDismiss={() => setOpen(false)}
						suggestions={['Add a FAQ']}
						imageSrc={(id) => `/image/${id}`}
					/>
				) : null}
			</EditorShell>
		);
	}

	function opened(root: HTMLElement): { entry: HTMLButtonElement; sheet: HTMLDialogElement } {
		const entry = button(root, 'Chat');
		entry.focus();
		act(() => entry.click());
		const sheet = root.querySelector('dialog');
		if (sheet === null) throw new Error('the entry opened no sheet');
		return { entry, sheet };
	}

	it('is shown as a modal holding the chat, with the focus inside it', () => {
		const { sheet } = opened(mount(<Editor />));
		expect(sheet.open).toBe(true);
		expect(sheet.querySelector('textarea')).not.toBeNull();
		expect(sheet.contains(document.activeElement)).toBe(true);
	});

	it('goes on its X and hands the focus back to Chat', () => {
		const root = mount(<Editor />);
		const { entry, sheet } = opened(root);
		act(() => button(sheet, 'Close').click());
		expect(root.querySelector('dialog')).toBeNull();
		expect(document.activeElement).toBe(entry);
	});

	it('goes on Escape and hands the focus back to Chat', () => {
		const root = mount(<Editor />);
		const { entry, sheet } = opened(root);
		act(() => sheet.dispatchEvent(new Event('cancel', { cancelable: true })));
		expect(root.querySelector('dialog')).toBeNull();
		expect(document.activeElement).toBe(entry);
	});
});

describe('the settings sheet', () => {
	const headings = (root: HTMLElement) =>
		[...root.querySelectorAll('dialog h3')].map((one) => one.textContent);
	/** each row that opens a sheet, as its label and the value beside it read together. */
	const rows = (root: HTMLElement) =>
		[...root.querySelectorAll('dialog button[aria-haspopup="dialog"]')].map(
			(one) => one.textContent
		);

	it('draws every group it is handed', () => {
		const root = mount(
			<SettingsSheet
				onDismiss={() => {}}
				campaign={{
					name: 'Winter coat drive',
					address: '/winter-coat-drive',
					goalMinor: null,
					currency: 'USD',
					endDate: null
				}}
				blocks={[{ id: 'b1', label: 'Story', summary: 'Last winter…' }]}
				onOpenBlock={() => {}}
				layouts={[{ value: 'box-right', label: 'Box on the right' }]}
				layout="box-right"
				onLayout={() => {}}
				look={<p>Colour</p>}
				shareMessage={null}
				donationSettings="Donor chooses"
				onOpen={() => {}}
			/>
		);
		expect(headings(root)).toEqual([
			'Blocks',
			'Layout',
			'Look',
			'Goal and end date',
			'Sharing and gifts'
		]);
		expect(rows(root)).toEqual([
			'NameWinter coat drive',
			'Address/winter-coat-drive',
			'StoryLast winter…',
			'GoalNone',
			'End dateNone',
			'Share messageThe Organisation’s',
			'Donation settingsDonor chooses'
		]);
	});

	it('draws no group it is not handed, and no heading over nothing', () => {
		const onOpenBlock = vi.fn();
		const root = mount(
			<SettingsSheet
				onDismiss={() => {}}
				blocks={[{ id: 'b1', label: 'Story', summary: 'Last winter…' }]}
				onOpenBlock={onOpenBlock}
			/>
		);
		expect(headings(root)).toEqual(['Blocks']);
		expect(rows(root)).toEqual(['StoryLast winter…']);
		expect(root.querySelector('[role="radiogroup"]')).toBeNull();
		act(() => button(root, 'StoryLast winter…').click());
		expect(onOpenBlock).toHaveBeenCalledWith('b1');
	});

	it('draws only the rows of a group it is handed', () => {
		const onOpen = vi.fn();
		const root = mount(
			<SettingsSheet
				onDismiss={() => {}}
				campaign={{ name: 'Winter coat drive', address: '/winter-coat-drive' }}
				shareMessage="Help us keep 400 children warm this winter."
				onOpen={onOpen}
			/>
		);
		expect(headings(root)).toEqual(['Sharing and gifts']);
		expect(rows(root)).toEqual([
			'NameWinter coat drive',
			'Address/winter-coat-drive',
			'Share messageHelp us keep 400 children warm this winter.'
		]);
		act(() => button(root, 'Address/winter-coat-drive').click());
		expect(onOpen).toHaveBeenCalledWith('address');
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

	/** a draft holding one block of every type the catalog has, so every variant is offered. */
	function everyBlock(): Page {
		const placed: Block[] = [
			...defaultCampaign().blocks,
			...defaultDonationPage().blocks,
			{ id: 'tiers', type: 'impact-tiers', variant: 'cards', background: 'none', tiers: [] },
			{ id: 'faq', type: 'faq', variant: 'accordion', background: 'none', items: [] },
			{
				id: 'photo',
				type: 'image',
				variant: 'column',
				background: 'none',
				imageId: null,
				alt: null
			}
		];
		const blocks = BLOCK_TYPES.map((type) => {
			const found = placed.find((block) => block.type === type);
			if (found === undefined) throw new Error(`no ${type} block in the case's draft; add one`);
			return found;
		});
		return { ...defaultCampaign(), blocks };
	}

	it('draw every variant the catalog gives a block, each under its label', () => {
		const undrawn: string[] = [];
		for (const block of editorBlocks(everyBlock(), 'USD', new Set())) {
			if (block.variant === null) continue;
			const root = mount(
				<PicturePicker
					legend={block.label}
					name={block.id}
					set={{ block: block.type }}
					options={block.variants}
					value={block.variant}
					onPick={() => {}}
				/>
			);
			const faces = [...root.querySelectorAll('label')];
			expect(faces.map((face) => face.textContent)).toEqual(
				block.variants.map((variant) => variant.label)
			);
			faces.forEach((face, at) => {
				if ((face.querySelector('.adm-picture__art')?.childElementCount ?? 0) === 0) {
					undrawn.push(`${block.type}:${block.variants[at]?.value}`);
				}
			});
		}
		expect(undrawn).toEqual([]);
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

describe('a block with nothing typed in it', () => {
	const sheet = (refusal: string | null) => (
		<BlockSheet
			title="Share buttons"
			block="share"
			variants={{
				options: [
					{ value: 'buttons', label: 'Buttons' },
					{ value: 'icons', label: 'Icons' }
				],
				value: 'buttons',
				onPick: () => {},
				refusal
			}}
			onDismiss={() => {}}
		/>
	);

	it('reports a refused pick under its pictures, from a region there before it', () => {
		const { root, redraw } = mountable(sheet(null));
		expect(root.querySelector('button[type="submit"]')).toBeNull();
		const region = () => root.querySelector('dialog [role="status"]');
		expect(region()?.textContent).toBe('');

		redraw(sheet('The page changed while this was open. Reload to see it.'));
		expect(region()?.textContent).toBe('The page changed while this was open. Reload to see it.');
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

	it('sends the same words again after a rename was refused', () => {
		const onRename = vi.fn();
		const named = (invalid: boolean) => (
			<InPlaceName value="Winter coat drive" onRename={onRename} invalid={invalid} />
		);
		const { root, redraw } = mountable(named(false));
		const box = root.querySelector('input');
		if (box === null) throw new Error('no box');
		const enter = () =>
			act(() => box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
		typeInto(box, 'Coats for kids');
		enter();

		redraw(named(true));
		enter();

		expect(onRename.mock.calls).toEqual([['Coats for kids'], ['Coats for kids']]);
		expect(box.value).toBe('Coats for kids');
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

	const openLink = (root: HTMLElement) =>
		[...root.querySelectorAll('a')].find((one) => one.textContent?.startsWith('Open'));

	it('opens the live page in a new tab, named by its address', () => {
		const open = openLink(routed(bar(undefined)));
		expect(open?.getAttribute('href')).toBe('/donate');
		expect(open?.textContent).toBe('Open /donate (opens in a new tab)');
		expect(open?.target).toBe('_blank');
		expect(open?.rel.split(' ')).toContain('noopener');
	});

	it('offers no Open while nothing is live', () => {
		const root = routed(
			<PublishBar
				closeHref="/admin/campaigns"
				page={{ kind: 'campaign', name: 'Winter coat drive', onRename: () => {} }}
				state="unpublished"
				livePath="/winter-coat-drive"
				publishing={false}
				republished={false}
				onPublish={() => {}}
				undoing={false}
			/>
		);
		expect(openLink(root)).toBeUndefined();
	});

	it('heads the editor with one h1 naming the page being edited', () => {
		const campaign = routed(
			<PublishBar
				closeHref="/admin/campaigns"
				page={{ kind: 'campaign', name: 'Winter coat drive', onRename: () => {} }}
				state="unpublished"
				publishing={false}
				republished={false}
				undoing={false}
			/>
		);
		const donation = routed(bar(undefined));
		const h1s = (root: HTMLElement) => [...root.querySelectorAll('h1')].map((h) => h.textContent);

		expect(h1s(campaign)).toEqual(['Winter coat drive']);
		expect(h1s(donation)).toEqual(['Donation page']);
	});

	it('has its report region on the page before there is a refusal', () => {
		const region = routed(bar(undefined)).querySelector('[role="status"]');
		expect(region).not.toBeNull();
		expect(region?.textContent).toBe('');
	});

	type Handlers = {
		onPublish?: () => void;
		onUndo?: () => void;
		onDiscard?: () => void;
	};
	const handled = (handlers: Handlers, republished = false) => (
		<PublishBar
			closeHref="/admin"
			page={{ kind: 'donation' }}
			state="changed"
			livePath="/donate"
			publishing={false}
			republished={republished}
			publishHeld="Publishing opens once donation settings are set."
			undoing={false}
			{...handlers}
		/>
	);
	it('draws Publish held, described by why, when it has no handler', () => {
		const root = routed(handled({}));
		const press = button(root, 'Publish');
		expect(press.getAttribute('aria-disabled')).toBe('true');
		const reason = document.getElementById(press.getAttribute('aria-describedby') ?? '');
		expect(reason?.textContent).toBe('Publishing opens once donation settings are set.');
		expect(reason?.closest('[role="status"]')).not.toBeNull();
		act(() => press.click());
	});

	it('draws Publish open and says nothing of a hold while it has a handler', () => {
		const onPublish = vi.fn();
		const root = routed(handled({ onPublish }));
		const press = button(root, 'Publish');
		expect(press.hasAttribute('aria-disabled')).toBe(false);
		expect(root.querySelector('[role="status"]')?.textContent).toBe('');
		act(() => press.click());
		expect(onPublish).toHaveBeenCalledOnce();
	});

	it('draws no Undo and no Discard changes without their handlers', () => {
		expect(names(routed(handled({}, true)))).not.toContain('Undo');
		expect(names(routed(handled({}, true)))).not.toContain('Discard changes');
		const both = names(routed(handled({ onUndo: () => {}, onDiscard: () => {} }, true)));
		expect(both).toContain('Undo');
		expect(both).toContain('Discard changes');
	});
});

describe('the address', () => {
	const sheet = (refusal: ReactNode) => (
		<AddressSheet
			host="give.riverbanktrust.org/"
			slug="winter-coat-drive"
			onSave={() => {}}
			saving={false}
			saved={false}
			refusal={refusal}
			onDismiss={() => {}}
		/>
	);

	it('saves a changed address trimmed, and reads Saved once it lands', () => {
		const onSave = vi.fn();
		const at = (slug: string, state: { saving?: boolean; saved?: boolean } = {}) => (
			<AddressSheet
				host="give.riverbanktrust.org/"
				slug={slug}
				onSave={onSave}
				saving={state.saving ?? false}
				saved={state.saved ?? false}
				onDismiss={() => {}}
			/>
		);
		const { root, redraw } = mountable(at('winter-coat-drive'));
		const box = root.querySelector<HTMLInputElement>('dialog input');
		if (box === null) throw new Error('no address box');
		const save = button(root, 'Save address');

		typeInto(box, '  coats-for-kids ');
		act(() => save.click());
		expect(onSave.mock.calls).toEqual([['coats-for-kids']]);

		redraw(at('winter-coat-drive', { saving: true }));
		expect(save.getAttribute('aria-busy')).toBe('true');

		redraw(at('coats-for-kids', { saved: true }));
		expect(save.textContent).toBe('Saved');
		expect(save.getAttribute('aria-disabled')).toBe('true');
		act(() => save.click());
		expect(onSave).toHaveBeenCalledOnce();
	});

	it('has its refusal region on the page before there is a refusal', () => {
		const root = mount(sheet(null));
		const save = button(root, 'Save address');
		expect(save.hasAttribute('aria-describedby')).toBe(false);
		const region = root.querySelector('dialog p[role="status"]');
		expect(region?.textContent).toBe('');
	});

	it('draws a refusal at Save and puts the focus there once, when it lands', () => {
		const { root, redraw } = mountable(sheet(null));
		const box = root.querySelector<HTMLInputElement>('dialog input');
		if (box === null) throw new Error('no address box');
		act(() => box.focus());

		redraw(sheet(<>The campaign changed while this was open. Reload to see it.</>));
		const save = button(root, 'Save address');
		const region = document.getElementById(save.getAttribute('aria-describedby') ?? '');
		expect(region?.getAttribute('role')).toBe('status');
		expect(region?.textContent).toBe('The campaign changed while this was open. Reload to see it.');
		expect(document.activeElement).toBe(save);

		act(() => box.focus());
		redraw(sheet(<>The campaign changed while this was open. Reload to see it.</>));
		expect(document.activeElement).toBe(box);
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
			<PreviewFrame
				src="about:blank"
				title="Preview of Winter coat drive"
				onBlockClick={onBlockClick}
			/>
		);
		const frame = root.querySelector('iframe');
		if (frame === null) throw new Error('no frame');
		return frame;
	}
	const post = (data: unknown, origin: string, source: Window | null) =>
		act(() => {
			window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
		});

	it('is the preview’s one tab stop, named, and no block in the page it frames is one', () => {
		// the page mounted first: its sweep takes every stop in the document it runs in out of the
		// order, which in the editor is the frame's own document and never the host's.
		const page = mount(
			<PageView
				type="campaign"
				page={defaultCampaign()}
				pageName="Winter coat drive"
				org={{
					name: 'Northside Neighbors',
					mission: null,
					vision: null,
					info: {
						legalName: 'Northside Neighbors',
						ein: null,
						addressLines: ['40 Elm Street', 'Easton, PA 18042'],
						email: null,
						links: []
					}
				}}
				look={{ brandColour: '#1d6b4f', shade: 'warm', corner: 'round' }}
				sharing={{
					channels: ['facebook', 'copy-link'],
					message: 'Help us get every kid a coat.',
					url: 'https://give.example.org/coats'
				}}
				goal={{ raisedMinor: 984000, goalMinor: 1500000, endsAt: 'December 31' }}
				money={{ locale: 'en-US', currency: 'usd' }}
				programs={[]}
				programMode="none"
				donationBox={() => <button type="button">Donate</button>}
				preview
			/>
		);
		const frame = framed(() => {});

		expect(frame.tabIndex).toBe(0);
		expect(frame.title).toBe('Preview of Winter coat drive');
		const stops = [...page.querySelectorAll<HTMLElement>('a[href], button, input, summary')].filter(
			(stop) => stop.closest('[inert]') === null
		);
		expect(stops.length).toBeGreaterThan(0);
		expect(stops.filter((stop) => stop.tabIndex !== -1)).toEqual([]);
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
