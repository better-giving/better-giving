import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { DataRouter } from 'react-router';
import { createMemoryRouter, RouterProvider, UNSAFE_withComponentProps } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgWrite } from '../api/types';

// the organisation page's save, through a router: what the screen draws on the render the answer
// lands in. that render is the one the seam's focus move runs on (../lib/use-console-form.ts), so a
// box still closed there is a refusal the operator is left in front of with focus nowhere. the
// client is replaced so the answer is whichever one the case sets, and the layout's reading is a
// count.

const binary = vi.hoisted(() => ({
	shellReads: 0,
	statusReads: 0,
	built: true,
	answer: null as unknown,
	/** each call the page made of the binary, in order, with what it was handed. */
	calls: [] as [string, ...unknown[]][],
	/** what the resize answers, which stands for the browser's canvas. */
	resized: null as unknown,
	/** what happens on the page while the resize runs. */
	whileResizing: null as (() => void) | null,
	/** the logo the deployment holds, as the binary answers its bytes. */
	stored: null as Blob | null
}));

vi.mock('../api/client', async (original) => ({
	...(await original<Record<string, unknown>>()),
	saveOrgProfile: async (...args: unknown[]) => {
		binary.calls.push(['saveOrgProfile', ...args]);
		return binary.answer;
	},
	uploadOrgLogo: async (...args: unknown[]) => {
		binary.calls.push(['uploadOrgLogo', ...args]);
		return binary.answer;
	},
	removeOrgLogo: async () => {
		binary.calls.push(['removeOrgLogo']);
		return binary.answer;
	},
	readOrgLogo: async () => {
		binary.calls.push(['readOrgLogo']);
		return binary.stored;
	},
	nonprofitsStatus: async () => {
		binary.statusReads += 1;
		return { built: binary.built };
	}
}));

// the resize draws on a canvas, which this pool has none of.
vi.mock('@better-giving/operator/images/resize', async (original) => ({
	...(await original<Record<string, unknown>>()),
	resizeImage: async (file: File) => {
		binary.calls.push(['resizeImage', file]);
		binary.whileResizing?.();
		return binary.resized;
	}
}));

const {
	LOGO_CROP_SIZE,
	LOGO_CROP_X,
	LOGO_CROP_Y,
	LOGO_FILE,
	LOGO_FROM_FILE,
	LOGO_FROM_STORED,
	LOGO_SOURCE,
	ORG_INTENT,
	ORG_LOGO_INTENT,
	ORG_LOGO_REMOVE_INTENT,
	storedProfile
} = await import('../lib/org-fields');
const { ORG_FORM } = await import('../lib/org-form');
const { LOGO_REFUSED } = await import('../lib/org-logo');
const sections = await import('./_sections');
const organisation = await import('./_sections.organisation');

const PAGE = '/organisation';
const PAGE_ID = 'organisation';

const STORED = storedProfile({ legal_name: 'Riverbank Trust', country: 'US' });

const REFUSED: OrgWrite = {
	kind: 'refused',
	message: 'The profile was not saved.',
	fix: null,
	errors: { legal_name: 'Add the name the organisation is registered under.' },
	unread: 0
};

/** a refusal at the logo, in the shape the fold draws. */
const logoRefusal = (sentence: string): OrgWrite => ({
	kind: 'refused',
	message: null,
	fix: null,
	errors: { logo: sentence },
	unread: 0
});

const SAVED: OrgWrite = { kind: 'saved', org: { ...STORED, legal_name: 'Riverbank Trust Inc' } };

beforeEach(() => {
	binary.shellReads = 0;
	binary.statusReads = 0;
	binary.built = true;
	binary.answer = REFUSED;
	binary.calls = [];
	binary.resized = null;
	binary.whileResizing = null;
	binary.stored = null;
});

/**
 * the page under a root and the sections layout, as the console mounts it: `matches[1]` is the
 * layout. the layout's reading is the one a save re-reads, so its `shouldRevalidate` is the module's.
 */
async function open() {
	const router = createMemoryRouter(
		[
			{
				children: [
					{
						loader: () => {
							binary.shellReads += 1;
							return { reading: { stored: STORED } };
						},
						shouldRevalidate: sections.shouldRevalidate,
						children: [
							{
								id: PAGE_ID,
								path: PAGE,
								loader: organisation.clientLoader,
								action: organisation.clientAction as never,
								shouldRevalidate: organisation.shouldRevalidate,
								Component: UNSAFE_withComponentProps(organisation.default as never)
							}
						]
					}
				]
			}
		],
		{ initialEntries: [PAGE] }
	);
	await vi.waitFor(() => expect(router.state.initialized).toBe(true));
	return router;
}

type Landed = { readonly navigation: string; readonly page: string };

/** a press with nothing in it but the intent, which is the save as the tests above make it. */
function pressing(intent: string): FormData {
	const posted = new FormData();
	posted.set('intent', intent);
	return posted;
}

/** the save made as the fold makes it, and the screen drawn on the render its answer arrives in. */
async function saved(
	router: DataRouter,
	posted = pressing(ORG_INTENT),
	formEncType: 'multipart/form-data' | undefined = undefined
): Promise<Landed> {
	let landed: Landed | null = null;
	const off = router.subscribe((state) => {
		if (landed !== null || state.actionData?.[PAGE_ID] === undefined) return;
		landed = {
			navigation: state.navigation.state,
			page: renderToString(createElement(RouterProvider, { router }))
		};
	});
	try {
		await router.navigate(PAGE, {
			formMethod: 'post',
			formData: posted,
			preventScrollReset: true,
			...(formEncType === undefined ? {} : { formEncType })
		});
		await vi.waitFor(() => expect(router.state.navigation.state).toBe('idle'));
	} finally {
		off();
	}
	if (landed === null) throw new Error('the answer never landed');
	return landed;
}

/** one opening tag, found by an attribute only it carries. */
function tag(page: string, name: string, carrying: string): string {
	const found = page.match(new RegExp(`<${name}\\b[^>]*${carrying}[^>]*>`));
	if (found === null) throw new Error(`no <${name}> carrying ${carrying}`);
	return found[0];
}

const legalName = (page: string) => tag(page, 'input', `id="${ORG_FORM.id}-legal_name"`);
const saveButton = (page: string) => tag(page, 'button', `value="${ORG_INTENT}"`);

describe('the organisation page, on the render a refused save lands in', () => {
	it('leaves the refused box open to type in and the button off Saving', async () => {
		const router = await open();
		try {
			const { page } = await saved(router);

			expect(legalName(page)).not.toMatch(/\sdisabled=/);
			expect(saveButton(page)).not.toContain('aria-busy');
		} finally {
			router.dispose();
		}
	});

	it('reads nothing again, because nothing was written', async () => {
		const router = await open();
		try {
			const before = binary.shellReads;
			const { navigation } = await saved(router);

			expect(navigation).toBe('idle');
			expect(binary.shellReads).toBe(before);
		} finally {
			router.dispose();
		}
	});
});

describe('the organisation page, on the render a landed save arrives in', () => {
	it('reads the deployment again and holds the boxes closed while it does', async () => {
		binary.answer = SAVED;
		const router = await open();
		try {
			const before = binary.shellReads;
			const { navigation, page } = await saved(router);

			expect(navigation).toBe('loading');
			expect(legalName(page)).toMatch(/\sdisabled=/);
			expect(binary.shellReads).toBe(before + 1);
		} finally {
			router.dispose();
		}
	});
});

describe('whether the page can ask the IRS list', () => {
	it('is read once for the visit, and not again after a save lands', async () => {
		binary.answer = SAVED;
		const router = await open();
		try {
			await saved(router);

			expect(binary.statusReads).toBe(1);
		} finally {
			router.dispose();
		}
	});

	it('draws the plain form where the console was built with no address for the list', async () => {
		binary.built = false;
		const router = await open();
		try {
			const page = renderToString(createElement(RouterProvider, { router }));

			expect(page).toContain(`id="${ORG_FORM.id}-legal_name"`);
			expect(page).not.toContain('Find your organisation');
		} finally {
			router.dispose();
		}
	});

	it('offers the find press where it was', async () => {
		const router = await open();
		try {
			const page = renderToString(createElement(RouterProvider, { router }));

			expect(page).toContain('Find your organisation');
		} finally {
			router.dispose();
		}
	});
});

describe('the profile save', () => {
	it('posts every box, the three statements included, and the link rows as typed', async () => {
		binary.answer = SAVED;
		const posted = pressing(ORG_INTENT);
		posted.set('legal_name', 'Riverbank Trust');
		posted.set('mission', 'A river anyone can swim in.');
		posted.set('vision', '');
		posted.set('brand_colour', '#0a7d5c');
		posted.set('social_links[0]', 'instagram.com/riverbank');
		posted.set('social_links[1]', '');
		const router = await open();
		try {
			await saved(router, posted);

			const [call] = binary.calls;
			expect(call?.[0]).toBe('saveOrgProfile');
			expect(call?.[1]).toMatchObject({
				legal_name: 'Riverbank Trust',
				mission: 'A river anyone can swim in.',
				vision: '',
				brand_colour: '#0a7d5c'
			});
			expect(call?.[2]).toEqual(['instagram.com/riverbank', '']);
			// tagged, so a logo answer landing later is never read as this save's.
			expect(router.state.actionData?.[PAGE_ID]).toEqual({ write: SAVED, press: 'profile' });
		} finally {
			router.dispose();
		}
	});
});

describe('the logo presses', () => {
	const photo = () => new File(['raw photo'], 'logo.png', { type: 'image/png' });
	const LOGO_SAVED: OrgWrite = {
		kind: 'saved',
		org: {
			...STORED,
			social_links: [],
			logo: { id: 'img_1', url: 'https://a.example/image/img_1' }
		}
	};

	/** the square every logo press posts, as three boxes. */
	const square = (posted: FormData, x: string, y: string, size: string) => {
		posted.set(LOGO_CROP_X, x);
		posted.set(LOGO_CROP_Y, y);
		posted.set(LOGO_CROP_SIZE, size);
		return posted;
	};

	/** a photo press as the crop dialog posts one: the file, and the square kept of it. */
	const choosing = (file: File) => {
		const posted = square(pressing(ORG_LOGO_INTENT), '40', '0', '400');
		posted.set(LOGO_SOURCE, LOGO_FROM_FILE);
		posted.set(LOGO_FILE, file);
		return posted;
	};

	/** a re-crop of the stored logo as the crop dialog posts one: no file, and the square. */
	const recropping = () => {
		const posted = square(pressing(ORG_LOGO_INTENT), '100', '0', '400');
		posted.set(LOGO_SOURCE, LOGO_FROM_STORED);
		return posted;
	};

	/** the photo press, posted the way a file can only be: as multipart, which the fold's form states. */
	const putting = (router: DataRouter, posted: FormData) =>
		saved(router, posted, 'multipart/form-data');

	/** the action alone, for an answer the screen that draws it is the fold's. */
	const acting = (posted: FormData, signal?: AbortSignal) =>
		organisation.clientAction({
			request: new Request(`http://localhost${PAGE}`, {
				method: 'POST',
				body: posted,
				...(signal === undefined ? {} : { signal })
			})
		} as never);

	/** the answer the page's action came back with. */
	const answered = (router: DataRouter) => router.state.actionData?.[PAGE_ID] as unknown;

	/** the browser's decoder and canvas, which this pool has none of: an 800 × 600 image. */
	const drawing = () => {
		vi.stubGlobal('createImageBitmap', async (source: Blob) => {
			binary.calls.push(['createImageBitmap', source]);
			return { width: 800, height: 600, close: () => {} };
		});
		vi.stubGlobal(
			'OffscreenCanvas',
			class {
				getContext() {
					return {
						drawImage: (...args: unknown[]) => binary.calls.push(['drawImage', ...args.slice(1)])
					};
				}
				async convertToBlob(options: { type: string }) {
					return new Blob(['cropped'], { type: options.type });
				}
			}
		);
	};

	beforeEach(drawing);

	it('crops the chosen photo to the posted square, resizes it and uploads it, then reads the deployment again', async () => {
		const drawn = new Blob(['resized'], { type: 'image/webp' });
		binary.resized = { ok: true, blob: drawn, width: 400, height: 400 };
		binary.answer = LOGO_SAVED;
		const router = await open();
		try {
			const before = binary.shellReads;
			await putting(router, choosing(photo()));

			expect(binary.calls.map(([name]) => name)).toEqual([
				'createImageBitmap',
				'drawImage',
				'resizeImage',
				'uploadOrgLogo'
			]);
			const opened = binary.calls[0]?.[1];
			expect(opened).toBeInstanceOf(File);
			expect(await (opened as File).text()).toBe('raw photo');
			expect(binary.calls[1]).toEqual(['drawImage', 40, 0, 400, 400, 0, 0, 400, 400]);
			const resizedFrom = binary.calls[2]?.[1];
			expect(resizedFrom).toBeInstanceOf(File);
			expect(await (resizedFrom as File).text()).toBe('cropped');
			expect(binary.calls[3]?.[1]).toBe(drawn);
			expect(answered(router)).toEqual({ write: LOGO_SAVED, press: 'logo' });
			expect(binary.shellReads).toBe(before + 1);
		} finally {
			router.dispose();
		}
	});

	it('crops the stored logo to the posted square and uploads it as the new one', async () => {
		const drawn = new Blob(['resized'], { type: 'image/webp' });
		binary.stored = new Blob(['stored webp'], { type: 'image/webp' });
		binary.resized = { ok: true, blob: drawn, width: 400, height: 400 };
		binary.answer = LOGO_SAVED;
		const router = await open();
		try {
			await saved(router, recropping());

			expect(binary.calls.map(([name]) => name)).toEqual([
				'readOrgLogo',
				'createImageBitmap',
				'drawImage',
				'resizeImage',
				'uploadOrgLogo'
			]);
			expect(binary.calls[1]?.[1]).toBe(binary.stored);
			expect(binary.calls[2]).toEqual(['drawImage', 100, 0, 400, 400, 0, 0, 400, 400]);
			expect(binary.calls[4]?.[1]).toBe(drawn);
			expect(answered(router)).toEqual({ write: LOGO_SAVED, press: 'logo' });
		} finally {
			router.dispose();
		}
	});

	it.each([LOGO_CROP_X, LOGO_CROP_Y, LOGO_CROP_SIZE])(
		'refuses a press whose square arrived without %s at the logo, and reads nothing',
		async (missing) => {
			const posted = choosing(photo());
			posted.delete(missing);

			expect(await acting(posted)).toEqual({
				press: 'logo',
				write: logoRefusal(LOGO_REFUSED['no-crop'])
			});
			expect(binary.calls).toEqual([]);
		}
	);

	it('refuses a press posting a width where its square side should be, as no square', async () => {
		// a side is the one shape the boxes take: a rectangle has no box to arrive in.
		const posted = recropping();
		posted.delete(LOGO_CROP_SIZE);
		posted.set('crop_width', '400');
		posted.set('crop_height', '300');

		expect(await acting(posted)).toEqual({
			press: 'logo',
			write: logoRefusal(LOGO_REFUSED['no-crop'])
		});
		expect(binary.calls).toEqual([]);
	});

	it('refuses a press that named neither a file nor the stored logo', async () => {
		const posted = choosing(photo());
		posted.delete(LOGO_SOURCE);

		expect(await acting(posted)).toEqual({
			press: 'logo',
			write: logoRefusal(LOGO_REFUSED['no-source'])
		});
		expect(binary.calls).toEqual([]);
	});

	it('answers a cropped photo the resize turned down as a refusal at the logo, and uploads nothing', async () => {
		binary.resized = { ok: false, reason: 'too-large-after-resize' };

		expect(await acting(choosing(photo()))).toEqual({
			press: 'logo',
			write: logoRefusal('That image is too large even after resizing. Choose a smaller one.')
		});
		expect(binary.calls.map(([name]) => name)).not.toContain('uploadOrgLogo');
	});

	it('uploads nothing for a press the router abandoned while the photo was resizing', async () => {
		binary.resized = { ok: true, blob: new Blob(['resized']), width: 400, height: 400 };
		const leaving = new AbortController();
		binary.whileResizing = () => leaving.abort();

		await expect(acting(choosing(photo()), leaving.signal)).rejects.toMatchObject({
			name: 'AbortError'
		});
		expect(binary.calls.map(([name]) => name)).not.toContain('uploadOrgLogo');
	});

	it('takes the logo off and reads the deployment again', async () => {
		binary.answer = { kind: 'saved', org: { ...STORED, social_links: [], logo: null } };
		const router = await open();
		try {
			const before = binary.shellReads;
			await saved(router, pressing(ORG_LOGO_REMOVE_INTENT));

			expect(binary.calls.map(([name]) => name)).toEqual(['removeOrgLogo']);
			expect(router.state.actionData?.[PAGE_ID]).toMatchObject({ press: 'logo' });
			expect(binary.shellReads).toBe(before + 1);
		} finally {
			router.dispose();
		}
	});
});
