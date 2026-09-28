import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, expect, it, onTestFinished } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import Organisation from './_app.admin.organisation';

// what the Look section posts and says: a pick is the whole look against the version the page
// holds, a pick made while one is in flight goes after it with the version its answer revalidated,
// and the answer is reported beside the control with an Undo.
//
// in the dom pool because every case is a fetcher round trip — a press, an action that has not
// settled, a revalidation — and a server render is one idle pass. the action here is a stand-in
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
/** each post waits here until the case lets it land. */
let held: (() => void)[];

beforeEach(() => {
	stored = { look: { shade: 'light', corner: 'soft', brandColour: null }, version: 'v0' };
	posted = [];
	held = [];
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
				lookVersion: stored.version
			}),
			action: async ({ request }) => {
				const body = Object.fromEntries(
					[...(await request.formData())].map(([k, v]) => [k, String(v)])
				);
				posted.push(body);
				await new Promise<void>((resolve) => held.push(resolve));
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
