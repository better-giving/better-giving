import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { editorBlocks, layoutPictures } from '$lib/page/block-edit';
import { BLOCK_MESSAGE } from '$lib/page/preview-message';
import { defaultCampaign } from '$lib/page/defaults';
import CampaignEditor from './_app.admin.campaigns.$pageId';

// a campaign's editor as the route mounts it: what its first Publish says of the address, the
// questions an address save comes back with — asked, answered yes with the version, or declined —
// whether the donation settings sheet stands over Settings or on its own ground, and the notice
// over a draft the read rule refuses.
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
		chat: '/admin/pages/p1/chat',
		shareMessage: null,
		goalMinor: null,
		endDate: null,
		blocks: editorBlocks(DRAFT, 'USD', new Set()),
		layout: DRAFT.layout,
		layouts: layoutPictures(),
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
		pageSettings: {
			look: { source: 'organisation' },
			organisationLook: { shade: 'light', corner: 'soft', brandColour: null },
			organisationShareMessage: null
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
/** what the action answers each post, in turn. */
let answers: { body: unknown; status?: number }[];

beforeEach(() => {
	drawn = unpublished();
	unreadable = null;
	posted = [];
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
				posted.push(
					Object.fromEntries([...(await request.formData())].map(([k, v]) => [k, String(v)]))
				);
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

describe('a first Publish', () => {
	it('reads the address taken and the one the campaign’s name asked for', async () => {
		await screen();

		await press(button('Publish', document.querySelector('.adm-publishbar') ?? document));

		const text = card('Publish Winter coat drive?').textContent;
		expect(text).toContain('/winter-coat-drive-2');
		expect(text).toContain(
			'/winter-coat-drive is taken, so this campaign takes the next free address.'
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
	const takeover = '/giving-tuesday shows Giving Tuesday’s ended screen. Use it here?';

	it('asks before taking an ended campaign’s address, and posts the yes with the version', async () => {
		drawn = { ...drawn, version: 7 };
		answers = [ended, { body: { saved: 'address' } }];
		await screen();

		await saveAddress('giving-tuesday');
		expect(posted).toEqual([
			{ [WHICH_FORM]: 'campaign-address', [RECORD_VERSION]: '7', slug: 'giving-tuesday' }
		]);
		expect(card(takeover).textContent).toContain('Giving Tuesday is left with no address.');

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
		await press(button('Settings'));

		await press(settingsRow('Donation settings'));

		expect(card('Donation settings').classList.contains('adm-sheet--stacked')).toBe(true);
	});

	it('lays its own ground when opened from the preview’s donation box', async () => {
		await screen();
		const box = drawn.blocks.find((block) => block.type === 'donation-box');
		if (box === undefined) throw new Error('the fixture draws no donation box');
		const frame = document.querySelector('iframe');

		await act(async () => {
			window.dispatchEvent(
				new MessageEvent('message', {
					data: { type: BLOCK_MESSAGE, id: box.id },
					origin: window.location.origin,
					source: frame?.contentWindow ?? null
				})
			);
		});
		await settle();

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
		chat: '/admin/pages/p1/chat',
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
		expect(() => button('Discard changes')).not.toThrow();
	});

	it('offers no Discard changes where the live page cannot be read either', async () => {
		unreadable = refused(false);
		await screen();

		expect(document.querySelector('.adm-banner')?.textContent).toContain(
			'there is no live page to go back to'
		);
		expect(() => button('Discard changes')).toThrow();
	});
});
