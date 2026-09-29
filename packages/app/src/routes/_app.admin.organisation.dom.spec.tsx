import type { Editor } from '@tiptap/react';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data, redirect, useActionData, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import type { Resized } from '$lib/images/resize';
import Organisation from './_app.admin.organisation';

// happy-dom decodes no image, so the resize is the boundary stood in for: each pick waits in
// `resizes` until the case hands it a result.
const resizes: ((result: Resized) => void)[] = [];
vi.mock('$lib/images/resize', async (actual) => ({
	...(await actual<typeof import('$lib/images/resize')>()),
	resizeImage: () => new Promise<Resized>((resolve) => resizes.push(resolve))
}));

// what the Look section posts and says: a pick is the whole look against the version the page
// holds, a pick made while one is in flight goes after it with the version its answer revalidated,
// and the answer is reported beside the control with an Undo. what the Story section posts and
// says around the same three: a save, its landing with an Undo, and a refusal. and what the Sharing
// section's presses post: the order its channels go in, the message and links, and its Undo. and
// what the logo, first in the Look, posts: the write the moment an upload lands, Remove, and Undo.
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
type Story = { version: string; mission: string | null; vision: string | null };
type Sharing = {
	version: string;
	channels: string[];
	message: string | null;
	links: { label: string; href: string }[];
};
/**
 * the story and sharing the loader reads, each with the version it moves through, and the one each
 * last save replaced: an Undo swaps the two, as the real one does, so an Undo brings a version back.
 */
let story: Story;
let storyBefore: Story | null;
let sharing: Sharing;
let sharingBefore: Sharing | null;
/** the marker a story or sharing write redirects with, taken by the next load as a flash is. */
let marker: string | null;
/** how many markers the loader has taken, which names each landing it publishes. */
let landings: number;
/** the sentence the next story save is refused with, when a case sets one. */
let refusingStory: string | null;
/** each post waits here until the case lets it land. */
let held: (() => void)[];
/** the sentence the next look post is refused with, when a case sets one. */
let refusing: string | null;
type Logo = { imageId: string; width: number; height: number } | null;
/** the logo the loader reads, the one its last write replaced, and the version it moves through. */
let logo: { now: Logo; before: Logo; version: string };
/** each logo write and Undo as it arrived. */
let logoPosts: Record<string, string>[];
/** the sentence the next logo write is refused with at its id, when a case sets one. */
let refusingLogo: string | null;
/** each upload waits here until the case lets it land, answered with what it is handed. */
let uploadsHeld: ((answer: unknown) => void)[];

beforeEach(() => {
	stored = { look: { shade: 'light', corner: 'soft', brandColour: null }, version: 'v0' };
	posted = [];
	shared = [];
	told = [];
	story = { version: 'story-v0', mission: null, vision: null };
	storyBefore = null;
	sharing = {
		version: 'sharing-v0',
		channels: ['facebook', 'email', 'copy-link'],
		message: null,
		links: []
	};
	sharingBefore = null;
	marker = null;
	landings = 0;
	refusingStory = null;
	held = [];
	refusing = null;
	logo = { now: null, before: null, version: 'logo-v0' };
	logoPosts = [];
	refusingLogo = null;
	uploadsHeld = [];
	resizes.length = 0;
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
				if (taken !== null) landings += 1;
				return {
					mission: story.mission === null ? null : JSON.parse(story.mission),
					vision: story.vision === null ? null : JSON.parse(story.vision),
					version: story.version,
					saved: taken?.startsWith('story') ? taken : null,
					landing: taken === null ? null : `landing-${landings}`,
					look: stored.look,
					lookVersion: stored.version,
					sharing: {
						channels: sharing.channels,
						message: sharing.message,
						links: sharing.links
					},
					sharingVersion: sharing.version,
					sharingSaved: taken?.startsWith('sharing') ? taken : null,
					logo: logo.now,
					logoVersion: logo.version,
					logoUndoable: logo.now?.imageId !== logo.before?.imageId
				};
			},
			action: async ({ request }) => {
				const form = await request.formData();
				const which = form.get(WHICH_FORM);
				if (which === 'org-sharing' || which === 'org-sharing-undo') {
					shared.push(form);
					if (which === 'org-sharing-undo' && sharingBefore !== null) {
						[sharing, sharingBefore] = [sharingBefore, sharing];
						return landed('sharing-undone');
					}
					sharingBefore = sharing;
					const message = String(form.get('message') ?? '');
					sharing = {
						...sharing,
						version: `sharing-v${shared.length}`,
						channels: form.getAll('channels').map(String),
						message: message === '' ? null : message
					};
					return landed('sharing');
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
					if (which === 'org-story-undo' && storyBefore !== null) {
						[story, storyBefore] = [storyBefore, story];
						return landed('story-undone');
					}
					storyBefore = story;
					story = {
						version: `story-v${told.length}`,
						mission: String(form.get('mission')),
						vision: String(form.get('vision'))
					};
					return landed('story');
				}
				if (which === 'org-logo' || which === 'org-logo-undo') {
					const body = fieldsOf(form);
					logoPosts.push(body);
					if (refusingLogo !== null)
						return data(
							{
								form: {
									id: which,
									result: {
										status: 'error',
										initialValue: body,
										error: { imageId: [refusingLogo] }
									}
								}
							},
							{ status: 400 }
						);
					const next: Logo =
						which === 'org-logo-undo'
							? logo.before
							: body.imageId
								? { imageId: body.imageId, width: 640, height: 320 }
								: null;
					logo = { now: next, before: logo.now, version: `logo-v${logoPosts.length}` };
					return {
						saved: which === 'org-logo-undo' ? 'logo-undone' : 'logo',
						version: logo.version
					};
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
		},
		{
			path: '/admin/images',
			action: async () => data(await new Promise((resolve) => uploadsHeld.push(resolve)))
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

/** the undo or redo mark a swap press draws, and only that. */
const swapMark = (press: HTMLElement) =>
	[...(press.querySelector('svg')?.classList ?? [])].filter((name) =>
		/^lucide-(undo|redo)-2$/.test(name)
	);

it('reads Undo after a save, Redo once its Undo lands, and Undo again once the Redo lands', async () => {
	const root = await drawn();
	act(() => radio(root, 'warm').click());
	await settle();
	act(() => held.shift()?.());
	await settle();
	await settle();

	const press = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Undo');
	if (press === undefined) throw new Error('no Undo after a landed save');
	expect(swapMark(press)).toEqual(['lucide-undo-2']);

	act(() => press.click());
	await settle();
	act(() => held.shift()?.());
	await settle();
	await settle();
	expect(said(root)).toContain('Undone on every page using the organisation’s look.');
	expect(press.textContent).toBe('Redo');
	expect(swapMark(press)).toEqual(['lucide-redo-2']);

	act(() => press.click());
	await settle();
	act(() => held.shift()?.());
	await settle();
	await settle();
	expect(said(root)).toContain('Saved to every page using the organisation’s look.');
	expect(press.textContent).toBe('Undo');
	expect(swapMark(press)).toEqual(['lucide-undo-2']);
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

	it('draws the stored story after a landed Undo, with Save story off', async () => {
		const root = await drawn();
		await saveStory(root);
		await pressOwned(button(card(root), 'Undo'));
		expect(story.version).toBe('story-v0');

		expect(document.getElementById('story-mission')?.textContent).toBe('');
		expect(document.getElementById('story-vision')?.textContent).toBe('');
		const save = card(root).querySelector('.adm-actions .adm-save');
		expect(save?.getAttribute('aria-disabled')).toBe('true');
	});

	it('reads Undo after a save, Redo once its Undo lands, and Undo again once the Redo lands', async () => {
		const root = await drawn();
		await saveStory(root);
		const buttons = () => [...card(root).querySelectorAll('.adm-actions button')];
		expect(swapMark(button(card(root), 'Undo'))).toEqual(['lucide-undo-2']);

		await pressOwned(button(card(root), 'Undo'));
		expect(buttons().map((b) => b.textContent)).toEqual(['Undone', 'Redo']);
		expect(swapMark(button(card(root), 'Redo'))).toEqual(['lucide-redo-2']);

		await pressOwned(button(card(root), 'Redo'));
		expect(buttons().map((b) => b.textContent)).toEqual(['Saved', 'Undo']);
		expect(swapMark(button(card(root), 'Undo'))).toEqual(['lucide-undo-2']);
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

	it('draws the stored sharing after a landed Undo, with Save sharing off', async () => {
		const root = await drawn();
		act(() => root.querySelector<HTMLInputElement>('input[value="whatsapp"]')?.click());
		act(() => press(root, 'Move WhatsApp up').click());
		type(root, 'message', 'Ghost share message');
		await saveSharing(root);
		await settle();

		const undo = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Undo');
		if (undo === undefined) throw new Error('no Undo after a landed save');
		await pressOwned(undo);
		expect(sharing.version).toBe('sharing-v0');

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
		expect(root.querySelector<HTMLTextAreaElement>('[name="message"]')?.value).toBe('');
		const card = [...root.querySelectorAll('h2')].find((h) => h.textContent === 'Sharing');
		const save = card?.parentElement?.querySelector('.adm-actions .adm-save');
		expect(save?.getAttribute('aria-disabled')).toBe('true');
	});

	it('reads Undo after a save, Redo once its Undo lands, and Undo again once the Redo lands', async () => {
		const root = await drawn();
		act(() => root.querySelector<HTMLInputElement>('input[value="x"]')?.click());
		await saveSharing(root);
		await settle();
		const card = [...root.querySelectorAll('h2')].find((h) => h.textContent === 'Sharing');
		const buttons = () => [...(card?.parentElement?.querySelectorAll('.adm-actions button') ?? [])];
		const swap = () => {
			const found = buttons().at(1);
			if (found === undefined) throw new Error('no swap press beside Save sharing');
			return found as HTMLButtonElement;
		};
		expect(buttons().map((b) => b.textContent)).toEqual(['Saved', 'Undo']);
		expect(swapMark(swap())).toEqual(['lucide-undo-2']);

		await pressOwned(swap());
		expect(buttons().map((b) => b.textContent)).toEqual(['Undone', 'Redo']);
		expect(swapMark(swap())).toEqual(['lucide-redo-2']);

		await pressOwned(swap());
		expect(buttons().map((b) => b.textContent)).toEqual(['Saved', 'Undo']);
		expect(swapMark(swap())).toEqual(['lucide-undo-2']);
	});
});

describe('the logo', () => {
	const STORED = '0192a4c1-0000-7000-8000-000000000002';

	/** the Logo group, which is where its outcomes have to be read. */
	function group(root: HTMLElement): HTMLElement {
		const legend = [...root.querySelectorAll('legend')].find((l) => l.textContent === 'Logo');
		const found = legend?.parentElement;
		if (!found) throw new Error('no Logo group');
		return found;
	}

	function button(root: HTMLElement, label: string): HTMLButtonElement {
		const found = [...group(root).querySelectorAll('button')].find((b) => b.textContent === label);
		if (found === undefined) throw new Error(`no button reading "${label}" in the Logo group`);
		return found;
	}

	/** a logo picked, resized, and its upload answered with the photo stored as `STORED`. */
	async function upload(root: HTMLElement): Promise<void> {
		const input = group(root).querySelector<HTMLInputElement>('input[type="file"]');
		if (input === null) throw new Error('no picker');
		Object.defineProperty(input, 'files', {
			configurable: true,
			value: [new File(['logo bytes'], 'logo.png', { type: 'image/png' })]
		});
		await act(async () => {
			input.dispatchEvent(new Event('change', { bubbles: true }));
		});
		const blob = new Blob([new Uint8Array(40_000)], { type: 'image/webp' });
		await act(async () => resizes.shift()?.({ ok: true, blob, width: 640, height: 320 }));
		await settle();
		await act(async () => uploadsHeld.shift()?.({ id: STORED, width: 640, height: 320 }));
		await settle();
		await settle();
	}

	it('posts the logo the moment its upload lands, with the stored id and the logo’s version', async () => {
		const root = await drawn();
		await upload(root);

		expect(logoPosts).toEqual([
			{ [WHICH_FORM]: 'org-logo', [RECORD_VERSION]: 'logo-v0', imageId: STORED }
		]);
	});

	it('reports the landed logo with Undo, which posts against the version the write left', async () => {
		const root = await drawn();
		await upload(root);

		expect(said(group(root))).toContain('Saved to every page.');
		act(() => button(root, 'Undo').click());
		await settle();
		expect(logoPosts[1]).toEqual({ [WHICH_FORM]: 'org-logo-undo', [RECORD_VERSION]: 'logo-v1' });
	});

	it('reads Undo after a save, Redo once its Undo lands, and Undo again once the Redo lands', async () => {
		const root = await drawn();
		await upload(root);
		const press = button(root, 'Undo');
		expect(swapMark(press)).toEqual(['lucide-undo-2']);

		act(() => press.click());
		await settle();
		await settle();
		expect(logo.now).toBeNull();
		expect(press.textContent).toBe('Redo');
		expect(swapMark(press)).toEqual(['lucide-redo-2']);

		act(() => press.click());
		await settle();
		await settle();
		expect(logo.now?.imageId).toBe(STORED);
		expect(press.textContent).toBe('Undo');
		expect(swapMark(press)).toEqual(['lucide-undo-2']);
	});

	it('posts an empty id for Remove, and reports it removed', async () => {
		logo = { now: { imageId: STORED, width: 640, height: 320 }, before: null, version: 'logo-v0' };
		const root = await drawn();

		act(() => button(root, 'Remove').click());
		await settle();
		await settle();

		expect(logoPosts).toEqual([
			{ [WHICH_FORM]: 'org-logo', [RECORD_VERSION]: 'logo-v0', imageId: '' }
		]);
		expect(said(group(root))).toContain('Removed from every page.');
	});

	it('shows a refused write at the control, with no Undo', async () => {
		refusingLogo = `"${STORED}" is an illustration; a logo is a photo uploaded here`;
		const root = await drawn();
		await upload(root);

		const refusal = group(root).querySelector('.adm-momentary--blocked');
		expect(refusal?.textContent).toBe(refusingLogo);
		expect([...group(root).querySelectorAll('button')].some((b) => b.textContent === 'Undo')).toBe(
			false
		);
	});
});
