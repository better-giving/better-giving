import { type ReactNode, act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { editorBlocks } from '$lib/page/block-edit';
import { BLOCK_TYPES, type Block, type Page } from '$lib/page/catalog';
import { defaultCampaign, defaultDonationPage } from '$lib/page/defaults';
import { PageView } from '$lib/donate/page-view';
import { AiPanel } from '../chat/ai-panel';
import { AddressSheet } from './address-sheet';
import { BlockSheet } from './block-sheet';
import { EditorShell } from './editor-shell';
import { GoalSheet } from './goal-sheet';
import { InPlaceName } from './in-place-name';
import { PicturePicker } from './pictures';
import { PreviewFrame } from './preview-frame';
import { PublishBar } from './publish-bar';
import { SettingsSheet } from './settings-sheet';

// the editor's parts, mounted so what a reader meets is looked at: the sheet each bar press opens
// and the ways out of it, the AI panel docked or a sheet by width, the groups Settings draws only
// when handed, the names a picture and the name box carry and a drawing for every variant the
// catalog offers, what More holds and when, which presses the bar draws without a handler and
// which below the wide breakpoint alone, the address's save and its refusal at Save, the goal's
// figure in and out, and which messages the preview frame listens to.
// a class is read only to find a part, such as whether a picture holds a drawing, and never to ask
// how anything looks — how the editor looks is left to a person looking at it.
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

/** the editor at the wide breakpoint or below it, as ./wide.ts reads it. */
function atWidth(wide: boolean) {
	vi.spyOn(window, 'matchMedia').mockImplementation(
		(media) =>
			({
				matches: wide,
				media,
				addEventListener: () => {},
				removeEventListener: () => {}
			}) as unknown as MediaQueryList
	);
}

beforeEach(() => atWidth(true));

/** the bar as an editor draws it over a live Donation page, with the presses that open sheets. */
function Bar({ onSettings, onAi }: { onSettings: () => void; onAi: () => void }) {
	return (
		<PublishBar
			closeHref="/admin"
			page={{ kind: 'donation' }}
			state="live"
			publishing={false}
			republished={false}
			undoing={false}
			onSettings={onSettings}
			onAi={onAi}
		/>
	);
}

describe('the Settings sheet opened from Settings while Edit is on', () => {
	function Editor() {
		const [open, setOpen] = useState(false);
		return (
			<EditorShell bar={<Bar onSettings={() => setOpen(true)} onAi={() => {}} />} preview={null}>
				{open ? (
					<SettingsSheet
						onDismiss={() => setOpen(false)}
						blocks={[{ id: 'b1', label: 'Story', summary: 'Last winter…' }]}
						onOpenBlock={() => {}}
						layouts={[{ value: 'box-right', label: 'Box on the right' }]}
						layout="box-right"
						onLayout={() => {}}
						donationSettings="Donor chooses"
						onOpen={() => {}}
					/>
				) : null}
			</EditorShell>
		);
	}

	function opened(root: HTMLElement): { entry: HTMLButtonElement; sheet: HTMLDialogElement } {
		act(() => button(root, 'Edit').click());
		const entry = button(root, 'Settings');
		entry.focus();
		act(() => entry.click());
		const sheet = root.querySelector('dialog');
		if (sheet === null) throw new Error('the press opened no sheet');
		return { entry, sheet };
	}

	it('is shown as a modal and takes the focus', () => {
		const { entry, sheet } = opened(routed(<Editor />));
		expect(entry.getAttribute('aria-haspopup')).toBe('dialog');
		expect(sheet.open).toBe(true);
		expect(document.activeElement).toBe(sheet);
	});

	it('goes on Escape and hands the focus back to Settings', () => {
		const root = routed(<Editor />);
		const { entry, sheet } = opened(root);
		act(() => sheet.dispatchEvent(new Event('cancel', { cancelable: true })));
		expect(root.querySelector('dialog')).toBeNull();
		expect(document.activeElement).toBe(entry);
	});

	it('goes on its X and hands the focus back to Settings', () => {
		const root = routed(<Editor />);
		const { entry, sheet } = opened(root);
		act(() => button(sheet, 'Close').click());
		expect(root.querySelector('dialog')).toBeNull();
		expect(document.activeElement).toBe(entry);
	});
});

describe('the AI panel in the editor', () => {
	function Editor() {
		const [open, setOpen] = useState(false);
		return (
			<EditorShell
				bar={<Bar onSettings={() => {}} onAi={() => setOpen(true)} />}
				preview={null}
				panel={
					<AiPanel
						messages={[]}
						isRunning={false}
						onSend={() => {}}
						onAnswer={() => {}}
						open={open}
						onDismiss={() => setOpen(false)}
						suggestions={['Add a FAQ']}
						imageSrc={(id) => `/image/${id}`}
					/>
				}
			/>
		);
	}

	function opened(root: HTMLElement): { entry: HTMLButtonElement; sheet: HTMLDialogElement } {
		const entry = button(root, 'AI');
		entry.focus();
		act(() => entry.click());
		const sheet = root.querySelector('dialog');
		if (sheet === null) throw new Error('the press opened no sheet');
		return { entry, sheet };
	}

	it('stands docked beside the preview from the wide breakpoint, with no AI press', () => {
		const root = routed(<Editor />);
		const body = root.querySelector('.adm-editor__body');
		expect(body?.querySelector(':scope > main')).not.toBeNull();
		expect(body?.querySelector(':scope > [role="complementary"] textarea')).not.toBeNull();
		expect(root.querySelector('dialog')).toBeNull();
		expect(() => button(root, 'AI')).toThrow();
	});

	it('is a modal below it, opened from the AI press, with the focus inside it', () => {
		atWidth(false);
		const root = routed(<Editor />);
		expect(root.querySelector('.adm-aipanel')).toBeNull();
		const { sheet } = opened(root);
		expect(sheet.open).toBe(true);
		expect(sheet.querySelector('textarea')).not.toBeNull();
		expect(sheet.contains(document.activeElement)).toBe(true);
	});

	it('goes on its X and hands the focus back to the AI press', () => {
		atWidth(false);
		const root = routed(<Editor />);
		const { entry, sheet } = opened(root);
		act(() => button(sheet, 'Close').click());
		expect(root.querySelector('dialog')).toBeNull();
		expect(document.activeElement).toBe(entry);
	});

	it('goes on Escape and hands the focus back to the AI press', () => {
		atWidth(false);
		const root = routed(<Editor />);
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
				donationSettings="Donor chooses"
				onOpen={() => {}}
			/>
		);
		expect(headings(root)).toEqual(['Blocks', 'Layout', 'Goal and end date', 'Gifts']);
		expect(rows(root)).toEqual([
			'NameWinter coat drive',
			'Address/winter-coat-drive',
			'StoryLast winter…',
			'GoalNone',
			'End dateNone',
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
				donationSettings="Donor chooses"
				onOpen={onOpen}
			/>
		);
		expect(headings(root)).toEqual(['Gifts']);
		expect(rows(root)).toEqual([
			'NameWinter coat drive',
			'Address/winter-coat-drive',
			'Donation settingsDonor chooses'
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
	/** the bar's presses and More's lines, each by the name a reader meets it by. */
	const names = (root: HTMLElement) =>
		[...root.querySelectorAll('button, [role="menuitem"]')].map(
			(one) => one.getAttribute('aria-label') ?? one.textContent?.trim()
		);
	const lines = (root: HTMLElement) =>
		[...root.querySelectorAll('[role="menuitem"]')].map((one) => one.textContent?.trim());

	it('offers Edit, which reads Done while on with Settings beside it, and More holding the page’s other presses', () => {
		const onSettings = vi.fn();
		const root = routed(
			<EditorShell
				bar={
					<PublishBar
						closeHref="/admin"
						page={{ kind: 'donation' }}
						state="changed"
						livePath="/donate"
						publishing={false}
						republished={false}
						undoing={false}
						onDiscard={() => {}}
						reset={{ hasEdits: true, onReset: () => {} }}
						onSettings={onSettings}
					/>
				}
				preview={null}
			/>
		);
		const edit = button(root, 'Edit');
		expect(edit.hasAttribute('aria-haspopup')).toBe(false);
		expect(names(root)).not.toContain('Settings');

		edit.focus();
		act(() => edit.click());
		expect(edit.textContent).toBe('Done');
		expect(document.activeElement).toBe(edit);
		const settings = button(root, 'Settings');
		expect(settings.getAttribute('aria-haspopup')).toBe('dialog');
		act(() => settings.click());
		expect(onSettings).toHaveBeenCalledOnce();

		act(() => edit.click());
		expect(edit.textContent).toBe('Edit');
		expect(names(root)).not.toContain('Settings');

		expect(button(root, 'More').getAttribute('aria-haspopup')).toBe('menu');
		expect(lines(root)).toEqual([
			'Open /donate (opens in a new tab)',
			'Reset to default',
			'Discard changes'
		]);
	});

	it('holds only the lines whose press can act in More, and draws no More holding none', () => {
		const campaign = (state: 'unpublished' | 'live') => (
			<PublishBar
				closeHref="/admin/campaigns"
				page={{ kind: 'campaign', name: 'Winter coat drive', onRename: () => {} }}
				state={state}
				livePath="/winter-coat-drive"
				publishing={false}
				republished={false}
				undoing={false}
				onDiscard={() => {}}
			/>
		);
		expect(lines(routed(campaign('live')))).toEqual([
			'Open /winter-coat-drive (opens in a new tab)'
		]);
		expect(names(routed(campaign('unpublished')))).not.toContain('More');
	});

	it('offers the AI press below the wide breakpoint alone, where the panel is a sheet', () => {
		const onAi = vi.fn();
		const at = () =>
			routed(
				<PublishBar
					closeHref="/admin"
					page={{ kind: 'donation' }}
					state="live"
					publishing={false}
					republished={false}
					undoing={false}
					onAi={onAi}
				/>
			);
		expect(names(at())).not.toContain('AI');

		atWidth(false);
		const ai = button(at(), 'AI');
		expect(ai.getAttribute('aria-haspopup')).toBe('dialog');
		act(() => ai.click());
		expect(onAi).toHaveBeenCalledOnce();
	});

	it('walks its presses in the order it draws them: Publish before the quieter ones on a phone', () => {
		/** below the wide breakpoint, and at or past the middle one or not, as ./wide.ts reads them. */
		const atMiddle = (middle: boolean) =>
			vi.spyOn(window, 'matchMedia').mockImplementation(
				(media) =>
					({
						matches: media.includes('44rem') ? middle : false,
						media,
						addEventListener: () => {},
						removeEventListener: () => {}
					}) as unknown as MediaQueryList
			);
		const presses = () =>
			names(
				routed(
					<PublishBar
						closeHref="/admin"
						page={{ kind: 'donation' }}
						state="changed"
						livePath="/donate"
						publishing={false}
						republished={false}
						onPublish={() => {}}
						undoing={false}
						onSettings={() => {}}
						onAi={() => {}}
					/>
				)
			).filter((name) => name !== 'Close editor' && name !== 'Open /donate (opens in a new tab)');

		atMiddle(false);
		expect(presses()).toEqual(['Publish', 'Edit', 'AI', 'More']);

		atMiddle(true);
		expect(presses()).toEqual(['Edit', 'AI', 'More', 'Publish']);
	});

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
	/** the frame in the editor, under the bar whose Edit turns it. */
	function framed(onBlockClick: (id: string) => void) {
		const root = routed(
			<EditorShell
				bar={<Bar onSettings={() => {}} onAi={() => {}} />}
				preview={
					<PreviewFrame
						src="about:blank"
						title="Preview of Winter coat drive"
						onBlockClick={onBlockClick}
					/>
				}
			/>
		);
		const frame = root.querySelector('iframe');
		if (frame === null || frame.contentWindow === null) throw new Error('no frame');
		// the framed window is the boundary: what the editor tells it is recorded rather than sent
		// into an empty document of another origin.
		const told = vi.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {});
		return Object.assign(frame, { told });
	}
	/** the bar's Edit, or Done while it is on. */
	const turnEdit = () => {
		const press = [...document.querySelectorAll('button')].find(
			(one) => one.textContent === 'Edit' || one.textContent === 'Done'
		);
		act(() => press?.click());
	};
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
						socialLinks: []
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
		turnEdit();
		const own = window.location.origin;
		const message = { type: 'bg-page-block', id: 'b1' };

		post(message, 'https://elsewhere.example', frame.contentWindow);
		post(message, own, window);
		post({ type: 'something-else', id: 'b1' }, own, frame.contentWindow);
		post(message, own, frame.contentWindow);

		expect(onBlockClick.mock.calls).toEqual([['b1']]);
	});

	it('hands on a click only while Edit is on, the preview being just the page with it off', () => {
		const onBlockClick = vi.fn();
		const frame = framed(onBlockClick);
		const clicked = (id: string) =>
			post({ type: 'bg-page-block', id }, window.location.origin, frame.contentWindow);

		clicked('off-before');
		turnEdit();
		clicked('on');
		turnEdit();
		clicked('off-after');

		expect(onBlockClick.mock.calls).toEqual([['on']]);
	});

	it('tells the page whether Edit is on at each press, and again when the page says it is ready', () => {
		const frame = framed(() => {});
		const own = window.location.origin;

		turnEdit();
		post({ type: 'bg-page-ready' }, own, frame.contentWindow);
		turnEdit();
		post({ type: 'bg-page-ready' }, own, window);

		expect(frame.told.mock.calls).toEqual([
			[{ type: 'bg-page-editing', on: true }, own],
			[{ type: 'bg-page-editing', on: true }, own],
			[{ type: 'bg-page-editing', on: false }, own]
		]);
	});
});
