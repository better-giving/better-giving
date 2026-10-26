import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import type { Resized } from '@better-giving/operator/images/resize';
import { CONTENT_FORMS, type EditorSection, SLOTS } from '$lib/page/content-edit';
import { SectionEditSheet } from './section-edit';

// happy-dom decodes no image, so the resize is the boundary stood in for: each pick waits in
// `resizes` until the case hands it a result.
const resizes: ((result: Resized) => void)[] = [];
vi.mock('@better-giving/operator/images/resize', async (actual) => ({
	...(await actual<typeof import('@better-giving/operator/images/resize')>()),
	resizeImage: () => new Promise<Resized>((resolve) => resizes.push(resolve))
}));

// a placed photo's sheet as the editor routes mount it: a new photo is resized, posted to the images
// route, drawn once stored, and written to the photo's slot by Done with what describes it; Remove
// photo posts the slot at once; and the sheet of a slot with no photo yet, whose Done posts nothing
// until one is chosen. both routes are stand-ins; what the real ones store is
// src/routes/_app.admin.images.db.spec.ts's and $lib/server/pages/content.db.spec.ts's.

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
	saveAnswer = { body: { saved: 'content' }, status: 200 };
	uploads = [];
	uploadsHeld = [];
	resizes.length = 0;
});

const hero: EditorSection = {
	id: 'cover',
	label: 'Cover photo',
	summary: 'Volunteers',
	empty: false,
	text: { kind: 'photo', slot: SLOTS.cover, imageId: PLACED, alt: 'Volunteers', removable: true }
};

function editor(section: EditorSection = hero) {
	const Stub = createRoutesStub([
		{
			path: '/admin/campaigns/:pageId',
			Component: () => (
				<SectionEditSheet section={section} version={3} onDismiss={() => {}} onSaved={() => {}} />
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

/** a photo picked, its resize still running. */
async function choose(root: HTMLElement) {
	const input = root.querySelector<HTMLInputElement>('input[type="file"]');
	if (input === null) throw new Error('no picker');
	Object.defineProperty(input, 'files', {
		configurable: true,
		value: [new File(['camera bytes'], 'coats.heic', { type: 'image/heic' })]
	});
	await act(async () => {
		input.dispatchEvent(new Event('change', { bubbles: true }));
	});
}

/** a photo picked, and the resize answering with `resized` — a 480 kB WebP unless a case says. */
async function pick(root: HTMLElement, resized?: Resized) {
	await choose(root);
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
	found.focus();
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
				[WHICH_FORM]: CONTENT_FORMS.photo,
				slot: SLOTS.cover,
				image_id: STORED,
				alt: 'Coats on a rack'
			})
		]);
	});

	it('holds Done while a new photo resizes or uploads, and writes the new photo once it is stored', async () => {
		const root = editor();

		await choose(root);
		await done(root);
		expect(saves).toEqual([]);

		await act(async () =>
			resizes.shift()?.({
				ok: true,
				blob: new Blob([new Uint8Array(480_000)], { type: 'image/webp' }),
				width: 1600,
				height: 1067
			})
		);
		await settle();
		expect(pressWords(root)).toBe('Uploading');
		await done(root);
		expect(saves).toEqual([]);

		await uploaded({ id: STORED, width: 1600, height: 1067 });
		await done(root);
		expect(saves).toEqual([expect.objectContaining({ image_id: STORED, alt: 'Volunteers' })]);
	});

	it('draws a refused description under its box, and moves the caret there', async () => {
		const words = 'a photo’s description holds at most 250 characters';
		saveAnswer = {
			body: {
				form: { id: CONTENT_FORMS.photo, result: { status: 'error', error: { alt: [words] } } }
			},
			status: 400
		};
		const root = editor();
		describePhoto(root, 'a'.repeat(251));

		await done(root);

		const box = root.querySelector<HTMLInputElement>('#section-cover-alt');
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

describe('the sheet of a slot with no photo yet', () => {
	const bare: EditorSection = {
		...hero,
		summary: 'No photo yet',
		empty: true,
		text: { kind: 'photo', slot: SLOTS.cover, imageId: null, alt: '', removable: false }
	};

	it('offers Add photo alone, and Done posts nothing but says a photo is wanted at the press', async () => {
		const root = editor(bare);
		expect([shown(root), pressWords(root)]).toEqual([undefined, 'Add photo']);

		await done(root);

		expect(saves).toEqual([]);
		const press = root.querySelector('.adm-placed button');
		const said = root.querySelector('.adm-placed [role="status"]');
		expect(said?.textContent).toBe('Add a photo first. The page doesn’t change until you do.');
		expect(press?.getAttribute('aria-describedby')).toBe(said?.id);
		expect(document.activeElement).toBe(press);
	});

	it('holds Done while the photo resizes or uploads, without saying a photo is wanted', async () => {
		const root = editor(bare);
		const said = () => root.querySelector('.adm-placed [role="status"]')?.textContent;

		await choose(root);
		await done(root);
		expect([saves, said(), document.activeElement?.textContent]).toEqual([[], '', 'Done']);

		await act(async () =>
			resizes.shift()?.({
				ok: true,
				blob: new Blob([new Uint8Array(480_000)], { type: 'image/webp' }),
				width: 1600,
				height: 1067
			})
		);
		await settle();
		await done(root);
		expect([saves, pressWords(root), said(), document.activeElement?.textContent]).toEqual([
			[],
			'Uploading',
			'',
			'Done'
		]);

		await uploaded({ id: STORED, width: 1600, height: 1067 });
		await done(root);
		expect(saves).toEqual([expect.objectContaining({ image_id: STORED })]);
	});

	it('writes the photo chosen, by its id, at the next Done', async () => {
		const root = editor(bare);
		await done(root);

		await pick(root);
		await uploaded({ id: STORED, width: 1600, height: 1067 });
		expect([shown(root), root.querySelector('.adm-placed [role="status"]')?.textContent]).toEqual([
			`/image/${STORED}`,
			''
		]);
		describePhoto(root, 'Coats on a rack');
		await done(root);

		expect(saves).toEqual([
			expect.objectContaining({
				[WHICH_FORM]: CONTENT_FORMS.photo,
				slot: SLOTS.cover,
				image_id: STORED,
				alt: 'Coats on a rack'
			})
		]);
	});
});

describe('Remove photo', () => {
	it('posts the photo’s slot at once, with the version, and Done is not needed', async () => {
		const root = editor();
		const remove = [...root.querySelectorAll('button')].find(
			(one) => one.textContent === 'Remove photo'
		);
		await act(async () => remove?.click());
		await settle();
		expect(saves).toEqual([
			{ [WHICH_FORM]: CONTENT_FORMS.photoRemove, [RECORD_VERSION]: '3', slot: SLOTS.cover }
		]);
	});

	it('names the slot of a photo beside the cover', async () => {
		const root = editor({
			...hero,
			id: 'photo-1',
			label: 'Photo 2',
			text: { kind: 'photo', slot: '1', imageId: PLACED, alt: '', removable: true }
		});
		const remove = [...root.querySelectorAll('button')].find(
			(one) => one.textContent === 'Remove photo'
		);
		await act(async () => remove?.click());
		await settle();
		expect(saves.map((body) => [body[WHICH_FORM], body.slot])).toEqual([
			[CONTENT_FORMS.photoRemove, '1']
		]);
	});

	it('is not offered where no photo is placed yet', () => {
		const root = editor({
			...hero,
			text: { kind: 'photo', slot: SLOTS.added, imageId: null, alt: '', removable: false }
		});
		expect([...root.querySelectorAll('button')].map((one) => one.textContent)).not.toContain(
			'Remove photo'
		);
	});
});
