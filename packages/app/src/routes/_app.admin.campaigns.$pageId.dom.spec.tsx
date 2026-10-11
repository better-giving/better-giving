import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import {
	addablePictures,
	editorBlocks,
	editorLook,
	editorShare,
	layoutPictures,
	lookPictures,
	shareChannelPictures
} from '$lib/page/block-edit';
import { BLOCK_MESSAGE } from '$lib/page/preview-message';
import type { Page } from '$lib/page/catalog';
import { defaultCampaign, startingBlock } from '$lib/page/defaults';
import CampaignEditor from './_app.admin.campaigns.$pageId';

// a campaign's editor as the route mounts it: the preview and the bar's presses, and no AI
// anywhere, every hand edit reached from Settings or a click in
// the preview once Edit is on, what its first Publish says of the address, the
// questions an address save comes back with — asked, answered yes with the version, or declined —
// whether the donation settings sheet stands over Settings or on its own ground, and the notice over
// a draft the read rule refuses.
// the loader and the action are stand-ins, one drawing the fixture below and the other recording
// each body and answering what the case scripts; what the real ones do is
// ./_app.admin.campaigns.$pageId.workers.spec.ts's.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen: nothing here reads a computed
// style.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE = '/admin/campaigns/p1';

type Drawn = Parameters<typeof CampaignEditor>[0]['loaderData'];
type Loaded = Extract<Drawn, { unreadable: false }>;

const DRAFT = defaultCampaign();

/** a never-published campaign whose name asked for an address another campaign holds. */
function unpublished(): Loaded {
	return {
		unreadable: false,
		state: 'unpublished',
		version: 1,
		// a frame on a path would be fetched from a server nothing here runs.
		preview: 'about:blank',
		goalMinor: null,
		endDate: null,
		blocks: editorBlocks(DRAFT, 'USD'),
		layout: DRAFT.layout,
		layouts: layoutPictures(),
		look: editorLook(DRAFT),
		lookPictures: lookPictures(),
		share: editorShare(DRAFT),
		shareChannels: shareChannelPictures(),
		addable: addablePictures('campaign'),
		settings: {
			boxes: {
				program_mode: 'none',
				program_id: '',
				min_minor: '100',
				max_minor: '1000000',
				suggested_amounts: []
			},
			currency: 'USD',
			programs: [],
			retired: null,
			summary: 'No program',
			switches: { open_on_monthly: false, dedication_on: false },
			monthlyOffered: true
		},
		name: 'Winter coat drive',
		address: '/winter-coat-drive-2',
		asked: '/winter-coat-drive',
		host: 'give.example.org/'
	};
}

let drawn: Loaded;
/** what the loader draws in `drawn`'s place over a draft the read rule refuses. */
let unreadable: Extract<Drawn, { unreadable: true }> | null;
let posted: Record<string, string>[];
/** each body whole, for a box posted more than once. */
let bodies: FormData[];
/** what the action answers each post, in turn. */
let answers: { body: unknown; status?: number }[];

beforeEach(() => {
	drawn = unpublished();
	unreadable = null;
	posted = [];
	bodies = [];
	answers = [];
});

function mount(tree: ReactNode) {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
}

function Editor() {
	return createElement(CampaignEditor as never, {
		loaderData: useLoaderData<Drawn>(),
		params: { pageId: 'p1' },
		matches: []
	});
}

async function screen() {
	const Stub = createRoutesStub([
		{
			path: '/admin/campaigns/:pageId',
			loader: () => unreadable ?? drawn,
			action: async ({ request }) => {
				const body = await request.formData();
				bodies.push(body);
				posted.push(Object.fromEntries([...body].map(([k, v]) => [k, String(v)])));
				const answer = answers.shift();
				if (answer === undefined) throw new Error('the action was posted to with no answer ready');
				return Response.json(answer.body, { status: answer.status ?? 200 });
			},
			HydrateFallback: () => null,
			Component: Editor
		}
	]);
	mount(createElement(Stub, { initialEntries: [PAGE] }));
	await settle();
}

/** a round of the event loop, so the router's promises settle. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function button(name: string, within: Element | Document = document): HTMLButtonElement {
	const found = [...within.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name
	);
	if (found === undefined) throw new Error(`no ${name} button`);
	return found;
}

/** the lines the bar's More menu holds, open or not. */
const moreLines = () =>
	[...document.querySelectorAll('.adm-publishbar [role="menuitem"]')].map((one) =>
		one.textContent?.trim()
	);

/** the card whose heading reads `title`. */
function card(title: string | RegExp): HTMLDialogElement {
	const found = [...document.querySelectorAll('dialog')].find((one) => {
		const heading = one.querySelector('h2')?.textContent ?? '';
		return typeof title === 'string' ? heading === title : title.test(heading);
	});
	if (found === undefined) throw new Error(`no card is headed ${title}`);
	return found;
}

/** Settings' own row named `label`. */
function settingsRow(label: string): HTMLButtonElement {
	const row = [...card('Settings').querySelectorAll('button')].find(
		(one) => one.querySelector('.adm-openrow__label')?.textContent === label
	);
	if (row === undefined) throw new Error(`Settings drew no ${label} row`);
	return row;
}

async function press(target: HTMLElement) {
	await act(async () => {
		target.focus();
		target.click();
	});
	await settle();
}

/** a click on the block `id` in the preview, as the framed page posts it. */
async function clickInPreview(id: string) {
	const frame = document.querySelector('iframe');
	await act(async () => {
		window.dispatchEvent(
			new MessageEvent('message', {
				data: { type: BLOCK_MESSAGE, id },
				origin: window.location.origin,
				source: frame?.contentWindow ?? null
			})
		);
	});
	await settle();
}

/**
 * the bar's Edit pressed on. what the editor tells the framed page is recorded rather than sent into
 * the empty document the stand-in frames.
 */
async function editOn() {
	const framed = document.querySelector('iframe')?.contentWindow;
	if (framed) vi.spyOn(framed, 'postMessage').mockImplementation(() => {});
	await press(button('Edit'));
}

describe('the editor as it opens', () => {
	/** the bar's presses, each by the name a reader meets it by. */
	const presses = () =>
		[...document.querySelectorAll('.adm-publishbar button')].map(
			(one) => one.getAttribute('aria-label') ?? one.textContent?.trim()
		);

	it('shows the preview and Edit, Settings and Publish', async () => {
		await screen();

		expect(document.querySelector('.adm-editor__preview iframe')).not.toBeNull();
		expect(presses()).toEqual(expect.arrayContaining(['Edit', 'Publish']));
		await editOn();
		expect(presses()).toEqual(expect.arrayContaining(['Done', 'Settings', 'Publish']));
	});

	it('draws no AI press, panel or unread mark', async () => {
		await screen();
		await editOn();

		expect(presses()).not.toContain('AI');
		expect(document.querySelector('.adm-publishbar [role="img"]')).toBeNull();
		expect(document.querySelector('.adm-editor__body > :not(main)')).toBeNull();
		expect(document.querySelector('[role="complementary"], dialog')).toBeNull();
	});
});

describe('every hand edit', () => {
	it('is reached from Settings, which stands beside Done once Edit is on', async () => {
		await screen();

		await editOn();
		await press(button('Settings'));

		expect(card('Settings').open).toBe(true);
	});

	it('is reached by a click on its block in the preview while Edit is on, which opens that block’s sheet', async () => {
		await screen();
		const block = drawn.blocks.find((one) => one.type !== 'donation-box');
		if (block === undefined) throw new Error('the fixture draws only a donation box');

		await clickInPreview(block.id);
		expect(document.querySelector('dialog')).toBeNull();

		await editOn();
		await clickInPreview(block.id);

		expect(card(block.label).open).toBe(true);
		expect(() => card('Settings')).toThrow();
	});
});

describe('a first Publish', () => {
	it('reads the address taken and the one the campaign’s name asked for', async () => {
		await screen();

		await press(button('Publish', document.querySelector('.adm-publishbar') ?? document));

		const text = card('Publish Winter coat drive?').textContent;
		expect(text).toContain('/winter-coat-drive-2');
		expect(text).toContain(
			'The address /winter-coat-drive is taken, so this campaign takes the next free one.'
		);
	});
});

describe('an address save that comes back with a question', () => {
	/** writes `text` into a box the way typing would, so react hears it. */
	function typeInto(box: HTMLInputElement, text: string): void {
		act(() => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, text);
			box.dispatchEvent(new Event('input', { bubbles: true }));
		});
	}

	/** Settings, its Address row, `slug` typed and saved. */
	async function saveAddress(slug: string) {
		await editOn();
		await press(button('Settings'));
		await press(settingsRow('Address'));
		const sheet = card('Address');
		const box = sheet.querySelector('input');
		if (box === null) throw new Error('the Address sheet drew no box');
		typeInto(box, slug);
		await press(button('Save address', sheet));
	}

	const ended = {
		body: { ask: { kind: 'takeover', holder: 'Giving Tuesday', to: '/giving-tuesday' } }
	};
	const takeover = 'Use /giving-tuesday here?';

	it('asks before taking an ended campaign’s address, and posts the yes with the version', async () => {
		drawn = { ...drawn, version: 7 };
		answers = [ended, { body: { saved: 'address' } }];
		await screen();

		await saveAddress('giving-tuesday');
		expect(posted).toEqual([
			{ [WHICH_FORM]: 'campaign-address', [RECORD_VERSION]: '7', slug: 'giving-tuesday' }
		]);
		expect(card(takeover).textContent).toContain('It shows the ended screen of Giving Tuesday.');

		await press(button('Use it here', card(takeover)));

		expect(posted[1]).toEqual({
			[WHICH_FORM]: 'campaign-address',
			[RECORD_VERSION]: '7',
			slug: 'giving-tuesday',
			takeover: 'on'
		});
		expect(() => card(takeover)).toThrow();
	});

	it('posts nothing more when the takeover is declined', async () => {
		answers = [ended];
		await screen();
		await saveAddress('giving-tuesday');

		await press(button('Cancel', card(takeover)));

		expect(posted).toHaveLength(1);
		expect(() => card(takeover)).toThrow();
	});

	it('asks before moving a published campaign, and posts the yes with the version', async () => {
		drawn = { ...drawn, state: 'live', address: '/winter-coat-drive', asked: null, version: 4 };
		answers = [
			{ body: { ask: { kind: 'move', from: '/winter-coat-drive', to: '/coats' } } },
			{ body: { saved: 'address' } }
		];
		await screen();

		await saveAddress('coats');
		const move = card('Change the address to /coats?');
		expect(move.textContent).toContain('/winter-coat-drive stops working at once');
		expect(posted).toHaveLength(1);

		await press(button('Change address', move));

		expect(posted[1]).toEqual({
			[WHICH_FORM]: 'campaign-address',
			[RECORD_VERSION]: '4',
			slug: 'coats',
			move: 'on'
		});
	});
});

describe('the donation settings sheet', () => {
	it('stacks over Settings when opened from its Donation settings row', async () => {
		await screen();
		await editOn();
		await press(button('Settings'));

		await press(settingsRow('Donation settings'));

		expect(card('Donation settings').classList.contains('adm-sheet--stacked')).toBe(true);
	});

	it('lays its own ground when opened from the preview’s donation box', async () => {
		await screen();
		const box = drawn.blocks.find((block) => block.type === 'donation-box');
		if (box === undefined) throw new Error('the fixture draws no donation box');

		await editOn();
		await clickInPreview(box.id);

		expect(() => card('Settings')).toThrow();
		expect(card('Donation settings').classList.contains('adm-sheet--stacked')).toBe(false);
	});
});

describe('a draft the page rule refuses', () => {
	const refused = (discardable: boolean): Extract<Drawn, { unreadable: true }> => ({
		unreadable: true,
		discardable,
		state: 'changed',
		version: 3,
		preview: 'about:blank',
		name: 'Winter coat drive',
		address: '/winter-coat-drive',
		host: 'give.example.org/'
	});

	it('says so in the preview’s place, padded from its edges, with Discard changes on the bar', async () => {
		unreadable = refused(true);
		await screen();

		const notice = document.querySelector('.adm-editor__preview > .adm-main > .adm-banner');
		expect(notice?.textContent).toContain('This draft can’t be read');
		expect(notice?.textContent).toContain('Discard changes to go back to the live page.');
		expect(document.querySelector('iframe')).toBe(null);
		expect(moreLines()).toContain('Discard changes');
	});

	it('offers no Discard changes where the live page cannot be read either', async () => {
		unreadable = refused(false);
		await screen();

		expect(document.querySelector('.adm-banner')?.textContent).toContain(
			'there is no live page to go back to'
		);
		expect(moreLines()).not.toContain('Discard changes');
	});
});

describe('Settings’ presses that apply at once', () => {
	/** Settings opened over the editor, as the bar's Settings opens it with Edit on. */
	async function settings() {
		await screen();
		await editOn();
		await press(button('Settings'));
		return card('Settings');
	}

	/** the chips the group headed `legend` holds, by their words. */
	function chips(within: Element, legend: string): Map<string, HTMLInputElement> {
		const group = [...within.querySelectorAll('fieldset')].find(
			(one) => one.querySelector('legend')?.textContent === legend
		);
		if (group === undefined) throw new Error(`no ${legend} group`);
		return new Map(
			[...group.querySelectorAll('label')].map((label) => [
				label.textContent ?? '',
				label.querySelector('input') as HTMLInputElement
			])
		);
	}

	const taken = (within: Element, legend: string) =>
		[...chips(within, legend)].filter(([, input]) => input.checked).map(([words]) => words);

	/** the report region at the foot of the part headed `title`. */
	function report(within: Element, title: string): string | null | undefined {
		const part = [...within.querySelectorAll('section')].find(
			(one) => one.querySelector('h3')?.textContent === title
		);
		return [...(part?.querySelectorAll(':scope > .adm-actions [role="status"]') ?? [])].at(-1)
			?.textContent;
	}

	const refused = (form: string, error: Record<string, string[]>, status = 400) => ({
		body: { form: { id: form, result: { status: 'error', error } } },
		status
	});

	it('draws the look the page wears and the share buttons it offers, picked', async () => {
		drawn = {
			...drawn,
			look: { shade: 'warm', corners: 'round', palette: 'bold' },
			share: { message: '', channels: ['email', 'x'] }
		};
		const sheet = await settings();

		expect(taken(sheet, 'Shade')).toEqual(['Warm']);
		expect(taken(sheet, 'Corners')).toEqual(['Round']);
		expect(taken(sheet, 'Colours')).toEqual(['Bold']);
		expect(taken(sheet, 'Share buttons')).toEqual(['Email', 'X']);
		expect(settingsRow('Share message').textContent).toBe('Share messageThe page’s title');
	});

	it('posts each look pick with the version, and nothing else', async () => {
		drawn = { ...drawn, version: 4 };
		answers = [
			{ body: { saved: 'page-shade' } },
			{ body: { saved: 'page-corners' } },
			{ body: { saved: 'page-palette' } }
		];
		const sheet = await settings();

		await press(chips(sheet, 'Shade').get('Cool') as HTMLInputElement);
		await press(chips(card('Settings'), 'Corners').get('Square') as HTMLInputElement);
		await press(chips(card('Settings'), 'Colours').get('Two-tone') as HTMLInputElement);

		expect(posted).toEqual([
			{ [WHICH_FORM]: 'page-shade', [RECORD_VERSION]: '4', shade: 'cool' },
			{ [WHICH_FORM]: 'page-corners', [RECORD_VERSION]: '4', corners: 'square' },
			{ [WHICH_FORM]: 'page-palette', [RECORD_VERSION]: '4', palette: 'duo' }
		]);
	});

	it('posts the share buttons ticked, in the order they stand', async () => {
		drawn = { ...drawn, share: { message: '', channels: ['facebook', 'email', 'copy-link'] } };
		answers = [{ body: { saved: 'page-share-channels' } }];
		const sheet = await settings();

		await press(chips(sheet, 'Share buttons').get('WhatsApp') as HTMLInputElement);

		expect([...(bodies[0]?.entries() ?? [])]).toEqual([
			[WHICH_FORM, 'page-share-channels'],
			[RECORD_VERSION, '1'],
			['share_channels', 'facebook'],
			['share_channels', 'whatsapp'],
			['share_channels', 'email'],
			['share_channels', 'copy-link']
		]);
	});

	it('says a refused look pick under the look, and draws the page’s look again', async () => {
		answers = [refused('page-shade', { shade: ['one of light, warm or cool'] })];
		const sheet = await settings();

		await press(chips(sheet, 'Shade').get('Cool') as HTMLInputElement);

		expect(report(card('Settings'), 'Look')).toBe('one of light, warm or cool');
		expect(taken(card('Settings'), 'Shade')).toEqual(['Light']);
	});

	it('says an emptied set of share buttons is refused, under them', async () => {
		drawn = { ...drawn, share: { message: '', channels: ['email'] } };
		answers = [refused('page-share-channels', { share_channels: ['at least one share button'] })];
		const sheet = await settings();

		await press(chips(sheet, 'Share buttons').get('Email') as HTMLInputElement);

		expect(posted[0]).toEqual({ [WHICH_FORM]: 'page-share-channels', [RECORD_VERSION]: '1' });
		expect(report(card('Settings'), 'Sharing')).toBe('at least one share button');
		expect(taken(card('Settings'), 'Share buttons')).toEqual(['Email']);
	});

	/** the presses on the block row whose sheet opens on `label`, by name. */
	function rowPresses(within: Element, label: string): string[] {
		const row = [...within.querySelectorAll('.adm-blockrow')].find(
			(one) => one.querySelector('.adm-openrow__label')?.textContent === label
		);
		if (row === undefined) throw new Error(`no ${label} row`);
		return [...row.querySelectorAll(':scope > button:not(.adm-openrow)')].map(
			(one) => one.getAttribute('aria-label') ?? ''
		);
	}

	it('offers each block row only the presses its block can take', async () => {
		const sheet = await settings();

		expect(rowPresses(sheet, 'Cover photo')).toEqual([
			'Move Cover photo down',
			'Remove Cover photo'
		]);
		expect(rowPresses(sheet, 'Story')).toEqual([
			'Move Story up',
			'Move Story down',
			'Remove Story'
		]);
		expect(rowPresses(sheet, 'Donation box')).toEqual([
			'Move Donation box up',
			'Move Donation box down'
		]);
		expect(rowPresses(sheet, 'Organisation details')).toEqual([
			'Move Organisation details up',
			'Remove Organisation details'
		]);
	});

	it('posts a move and a remove with the block and the version', async () => {
		drawn = { ...drawn, version: 9 };
		answers = [{ body: { saved: 'block-move' } }, { body: { saved: 'block-remove' } }];
		await settings();

		await press(button('Move Story up', card('Settings')));
		await press(button('Remove Goal', card('Settings')));

		expect(posted).toEqual([
			{ [WHICH_FORM]: 'block-move', [RECORD_VERSION]: '9', block_id: 'story', direction: 'up' },
			{ [WHICH_FORM]: 'block-remove', [RECORD_VERSION]: '9', block_id: 'goal' }
		]);
	});

	it('says a refused block press under the list, the reload sentence of a stale one among them', async () => {
		const stale = 'Nothing was changed: this page has been saved since the editor was opened.';
		answers = [refused('block-move', { '': [stale] }, 409)];
		await settings();

		await press(button('Move Story up', card('Settings')));

		expect(report(card('Settings'), 'Blocks')).toBe(stale);
		expect(card('Settings').open).toBe(true);
	});

	it('adds a block from Add a block, and opens its sheet once it lands', async () => {
		const added = {
			...DRAFT,
			blocks: [...DRAFT.blocks.slice(0, -1), startingBlock('faq', 'faq'), DRAFT.blocks.at(-1)]
		};
		answers = [{ body: { saved: 'block-add', blockId: 'faq' } }];
		const sheet = await settings();
		drawn = { ...drawn, version: 2, blocks: editorBlocks(added as Page, 'USD') };

		const add = button('Add a block', sheet);
		act(() => add.focus());
		const key = (name: string) =>
			act(async () => {
				document.activeElement?.dispatchEvent(
					new KeyboardEvent('keydown', { key: name, bubbles: true })
				);
			});
		const highlighted = () =>
			sheet.querySelector('[role="menuitem"][data-highlighted]')?.textContent;
		for (let step = 0; step < 12 && highlighted() !== 'Questions'; step += 1)
			await key('ArrowDown');
		await key('Enter');
		await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
		await settle();

		expect(posted).toEqual([
			{ [WHICH_FORM]: 'block-add', [RECORD_VERSION]: '1', block_type: 'faq' }
		]);
		expect(card('Questions').open).toBe(true);
		expect(card('Questions').classList.contains('adm-sheet--stacked')).toBe(true);
	});
});

describe('the share message', () => {
	async function opened() {
		await screen();
		await editOn();
		await press(button('Settings'));
		await press(settingsRow('Share message'));
		return card('Share message');
	}

	function typeInto(box: HTMLTextAreaElement, text: string): void {
		act(() => {
			Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(box, text);
			box.dispatchEvent(new Event('input', { bubbles: true }));
		});
	}

	it('is seeded with the page’s message, and Done posts it trimmed with the version', async () => {
		drawn = { ...drawn, version: 5, share: { message: 'Help us', channels: ['email'] } };
		answers = [{ body: { saved: 'page-share-message' } }];
		const sheet = await opened();
		const box = sheet.querySelector('textarea');
		if (box === null) throw new Error('no message box');
		expect(box.value).toBe('Help us');

		typeInto(box, '  Keep 300 kids warm  ');
		await press(button('Done', sheet));

		expect(posted).toEqual([
			{
				[WHICH_FORM]: 'page-share-message',
				[RECORD_VERSION]: '5',
				share_message: 'Keep 300 kids warm'
			}
		]);
		expect(() => card('Share message')).toThrow();
	});

	it('says a refused message under its box, and a stale one at Done, open both times', async () => {
		const stale = 'Nothing was changed: this page has been saved since the editor was opened.';
		answers = [
			{
				body: {
					form: {
						id: 'page-share-message',
						result: { status: 'error', error: { share_message: ['at most 280 characters'] } }
					}
				},
				status: 400
			},
			{
				body: {
					form: { id: 'page-share-message', result: { status: 'error', error: { '': [stale] } } }
				},
				status: 409
			}
		];
		const sheet = await opened();
		const box = sheet.querySelector('textarea');
		if (box === null) throw new Error('no message box');

		typeInto(box, 'x'.repeat(281));
		await press(button('Done', sheet));
		expect(document.activeElement).toBe(box);
		expect(sheet.textContent).toContain('at most 280 characters');

		typeInto(box, 'Short');
		await press(button('Done', sheet));
		expect(card('Share message').open).toBe(true);
		expect(card('Share message').textContent).toContain(stale);
	});
});
