import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { editorBlocks, layoutPictures } from '$lib/page/block-edit';
import { defaultCampaign } from '$lib/page/defaults';
import CampaignEditor from './_app.admin.campaigns.$pageId';

// a campaign's editor as the route mounts it: what its first Publish says of the address, and the
// questions an address save comes back with — asked, answered yes with the version, or declined.
// the loader and the action are stand-ins, one drawing the fixture below and the other recording
// each body and answering what the case scripts; what the real ones do is
// ./_app.admin.campaigns.$pageId.workers.spec.ts's.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen: nothing here reads a computed
// style.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE = '/admin/campaigns/p1';

type Loaded = Parameters<typeof CampaignEditor>[0]['loaderData'];

const DRAFT = defaultCampaign();

/** a never-published campaign whose name asked for an address another campaign holds. */
function unpublished(): Loaded {
	return {
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
			summary: 'No program'
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
let posted: Record<string, string>[];
/** what the action answers each post, in turn. */
let answers: { body: unknown; status?: number }[];

beforeEach(() => {
	drawn = unpublished();
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
		loaderData: useLoaderData<Loaded>(),
		params: { pageId: 'p1' },
		matches: []
	});
}

async function screen() {
	const Stub = createRoutesStub([
		{
			path: '/admin/campaigns/:pageId',
			loader: () => drawn,
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
		const row = [...card('Settings').querySelectorAll('button')].find(
			(one) => one.querySelector('.adm-openrow__label')?.textContent === 'Address'
		);
		if (row === undefined) throw new Error('Settings drew no Address row');
		await press(row);
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
