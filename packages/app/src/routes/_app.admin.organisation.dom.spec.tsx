import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import Organisation from './_app.admin.organisation';

// what the Look section posts and says: a pick is the whole look against the version the page
// holds, a pick made while one is in flight goes after it with the version its answer revalidated,
// and the answer is reported beside the control with an Undo. and what the Sharing section's
// reorder presses do to the order its channels post in.
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
/** each sharing save as it arrived, kept whole: its channels are one name repeated. */
let shared: FormData[];
/** each post waits here until the case lets it land. */
let held: (() => void)[];
/** the sentence the next look post is refused with, when a case sets one. */
let refusing: string | null;

beforeEach(() => {
	stored = { look: { shade: 'light', corner: 'soft', brandColour: null }, version: 'v0' };
	posted = [];
	shared = [];
	held = [];
	refusing = null;
});

function screen(): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/organisation',
			loader: () => ({
				mission: null,
				vision: null,
				version: 'story-v0',
				saved: null,
				look: stored.look,
				lookVersion: stored.version,
				sharing: {
					channels: ['facebook', 'email', 'copy-link'],
					message: null,
					links: []
				},
				sharingVersion: 'sharing-v0',
				sharingSaved: null
			}),
			action: async ({ request }) => {
				const form = await request.formData();
				if (form.get(WHICH_FORM) === 'org-sharing') {
					shared.push(form);
					return null;
				}
				const body = Object.fromEntries([...form].map(([k, v]) => [k, String(v)]));
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
					actionData: undefined,
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
});
