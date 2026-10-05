import { LONG_SIDE_MAX } from '@better-giving/operator/images/resize';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoReport, OrgWrite } from '../api/types';
import type { LogoPress } from './org-fields';

// the logo press's crop: which square of which image is drawn, handed to the resize and uploaded,
// and every square or image it turns down at the logo instead. the binary is replaced at the
// client, the resize at its module, and the browser's decoder and canvas — which this pool has none
// of — at the two globals the crop draws with.

const seen = vi.hoisted(() => ({
	/** each call made of the binary, the resize and the canvas, in order, with what it was handed. */
	calls: [] as [string, ...unknown[]][],
	/** the size the decoder reports for whatever it is handed. */
	decoded: { width: 800, height: 600 } as { width: number; height: number } | 'fails',
	/** the stored logo the binary answers, none, or why it could not read one. */
	stored: null as Blob | null | NoReport,
	/** what the resize answers. */
	resized: null as unknown,
	/** what happens while the resize runs. */
	whileResizing: null as (() => void) | null
}));

const UPLOADED: OrgWrite = {
	kind: 'saved',
	org: {
		legal_name: 'Riverbank Trust',
		social_links: [],
		logo: { id: 'img_2', url: 'https://a.example/image/img_2' }
	} as never
};

vi.mock(import('../api/client'), async (original) => ({
	...(await original()),
	uploadOrgLogo: async (file: Blob) => {
		seen.calls.push(['uploadOrgLogo', file]);
		return UPLOADED;
	},
	readOrgLogo: async (pressed: AbortSignal) => {
		seen.calls.push(['readOrgLogo', pressed]);
		return seen.stored;
	}
}));

vi.mock(import('@better-giving/operator/images/resize'), async (original) => ({
	...(await original()),
	resizeImage: async (file: File) => {
		seen.calls.push(['resizeImage', file]);
		seen.whileResizing?.();
		return seen.resized as never;
	}
}));

const { putLogo, LOGO_CROP_MIN, LOGO_REFUSED } = await import('./org-logo');

/** the decoder: an image of the size the case sets, or a file it cannot open. */
function decoder() {
	return async (source: Blob, options: unknown) => {
		seen.calls.push(['createImageBitmap', source, options]);
		if (seen.decoded === 'fails') throw new DOMException('cannot decode', 'InvalidStateError');
		const { width, height } = seen.decoded;
		return { width, height, close: () => seen.calls.push(['close']) };
	};
}

/** the canvas: records what it is drawn at and what is drawn on it, and encodes a marker. */
class Canvas {
	constructor(width: number, height: number) {
		seen.calls.push(['canvas', width, height]);
	}
	getContext() {
		return {
			drawImage: (...args: unknown[]) => seen.calls.push(['drawImage', ...args.slice(1)])
		};
	}
	async convertToBlob(options: { type: string }) {
		seen.calls.push(['convertToBlob', options]);
		return new Blob(['cropped'], { type: options.type });
	}
}

const RESIZED = new Blob(['resized'], { type: 'image/webp' });

beforeEach(() => {
	seen.calls = [];
	seen.decoded = { width: 800, height: 600 };
	seen.stored = null;
	seen.resized = { ok: true, blob: RESIZED, width: 320, height: 320 };
	seen.whileResizing = null;
	vi.stubGlobal('createImageBitmap', decoder());
	vi.stubGlobal('OffscreenCanvas', Canvas);
});

const photo = (type = 'image/jpeg') => new File(['raw photo'], 'logo.jpg', { type });

const choosing = (file: FormDataEntryValue | null, crop: LogoPress['crop']): LogoPress => ({
	source: { from: 'file', file },
	crop
});

const pressing = () => new AbortController().signal;

/** a refusal at the logo, in the shape the fold draws. */
const refusal = (sentence: string): OrgWrite => ({
	kind: 'refused',
	message: null,
	fix: null,
	errors: { logo: sentence },
	unread: 0
});

const called = () => seen.calls.map(([name]) => name);

describe('a logo cropped from the photo the operator chose', () => {
	it('draws the square onto a canvas its own size, resizes that drawing and uploads the result', async () => {
		const chosen = photo();

		await expect(
			putLogo(choosing(chosen, { x: 120, y: 40, size: 480 }), pressing())
		).resolves.toEqual(UPLOADED);

		const decoded = seen.calls.find(([name]) => name === 'createImageBitmap');
		expect(decoded?.[1]).toBe(chosen);
		// decoded the right way up, which is the size an <img> of it reports to the dialog.
		expect(decoded?.[2]).toEqual({ imageOrientation: 'from-image' });
		expect(seen.calls.find(([name]) => name === 'canvas')).toEqual(['canvas', 480, 480]);
		expect(seen.calls.find(([name]) => name === 'drawImage')).toEqual([
			'drawImage',
			120,
			40,
			480,
			480,
			0,
			0,
			480,
			480
		]);
		const handed = seen.calls.find(([name]) => name === 'resizeImage')?.[1];
		expect(handed).toBeInstanceOf(File);
		expect((handed as File).type).toBe('image/png');
		expect(await (handed as File).text()).toBe('cropped');
		expect(seen.calls.at(-1)).toEqual(['uploadOrgLogo', RESIZED]);
	});

	it('draws a square wider than the resize keeps at the side the resize keeps', async () => {
		// a camera's full-height square is a canvas some browsers will not hold, and the resize
		// would draw it down to this side anyway.
		seen.decoded = { width: 6000, height: 4000 };

		await putLogo(choosing(photo(), { x: 1000, y: 0, size: 4000 }), pressing());

		expect(seen.calls.find(([name]) => name === 'canvas')).toEqual([
			'canvas',
			LONG_SIDE_MAX,
			LONG_SIDE_MAX
		]);
		expect(seen.calls.find(([name]) => name === 'drawImage')).toEqual([
			'drawImage',
			1000,
			0,
			4000,
			4000,
			0,
			0,
			LONG_SIDE_MAX,
			LONG_SIDE_MAX
		]);
	});
});

describe('a square the crop turns down at the logo', () => {
	it('refuses a press that posted no square, and opens nothing', async () => {
		await expect(putLogo(choosing(photo(), null), pressing())).resolves.toEqual(
			refusal(LOGO_REFUSED['no-crop'])
		);
		expect(called()).toEqual([]);
	});

	it('refuses a square under the smallest side, and opens nothing', async () => {
		const crop = { x: 0, y: 0, size: LOGO_CROP_MIN - 1 };

		await expect(putLogo(choosing(photo(), crop), pressing())).resolves.toEqual(
			refusal(LOGO_REFUSED['crop-too-small'])
		);
		expect(called()).toEqual([]);
	});

	it('takes a square exactly the smallest side', async () => {
		const crop = { x: 0, y: 0, size: LOGO_CROP_MIN };

		await expect(putLogo(choosing(photo(), crop), pressing())).resolves.toEqual(UPLOADED);
	});

	it.each([
		['left', { x: -1, y: 0, size: 400 }],
		['top', { x: 0, y: -1, size: 400 }],
		['right', { x: 401, y: 0, size: 400 }],
		['bottom', { x: 0, y: 201, size: 400 }]
	])(
		'refuses a square past the %s edge of the 800 × 600 image, and uploads nothing',
		async (_, crop) => {
			await expect(putLogo(choosing(photo(), crop), pressing())).resolves.toEqual(
				refusal(LOGO_REFUSED['crop-outside'])
			);
			expect(called()).not.toContain('resizeImage');
			expect(called()).not.toContain('uploadOrgLogo');
			// the decoded image is let go on the way out.
			expect(called()).toContain('close');
		}
	);

	it('takes a square touching the right and bottom edges', async () => {
		const crop = { x: 400, y: 200, size: 400 };

		await expect(putLogo(choosing(photo(), crop), pressing())).resolves.toEqual(UPLOADED);
	});
});

describe('an image the crop turns down at the logo', () => {
	it('refuses a press that named no image', async () => {
		const press: LogoPress = { source: null, crop: { x: 0, y: 0, size: 400 } };

		await expect(putLogo(press, pressing())).resolves.toEqual(refusal(LOGO_REFUSED['no-source']));
		expect(called()).toEqual([]);
	});

	it('refuses an entry that is not a file as no image', async () => {
		await expect(
			putLogo(choosing('logo.png', { x: 0, y: 0, size: 400 }), pressing())
		).resolves.toEqual(refusal(LOGO_REFUSED['not-an-image']));
		expect(called()).toEqual([]);
	});

	it('refuses a file typed as something other than an image before opening it', async () => {
		await expect(
			putLogo(choosing(photo('application/pdf'), { x: 0, y: 0, size: 400 }), pressing())
		).resolves.toEqual(refusal(LOGO_REFUSED['not-an-image']));
		expect(called()).toEqual([]);
	});

	it('refuses an image the browser could not open as unreadable', async () => {
		seen.decoded = 'fails';

		await expect(
			putLogo(choosing(photo(), { x: 0, y: 0, size: 400 }), pressing())
		).resolves.toEqual(refusal(LOGO_REFUSED.unreadable));
		expect(called()).not.toContain('uploadOrgLogo');
	});

	it('refuses an untyped file the browser could not open as no image', async () => {
		// some devices send a photo untyped, so one is given the chance to decode first.
		seen.decoded = 'fails';

		await expect(
			putLogo(choosing(photo(''), { x: 0, y: 0, size: 400 }), pressing())
		).resolves.toEqual(refusal(LOGO_REFUSED['not-an-image']));
	});

	it('refuses a cropped square the resize could not bring under the cap, and uploads nothing', async () => {
		seen.resized = { ok: false, reason: 'too-large-after-resize' };

		await expect(
			putLogo(choosing(photo(), { x: 0, y: 0, size: 400 }), pressing())
		).resolves.toEqual(refusal(LOGO_REFUSED['too-large-after-resize']));
		expect(called()).not.toContain('uploadOrgLogo');
	});
});

describe('a logo cropped again from the one stored', () => {
	const recropping = (crop: LogoPress['crop']): LogoPress => ({ source: { from: 'stored' }, crop });

	it('reads the stored logo back and crops those bytes the same way, then uploads them', async () => {
		seen.stored = new Blob(['stored webp'], { type: 'image/webp' });
		seen.decoded = { width: 640, height: 400 };
		const pressed = pressing();

		await expect(putLogo(recropping({ x: 100, y: 0, size: 400 }), pressed)).resolves.toEqual(
			UPLOADED
		);

		expect(seen.calls[0]).toEqual(['readOrgLogo', pressed]);
		expect(seen.calls.find(([name]) => name === 'createImageBitmap')?.[1]).toBe(seen.stored);
		expect(seen.calls.find(([name]) => name === 'drawImage')).toEqual([
			'drawImage',
			100,
			0,
			400,
			400,
			0,
			0,
			400,
			400
		]);
		expect(seen.calls.at(-1)).toEqual(['uploadOrgLogo', RESIZED]);
	});

	it('refuses where the deployment holds no logo any more, and uploads nothing', async () => {
		await expect(putLogo(recropping({ x: 0, y: 0, size: 400 }), pressing())).resolves.toEqual(
			refusal(LOGO_REFUSED['no-stored-logo'])
		);
		expect(called()).toEqual(['readOrgLogo']);
	});

	it('answers a stored logo the binary could not read as unwritten, and uploads nothing', async () => {
		const read: NoReport = { kind: 'no-session' };
		seen.stored = read;

		await expect(putLogo(recropping({ x: 0, y: 0, size: 400 }), pressing())).resolves.toEqual({
			kind: 'unwritten',
			read
		});
		expect(called()).toEqual(['readOrgLogo']);
	});

	it('refuses a square past the edge of the stored logo', async () => {
		// the edges an earlier crop took off are not there to keep.
		seen.stored = new Blob(['stored webp'], { type: 'image/webp' });
		seen.decoded = { width: 400, height: 400 };

		await expect(putLogo(recropping({ x: 100, y: 0, size: 400 }), pressing())).resolves.toEqual(
			refusal(LOGO_REFUSED['crop-outside'])
		);
		expect(called()).not.toContain('uploadOrgLogo');
	});

	it('reads nothing back for a square it refuses on its own', async () => {
		await expect(putLogo(recropping(null), pressing())).resolves.toEqual(
			refusal(LOGO_REFUSED['no-crop'])
		);
		expect(called()).toEqual([]);
	});
});

describe('a press the router abandoned', () => {
	it('throws its abort once the resize is done, and uploads nothing', async () => {
		const leaving = new AbortController();
		seen.whileResizing = () => leaving.abort();

		await expect(
			putLogo(choosing(photo(), { x: 0, y: 0, size: 400 }), leaving.signal)
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(called()).not.toContain('uploadOrgLogo');
	});
});
