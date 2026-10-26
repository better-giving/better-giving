import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { UNREACHED } from '$lib/admin/unreached';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { editorSections, editorShareMessage, newPhotoSection } from '$lib/page/content-edit';
import { SECTION_MESSAGE } from '$lib/page/preview-message';
import { type Page, PHOTOS_MAX } from '$lib/page/catalog';
import { defaultCampaign } from '$lib/page/defaults';
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
// anywhere, content and nothing that lays the page out, every hand edit reached from Settings or a
// click in the preview once Edit is on, what its first Publish says of the address, the
// questions an address save comes back with — asked, answered yes with the version, or declined —
// whether the donation settings sheet stands over Settings or on its own ground, and the notice over
// a draft the read rule refuses, and a press whose request never reaches the server.
// the loader and the server's action are stand-ins, one drawing the fixture below and the other
// recording each body and answering what the case scripts, or rejecting the way a browser's
// `fetch` does when the request never left; what the real ones do is
// ./_app.admin.campaigns.$pageId.db.spec.ts's. every press goes through the route's own
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
		sections: editorSections(DRAFT, 'campaign', 'USD'),
		newPhoto: newPhotoSection(DRAFT),
		shareMessage: editorShareMessage(DRAFT),
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

/** a click on the section `id` in the preview, as the framed page posts it. */
async function clickInPreview(id: string) {
	const frame = document.querySelector('iframe');
	await act(async () => {
		window.dispatchEvent(
			new MessageEvent('message', {
				data: { type: SECTION_MESSAGE, id },
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

	it('is reached by a click on its section in the preview while Edit is on, which opens that section’s sheet', async () => {
		await screen();
		const section = drawn.sections.find((one) => one.id === 'story');
		if (section === undefined) throw new Error('the fixture draws no story section');

		await clickInPreview(section.id);
		expect(document.querySelector('dialog')).toBeNull();

		await editOn();
		await clickInPreview(section.id);

		expect(card(section.label).open).toBe(true);
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
		await editOn();
		await clickInPreview('donate');

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

describe('Settings’ content', () => {
	/** Settings opened over the editor, as the bar's Settings opens it with Edit on. */
	async function settings() {
		await screen();
		await editOn();
		await press(button('Settings'));
		return card('Settings');
	}

	/** the rows Settings lists, by label. */
	const rows = (sheet: Element) =>
		[...sheet.querySelectorAll('.adm-openrow__label')].map((one) => one.textContent);

	it('lists the content a campaign holds and what is around it, and nothing that lays the page out', async () => {
		const sheet = await settings();

		expect(rows(sheet)).toEqual([
			'Name',
			'Address',
			'Title',
			'Story',
			'Cover photo',
			'Impact tiers',
			'Questions',
			'Goal',
			'End date',
			'Share message',
			'Donation settings'
		]);
		expect(button('Add a photo', sheet)).toBeDefined();
		const text = sheet.textContent ?? '';
		for (const gone of [
			'Layout',
			'Look',
			'Shade',
			'Corners',
			'Colours',
			'Variant',
			'Background',
			'Share buttons',
			'Add a block',
			'Move',
			'Remove'
		])
			expect(text).not.toContain(gone);
		expect(sheet.querySelector('fieldset, input[type="radio"], select')).toBeNull();
		const labelled = [...document.querySelectorAll('[aria-label]')].map(
			(one) => one.getAttribute('aria-label') ?? ''
		);
		expect(labelled.length).toBeGreaterThan(0);
		expect(labelled.filter((name) => /\bmove\b|variant|background|layout/i.test(name))).toEqual([]);
	});

	it('lists a placed photo, a tier and a question as rows of their own, in the order the page draws them', async () => {
		const full: Page = {
			...DRAFT,
			photos: [{ imageId: '019fb300-0000-7000-8000-000000000001', alt: 'Coats on a rack' }],
			tiers: [{ amountMinor: 2500, buys: 'a coat' }],
			faq: [
				{ question: 'Who gets them?', answer: { type: 'doc', content: [{ type: 'paragraph' }] } }
			]
		};
		drawn = {
			...drawn,
			sections: editorSections(full, 'campaign', 'USD'),
			newPhoto: newPhotoSection(full)
		};

		const sheet = await settings();

		expect(rows(sheet).slice(2, 8)).toEqual([
			'Title',
			'Story',
			'Cover photo',
			'Photo 1',
			'Impact tiers',
			'Questions'
		]);
	});

	it('opens a section’s sheet over Settings from its row, with no preview click', async () => {
		await settings();

		await press(settingsRow('Story'));

		expect(card('Story').classList.contains('adm-sheet--stacked')).toBe(true);
	});

	it.each([
		['goal', 'Goal'],
		['share', 'Share message']
	])(
		'opens the %s sheet, not a section’s, on a click on it in the preview',
		async (id, heading) => {
			await screen();
			await editOn();

			await clickInPreview(id);

			expect(card(heading).open).toBe(true);
			expect(() => card('Settings')).toThrow();
		}
	);

	it.each([
		[PHOTOS_MAX - 1, true],
		[PHOTOS_MAX, false]
	])('with %i photos placed, Add a photo is offered: %s', async (count, drawnButton) => {
		const full: Page = {
			...DRAFT,
			photos: Array.from({ length: count }, (_, at) => ({
				imageId: `019fb300-0000-7000-8000-0000000002${String(at).padStart(2, '0')}`,
				alt: null
			}))
		};
		drawn = {
			...drawn,
			sections: editorSections(full, 'campaign', 'USD'),
			newPhoto: newPhotoSection(full)
		};

		const sheet = await settings();

		expect(rows(sheet).filter((label) => label?.startsWith('Photo '))).toHaveLength(count);
		const added = [...sheet.querySelectorAll('button')].some(
			(one) => one.textContent?.trim() === 'Add a photo'
		);
		expect(added).toBe(drawnButton);
	});

	it('opens an empty photo’s sheet from Add a photo', async () => {
		const sheet = await settings();

		await press(button('Add a photo', sheet));

		expect(card('Add a photo').open).toBe(true);
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
		drawn = { ...drawn, version: 5, shareMessage: 'Help us' };
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

	it('leaves a section’s sheet open, holding what was typed, and says so at Done', async () => {
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

	it('leaves the cover photo’s sheet open on an upload, with no photo placed, and says so at the press', async () => {
		await screen();
		await editOn();
		await clickInPreview('cover');
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
