import type { Editor } from '@tiptap/react';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data, redirect, useActionData, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import Organisation from './_app.admin.organisation';

// what the Look section posts and says: a pick is the whole look against the version the page
// holds, a pick made while one is in flight goes after it with the version its answer revalidated,
// and the answer is reported beside the control with an Undo. what the Story section posts and
// says around the same three: a save, its landing with an Undo, and a refusal. and what the Sharing
// section's presses post: the order its channels go in, the message and links, and its Undo.
//
// in the dom pool because every case is a press, and a look's is a fetcher round trip — a press, an
// action that has not settled, a revalidation — where a server render is one idle pass. the action here is a stand-in
// that records what arrived: what the real one does with it is
// ./_app.admin.organisation.workers.spec.ts's.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

type Stored = { shade: string; corner: string; brandColour: string | null };

/** the row the stand-in action writes, and each version it moves through: v0, v1, … */
let stored: { look: Stored; version: string };
let posted: Record<string, string>[];
/** each sharing save and Undo as it arrived, kept whole: its channels are one name repeated. */
let shared: FormData[];
/** each story save and Undo as it arrived. */
let told: FormData[];
/** the story and sharing the loader reads, each with the version it moves through. */
let story: { version: string };
let sharing: {
	version: string;
	message: string | null;
	links: { label: string; href: string }[];
};
/** the marker a story or sharing write redirects with, taken by the next load as a flash is. */
let marker: string | null;
/** the sentence the next story save is refused with, when a case sets one. */
let refusingStory: string | null;
/** each post waits here until the case lets it land. */
let held: (() => void)[];
/** the sentence the next look post is refused with, when a case sets one. */
let refusing: string | null;

beforeEach(() => {
	stored = { look: { shade: 'light', corner: 'soft', brandColour: null }, version: 'v0' };
	posted = [];
	shared = [];
	told = [];
	story = { version: 'story-v0' };
	sharing = { version: 'sharing-v0', message: null, links: [] };
	marker = null;
	refusingStory = null;
	held = [];
	refusing = null;
});

/** a body's own fields, as the stand-in action reads them. */
const fieldsOf = (form: FormData) => Object.fromEntries([...form].map(([k, v]) => [k, String(v)]));

/** what the stand-in action answers a story or sharing press with: the real one's redirect. */
function landed(next: string): Response {
	marker = next;
	return redirect('/admin/organisation');
}

function screen(): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/organisation',
			loader: () => {
				const taken = marker;
				marker = null;
				return {
					mission: null,
					vision: null,
					version: story.version,
					saved: taken?.startsWith('story') ? taken : null,
					look: stored.look,
					lookVersion: stored.version,
					sharing: {
						channels: ['facebook', 'email', 'copy-link'],
						message: sharing.message,
						links: sharing.links
					},
					sharingVersion: sharing.version,
					sharingSaved: taken?.startsWith('sharing') ? taken : null
				};
			},
			action: async ({ request }) => {
				const form = await request.formData();
				const which = form.get(WHICH_FORM);
				if (which === 'org-sharing' || which === 'org-sharing-undo') {
					shared.push(form);
					sharing = { ...sharing, version: `sharing-v${shared.length}` };
					return landed(which === 'org-sharing' ? 'sharing' : 'sharing-undone');
				}
				if (which === 'org-story' || which === 'org-story-undo') {
					told.push(form);
					if (refusingStory !== null)
						return data(
							{
								form: {
									id: which,
									result: {
										status: 'error',
										initialValue: fieldsOf(form),
										error: { '': [refusingStory] }
									}
								}
							},
							{ status: 409 }
						);
					story = { version: `story-v${told.length}` };
					return landed(which === 'org-story' ? 'story' : 'story-undone');
				}
				const body = fieldsOf(form);
				posted.push(body);
				await new Promise<void>((resolve) => held.push(resolve));
				if (refusing !== null)
					return {
						form: {
							id: body[WHICH_FORM],
							result: { status: 'error', initialValue: body, error: { '': [refusing] } }
						}
					};
				const version = `v${posted.length}`;
				if (body[WHICH_FORM] === 'org-look') {
					stored = {
						look: {
							shade: body.shade ?? '',
							corner: body.corner ?? '',
							brandColour: body.brandColour === '' ? null : (body.brandColour ?? null)
						},
						version
					};
					return { saved: 'look', version };
				}
				stored = { ...stored, version };
				return { saved: 'look-undone', version };
			},
			HydrateFallback: () => null,
			Component: () =>
				createElement(Organisation as never, {
					loaderData: useLoaderData(),
					actionData: useActionData(),
					params: {},
					matches: []
				})
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/organisation'] }));
}

/** a round of the event loop, so the router's promises settle. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function drawn(): Promise<HTMLElement> {
	const root = screen();
	await settle();
	return root;
}

function radio(root: HTMLElement, value: string): HTMLInputElement {
	const found = root.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
	if (found === null) throw new Error(`no choice for ${value}`);
	return found;
}

const said = (root: HTMLElement) =>
	[...root.querySelectorAll('[role="status"]')].map((region) => region.textContent).join(' ');

/**
 * presses a submit that names its form by the `form` attribute, submitting the form it names.
 * happy-dom submits the form enclosing the button instead, where a browser submits the one the
 * attribute names.
 */
async function pressOwned(submit: HTMLButtonElement): Promise<void> {
	const owner = document.getElementById(submit.getAttribute('form') ?? '');
	if (!(owner instanceof HTMLFormElement)) throw new Error('the press names no form');
	await act(async () => owner.requestSubmit());
	await settle();
}

it('posts the whole look against the look’s version, with no colour where none is set', async () => {
	const root = await drawn();
	const colour = root.querySelector<HTMLInputElement>('input[type="color"]');
	const describedBy = colour?.getAttribute('aria-describedby');
	expect(describedBy && document.getElementById(describedBy)?.textContent).toBe('No colour set');

	act(() => radio(root, 'warm').click());
	await settle();

	expect(posted).toEqual([
		{
			[WHICH_FORM]: 'org-look',
			[RECORD_VERSION]: 'v0',
			shade: 'warm',
			corner: 'soft',
			brandColour: ''
		}
	]);
});

it('sends a pick made while one is in flight after it, with the version its answer revalidated', async () => {
	const root = await drawn();

	act(() => radio(root, 'warm').click());
	await settle();
	act(() => radio(root, 'round').click());
	act(() => radio(root, 'cool').click());
	await settle();
	expect(posted).toHaveLength(1);

	act(() => held.shift()?.());
	await settle();
	await settle();

	expect(posted).toHaveLength(2);
	expect(posted[1]).toMatchObject({
		[RECORD_VERSION]: 'v1',
		shade: 'cool',
		corner: 'round',
		brandColour: ''
	});
});

it('reports the landed save beside the control, and its Undo posts against the version it wrote', async () => {
	const root = await drawn();

	act(() => radio(root, 'warm').click());
	await settle();
	expect(said(root)).toContain('Saving…');
	act(() => held.shift()?.());
	await settle();
	await settle();

	expect(said(root)).toContain('Saved to every page using the organisation’s look.');
	const undo = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Undo');
	if (undo === undefined) throw new Error('no Undo after a landed save');

	act(() => undo.click());
	await settle();
	expect(posted[1]).toEqual({ [WHICH_FORM]: 'org-look-undo', [RECORD_VERSION]: 'v1' });
	expect(undo.getAttribute('aria-disabled')).toBe('true');
});

it('reports a refused save beside the control under the alert mark, not the check', async () => {
	refusing = 'This look changed since the page loaded. Reload to see it.';
	const root = await drawn();

	act(() => radio(root, 'warm').click());
	await settle();
	act(() => held.shift()?.());
	await settle();

	const word = root.querySelector('.adm-actions [role="status"] .adm-momentary');
	expect(word?.textContent).toBe(refusing);
	expect(word?.querySelector('svg')?.classList.contains('lucide-circle-alert')).toBe(true);
});

describe('the story', () => {
	/**
	 * writes into the editor standing on `id`, through the editor's own commands: happy-dom has no
	 * input pipeline for a contenteditable, and ../lib/admin/rich-text/rich-text-editor.dom.spec.tsx
	 * stands typing in the same way.
	 */
	async function write(id: string, text: string): Promise<void> {
		const editor = (document.getElementById(id) as (HTMLElement & { editor?: Editor }) | null)
			?.editor;
		if (editor === undefined) throw new Error(`no editor standing on #${id}`);
		await act(async () => {
			editor.chain().focus().insertContent(text).run();
		});
	}

	/** every run of text a posted document holds, in reading order. */
	function wordsIn(posted: FormDataEntryValue | null): string {
		const walk = (node: { text?: string; content?: unknown[] }): string =>
			(node.text ?? '') + (node.content ?? []).map((child) => walk(child as never)).join('');
		return walk(JSON.parse(String(posted)));
	}

	function button(root: HTMLElement, label: string): HTMLButtonElement {
		const found = [...root.querySelectorAll('button')].find((b) => b.textContent === label);
		if (found === undefined) throw new Error(`no button reading "${label}"`);
		return found;
	}

	/** the Story card, which is where its outcomes have to be read. */
	function card(root: HTMLElement): HTMLElement {
		const found = [...root.querySelectorAll('h2')].find((h) => h.textContent === 'Story');
		const section = found?.parentElement;
		if (!section) throw new Error('no Story section');
		return section;
	}

	async function saveStory(root: HTMLElement): Promise<void> {
		await write('story-mission', 'Warm coats for every child.');
		await write('story-vision', 'No child cold this winter.');
		act(() => button(card(root), 'Save story').click());
		await settle();
		await settle();
	}

	it('posts the mission and vision against the story’s version', async () => {
		const root = await drawn();
		await saveStory(root);

		expect(told).toHaveLength(1);
		const [sent] = told;
		expect(sent?.get(WHICH_FORM)).toBe('org-story');
		expect(sent?.get(RECORD_VERSION)).toBe('story-v0');
		expect(wordsIn(sent?.get('mission') ?? null)).toBe('Warm coats for every child.');
		expect(wordsIn(sent?.get('vision') ?? null)).toBe('No child cold this winter.');
	});

	it('reports the landed save beside its control, and its Undo posts against the version it wrote', async () => {
		const root = await drawn();
		await saveStory(root);

		const actions = card(root).querySelector('.adm-actions');
		expect(actions?.querySelector('.adm-save')?.textContent).toBe('Saved');
		expect(actions?.querySelector('[aria-live]')?.textContent).toBe(
			'Saved. Nothing else on this page changed.'
		);

		await pressOwned(button(card(root), 'Undo'));
		expect(told).toHaveLength(2);
		expect(fieldsOf(told[1] as FormData)).toEqual({
			[WHICH_FORM]: 'org-story-undo',
			[RECORD_VERSION]: 'story-v1'
		});
	});

	it('reports a refused save under the alert mark, in the card it was pressed in', async () => {
		refusingStory = 'Nothing was changed: the story has been saved since this page was opened.';
		const root = await drawn();
		await saveStory(root);

		const alert = card(root).querySelector('[role="alert"]');
		expect(alert?.querySelector('.adm-banner__word')?.textContent).toBe('Not saved');
		expect(alert?.textContent).toContain(refusingStory);
		expect(alert?.querySelector('svg')?.classList.contains('lucide-circle-alert')).toBe(true);
		// a refusal is no landing, so nothing offers to undo it.
		expect([...card(root).querySelectorAll('button')].some((b) => b.textContent === 'Undo')).toBe(
			false
		);
	});
});

describe('the sharing channels', () => {
	function press(root: HTMLElement, name: string): HTMLButtonElement {
		const found = [...root.querySelectorAll('button')].find(
			(b) => b.getAttribute('aria-label') === name
		);
		if (found === undefined) throw new Error(`no button named ${name}`);
		return found;
	}

	function drawnOrder(root: HTMLElement): string[] {
		return [...root.querySelectorAll<HTMLInputElement>('input[name="channels"]')].map(
			(box) => box.value
		);
	}

	async function saveSharing(root: HTMLElement): Promise<FormData> {
		const save = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Save sharing');
		if (save === undefined) throw new Error('no Save sharing');
		act(() => save.click());
		await settle();
		const sent = shared.at(-1);
		if (sent === undefined) throw new Error('the sharing posted nothing');
		return sent;
	}

	it('draws the chosen channels first, in their order, and the rest of the list unticked after', async () => {
		const root = await drawn();
		expect(drawnOrder(root)).toEqual([
			'facebook',
			'email',
			'copy-link',
			'whatsapp',
			'linkedin',
			'x'
		]);
		const ticked = [...root.querySelectorAll<HTMLInputElement>('input[name="channels"]:checked')];
		expect(ticked.map((box) => box.value)).toEqual(['facebook', 'email', 'copy-link']);
	});

	it('moves a channel down and up, keeping the focus on the pressed button', async () => {
		const root = await drawn();

		const down = press(root, 'Move Facebook down');
		down.focus();
		act(() => down.click());
		await settle();
		expect(drawnOrder(root).slice(0, 3)).toEqual(['email', 'facebook', 'copy-link']);
		expect(document.activeElement).toBe(press(root, 'Move Facebook down'));

		const up = press(root, 'Move Copy link up');
		up.focus();
		act(() => up.click());
		await settle();
		expect(drawnOrder(root).slice(0, 3)).toEqual(['email', 'copy-link', 'facebook']);
		expect(document.activeElement).toBe(press(root, 'Move Copy link up'));
	});

	it('holds Move up on the first channel and Move down on the last, and a press there moves nothing', async () => {
		const root = await drawn();
		const top = press(root, 'Move Facebook up');
		const bottom = press(root, 'Move X down');
		expect(top.getAttribute('aria-disabled')).toBe('true');
		expect(bottom.getAttribute('aria-disabled')).toBe('true');
		expect(press(root, 'Move Facebook down').getAttribute('aria-disabled')).toBeNull();

		act(() => top.click());
		act(() => bottom.click());
		await settle();
		expect(drawnOrder(root)).toEqual([
			'facebook',
			'email',
			'copy-link',
			'whatsapp',
			'linkedin',
			'x'
		]);
	});

	it('saves the ticked channels in the order they are drawn, against the sharing’s version', async () => {
		const root = await drawn();
		act(() => press(root, 'Move Copy link up').click());
		act(() => press(root, 'Move Copy link up').click());
		act(() => root.querySelector<HTMLInputElement>('input[value="x"]')?.click());
		act(() => root.querySelector<HTMLInputElement>('input[value="email"]')?.click());
		await settle();

		const sent = await saveSharing(root);
		expect(sent.getAll('channels')).toEqual(['copy-link', 'facebook', 'x']);
		expect(sent.get(RECORD_VERSION)).toBe('sharing-v0');
	});

	/** types into the box or text area named `name`, the way a keystroke does. */
	function type(root: HTMLElement, name: string, value: string): void {
		const box = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
		if (box === null) throw new Error(`no box named ${name}`);
		act(() => {
			Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value')?.set?.call(box, value);
			box.dispatchEvent(new Event('input', { bubbles: true }));
		});
	}

	it('posts the message and every link with the save, the stored ones and the added', async () => {
		sharing = {
			...sharing,
			message: 'Give a coat.',
			links: [{ label: 'Instagram', href: 'https://instagram.com/rivergate' }]
		};
		const root = await drawn();
		type(root, 'message', 'Give a coat this winter.');
		act(() => root.querySelector<HTMLButtonElement>('#sharing-link-add')?.click());
		type(root, 'linkLabel[1]', 'Facebook');
		type(root, 'linkUrl[1]', 'https://facebook.com/rivergate');

		const sent = await saveSharing(root);
		expect(sent.get('message')).toBe('Give a coat this winter.');
		expect([sent.get('linkLabel[0]'), sent.get('linkUrl[0]')]).toEqual([
			'Instagram',
			'https://instagram.com/rivergate'
		]);
		expect([sent.get('linkLabel[1]'), sent.get('linkUrl[1]')]).toEqual([
			'Facebook',
			'https://facebook.com/rivergate'
		]);
	});

	it('offers Undo after a landed save, and it posts against the version the save wrote', async () => {
		const root = await drawn();
		act(() => root.querySelector<HTMLInputElement>('input[value="x"]')?.click());
		await saveSharing(root);
		await settle();

		const undo = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Undo');
		if (undo === undefined) throw new Error('no Undo after a landed save');
		await pressOwned(undo);
		expect(shared).toHaveLength(2);
		expect(fieldsOf(shared[1] as FormData)).toEqual({
			[WHICH_FORM]: 'org-sharing-undo',
			[RECORD_VERSION]: 'sharing-v1'
		});
	});
});
