import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Resized } from '$lib/images/resize';
import type { ChatMessage } from '../chat/ai-panel';
import { useEditorChat } from './chat-wiring';
import { EditorShell } from './editor-shell';
import { PublishBar } from './publish-bar';

// happy-dom decodes no image, so the resize is the boundary stood in for: each pick waits in
// `resizes` until the case hands it a result.
const resizes: ((result: Resized) => void)[] = [];
vi.mock('$lib/images/resize', async (actual) => ({
	...(await actual<typeof import('$lib/images/resize')>()),
	resizeImage: () => new Promise<Resized>((resolve) => resizes.push(resolve))
}));

// what the editor's chat does over the network: what a send posts, what the composer does while
// the turn runs, what the editor reads once it lands, and what a send nothing was stored from gives
// back. the chat route here is a stand-in that records what arrived and holds each post until the
// case lets it land; what the real one does with it is
// src/routes/_app.admin.pages.$pageId.chat.workers.spec.ts's. the images route is a stand-in the
// same way, and what the real one stores is src/routes/_app.admin.images.workers.spec.ts's.

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
/** each photo posted to the images route: its file's type and size. */
let uploads: { type: string; size: number }[];
/** each upload waits here until the case lets it land, answered with what it is handed. */
let uploadsHeld: ((answer: { body: unknown; status: number }) => void)[];
/** while set, each read of the chat waits here until the case lets it land. */
let historyHeld: (() => void)[] | null;

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

beforeEach(() => {
	// below the wide breakpoint, where the panel is a sheet the bar's AI press opens; the docked
	// column's own case says so.
	atWidth(false);
	stored = [
		{ id: 't1', role: 'operator', text: 'Make it warmer' },
		{ id: 't2', role: 'assistant', text: 'I moved the page to the warm shade.' }
	];
	posted = [];
	held = [];
	editorLoads = 0;
	refusals = [];
	uploads = [];
	uploadsHeld = [];
	historyHeld = null;
	resizes.length = 0;
});

/** the opening questions the stand-in route asks an empty chat. */
const OPENING: ChatMessage = {
	id: 'q1',
	role: 'assistant',
	text: 'A few questions first.',
	questions: [
		{ id: 'mission', kind: 'text', prompt: 'Your mission, in a sentence' },
		{
			id: 'who',
			kind: 'choice',
			prompt: 'Who do gifts mostly help?',
			options: ['Children', 'Elders']
		}
	]
};

/** the answers summary the real route reads back from an answers post, for the stand-in to store. */
function answeredWith(body: Record<string, string>) {
	const prompts = new Map(OPENING.questions?.map((q) => [q.id, q.prompt]));
	return (JSON.parse(body.answers ?? '[]') as { id: string; value: string }[]).map(
		({ id, value }) => ({ id, prompt: prompts.get(id) ?? id, words: String(value) })
	);
}

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

/** an editor as the two editor routes mount the chat: the bar's AI press and the panel. */
function Editor() {
	const { version } = useLoaderData<{ version: number }>();
	const chat = useEditorChat(CHAT);
	return (
		<EditorShell
			bar={
				<PublishBar
					closeHref="/admin"
					page={{ kind: 'donation' }}
					state="live"
					publishing={false}
					republished={false}
					undoing={false}
					onAi={chat.open}
				/>
			}
			preview={<output>{version}</output>}
			panel={chat.panel}
		>
			{chat.sheet}
		</EditorShell>
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
			loader: async () => {
				const waiting = historyHeld;
				if (waiting !== null) await new Promise<void>((resolve) => waiting.push(resolve));
				return { turns: stored };
			},
			action: async ({ request }) => {
				const body = Object.fromEntries(
					[...(await request.formData())].map(([k, v]) => [k, String(v)])
				);
				posted.push(body);
				const n = posted.length;
				await new Promise<void>((resolve) => held.push(resolve));
				const refused = refusals.shift();
				if (refused !== undefined) return data(refused.body, refused.status);
				if (body.intent === 'open') {
					if (stored.length > 0) return { outcome: 'unchanged', turns: stored };
					stored = [OPENING];
					return { outcome: 'asked', turns: stored };
				}
				const turns: ChatMessage[] =
					body.intent === 'answers'
						? [
								{ id: `o${n}`, role: 'operator', text: 'answered', answers: answeredWith(body) },
								{ id: `a${n}`, role: 'assistant', text: 'I drafted your page.' }
							]
						: [
								{ id: `o${n}`, role: 'operator', text: body.message ?? '' },
								{ id: `a${n}`, role: 'assistant', text: 'I added a FAQ.' }
							];
				stored = [...stored, ...turns];
				return { outcome: 'accepted', turns };
			}
		},
		{
			path: '/admin/images',
			action: async ({ request }) => {
				const file = (await request.formData()).get('file');
				if (!(file instanceof File)) throw new Error('no file posted');
				uploads.push({ type: file.type, size: file.size });
				const answer = await new Promise<{ body: unknown; status: number }>((resolve) =>
					uploadsHeld.push(resolve)
				);
				return data(answer.body, answer.status);
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
	await press(button('AI'));
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

		await press(button('AI'));
		await settle();

		expect(turnsShown()).toEqual(['Make it warmer', 'I moved the page to the warm shade.']);
	});

	it('holds the AI press busy from its press until the sheet is up', async () => {
		historyHeld = [];
		screen();
		await settle();
		const entry = button('AI');
		expect(entry.hasAttribute('aria-busy')).toBe(false);

		await press(entry);
		await settle();

		expect(document.querySelector('dialog')).toBeNull();
		expect(entry.getAttribute('aria-busy')).toBe('true');
		expect(entry.getAttribute('aria-disabled')).toBe('true');
		expect(document.activeElement).toBe(entry);

		await act(async () => historyHeld?.shift()?.());
		await settle();

		expect(document.querySelector('dialog')).not.toBeNull();
		expect(entry.hasAttribute('aria-busy')).toBe(false);
		expect(entry.hasAttribute('aria-disabled')).toBe(false);
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

	it('stands docked from the wide breakpoint, on the chat read without a press', async () => {
		atWidth(true);
		screen();
		await settle();

		expect(document.querySelector('aside .adm-chat__log')).not.toBeNull();
		expect(document.querySelector('dialog')).toBeNull();
		expect(turnsShown()).toEqual(['Make it warmer', 'I moved the page to the warm shade.']);
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
		await press(button('AI'));
		await settle();

		expect(refusalShown()).toBe('');
	});
});

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** the question card, while one is up. */
const questionCard = () => document.querySelector<HTMLFormElement>('.adm-questions');

describe('a chat with turns', () => {
	it.each([
		['at the editor’s address', PAGE],
		['at `?chat`, which nothing opens the chat on', `${PAGE}?chat`]
	])(
		'is asked nothing on arrival %s, and below the wide breakpoint opens nothing',
		async (_, at) => {
			screen(at);
			await settle();

			expect(posted).toEqual([]);
			expect(document.querySelector('dialog')).toBeNull();
		}
	);
});

describe('an empty chat', () => {
	beforeEach(() => {
		stored = [];
	});

	it('is asked its opening questions once, reading the page until they land', async () => {
		atWidth(true);
		screen();
		await settle();

		expect(posted).toEqual([{ intent: 'open', timeZone: ZONE }]);
		expect(document.querySelector('.adm-chat__waiting')?.textContent).toBe('Reading your page');
		expect(questionCard()).toBeNull();

		await act(async () => held.shift()?.());
		await settle();

		expect(questionCard()).not.toBeNull();
		expect(document.querySelector('.adm-chat__waiting')).toBeNull();
		expect(posted).toHaveLength(1);
	});

	it('opens the AI sheet on arrival below the wide breakpoint, the card in it once it lands', async () => {
		screen();
		await settle();

		expect(document.querySelector('dialog .adm-chat__log')).not.toBeNull();
		await act(async () => held.shift()?.());
		await settle();

		expect(document.querySelector('dialog .adm-questions')).not.toBeNull();
	});

	it('hands the focus to the AI press when the sheet it opened on arrival is closed', async () => {
		screen();
		await settle();
		await act(async () => held.shift()?.());
		await settle();

		await press(button('Close'));
		await settle();

		expect(document.querySelector('dialog')).toBeNull();
		expect(document.activeElement).toBe(button('AI'));
	});

	it('says the questions did not load when the opening fails, and stops reading', async () => {
		atWidth(true);
		refusals = [{ body: { error: 'the turn on page "p1" failed', reason: 'failed' }, status: 500 }];
		screen();
		await settle();

		await act(async () => held.shift()?.());
		await settle();

		expect(refusalShown()).toBe('The questions didn’t load. Reload the editor to be asked them.');
		expect(document.querySelector('.adm-chat__waiting')).toBeNull();
		expect(posted).toHaveLength(1);
	});

	it('shows the card docked from the wide breakpoint, with no sheet', async () => {
		atWidth(true);
		screen();
		await settle();
		await act(async () => held.shift()?.());
		await settle();

		expect(document.querySelector('aside .adm-questions')).not.toBeNull();
		expect(document.querySelector('dialog')).toBeNull();
	});
});

/** an empty chat at the wide breakpoint, its opening questions landed. */
async function asked(): Promise<HTMLElement> {
	stored = [];
	atWidth(true);
	const root = screen();
	await settle();
	await act(async () => held.shift()?.());
	await settle();
	return root;
}

/** types `words` into the card's box for the question `id`. */
function answer(id: string, words: string) {
	const box = questionCard()?.querySelector<HTMLInputElement>(`input[name="${id}"]`);
	if (box === null || box === undefined) throw new Error(`no box for ${id}`);
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, words);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

describe('a question card answered', () => {
	it('posts the answers as JSON with the browser’s zone, the card held until they land', async () => {
		await asked();
		answer('mission', 'Warm coats for every child.');

		await press(button('Draft my page'));
		await settle();

		expect(posted.at(-1)).toEqual({
			intent: 'answers',
			answers: JSON.stringify([{ id: 'mission', value: 'Warm coats for every child.' }]),
			timeZone: ZONE
		});
		expect(button('Draft my page').getAttribute('aria-disabled')).toBe('true');
		expect(button('Draft my page').getAttribute('aria-busy')).toBe('true');
		expect(document.activeElement).toBe(button('Draft my page'));
	});

	it('posts no answers for a skip', async () => {
		await asked();

		await press(button('Skip, draft anyway'));
		await settle();

		expect(posted.at(-1)).toEqual({ intent: 'answers', answers: '[]', timeZone: ZONE });
	});

	it.each([
		[
			'answered already',
			{ body: { error: 'the questions… were answered already', reason: 'answered' }, status: 409 },
			'These questions were answered already. Reload the editor to see the chat.'
		],
		[
			'a turn that failed',
			{ body: { error: 'the turn on page "p1" failed', reason: 'failed' }, status: 500 },
			'That didn’t go through. Send your answers again.'
		],
		[
			'answers the route refused',
			{ body: { error: 'answers[0] names no question asked: "who-else"' }, status: 400 },
			'answers[0] names no question asked: "who-else"'
		]
	])('says %s where a refused send is said, the card still up', async (_, refusal, line) => {
		await asked();
		refusals = [refusal];

		await press(button('Draft my page'));
		await act(async () => held.shift()?.());
		await settle();

		expect(refusalShown()).toBe(line);
		expect(questionCard()).not.toBeNull();
		expect(box()).toBe('');
	});

	it('draws the answers and the drafted turn once they land, and the preview reads again', async () => {
		const root = await asked();
		const version = () => root.querySelector('output')?.textContent;
		const before = version();
		answer('mission', 'Warm coats for every child.');
		await press(button('Draft my page'));
		await settle();

		await act(async () => held.shift()?.());
		await settle();

		expect(questionCard()).toBeNull();
		expect(turnsShown().slice(1)).toEqual([
			'Your answersYour mission, in a sentenceWarm coats for every child.',
			'I drafted your page.'
		]);
		expect(version()).not.toBe(before);
	});
});

/** the suggestions the composer offers. */
const suggestions = () =>
	[...document.querySelectorAll('.adm-chat__suggestions button')].map((b) => b.textContent);

describe('the suggestions', () => {
	it('are not offered while a question card is up', async () => {
		await asked();

		expect(questionCard()).not.toBeNull();
		expect(suggestions()).toEqual([]);
	});

	it('are offered once the answers have drafted the page', async () => {
		await asked();
		await press(button('Skip, draft anyway'));
		await act(async () => held.shift()?.());
		await settle();

		expect(suggestions()).toContain('Add a FAQ');
	});

	it.each([
		['refused', 'That reply didn’t fit.'],
		['unanswered', 'No model answered, so nothing changed. Try again in a moment.']
	] as const)('are not offered on a chat whose only reply was %s', async (note, text) => {
		stored = [
			{ id: 't1', role: 'operator', text: 'Make it warmer' },
			{ id: 't2', role: 'assistant', text, note }
		];
		await opened();

		expect(suggestions()).toEqual([]);
	});

	it('are offered on a chat whose reply the default model wrote', async () => {
		stored = [
			{ id: 't1', role: 'operator', text: 'Make it warmer' },
			{ id: 't2', role: 'assistant', text: 'Warmer now.', note: 'fell-back' }
		];
		await opened();

		expect(suggestions()).toContain('Add a FAQ');
	});

	it('leave free words sent while a card is up to post as a message', async () => {
		await asked();

		await sendAndLand('Just make it warm');

		expect(posted.at(-1)).toEqual({ message: 'Just make it warm', imageIds: '[]', timeZone: ZONE });
		expect(turnsShown().slice(-2)).toEqual(['Just make it warm', 'I added a FAQ.']);
	});
});

/** picks `name` in the attach press's picker, the way the device hands a file back. */
async function attach(name = 'food-bank.heic') {
	const input = document.querySelector<HTMLInputElement>('input[type="file"]');
	if (input === null) throw new Error('no picker');
	Object.defineProperty(input, 'files', {
		configurable: true,
		value: [new File(['camera bytes'], name, { type: 'image/heic' })]
	});
	await act(async () => {
		input.dispatchEvent(new Event('change', { bubbles: true }));
	});
}

/** lets the oldest pick's resize land as a `bytes`-long webp at 1600 × 1067. */
async function resized(bytes = 480_000) {
	const blob = new Blob([new Uint8Array(bytes)], { type: 'image/webp' });
	await act(async () => resizes.shift()?.({ ok: true, blob, width: 1600, height: 1067 }));
	await settle();
}

/** lets the oldest upload land with `body`. */
async function uploaded(body: unknown, status = 200) {
	await act(async () => uploadsHeld.shift()?.({ body, status }));
	await settle();
}

const photoState = () => document.querySelector('.adm-attachment__state')?.textContent;

describe('a photo attached in the chat', () => {
	it('is resized, posted to the images route, and ready once stored', async () => {
		await opened();

		await attach();
		expect(photoState()).toBe('Resizing');
		await resized();
		expect(photoState()).toBe('Uploading');
		expect(uploads).toEqual([{ type: 'image/webp', size: 480_000 }]);

		await uploaded({ id: 'img1', width: 1600, height: 1067 });

		expect(photoState()).toBe('1600 × 1067, 480 KB');
	});

	it('reads nothing again once stored: it is on no page until a turn names it', async () => {
		await opened();
		const loads = editorLoads;

		await attach();
		await resized();
		await uploaded({ id: 'img1', width: 1600, height: 1067 });

		expect(editorLoads).toBe(loads);
	});

	it('rides with the next send, and is gone once that turn lands', async () => {
		await opened();
		await attach();
		await resized();
		await uploaded({ id: 'img1', width: 1600, height: 1067 });

		await sendAndLand('Use this photo at the top');

		expect(posted.map((turn) => turn.imageIds)).toEqual(['["img1"]']);
		expect(photoState()).toBeUndefined();
	});

	it('is not posted when the resize refuses it, and says why', async () => {
		await opened();
		await attach('scan.tiff');

		await act(async () => resizes.shift()?.({ ok: false, reason: 'unreadable' }));
		await settle();

		expect(photoState()).toBe(
			'This photo couldn’t be opened here. Attach it as a JPEG, PNG or WebP.'
		);
		expect(uploads).toEqual([]);
	});

	it('is dropped by Remove, and an answer landing after it attaches nothing', async () => {
		await opened();
		await attach();
		await resized();

		await press(button('Remove photo'));
		await uploaded({ id: 'img1', width: 1600, height: 1067 });
		await sendAndLand('Warmer, please');

		expect(photoState()).toBeUndefined();
		expect(posted.map((turn) => turn.imageIds)).toEqual(['[]']);
	});

	it('says why the images route refused it, and is not sent', async () => {
		await opened();
		await attach();
		await resized();

		await uploaded({ error: 'the photo was not stored; post it again', reason: 'failed' }, 500);

		expect(photoState()).toBe('That didn’t go through. Attach it again.');
		await sendAndLand('Warmer, please');
		expect(posted.map((turn) => turn.imageIds)).toEqual(['[]']);
	});

	it('stays attached through a send nothing was stored from, so the resend carries it', async () => {
		await opened();
		await attach();
		await resized();
		await uploaded({ id: 'img1', width: 1600, height: 1067 });
		refusals = [{ body: { error: 'the page was saved…', reason: 'stale' }, status: 409 }];

		await sendAndLand('Use this photo at the top');

		expect(photoState()).toBe('1600 × 1067, 480 KB');
	});

	it('stays attached through answers sent from a card, which carry no photo', async () => {
		await asked();
		await attach();
		await resized();
		await uploaded({ id: 'img1', width: 1600, height: 1067 });

		await press(button('Skip, draft anyway'));
		await act(async () => held.shift()?.());
		await settle();

		expect(photoState()).toBe('1600 × 1067, 480 KB');
	});
});
