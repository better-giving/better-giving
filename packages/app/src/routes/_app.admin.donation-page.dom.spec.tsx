import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import {
	addablePictures,
	editorBlocks,
	editorLook,
	editorShare,
	layoutPictures,
	lookPictures,
	shareChannelPictures
} from '$lib/page/block-edit';
import { defaultCampaign } from '$lib/page/defaults';
import { BLOCK_MESSAGE } from '$lib/page/preview-message';
import DonationPageEditor, { clientAction } from './_app.admin.donation-page';

// the Donation page's editor as the route mounts it, over a phone that has lost its signal: a
// press whose request never reaches the server leaves the editor on screen and says so where the
// press reports. the loader and the server's action are stand-ins that reject the way a
// browser's `fetch` does while `offline`; every press goes through the route's own `clientAction`,
// as it does in a browser. what the real action writes is
// ./_app.admin.donation-page.workers.spec.ts's, and the editor's other presses are the campaign
// editor's spec beside this one, over the same parts.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen: nothing here reads a computed
// style.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Drawn = Parameters<typeof DonationPageEditor>[0]['loaderData'];
type Loaded = Extract<Drawn, { unreadable: false }>;

const DRAFT = defaultCampaign();

/** a Donation page live with edits since. */
function edited(): Loaded {
	return {
		unreadable: false,
		state: 'changed',
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
		addable: addablePictures('donation_page'),
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
		hasEdits: true
	};
}

/** the phone has lost its signal: every request rejects before it leaves, as `fetch` does. */
let offline: boolean;

beforeEach(() => {
	offline = false;
});

function unreachable(): void {
	if (offline) throw new TypeError('Failed to fetch');
}

const NOT_SENT =
	'That may not have saved: the server couldn’t be reached. Check your connection and press again.';

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
	return createElement(DonationPageEditor as never, {
		loaderData: useLoaderData<Drawn>(),
		params: {},
		matches: []
	});
}

/** a round of the event loop, so the router's promises settle. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function screen() {
	const Stub = createRoutesStub([
		{
			path: '/admin/donation-page',
			loader: () => {
				unreachable();
				return edited();
			},
			action: (args) =>
				clientAction({
					...args,
					serverAction: async () => {
						unreachable();
						throw new Error('no press in these cases reaches the server');
					}
				} as never),
			HydrateFallback: () => null,
			Component: Editor
		}
	]);
	mount(createElement(Stub, { initialEntries: ['/admin/donation-page'] }));
	await settle();
}

function button(name: string, within: Element | Document = document): HTMLButtonElement {
	const found = [...within.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name
	);
	if (found === undefined) throw new Error(`no ${name} button`);
	return found;
}

function card(title: string): HTMLDialogElement {
	const found = [...document.querySelectorAll('dialog')].find(
		(one) => one.querySelector('h2')?.textContent === title
	);
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

/** what the message areas inside `within` say. */
const said = (within: Element) =>
	[...within.querySelectorAll('[role="status"]')].map((one) => one.textContent).join(' ');

const bar = () => document.querySelector('.adm-publishbar') ?? document.body;

it('leaves a block’s sheet open, holding what was typed, and says so at Done', async () => {
	await screen();
	const framed = document.querySelector('iframe')?.contentWindow;
	if (framed) vi.spyOn(framed, 'postMessage').mockImplementation(() => {});
	await press(button('Edit'));
	await act(async () => {
		window.dispatchEvent(
			new MessageEvent('message', {
				data: { type: BLOCK_MESSAGE, id: 'title' },
				origin: window.location.origin,
				source: framed ?? null
			})
		);
	});
	await settle();
	const heading = card('Title').querySelector<HTMLInputElement>('input[name="heading"]');
	if (heading === null) throw new Error('the Title sheet drew no heading box');
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
			heading,
			'Give where it counts'
		);
		heading.dispatchEvent(new Event('input', { bubbles: true }));
	});

	offline = true;
	await press(button('Done', card('Title')));

	expect(card('Title').open).toBe(true);
	expect(heading.value).toBe('Give where it counts');
	expect(said(card('Title'))).toContain(NOT_SENT);
});

it('says at the bar that a Publish never reached the server, and draws the page unpublished', async () => {
	await screen();

	offline = true;
	await press(button('Publish', bar()));

	expect(said(bar())).toContain(NOT_SENT);
	expect(bar().textContent).toContain('Changes not published');
});
