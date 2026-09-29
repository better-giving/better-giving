import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { PublishBar, type PublishState } from './publish-bar';
import { type FirstPublish, usePublishPresses } from './publish-wiring';

// what the editor's Publish, Undo, Discard changes and Reset to default post, and what the bar and
// the confirms do with each answer. the editor's action here is a stand-in that records each body and
// answers what the case scripts; what the real one does is $lib/server/pages/publish.workers.spec.ts's
// and reset.workers.spec.ts's.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE = '/admin/campaigns/p1';

type Drawn = { version: number; state: PublishState; hasEdits?: boolean };

let drawn: Drawn;
let posted: Record<string, string>[];
/** what the action answers each post, in turn; the page it leaves drawn follows each. */
let answers: { body: unknown; status?: number; leaves?: Partial<Drawn> }[];

beforeEach(() => {
	drawn = { version: 1, state: 'changed' };
	posted = [];
	answers = [];
});

const FIRST: FirstPublish = {
	name: 'Winter coat drive',
	programs: [
		{ value: 'none', label: 'No program' },
		{ value: 'prg_coats', label: 'Winter coats' }
	],
	program: 'none',
	address: '/winter-coat-drive'
};

function Editor({ first }: { first: boolean }) {
	const { version, state, hasEdits } = useLoaderData<Drawn>();
	const presses = usePublishPresses({
		version,
		state,
		first: first ? FIRST : undefined,
		reset: hasEdits === undefined ? undefined : { hasEdits }
	});
	return (
		<>
			<PublishBar
				closeHref="/admin"
				page={{ kind: 'donation' }}
				state={state}
				livePath="/donate"
				{...presses.bar}
			/>
			{presses.confirm}
		</>
	);
}

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

async function screen({ first = false }: { first?: boolean } = {}) {
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
				drawn = { ...drawn, ...answer.leaves };
				return Response.json(answer.body, { status: answer.status ?? 200 });
			},
			HydrateFallback: () => null,
			Component: () => <Editor first={first} />
		}
	]);
	mount(createElement(Stub, { initialEntries: [PAGE] }));
	await settle();
}

/** a round of the event loop, so the router's promises settle. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function button(name: string, within: HTMLElement | Document = document): HTMLButtonElement {
	const found = [...within.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name
	);
	if (found === undefined) throw new Error(`no ${name} button`);
	return found;
}

const bar = () => {
	const found = document.querySelector<HTMLElement>('.adm-publishbar');
	if (found === null) throw new Error('no publish bar');
	return found;
};
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"], dialog');
const stateWord = () => bar().querySelector('.adm-publishbar__state');

async function press(target: HTMLElement) {
	await act(async () => {
		target.focus();
		target.click();
	});
	await settle();
}

describe('Publish', () => {
	it('republishes at once, and offers Undo while the page is what went live', async () => {
		answers = [
			{ body: { published: true, undoable: true }, leaves: { version: 2, state: 'live' } }
		];
		await screen();

		await press(button('Publish', bar()));

		expect(posted).toEqual([{ [WHICH_FORM]: 'page-publish', [RECORD_VERSION]: '1' }]);
		expect(dialog()).toBeNull();
		expect(button('Undo', bar())).toBeTruthy();
	});

	it('reads Published beside Undo after a republish', async () => {
		answers = [
			{ body: { published: true, undoable: true }, leaves: { version: 2, state: 'live' } }
		];
		await screen();
		const publish = button('Publish', bar());

		await press(publish);

		expect(publish.textContent).toBe('Published');
		expect(publish.getAttribute('aria-disabled')).toBe('true');
		const beside = [...(publish.parentElement?.querySelectorAll('button') ?? [])];
		expect(beside.map((one) => one.textContent)).toEqual(['Published', 'Undo']);
	});

	it('posts Undo against the version the republish left drawn', async () => {
		answers = [
			{ body: { published: true, undoable: true }, leaves: { version: 2, state: 'live' } },
			{ body: { undone: true }, leaves: { version: 3, state: 'changed' } }
		];
		await screen();
		await press(button('Publish', bar()));

		await press(button('Undo', bar()));

		expect(posted[1]).toEqual({ [WHICH_FORM]: 'page-undo', [RECORD_VERSION]: '2' });
		expect([...bar().querySelectorAll('button')].map((b) => b.textContent?.trim())).not.toContain(
			'Undo'
		);
	});

	it('hands the focus to the state an Undo left, its own press gone', async () => {
		answers = [
			{ body: { published: true, undoable: true }, leaves: { version: 2, state: 'live' } },
			{ body: { undone: true }, leaves: { version: 3, state: 'changed' } }
		];
		await screen();
		await press(button('Publish', bar()));

		await press(button('Undo', bar()));

		expect(document.activeElement).toBe(stateWord());
		expect(stateWord()?.textContent).toBe('Changes not published');
	});

	it('says a refusal at the bar', async () => {
		const text =
			'Nothing was published: a page holds exactly one donation box, and this one holds none.';
		answers = [
			{
				body: { form: { id: 'page-publish', result: { status: 'error', error: { '': [text] } } } },
				status: 422
			}
		];
		await screen();

		await press(button('Publish', bar()));

		expect(bar().querySelector('[role="status"]')?.textContent).toContain(text);
	});

	it('asks a campaign’s first Publish where its gifts go, and posts the answer', async () => {
		answers = [
			{ body: { published: true, undoable: false }, leaves: { version: 2, state: 'live' } }
		];
		await screen({ first: true });

		await press(button('Publish', bar()));
		expect(posted).toEqual([]);
		const asked = dialog();
		if (asked === null) throw new Error('no confirm was put up');
		expect(asked.textContent).toContain('/winter-coat-drive');

		await press(button('Publish', asked));

		expect(posted).toEqual([
			{ [WHICH_FORM]: 'page-first-publish', [RECORD_VERSION]: '1', gifts_go_to: 'none' }
		]);
		expect(dialog()).toBeNull();
	});
});

describe('a campaign’s first Publish', () => {
	async function choose(words: string) {
		const asked = dialog();
		if (asked === null) throw new Error('no confirm was put up');
		const box = asked.querySelector<HTMLButtonElement>('button[role="combobox"]');
		if (box === null) throw new Error('the confirm drew no program box');
		await act(async () => box.click());
		const row = [...document.querySelectorAll<HTMLElement>('.adm-selectrow')].find(
			(one) => one.textContent === words
		);
		if (row === undefined) throw new Error(`the list holds no row reading ${words}`);
		await act(async () => {
			row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
			row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
			row.click();
		});
	}

	it('posts the program chosen in its confirm', async () => {
		answers = [
			{ body: { published: true, undoable: false }, leaves: { version: 2, state: 'live' } }
		];
		await screen({ first: true });
		await press(button('Publish', bar()));

		await choose('Winter coats');
		await press(button('Publish', dialog() ?? document));

		expect(posted).toEqual([
			{ [WHICH_FORM]: 'page-first-publish', [RECORD_VERSION]: '1', gifts_go_to: 'prg_coats' }
		]);
	});
});

describe('a confirm reopened after a refusal', () => {
	it('opens without the refusal it was cancelled on', async () => {
		const text =
			'Nothing was published: the program chosen for gifts is no longer offered. Choose another.';
		answers = [
			{
				body: {
					form: { id: 'page-first-publish', result: { status: 'error', error: { '': [text] } } }
				},
				status: 422
			}
		];
		await screen({ first: true });
		await press(button('Publish', bar()));
		await press(button('Publish', dialog() ?? document));
		expect(dialog()?.textContent).toContain(text);

		await press(button('Cancel', dialog() ?? document));
		await press(button('Publish', bar()));

		expect(dialog()?.textContent).not.toContain(text);
	});
});

describe('Discard changes', () => {
	it('is confirmed before it posts, and the confirm goes once it lands', async () => {
		answers = [{ body: { discarded: true }, leaves: { version: 2, state: 'live' } }];
		await screen();

		await press(button('Discard changes', bar()));
		expect(posted).toEqual([]);
		const asked = dialog();
		if (asked === null) throw new Error('no confirm was put up');

		await press(button('Discard changes', asked));

		expect(posted).toEqual([{ [WHICH_FORM]: 'page-discard', [RECORD_VERSION]: '1' }]);
		expect(dialog()).toBeNull();
	});

	it('hands the focus to the state it left, its own press gone', async () => {
		answers = [{ body: { discarded: true }, leaves: { version: 2, state: 'live' } }];
		await screen();
		await press(button('Discard changes', bar()));

		await press(button('Discard changes', dialog() ?? document));

		expect(bar().textContent).not.toContain('Discard changes');
		expect(document.activeElement).toBe(stateWord());
		expect(stateWord()?.textContent).toBe('Live');
	});
});

describe('Reset to default', () => {
	const buttons = () => [...bar().querySelectorAll('button')].map((b) => b.textContent?.trim());

	it('is offered only while the page has edits', async () => {
		drawn = { ...drawn, hasEdits: false };
		await screen();

		expect(buttons()).not.toContain('Reset to default');
	});

	it('is confirmed before it posts, and is gone with its confirm once it lands', async () => {
		drawn = { ...drawn, hasEdits: true };
		answers = [{ body: { reset: true }, leaves: { version: 2, state: 'live', hasEdits: false } }];
		await screen();

		await press(button('Reset to default', bar()));
		expect(posted).toEqual([]);
		const asked = dialog();
		if (asked === null) throw new Error('no confirm was put up');
		expect(asked.textContent).toContain('can’t be undone');

		await press(button('Reset to default', asked));

		expect(posted).toEqual([{ [WHICH_FORM]: 'page-reset', [RECORD_VERSION]: '1' }]);
		expect(dialog()).toBeNull();
		expect(buttons()).not.toContain('Reset to default');
		expect(document.activeElement).toBe(stateWord());
	});

	it('says a refusal in its confirm, which stays up', async () => {
		const text =
			'Nothing was changed: this page has been saved since the editor was opened. Reload it, then try again.';
		drawn = { ...drawn, hasEdits: true };
		answers = [
			{
				body: { form: { id: 'page-reset', result: { status: 'error', error: { '': [text] } } } },
				status: 409
			}
		];
		await screen();
		await press(button('Reset to default', bar()));

		await press(button('Reset to default', dialog() ?? document));

		expect(dialog()?.textContent).toContain(text);
		expect(document.activeElement).not.toBe(stateWord());
	});
});
