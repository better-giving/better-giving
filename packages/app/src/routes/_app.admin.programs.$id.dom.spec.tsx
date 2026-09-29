import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, redirect } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { WHICH_FORM } from '$lib/forms/definition';
import type { Resized } from '$lib/images/resize';
import Program from './_app.admin.programs.$id';

// happy-dom decodes no image, so the resize is the boundary stood in for: each pick waits in
// `resizes` until the case hands it a result.
const resizes: ((result: Resized) => void)[] = [];
vi.mock('$lib/images/resize', async (actual) => ({
	...(await actual<typeof import('$lib/images/resize')>()),
	resizeImage: () => new Promise<Resized>((resolve) => resizes.push(resolve))
}));

beforeEach(() => {
	resizes.length = 0;
});

// a program's record, pressed through the redirect every write on it answers with.
//
// what it covers: the photo an upload lands or Remove clears is what Save program posts, and the
// save and the archive stay held for the whole navigation a press started, and
// not only its `submitting` half. both redirect back onto this record, and the router spends the
// redirect's `loading` phase reading it again with the pressed control still on the screen. a save
// that re-armed there sends a second body carrying the version the first one moved past, refused as
// stale; an archive that re-armed archives a program already archived. neither is visible to the
// workers spec beside this file, which drives the action and renders nothing.
//
// mounted rather than rendered to a string, because the phase is the router's and exists only
// between a press and a landing. it is not the browser spec CLAUDE.md bans over a dashboard
// screen: nothing here reads a computed style or a class.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * mounts `tree` into a document that lives as long as the case, and hands back its root element.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
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

const PROGRAM_ID = '019fb700-0000-7000-8000-000000000301';
const RECORD = `/admin/programs/${PROGRAM_ID}`;
const PLACED = '0192a4c1-0000-7000-8000-000000000001';
const STORED = '0192a4c1-0000-7000-8000-000000000002';

type Loaded = Parameters<typeof Program>[0]['loaderData'];

/** an active program with nothing just landed. */
function record(confirmArchive: boolean, imageId: string | null): Loaded {
	return {
		id: PROGRAM_ID,
		name: 'Winter Shelter',
		description: 'Beds and a hot meal through the cold months.',
		status: 'active',
		archived: false,
		editor: {
			name: 'Winter Shelter',
			description: 'Beds and a hot meal through the cold months.'
		},
		saved: null,
		archivedJustNow: false,
		imageId,
		confirmArchive,
		version: 1_790_000_000_000
	} as unknown as Loaded;
}

/**
 * the record under a router whose action answers every press with a redirect back onto it, and
 * whose loader for it never settles — the `loading` phase a real write spends reading the record
 * again, held open. hydrated, so the first render reaches no loader.
 *
 * `posted` is the form each body named, in the order the action received them, and `photos` the
 * photo's box in each. the images route answers every upload with `STORED`.
 */
function screen({ confirmArchive = false, imageId = null as string | null } = {}): {
	root: HTMLElement;
	posted: string[];
	photos: (string | null)[];
} {
	const posted: string[] = [];
	const photos: (string | null)[] = [];
	const Stub = createRoutesStub([
		{
			id: 'record',
			path: '/admin/programs/:id',
			loader: () => new Promise<never>(() => {}),
			Component: () =>
				createElement(Program as never, {
					loaderData: record(confirmArchive, imageId),
					actionData: undefined,
					params: { id: PROGRAM_ID },
					matches: []
				}),
			action: async ({ request }) => {
				const body = await request.formData();
				posted.push(String(body.get(WHICH_FORM)));
				photos.push(body.get('image_id') as string | null);
				return redirect(RECORD);
			}
		},
		{
			path: '/admin/images',
			action: () => ({ id: STORED, width: 800, height: 800 })
		}
	]);
	const root = mount(
		createElement(Stub, {
			initialEntries: [confirmArchive ? `${RECORD}?confirm=archive` : RECORD],
			hydrationData: { loaderData: { record: null } }
		})
	);
	return { root, posted, photos };
}

/** the button reading `label`, found the way an operator finds it. */
function buttonReading(root: HTMLElement, label: string): HTMLButtonElement {
	const found = [...root.querySelectorAll('button')].find((b) => b.textContent === label);
	if (found === undefined) throw new Error(`the screen drew no button reading "${label}"`);
	return found;
}

/**
 * types into a box the way a keystroke does, which is what makes the save pressable: a group
 * holding nothing to save draws its button closed.
 */
function type(root: HTMLElement, name: string, value: string): void {
	const box = root.querySelector<HTMLInputElement>(`input[name="${name}"]`);
	if (box === null) throw new Error(`the screen drew no box named "${name}"`);
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, value);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

/** the id the photo's hidden box holds, which is what Save program posts. */
function photoBox(root: HTMLElement): string | undefined {
	return root.querySelector<HTMLInputElement>('input[type="hidden"][name="image_id"]')?.value;
}

/** a photo picked and resized, then posted to the images route and answered. */
async function pick(root: HTMLElement): Promise<void> {
	const input = root.querySelector<HTMLInputElement>('input[type="file"]');
	if (input === null) throw new Error('the screen drew no photo picker');
	Object.defineProperty(input, 'files', {
		configurable: true,
		value: [new File(['camera bytes'], 'well.heic', { type: 'image/heic' })]
	});
	await act(async () => {
		input.dispatchEvent(new Event('change', { bubbles: true }));
	});
	const blob = new Blob([new Uint8Array(1_000)], { type: 'image/webp' });
	await act(async () => resizes.shift()?.({ ok: true, blob, width: 800, height: 800 }));
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

/** presses a control, then lets the router carry the press through its action and on. */
async function press(button: HTMLButtonElement): Promise<void> {
	await act(async () => button.click());
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

it('holds the save through the redirect’s loading, and a second press posts nothing', async () => {
	const { root, posted } = screen();
	type(root, 'name', 'Winter Shelter 2026');
	const save = buttonReading(root, 'Save program');

	await press(save);
	expect(posted).toEqual(['program-edit']);
	// the action has answered and the record is being read again: the press is still this one's.
	expect(save.getAttribute('aria-disabled')).toBe('true');

	// the body carries the version the first save has just moved past, so it is refused as stale.
	await press(save);
	expect(posted).toEqual(['program-edit']);
});

it('holds the archive through the redirect’s loading, and a second press posts nothing', async () => {
	const { root, posted } = screen({ confirmArchive: true });
	const archive = buttonReading(root, 'Yes, archive this program');

	await press(archive);
	expect(posted).toEqual(['program-archive']);
	expect(archive.getAttribute('aria-disabled')).toBe('true');

	// a second archive is refused as already archived, over a program still drawn as editable.
	await press(archive);
	expect(posted).toEqual(['program-archive']);
});

describe('the photo', () => {
	it('puts an upload’s id in the box once it lands', async () => {
		const { root } = screen();
		expect(photoBox(root)).toBe('');
		await pick(root);
		expect(photoBox(root)).toBe(STORED);
	});

	it('empties the box on Remove', async () => {
		const { root } = screen({ imageId: PLACED });
		expect(photoBox(root)).toBe(PLACED);
		await press(buttonReading(root, 'Remove'));
		expect(photoBox(root)).toBe('');
	});

	it('posts the landed photo with Save program, with nothing else changed', async () => {
		const { root, posted, photos } = screen({ imageId: PLACED });
		const save = buttonReading(root, 'Save program');
		expect(save.getAttribute('aria-disabled')).toBe('true');
		await pick(root);
		expect(save.getAttribute('aria-disabled')).toBeNull();
		await press(save);
		expect(posted).toEqual(['program-edit']);
		expect(photos).toEqual([STORED]);
	});
});
