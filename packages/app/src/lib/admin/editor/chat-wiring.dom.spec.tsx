import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data, useLoaderData, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import type { ChatMessage } from '../chat/chat-sheet';
import { useEditorChat } from './chat-wiring';

// what the editor's chat does over the network: what a send posts, what the composer does while
// the turn runs, what the editor reads once it lands, and what a send nothing was stored from gives
// back. the chat route here is a stand-in that
// records what arrived and holds each post until the case lets it land; what the real one does with
// it is src/routes/_app.admin.pages.$pageId.chat.workers.spec.ts's.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE = '/admin/campaigns/p1';
const CHAT = '/admin/pages/p1/chat';

let stored: ChatMessage[];
let posted: Record<string, string>[];
/** each post waits here until the case lets it land. */
let held: (() => void)[];
/** how many times the editor's own loader has answered. */
let editorLoads: number;
/** what the chat route answers the next posts with, in order, in place of a stored turn. */
let refusals: { body: { error: string; reason?: string }; status: number }[];

beforeEach(() => {
	stored = [
		{ id: 't1', role: 'operator', text: 'Make it warmer' },
		{ id: 't2', role: 'assistant', text: 'I moved the page to the warm shade.' }
	];
	posted = [];
	held = [];
	editorLoads = 0;
	refusals = [];
});

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

/** an editor as the two editor routes mount the chat: its Chat press and the sheet. */
function Editor() {
	const { version } = useLoaderData<{ version: number }>();
	const chat = useEditorChat(CHAT);
	return (
		<>
			<button type="button" onClick={chat.open}>
				Chat
			</button>
			<output>{version}</output>
			<samp>{useLocation().search}</samp>
			{chat.sheet}
		</>
	);
}

function screen(entry = PAGE): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/campaigns/:pageId',
			loader: () => {
				editorLoads += 1;
				return { version: editorLoads };
			},
			HydrateFallback: () => null,
			Component: Editor
		},
		{
			path: '/admin/pages/:pageId/chat',
			loader: () => ({ turns: stored }),
			action: async ({ request }) => {
				const body = Object.fromEntries(
					[...(await request.formData())].map(([k, v]) => [k, String(v)])
				);
				posted.push(body);
				await new Promise<void>((resolve) => held.push(resolve));
				const refused = refusals.shift();
				if (refused !== undefined) return data(refused.body, refused.status);
				const turns: ChatMessage[] = [
					{ id: `o${posted.length}`, role: 'operator', text: body.message ?? '' },
					{ id: `a${posted.length}`, role: 'assistant', text: 'I added a FAQ.' }
				];
				stored = [...stored, ...turns];
				return { outcome: 'accepted', turns };
			}
		}
	]);
	return mount(createElement(Stub, { initialEntries: [entry] }));
}

/** a round of the event loop, so the router's promises settle. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function button(name: string): HTMLButtonElement {
	const found = [...document.querySelectorAll('button')].find(
		(b) => b.textContent === name || b.getAttribute('aria-label') === name
	);
	if (found === undefined) throw new Error(`no ${name} button`);
	return found;
}

async function press(target: HTMLElement) {
	await act(async () => {
		target.focus();
		target.click();
	});
}

/** types into the box the way a keyboard does: the value changes and the element says so. */
function type(words: string) {
	const box = document.querySelector('textarea');
	if (box === null) throw new Error('no message box');
	const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
	act(() => {
		setter?.call(box, words);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

/** the chat opened, its history drawn. */
async function opened(entry = PAGE): Promise<HTMLElement> {
	const root = screen(entry);
	await settle();
	await press(button('Chat'));
	await settle();
	return root;
}

/** sends the words in the box and lets the answer land. */
async function sendAndLand(words: string) {
	type(words);
	await press(button('Send'));
	await settle();
	await act(async () => held.shift()?.());
	await settle();
}

const box = () => document.querySelector('textarea')?.value;
const refusalShown = () => document.querySelector('.adm-chat__refusal')?.textContent;

const turnsShown = () =>
	[...document.querySelectorAll('.adm-chat__log .adm-chat__turn')].map((t) => t.textContent);

describe('the editor’s chat', () => {
	it('opens on the chat the page already has', async () => {
		screen();
		await settle();
		expect(document.querySelector('.adm-chat__log')).toBeNull();

		await press(button('Chat'));
		await settle();

		expect(turnsShown()).toEqual(['Make it warmer', 'I moved the page to the warm shade.']);
	});

	it('posts a send as the message, no photos, and the browser’s time zone', async () => {
		await opened();
		type('Add a FAQ about coat sizes');
		await press(button('Send'));
		await settle();

		expect(posted).toEqual([
			{
				message: 'Add a FAQ about coat sizes',
				imageIds: '[]',
				timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
			}
		]);
	});

	it('holds Send while the turn runs, the message sent standing in the log', async () => {
		await opened();
		type('Add a FAQ about coat sizes');
		await press(button('Send'));
		await settle();

		type('And warmer');

		expect(button('Send').getAttribute('aria-disabled')).toBe('true');
		expect(turnsShown()).toContain('Add a FAQ about coat sizes');
	});

	it('draws the reply once the turn lands, and the editor reads the page again', async () => {
		const root = await opened();
		const version = () => root.querySelector('output')?.textContent;
		const before = version();
		type('Add a FAQ about coat sizes');
		await press(button('Send'));
		await settle();

		await act(async () => held.shift()?.());
		await settle();

		expect(turnsShown()).toEqual([
			'Make it warmer',
			'I moved the page to the warm shade.',
			'Add a FAQ about coat sizes',
			'I added a FAQ.'
		]);
		expect(version()).not.toBe(before);
		type('And warmer');
		expect(button('Send').getAttribute('aria-disabled')).toBeNull();
	});

	it('opens on arrival at ?chat, as a campaign made with a line is', async () => {
		screen(`${PAGE}?chat`);
		await settle();

		expect(turnsShown()).toEqual(['Make it warmer', 'I moved the page to the warm shade.']);
	});

	it('closes to the editor’s own address, so a reload does not open it again', async () => {
		const root = screen(`${PAGE}?chat`);
		await settle();

		await press(button('Close'));
		await settle();

		expect(document.querySelector('.adm-chat__log')).toBeNull();
		expect(root.querySelector('samp')?.textContent).toBe('');
	});

	it('gives a send back to the box when the page was saved while it was answered', async () => {
		await opened();
		refusals = [{ body: { error: 'the page was saved…', reason: 'stale' }, status: 409 }];

		await sendAndLand('Add a FAQ about coat sizes');

		expect(box()).toBe('Add a FAQ about coat sizes');
		expect(refusalShown()).toBe(
			'The page was saved while this was being written, so nothing changed. Send it again.'
		);
		expect(turnsShown()).not.toContain('Add a FAQ about coat sizes');
	});

	it('says a turn that failed did not go through, and gives the words back', async () => {
		await opened();
		refusals = [{ body: { error: 'the turn on page "p1" failed', reason: 'failed' }, status: 500 }];

		await sendAndLand('Add a FAQ about coat sizes');

		expect(box()).toBe('Add a FAQ about coat sizes');
		expect(refusalShown()).toBe('That didn’t go through. Send it again.');
	});

	it('says what the route refused a send for when it names no reason', async () => {
		await opened();
		refusals = [{ body: { error: 'message holds at most 4000 characters' }, status: 400 }];

		await sendAndLand('Add a FAQ about coat sizes');

		expect(refusalShown()).toBe('message holds at most 4000 characters');
	});

	it('gives the words back again when the resend is refused the same way', async () => {
		await opened();
		const stale = () => ({ body: { error: 'the page was saved…', reason: 'stale' }, status: 409 });
		refusals = [stale(), stale()];
		await sendAndLand('Add a FAQ about coat sizes');

		await press(button('Send'));
		await settle();
		expect(refusalShown()).toBe('');
		await act(async () => held.shift()?.());
		await settle();

		expect(box()).toBe('Add a FAQ about coat sizes');
		expect(refusalShown()).toBe(
			'The page was saved while this was being written, so nothing changed. Send it again.'
		);
	});

	it('opens again without the last refusal', async () => {
		await opened();
		refusals = [{ body: { error: 'the page was saved…', reason: 'stale' }, status: 409 }];
		await sendAndLand('Add a FAQ about coat sizes');

		await press(button('Close'));
		await press(button('Chat'));
		await settle();

		expect(refusalShown()).toBe('');
	});
});
