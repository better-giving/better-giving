import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { UNREACHED } from '$lib/admin/unreached';
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
import type { Resized } from '@better-giving/operator/images/resize';
import CampaignEditor, { clientAction } from './_app.admin.campaigns.$pageId';
import { clientAction as imagesClientAction } from './_app.admin.images';

// happy-dom decodes no image, so the resize is the boundary stood in for: each pick waits in
// `resizes` until the case hands it a result.
const resizes: ((result: Resized) => void)[] = [];
vi.mock('@better-giving/operator/images/resize', async (actual) => ({
	...(await actual<typeof import('@better-giving/operator/images/resize')>()),
	resizeImage: () => new Promise<Resized>((resolve) => resizes.push(resolve))
}));

// a campaign's editor as the route mounts it: the preview and the bar's presses, and no AI
// anywhere, every hand edit reached from Settings or a click in
// the preview once Edit is on, what its first Publish says of the address, the
// questions an address save comes back with — asked, answered yes with the version, or declined —
// whether the donation settings sheet stands over Settings or on its own ground, and the notice over
// a draft the read rule refuses, and a press whose request never reaches the server.
// the loader and the server's action are stand-ins, one drawing the fixture below and the other
// recording each body and answering what the case scripts, or rejecting the way a browser's
// `fetch` does when the request never left; what the real ones do is
// ./_app.admin.campaigns.$pageId.workers.spec.ts's. every press goes through the route's own
// `clientAction`, as it does in a browser.
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
/** what the action answers each post, in turn, and the draft it leaves for the loader to draw. */
let answers: { body: unknown; status?: number; drawn?: Loaded }[];
/** the phone has lost its signal: every request rejects before it leaves, as `fetch` does. */
let offline: boolean;
/** what the server's action throws in place of answering, as it reaches the browser. */
let thrown: unknown;

/** what the editor says of a press that never reached the server. */
const NOT_SENT =
	'That may not have saved: the server couldn’t be reached. Check your connection and press again.';

function unreachable(): void {
	if (offline) throw new TypeError('Failed to fetch');
}

beforeEach(() => {
	drawn = unpublished();
	unreadable = null;
	posted = [];
	bodies = [];
	answers = [];
	offline = false;
	thrown = undefined;
	resizes.length = 0;
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
			loader: () => {
				unreachable();
				return unreadable ?? drawn;
			},
			action: (args) =>
				clientAction({
					...args,
					serverAction: async () => {
						unreachable();
						const body = await args.request.formData();
						bodies.push(body);
						posted.push(Object.fromEntries([...body].map(([k, v]) => [k, String(v)])));
						if (thrown !== undefined) throw thrown;
						const answer = answers.shift();
						if (answer === undefined)
							throw new Error('the action was posted to with no answer ready');
						if (answer.drawn !== undefined) drawn = answer.drawn;
						return Response.json(answer.body, { status: answer.status ?? 200 });
					}
				} as never),
			HydrateFallback: () => null,
			Component: Editor
		},
		{
			path: '/admin/images',
			action: (args) =>
				imagesClientAction({
					...args,
					serverAction: async () => {
						unreachable();
						throw new Error('no upload in these cases reaches the server');
					}
				} as never)
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

	it('says a refusal about no box at Save, the connection-lost sentence among them', async () => {
		answers = [
			{
				body: {
					form: { id: 'campaign-address', result: { status: 'error', error: { '': [UNREACHED] } } }
				},
				status: 503
			}
		];
		await screen();

		await saveAddress('winter-coats');

		const sheet = card('Address');
		const said = [...sheet.querySelectorAll('[role="status"]')].map((one) => one.textContent);
		expect(said).toContain(UNREACHED);
		expect(button('Save address', sheet).getAttribute('aria-describedby')).toBeTruthy();
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

	/**
	 * the refusal the group headed `legend` was answered with, and whether each of its chips is
	 * marked refused and described by it.
	 */
	function groupRefusal(within: Element, legend: string) {
		const group = [...within.querySelectorAll('fieldset')].find(
			(one) => one.querySelector('legend')?.textContent === legend
		);
		const refusal = group?.querySelector('.adm-field__error') ?? null;
		const marked = [...chips(within, legend).values()].every(
			(chip) =>
				chip.getAttribute('aria-invalid') === 'true' &&
				(chip.getAttribute('aria-describedby') ?? '').split(' ').includes(refusal?.id ?? '-')
		);
		return { said: refusal?.textContent ?? null, marked };
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

	/** the share buttons each body posted, in the order it posted them. */
	const channelsPosted = () => bodies.map((body) => body.getAll('share_channels'));

	it('posts a share button ticked after the ones the page holds, in the order it holds them', async () => {
		drawn = { ...drawn, share: { message: '', channels: ['email', 'facebook'] } };
		answers = [{ body: { saved: 'page-share-channels' } }];
		const sheet = await settings();

		await press(chips(sheet, 'Share buttons').get('X') as HTMLInputElement);

		expect(posted[0]?.[WHICH_FORM]).toBe('page-share-channels');
		expect(channelsPosted()).toEqual([['email', 'facebook', 'x']]);
	});

	it('posts a share button unticked by taking it out where it stands', async () => {
		drawn = { ...drawn, share: { message: '', channels: ['x', 'email', 'facebook'] } };
		answers = [{ body: { saved: 'page-share-channels' } }];
		const sheet = await settings();

		await press(chips(sheet, 'Share buttons').get('Email') as HTMLInputElement);

		expect(channelsPosted()).toEqual([['x', 'facebook']]);
	});

	it('keeps a pick on each control made while a press is in flight, drawn picked, and sends them in turn, each at the version the one before moved to, the head saying so meanwhile', async () => {
		const banner: Loaded = { ...drawn, version: 2, layout: 'banner' };
		const cool: Loaded = { ...banner, version: 3, look: { ...banner.look, shade: 'cool' } };
		const square: Loaded = { ...cool, version: 4, look: { ...cool.look, corners: 'square' } };
		answers = [
			{ body: { saved: 'page-layout' }, drawn: banner },
			{ body: { saved: 'page-shade' }, drawn: cool },
			{ body: { saved: 'page-corners' }, drawn: square }
		];
		const sheet = await settings();
		const layout = sheet.querySelector<HTMLInputElement>('input[value="banner"]');
		if (layout === null) throw new Error('no Banner layout');

		act(() => {
			layout.click();
			(chips(sheet, 'Shade').get('Cool') as HTMLInputElement).click();
			(chips(sheet, 'Corners').get('Square') as HTMLInputElement).click();
		});
		// both picks wait, each drawn picked meanwhile.
		expect(taken(card('Settings'), 'Shade')).toEqual(['Cool']);
		expect(taken(card('Settings'), 'Corners')).toEqual(['Square']);
		const status = () => card('Settings').querySelector('.adm-sheet__head [role="status"]');
		expect(status()?.textContent).toBe('Saving your change…');
		for (let round = 0; round < 6; round += 1) await settle();
		expect(status()?.textContent).toBe('');

		expect(posted).toEqual([
			{ [WHICH_FORM]: 'page-layout', [RECORD_VERSION]: '1', layout: 'banner' },
			{ [WHICH_FORM]: 'page-shade', [RECORD_VERSION]: '2', shade: 'cool' },
			{ [WHICH_FORM]: 'page-corners', [RECORD_VERSION]: '3', corners: 'square' }
		]);
		expect(taken(card('Settings'), 'Shade')).toEqual(['Cool']);
		expect(taken(card('Settings'), 'Corners')).toEqual(['Square']);
	});

	it('says a refused look pick under the look, and draws the page’s look again', async () => {
		answers = [refused('page-shade', { shade: ['one of light, warm or cool'] })];
		const sheet = await settings();

		await press(chips(sheet, 'Shade').get('Cool') as HTMLInputElement);

		expect(groupRefusal(card('Settings'), 'Shade')).toEqual({
			said: 'one of light, warm or cool',
			marked: true
		});
		expect(groupRefusal(card('Settings'), 'Corners')).toEqual({ said: null, marked: false });
		expect(taken(card('Settings'), 'Shade')).toEqual(['Light']);
	});

	it('says an emptied set of share buttons is refused, under them', async () => {
		drawn = { ...drawn, share: { message: '', channels: ['email'] } };
		answers = [refused('page-share-channels', { share_channels: ['at least one share button'] })];
		const sheet = await settings();

		await press(chips(sheet, 'Share buttons').get('Email') as HTMLInputElement);

		expect(posted[0]).toEqual({ [WHICH_FORM]: 'page-share-channels', [RECORD_VERSION]: '1' });
		expect(groupRefusal(card('Settings'), 'Share buttons')).toEqual({
			said: 'at least one share button',
			marked: true
		});
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
			'Move Cover photo down, 1 of 7',
			'Remove Cover photo, 1 of 7'
		]);
		expect(rowPresses(sheet, 'Story')).toEqual([
			'Move Story up, 4 of 7',
			'Move Story down, 4 of 7',
			'Remove Story, 4 of 7'
		]);
		expect(rowPresses(sheet, 'Donation box')).toEqual([
			'Move Donation box up, 5 of 7',
			'Move Donation box down, 5 of 7'
		]);
		expect(rowPresses(sheet, 'Organisation details')).toEqual([
			'Move Organisation details up, 7 of 7',
			'Remove Organisation details, 7 of 7'
		]);
	});

	it('posts a move, and a remove once its card is answered, with the block and the version', async () => {
		drawn = { ...drawn, version: 9 };
		answers = [{ body: { saved: 'block-move' } }, { body: { saved: 'block-remove' } }];
		await settings();

		await press(button('Move Story up, 4 of 7', card('Settings')));
		await press(button('Remove Goal, 3 of 7', card('Settings')));
		expect(posted).toHaveLength(1);
		await press(button('Remove', card('Remove Goal?')));

		expect(posted).toEqual([
			{ [WHICH_FORM]: 'block-move', [RECORD_VERSION]: '9', block_id: 'story', direction: 'up' },
			{ [WHICH_FORM]: 'block-remove', [RECORD_VERSION]: '9', block_id: 'goal' }
		]);
	});

	it('says a refused block press under the row pressed, the reload sentence of a stale one among them', async () => {
		const stale = 'Nothing was changed: this page has been saved since the editor was opened.';
		answers = [refused('block-move', { '': [stale] }, 409)];
		await settings();

		await press(button('Move Story up, 4 of 7', card('Settings')));

		const pressed = button('Move Story up, 4 of 7', card('Settings'));
		const line = document.getElementById(pressed.getAttribute('aria-describedby') ?? '');
		expect(line?.textContent).toBe(stale);
		expect(line?.closest('.adm-blockrow')).toBe(pressed.closest('.adm-blockrow'));
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

describe('a press whose request never reaches the server', () => {
	/** what the sheet's message areas say, a group's refusal among them. */
	const said = (sheet: Element) =>
		[...sheet.querySelectorAll('[role="status"], [role="alert"]')]
			.map((one) => one.textContent)
			.join(' ');

	function typeInto(box: HTMLInputElement, text: string): void {
		act(() => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, text);
			box.dispatchEvent(new Event('input', { bubbles: true }));
		});
	}

	it('leaves a block’s sheet open, holding what was typed, and says so at Done', async () => {
		await screen();
		await editOn();
		await clickInPreview('title');
		const sheet = card('Title');
		const heading = sheet.querySelector<HTMLInputElement>('input[name="heading"]');
		if (heading === null) throw new Error('the Title sheet drew no heading box');

		typeInto(heading, 'Coats for every kid');
		offline = true;
		await press(button('Done', sheet));

		expect(card('Title').open).toBe(true);
		expect(heading.value).toBe('Coats for every kid');
		expect(said(card('Title'))).toContain(NOT_SENT);
	});

	it('leaves Settings open on a look pick, the page’s look drawn again, and says so under its group', async () => {
		await screen();
		await editOn();
		await press(button('Settings'));
		const cool = [...card('Settings').querySelectorAll('label')].find(
			(one) => one.textContent === 'Cool'
		);
		if (cool === undefined) throw new Error('Settings drew no Cool shade');

		offline = true;
		await press(cool.querySelector('input') as HTMLInputElement);

		expect(card('Settings').open).toBe(true);
		expect(said(card('Settings'))).toContain(NOT_SENT);
		const shade = [...card('Settings').querySelectorAll('fieldset')].find(
			(one) => one.querySelector('legend')?.textContent === 'Shade'
		);
		const picked = [...(shade?.querySelectorAll('label') ?? [])].filter(
			(one) => one.querySelector('input')?.checked
		);
		expect(picked.map((one) => one.textContent)).toEqual(['Light']);
	});

	it('leaves the first Publish’s confirm up, and the campaign unpublished', async () => {
		await screen();
		await press(button('Publish', document.querySelector('.adm-publishbar') ?? document));

		offline = true;
		await press(button('Publish', card('Publish Winter coat drive?')));

		expect(card('Publish Winter coat drive?').open).toBe(true);
		expect(said(card('Publish Winter coat drive?'))).toContain(NOT_SENT);
		expect(document.querySelector('.adm-publishbar')?.textContent).toContain('Not published');
	});

	it('leaves the Name sheet open on a rename, holding the name typed', async () => {
		await screen();
		await editOn();
		await press(button('Settings'));
		await press(settingsRow('Name'));
		const box = card('Name').querySelector('input');
		if (box === null) throw new Error('the Name sheet drew no box');

		typeInto(box, 'Coats for every kid');
		offline = true;
		await press(button('Done', card('Name')));

		expect(card('Name').open).toBe(true);
		expect(box.value).toBe('Coats for every kid');
		expect(said(card('Name'))).toContain(NOT_SENT);
		expect(settingsRow('Name').textContent).toContain('Winter coat drive');
	});

	it('leaves a photo block’s sheet open on an upload, with no photo placed, and says so at the press', async () => {
		await screen();
		await editOn();
		await clickInPreview('hero');
		const sheet = card('Cover photo');
		const picker = sheet.querySelector<HTMLInputElement>('input[type="file"]');
		if (picker === null) throw new Error('the Cover photo sheet drew no picker');
		Object.defineProperty(picker, 'files', {
			configurable: true,
			value: [new File(['camera bytes'], 'coats.heic', { type: 'image/heic' })]
		});

		offline = true;
		await act(async () => {
			picker.dispatchEvent(new Event('change', { bubbles: true }));
		});
		const blob = new Blob([new Uint8Array(1_000)], { type: 'image/webp' });
		await act(async () => resizes.shift()?.({ ok: true, blob, width: 800, height: 800 }));
		await settle();

		expect(card('Cover photo').open).toBe(true);
		expect(said(card('Cover photo'))).toContain(NOT_SENT);
		expect(card('Cover photo').querySelector('input[name="image_id"]')?.getAttribute('value')).toBe(
			''
		);
	});

	describe('beside a server that answered', () => {
		async function renameInSheet(next: string) {
			await screen();
			await editOn();
			await press(button('Settings'));
			await press(settingsRow('Name'));
			const box = card('Name').querySelector('input');
			if (box === null) throw new Error('the Name sheet drew no box');
			typeInto(box, next);
			await press(button('Done', card('Name')));
			return box;
		}

		it('draws a 500’s refusal in the sheet as it came', async () => {
			const failed = 'Nothing was saved: the name could not be written. Press Done again.';
			answers = [
				{
					body: {
						form: { id: 'campaign-name', result: { status: 'error', error: { '': [failed] } } }
					},
					status: 500
				}
			];
			const box = await renameInSheet('Coats for every kid');

			expect(card('Name').open).toBe(true);
			expect(box.value).toBe('Coats for every kid');
			expect(said(card('Name'))).toContain(failed);
			expect(said(card('Name'))).not.toContain(NOT_SENT);
		});

		it('says nothing of the connection over an error the server’s action threw', async () => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			thrown = new Error('Unexpected Server Error');
			await renameInSheet('Coats for every kid');

			expect(document.body.textContent).not.toContain(NOT_SENT);
			expect(() => card('Name')).toThrow();
		});
	});
});
