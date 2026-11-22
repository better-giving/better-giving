import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, redirect, useActionData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { WHICH_FORM } from '$lib/forms/definition';
import type { Resized } from '@better-giving/operator/images/resize';
import Program, { clientAction } from './_app.admin.programs.$id';
import { clientAction as imagesClientAction } from './_app.admin.images';

// happy-dom decodes no image, so the resize is the boundary stood in for: each pick waits in
// `resizes` until the case hands it a result.
const resizes: ((result: Resized) => void)[] = [];
vi.mock('@better-giving/operator/images/resize', async (actual) => ({
	...(await actual<typeof import('@better-giving/operator/images/resize')>()),
	resizeImage: () => new Promise<Resized>((resolve) => resizes.push(resolve))
}));

/** the phone has lost its signal: every request rejects before it leaves, as `fetch` does. */
let offline: boolean;

beforeEach(() => {
	resizes.length = 0;
	offline = false;
});

function unreachable(): void {
	if (offline) throw new TypeError('Failed to fetch');
}

/** what the screen says of a press that never reached the server. */
const NOT_SENT =
	'That may not have saved: the server couldn’t be reached. Check your connection and press again.';

// a program's record, pressed through the redirect every write on it answers with.
//
// what it covers: the photo an upload lands or Remove clears is what Save program posts, and the
// save and the archive stay held for the whole navigation a press started, and not only its
// `submitting` half. both redirect back onto this record, and the router spends the redirect's
// `loading` phase reading it again with the pressed control still on the screen. a save that
// re-armed there sends a second body carrying the version the first one moved past, refused as
// stale; an archive that re-armed archives a program already archived. neither is visible to the
// db spec beside this file, which drives the action and renders nothing.
//
// and a press whose request never reaches the server — a save, an upload — leaves the screen up
// with what was typed and says so where that press reports; every press goes through the route's
// own `clientAction`, as it does in a browser.
//
// mounted rather than rendered to a string, because the phase is the router's and exists only
// between a press and a landing. it is not the browser spec CLAUDE.md bans over a dashboard
// screen: nothing here reads a computed style.

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

/** the program's public address and the preview's, as the loader hands them on. */
const PUBLIC_URL = `https://give.example/programs/${PROGRAM_ID}`;
const PREVIEW_SRC = `/programs/${PROGRAM_ID}/preview`;

/** a program with nothing just landed: active, or archived where `archived` is set. */
function record(confirmArchive: boolean, imageId: string | null, archived = false): Loaded {
	return {
		id: PROGRAM_ID,
		name: 'Winter Shelter',
		description: 'Beds and a hot meal through the cold months.',
		status: archived ? 'archived' : 'active',
		archived,
		publicPage: { url: PUBLIC_URL, previewSrc: PREVIEW_SRC },
		editor: archived
			? null
			: {
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
 * photo's box in each. the images route answers every upload with `STORED`, or never where
 * `uploadHeld` is set.
 */
function screen({
	confirmArchive = false,
	imageId = null as string | null,
	uploadHeld = false,
	archived = false
} = {}): {
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
					loaderData: record(confirmArchive, imageId, archived),
					actionData: useActionData(),
					params: { id: PROGRAM_ID },
					matches: []
				}),
			action: (args) =>
				clientAction({
					...args,
					serverAction: async () => {
						unreachable();
						const body = await args.request.formData();
						posted.push(String(body.get(WHICH_FORM)));
						photos.push(body.get('image_id') as string | null);
						return redirect(RECORD);
					}
				} as never)
		},
		{
			path: '/admin/images',
			action: (args) =>
				imagesClientAction({
					...args,
					serverAction: async () => {
						unreachable();
						return uploadHeld
							? new Promise<never>(() => {})
							: { id: STORED, width: 800, height: 800 };
					}
				} as never)
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

/** the section a level-two heading reading `heading` heads, or null where none is drawn. */
function sectionNamed(root: HTMLElement, heading: string): HTMLElement | null {
	const h2 = [...root.querySelectorAll('h2')].find((h) => h.textContent === heading);
	return h2?.closest('section') ?? null;
}

/** the text of the element a section's `aria-labelledby` names, or null where it names none. */
function labelOf(section: HTMLElement | null): string | null {
	const id = section?.getAttribute('aria-labelledby');
	return id ? (document.getElementById(id)?.textContent ?? null) : null;
}

describe('the two cards', () => {
	it('are sections each named by its own heading', () => {
		const { root } = screen();

		expect(labelOf(sectionNamed(root, 'Details'))).toBe('Details');
		expect(labelOf(sectionNamed(root, 'Public page'))).toBe('Public page');
	});

	it('names the archived record by its heading in Details’ place', () => {
		const { root } = screen({ archived: true });

		const record = sectionNamed(root, 'How this program was described');
		expect(labelOf(record)).toBe('How this program was described');
		expect(labelOf(sectionNamed(root, 'Public page'))).toBe('Public page');
	});

	// the record stands in the 3fr card of `.adm-cardpair`, too narrow beside a setting row's 20rem
	// label track: packages/operator/src/styles/adm.css draws both classes read here.
	it('stacks the archived description under its label and wraps a long word in it', () => {
		const { root } = screen({ archived: true });

		const value = sectionNamed(root, 'How this program was described')?.querySelector('dd');
		expect(value?.closest('.adm-setting')?.classList.contains('adm-setting--stacked')).toBe(true);
		expect(value?.classList.contains('adm-setting__value--wrap')).toBe(true);
	});

	it('draws no section inside Details', () => {
		const { root } = screen();

		expect(sectionNamed(root, 'Details')?.querySelector('section')).toBeNull();
	});
});

describe('the Public page card', () => {
	it('shows an active program’s public address and a preview of what is saved, beside Details', () => {
		const { root } = screen();

		const details = sectionNamed(root, 'Details');
		expect(details).not.toBeNull();
		expect(details?.querySelector('input[name="name"]')).not.toBeNull();
		const card = sectionNamed(root, 'Public page');
		expect(card).not.toBeNull();
		expect(card?.textContent).toContain(PUBLIC_URL);
		expect(card?.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe(PUBLIC_URL);
		const frame = card?.querySelector('iframe');
		expect(frame?.getAttribute('src')).toBe(PREVIEW_SRC);
		expect(frame?.getAttribute('title')).toBe('Preview of the Winter Shelter page');
	});

	it('keeps only the sentence and Open page for an archived program, with the record for Details', () => {
		const { root } = screen({ archived: true });

		expect(sectionNamed(root, 'Details')).toBeNull();
		expect(sectionNamed(root, 'How this program was described')).not.toBeNull();
		const card = sectionNamed(root, 'Public page');
		expect(card).not.toBeNull();
		expect(card?.textContent).toContain('This program is archived');
		expect(card?.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe(PUBLIC_URL);
		expect(card?.querySelector('iframe')).toBeNull();
		expect(root.querySelector('iframe')).toBeNull();
	});
});

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

	it('holds Save program while an upload is unanswered, and a press posts nothing', async () => {
		const { root, posted } = screen({ imageId: PLACED, uploadHeld: true });
		type(root, 'name', 'Winter Shelter 2026');
		const save = buttonReading(root, 'Save program');
		expect(save.getAttribute('aria-disabled')).toBeNull();

		await pick(root);
		expect(save.getAttribute('aria-disabled')).toBe('true');
		expect(save.getAttribute('aria-busy')).toBe('true');

		// the box still holds the photo the upload is replacing.
		await press(save);
		expect(posted).toEqual([]);
	});
});

describe('a press whose request never reaches the server', () => {
	it('leaves the save’s boxes holding what was typed, says so, and offers the save again', async () => {
		const { root, posted } = screen();
		type(root, 'name', 'Winter Shelter 2026');
		const save = buttonReading(root, 'Save program');

		offline = true;
		await press(save);

		expect(posted).toEqual([]);
		expect(root.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe(
			'Winter Shelter 2026'
		);
		expect(root.querySelector('[role="alert"]')?.textContent).toContain(NOT_SENT);
		expect(save.textContent).toBe('Save program');
		expect(save.getAttribute('aria-disabled')).toBeNull();
	});

	it('says so at the photo’s press, and keeps the photo the box held', async () => {
		const { root } = screen({ imageId: PLACED });

		offline = true;
		await pick(root);

		expect(photoBox(root)).toBe(PLACED);
		const said = [...root.querySelectorAll('[role="status"]')].map((one) => one.textContent);
		expect(said).toContain(NOT_SENT);
	});
});
