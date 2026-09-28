import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { WHICH_FORM } from '$lib/forms/definition';
import type { Resized } from '$lib/images/resize';
import { BLOCK_FORMS, type EditorBlock } from '$lib/page/block-edit';
import { BlockEditSheet } from './block-edit';

// happy-dom decodes no image, so the resize is the boundary stood in for: each pick waits in
// `resizes` until the case hands it a result.
const resizes: ((result: Resized) => void)[] = [];
vi.mock('$lib/images/resize', async (actual) => ({
	...(await actual<typeof import('$lib/images/resize')>()),
	resizeImage: () => new Promise<Resized>((resolve) => resizes.push(resolve))
}));

// a placed photo's sheet as the editor routes mount it: a new photo is resized, posted to the images
// route, drawn once stored, and written to the block by Done with what describes it. both routes are
// stand-ins; what the real ones store is src/routes/_app.admin.images.workers.spec.ts's and
// $lib/server/pages/blocks.workers.spec.ts's.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLACED = '0192a4c1-0000-7000-8000-000000000001';
const STORED = '0192a4c1-0000-7000-8000-000000000002';

let saves: Record<string, string>[];
/** what the editor's action answers a save; a landed one unless a case says otherwise. */
let saveAnswer: { body: unknown; status: number };
let uploads: number[];
/** each upload waits here until the case lets it land, answered with what it is handed. */
let uploadsHeld: ((answer: { body: unknown; status: number }) => void)[];

beforeEach(() => {
	saves = [];
	saveAnswer = { body: { saved: 'block' }, status: 200 };
	uploads = [];
	uploadsHeld = [];
	resizes.length = 0;
});

const hero: EditorBlock = {
	id: 'hero',
	type: 'hero',
	label: 'Cover photo',
	summary: 'Volunteers',
	variant: 'wide',
	variants: [
		{ value: 'wide', label: 'Wide' },
		{ value: 'framed', label: 'Framed' }
	],
	text: { kind: 'photo', imageId: PLACED, alt: 'Volunteers' }
};

function editor() {
	const Stub = createRoutesStub([
		{
			path: '/admin/campaigns/:pageId',
			Component: () => (
				<BlockEditSheet block={hero} version={3} onDismiss={() => {}} onSaved={() => {}} />
			),
			action: async ({ request }) => {
				saves.push(
					Object.fromEntries([...(await request.formData())].map(([k, v]) => [k, String(v)]))
				);
				return data(saveAnswer.body, saveAnswer.status);
			}
		},
		{
			path: '/admin/images',
			action: async ({ request }) => {
				const file = (await request.formData()).get('file');
				if (!(file instanceof File)) throw new Error('no file posted');
				uploads.push(file.size);
				const answer = await new Promise<{ body: unknown; status: number }>((resolve) =>
					uploadsHeld.push(resolve)
				);
				return data(answer.body, answer.status);
			}
		}
	]);
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(<Stub initialEntries={['/admin/campaigns/p1']} />));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

/** a photo picked, and the resize answering with `resized` — a 480 kB WebP unless a case says. */
async function pick(root: HTMLElement, resized?: Resized) {
	const input = root.querySelector<HTMLInputElement>('input[type="file"]');
	if (input === null) throw new Error('no picker');
	Object.defineProperty(input, 'files', {
		configurable: true,
		value: [new File(['camera bytes'], 'coats.heic', { type: 'image/heic' })]
	});
	await act(async () => {
		input.dispatchEvent(new Event('change', { bubbles: true }));
	});
	const blob = new Blob([new Uint8Array(480_000)], { type: 'image/webp' });
	await act(async () =>
		resizes.shift()?.(resized ?? { ok: true, blob, width: 1600, height: 1067 })
	);
	await settle();
}

async function uploaded(body: unknown, status = 200) {
	await act(async () => uploadsHeld.shift()?.({ body, status }));
	await settle();
}

function describePhoto(root: HTMLElement, words: string) {
	const label = [...root.querySelectorAll('label')].find((one) =>
		one.textContent?.includes('Describe the photo')
	);
	const box = label === undefined ? null : document.getElementById(label.htmlFor);
	if (!(box instanceof HTMLInputElement)) throw new Error('no description box');
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
	act(() => {
		setter?.call(box, words);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

async function done(root: HTMLElement) {
	const found = [...root.querySelectorAll('button')].find((one) => one.textContent === 'Done');
	if (found === undefined) throw new Error('no Done');
	await act(async () => found.click());
	await settle();
}

const shown = (root: HTMLElement) => root.querySelector('.adm-placed img')?.getAttribute('src');
const pressWords = (root: HTMLElement) => root.querySelector('.adm-placed button')?.textContent;

describe('a placed photo’s sheet', () => {
	it('uploads a new photo, draws it once stored, and Done writes it with its description', async () => {
		const root = editor();
		expect(shown(root)).toBe(`/image/${PLACED}`);

		await pick(root);
		expect([pressWords(root), uploads]).toEqual(['Uploading', [480_000]]);
		await uploaded({ id: STORED, width: 1600, height: 1067 });
		expect([pressWords(root), shown(root)]).toEqual(['Replace photo', `/image/${STORED}`]);

		describePhoto(root, 'Coats on a rack');
		await done(root);

		expect(saves).toEqual([
			expect.objectContaining({
				[WHICH_FORM]: BLOCK_FORMS.photo,
				block_id: 'hero',
				image_id: STORED,
				alt: 'Coats on a rack'
			})
		]);
	});

	it('draws a refused description under its box, and moves the caret there', async () => {
		const words = 'a photo’s description holds at most 250 characters';
		saveAnswer = {
			body: {
				form: { id: BLOCK_FORMS.photo, result: { status: 'error', error: { alt: [words] } } }
			},
			status: 400
		};
		const root = editor();
		describePhoto(root, 'a'.repeat(251));

		await done(root);

		const box = root.querySelector<HTMLInputElement>('#block-hero-alt');
		expect(box).not.toBeNull();
		expect(document.activeElement).toBe(box);
		const said = box?.getAttribute('aria-describedby')?.split(' ') ?? [];
		expect(said.map((id) => document.getElementById(id)?.textContent)).toContain(words);
	});

	it('says a refused resize at the press, posts nothing, and keeps the photo placed', async () => {
		const root = editor();

		await pick(root, { ok: false, reason: 'too-large-after-resize' });

		const said = root.querySelector('.adm-placed [role="status"]');
		expect(said?.textContent).toBe(
			'That photo is too large even after resizing. Choose a smaller one.'
		);
		const press = root.querySelector('.adm-placed button');
		expect(press?.getAttribute('aria-describedby')).toBe(said?.id);
		expect([uploads, shown(root), pressWords(root)]).toEqual([
			[],
			`/image/${PLACED}`,
			'Replace photo'
		]);
		await done(root);
		expect(saves).toEqual([expect.objectContaining({ image_id: PLACED, alt: 'Volunteers' })]);
	});

	it('says a refused upload at the press, and keeps the photo placed', async () => {
		const root = editor();

		await pick(root);
		await uploaded({ error: 'a photo is at most 1900000 bytes (1.9 MB) once resized' }, 413);

		expect(root.querySelector('.adm-placed [role="status"]')?.textContent).toContain(
			'a photo is at most 1900000 bytes'
		);
		await done(root);
		expect(saves).toEqual([expect.objectContaining({ image_id: PLACED, alt: 'Volunteers' })]);
	});
});
