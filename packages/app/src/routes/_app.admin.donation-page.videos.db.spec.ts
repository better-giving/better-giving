import { eq } from 'drizzle-orm';
import { createStaticHandler, type LoaderFunction, type MiddlewareFunction } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { VIDEO_REFUSALS } from '$lib/page/videos';
import { createDb, type Db } from '$lib/server/db/client';
import { client, stmt } from '$lib/server/db/database.testing';
import { page } from '$lib/server/db/schema';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { jpegHeader } from '$lib/server/images/headers.testing';
import { stored } from '$lib/server/images/image.testing';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { finishedDeployment } from '../page-routes.testing';
import { ORIGIN, signIn } from '../program-routes.testing';
import { requestContext } from '../request-context';
import { mountRoutes, queryDocument, type RouteRequester } from '../route-request.testing';
import type { Route as DonateRoute } from './+types/donate';
import * as layout from './_app';
import * as editor from './_app.admin.donation-page';
import * as donatePage from './donate';

// the Videos card on the Donation page's edit page: Add video, Move up, Move down and Remove,
// through the protected layout, against a real database, with `fetch` to YouTube stubbed — no case
// here reaches YouTube (AGENTS.md → Tests).

const EDITOR = '/admin/donation-page';
const RENT = 'dQw4w9WgXcQ';
const FOOD = '9bZkp7q19f0';
const POSTER = jpegHeader(1280, 720);

let db: Db;
let request: RouteRequester;
let session: string;
let bindings: Env;

beforeAll(async () => {
	db = createDb(client);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/donation-page', module: editor }
	]);
	session = await signIn(db);
});

beforeEach(async () => {
	await client.batch([stmt('delete from page'), stmt('delete from form')]);
	bindings = { ...(await finishedDeployment()), STRIPE_WEBHOOK_SECRET: 'whsec_spec' };
	await edgeCache().put(
		new Request(`${ORIGIN}/__offered-rails`),
		new Response(JSON.stringify(['card']), {
			headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

type Drawn = {
	version: number;
	hasEdits: boolean;
	seeds: {
		videos: {
			videos: {
				videoId: string;
				title: string;
				durationSeconds: number | null;
				posterUrl: string;
			}[];
			count: number;
			cap: number;
		};
	};
};

async function open(): Promise<Drawn> {
	const response = await request(
		new Request(`${ORIGIN}${EDITOR}`, { headers: { cookie: session } }),
		{ env: bindings }
	);
	expect(response.status).toBe(200);
	return response.json();
}

async function post(which: string, fields: Record<string, string> = {}) {
	const body = new FormData();
	body.set(WHICH_FORM, which);
	body.set(RECORD_VERSION, String((await open()).version));
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	return request(
		new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
		{ env: bindings }
	);
}

/** the sentence a refused press carries under `box`, `''` for the form's own. */
async function refusedUnder(response: Response, box: string): Promise<unknown> {
	const answer = (await response.json()) as {
		form?: { result?: { error?: Record<string, string[]> } };
	};
	return answer.form?.result?.error?.[box];
}

async function donationPage() {
	const [row] = await db.select().from(page).where(eq(page.type, 'donation_page'));
	if (row === undefined) throw new Error('the edit page made no Donation page');
	return row;
}

/** the videos the stored `column` holds. */
async function storedVideos(column: 'draft' | 'published') {
	const row = await donationPage();
	const document = JSON.parse(row[column] ?? '{}') as {
		videos?: { videoId: string; posterImageId: string }[];
	};
	return document.videos ?? [];
}

/**
 * YouTube, answering every fixed address for any video with `title` and the poster, and
 * remembering each request. `oembed` and `poster` make the answer in their place, fresh each time.
 */
function youtube(
	options: { title?: string; oembed?: () => Response | Error; poster?: () => Response } = {}
) {
	const calls: URL[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL | Request) => {
			const url = new URL(String(input));
			calls.push(url);
			if (url.pathname === '/oembed') {
				const answer = options.oembed?.() ?? Response.json({ title: options.title ?? 'A video' });
				if (answer instanceof Error) throw answer;
				return answer;
			}
			if (url.hostname === 'i.ytimg.com') {
				return options.poster?.() ?? new Response(new Uint8Array(POSTER));
			}
			if (url.hostname === 'www.googleapis.com') {
				return Response.json({ items: [{ contentDetails: { duration: 'PT3M42S' } }] });
			}
			throw new Error(`unscripted request to ${url.origin}`);
		})
	);
	return calls;
}

const add = (link: string) => post('donation-page-video-add', { video_link: link });

describe('Add video', () => {
	it('adds the video to the draft with its title and poster, and lists it on the card', async () => {
		youtube({ title: 'How a rent grant works' });

		const added = await add(`https://youtu.be/${RENT}`);

		expect(added.status).toBe(200);
		expect(await added.json()).toEqual({ saved: 'donation-page-video-add', videoId: RENT });
		const [video] = await storedVideos('draft');
		expect(video).toEqual({
			videoId: RENT,
			title: 'How a rent grant works',
			durationSeconds: null,
			posterImageId: expect.any(String)
		});
		expect(await stored(db, video?.posterImageId ?? '')).toEqual({ row: true, bytes: true });
		expect((await open()).seeds.videos).toEqual({
			videos: [
				{
					videoId: RENT,
					title: 'How a rent grant works',
					durationSeconds: null,
					posterUrl: `/image/${video?.posterImageId}`
				}
			],
			count: 1,
			cap: 6
		});
	});

	it('adds each new video after the last', async () => {
		youtube();
		await add(`https://www.youtube.com/watch?v=${RENT}`);
		await add(`https://www.youtube.com/shorts/${FOOD}`);

		expect(await storedVideos('draft')).toMatchObject([{ videoId: RENT }, { videoId: FOOD }]);
	});

	it('reads the length where the deployment holds a YouTube Data API key', async () => {
		youtube();
		bindings = { ...bindings, YOUTUBE_API_KEY: 'AIza-spec-key' };

		await add(`https://youtu.be/${RENT}`);

		expect(await storedVideos('draft')).toMatchObject([{ durationSeconds: 222 }]);
	});

	it('refuses a link that is not YouTube, before asking YouTube anything', async () => {
		const calls = youtube();

		const refused = await add('https://vimeo.com/76979871');

		expect(refused.status).toBe(400);
		expect(await refusedUnder(refused, 'video_link')).toEqual([VIDEO_REFUSALS.notYouTube]);
		expect(calls).toEqual([]);
	});

	it('refuses a playlist as not a video', async () => {
		const calls = youtube();

		const refused = await add('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdm');

		expect(await refusedUnder(refused, 'video_link')).toEqual([VIDEO_REFUSALS.notYouTube]);
		expect(calls).toEqual([]);
	});

	it('refuses a video already on the page, whatever the link’s shape, before asking YouTube', async () => {
		youtube();
		await add(`https://youtu.be/${RENT}`);
		const calls = youtube();

		const refused = await add(`https://m.youtube.com/embed/${RENT}?start=3`);

		expect(refused.status).toBe(409);
		expect(await refusedUnder(refused, 'video_link')).toEqual([VIDEO_REFUSALS.alreadyAdded]);
		expect(calls).toEqual([]);
		expect(await storedVideos('draft')).toHaveLength(1);
	});

	it('refuses a seventh video, before asking YouTube', async () => {
		youtube();
		for (const id of [
			'aaaaaaaaaa1',
			'aaaaaaaaaa2',
			'aaaaaaaaaa3',
			'aaaaaaaaaa4',
			'aaaaaaaaaa5',
			'aaaaaaaaaa6'
		]) {
			expect((await add(`https://youtu.be/${id}`)).status).toBe(200);
		}
		const calls = youtube();

		const refused = await add(`https://youtu.be/${RENT}`);

		expect(refused.status).toBe(422);
		expect(await refusedUnder(refused, 'video_link')).toEqual([VIDEO_REFUSALS.atCap]);
		expect(calls).toEqual([]);
		expect((await open()).seeds.videos).toMatchObject({ count: 6, cap: 6 });
	});

	it.each([401, 403, 404])(
		'refuses a video YouTube answers %i for as not found, storing nothing',
		async (status) => {
			youtube({ oembed: () => new Response('', { status }) });
			const images = await imageCount();

			const refused = await add(`https://youtu.be/${RENT}`);

			expect(refused.status).toBe(422);
			expect(await refusedUnder(refused, 'video_link')).toEqual([VIDEO_REFUSALS.notFound]);
			expect(await storedVideos('draft')).toEqual([]);
			expect(await imageCount()).toBe(images);
		}
	);

	it.each<[string, Parameters<typeof youtube>[0]]>([
		['YouTube cannot be reached', { oembed: () => new TypeError('fetch failed') }],
		['YouTube fails', { oembed: () => new Response('', { status: 503 }) }],
		['the poster fails', { poster: () => new Response('', { status: 500 }) }],
		['the poster is not an image', { poster: () => new Response('<html>not a jpeg</html>') }]
	])('refuses as unreachable where %s, storing nothing', async (_, options) => {
		youtube(options);
		const images = await imageCount();

		const refused = await add(`https://youtu.be/${RENT}`);

		expect(refused.status).toBe(500);
		expect(await refusedUnder(refused, 'video_link')).toEqual([VIDEO_REFUSALS.unreachable]);
		expect(await storedVideos('draft')).toEqual([]);
		expect(await imageCount()).toBe(images);
	});
});

async function imageCount(): Promise<number> {
	const counted = await client.execute('select count(*) as n from image');
	return Number(counted.rows[0]?.n);
}

/** the draft holding `ids`' videos in that order, each added through the card. */
async function added(...ids: string[]) {
	youtube();
	for (const id of ids) expect((await add(`https://youtu.be/${id}`)).status).toBe(200);
	return storedVideos('draft');
}

const order = async () => (await storedVideos('draft')).map((video) => video.videoId);
const move = (videoId: string, direction: string) =>
	post('donation-page-video-move', { video_id: videoId, direction });
const remove = (videoId: string) => post('donation-page-video-remove', { video_id: videoId });

describe('Move up and Move down', () => {
	it('moves a video one place, writing the draft at once and saying where it stands', async () => {
		await added(RENT, FOOD, 'aaaaaaaaaa3');

		const moved = await move('aaaaaaaaaa3', 'up');

		expect(moved.status).toBe(200);
		expect(await moved.json()).toEqual({
			saved: 'donation-page-video-move',
			videoId: 'aaaaaaaaaa3',
			position: 2,
			count: 3
		});
		expect(await order()).toEqual([RENT, 'aaaaaaaaaa3', FOOD]);
		await move(RENT, 'down');
		expect(await order()).toEqual(['aaaaaaaaaa3', RENT, FOOD]);
	});

	it('moves nothing past either end, and writes nothing', async () => {
		await added(RENT, FOOD);
		const before = await donationPage();

		const up = await move(RENT, 'up');
		const down = await move(FOOD, 'down');

		expect(await up.json()).toMatchObject({ position: 1, count: 2 });
		expect(await down.json()).toMatchObject({ position: 2, count: 2 });
		expect(await order()).toEqual([RENT, FOOD]);
		expect((await donationPage()).updatedAt).toEqual(before.updatedAt);
	});

	it('takes a second press drawn before the first landed, rather than refusing it as stale', async () => {
		await added(RENT, FOOD, 'aaaaaaaaaa3');
		const drawn = (await open()).version;
		const press = () => {
			const body = new FormData();
			body.set(WHICH_FORM, 'donation-page-video-move');
			body.set(RECORD_VERSION, String(drawn));
			body.set('video_id', 'aaaaaaaaaa3');
			body.set('direction', 'up');
			return request(
				new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
				{ env: bindings }
			);
		};

		expect((await press()).status).toBe(200);
		expect((await press()).status).toBe(200);
		expect(await order()).toEqual(['aaaaaaaaaa3', RENT, FOOD]);
	});

	it('refuses a video no longer on the page', async () => {
		await added(RENT);

		const refused = await move(FOOD, 'up');

		expect(refused.status).toBe(404);
		expect(await refusedUnder(refused, '')).toEqual([VIDEO_REFUSALS.gone]);
	});

	it('refuses a direction that is neither up nor down', async () => {
		await added(RENT);

		expect((await move(RENT, 'sideways')).status).toBe(400);
	});
});

describe('Remove', () => {
	it('takes the video off the draft and frees a poster nothing else names', async () => {
		const [rent, food] = await added(RENT, FOOD);

		const removed = await remove(RENT);

		expect(removed.status).toBe(200);
		expect(await removed.json()).toEqual({ saved: 'donation-page-video-remove', videoId: RENT });
		expect(await order()).toEqual([FOOD]);
		expect(await stored(db, rent?.posterImageId ?? '')).toEqual({ row: false, bytes: false });
		expect(await stored(db, food?.posterImageId ?? '')).toEqual({ row: true, bytes: true });
	});

	it('keeps a published video’s poster while the live page or Undo publish can show it', async () => {
		const [rent] = await added(RENT);
		await post('page-publish');

		await remove(RENT);
		expect(await stored(db, rent?.posterImageId ?? '')).toEqual({ row: true, bytes: true });
		await post('page-publish');

		expect(await storedVideos('published')).toEqual([]);
		expect(await stored(db, rent?.posterImageId ?? '')).toEqual({ row: true, bytes: true });
		expect((await post('page-undo')).status).toBe(200);
		expect(await storedVideos('published')).toMatchObject([{ videoId: RENT }]);
	});

	it('answers a second Remove as the first, with nothing left to take off', async () => {
		await added(RENT);
		await remove(RENT);

		const again = await remove(RENT);

		expect(again.status).toBe(200);
		expect((await open()).seeds.videos).toEqual({ videos: [], count: 0, cap: 6 });
	});
});

describe('Reset to default', () => {
	it('is offered for videos alone, and takes them off both pages, freeing their posters', async () => {
		const [rent] = await added(RENT);
		await post('page-publish');
		expect(await open()).toMatchObject({ hasEdits: true });

		expect((await post('page-reset')).status).toBe(200);

		expect(await storedVideos('draft')).toEqual([]);
		expect(await storedVideos('published')).toEqual([]);
		expect(await stored(db, rent?.posterImageId ?? '')).toEqual({ row: false, bytes: false });
		expect(await open()).toMatchObject({ hasEdits: false });
	});
});

describe('what the editor is handed', () => {
	it('names no YouTube host: the card builds “Watch on YouTube” from the id', async () => {
		await added(RENT, FOOD);
		bindings = { ...bindings, YOUTUBE_API_KEY: 'AIza-spec-key' };

		const drawn = JSON.stringify(await open());

		expect(drawn).toContain(RENT);
		expect(drawn).not.toMatch(/youtube|youtu\.be|ytimg|googleapis/i);
		expect(drawn).not.toContain('AIza-spec-key');
	});
});

const donate = createStaticHandler([
	{
		id: 'donate',
		path: 'donate',
		middleware: donatePage.middleware as unknown as MiddlewareFunction[],
		loader: donatePage.loader as unknown as LoaderFunction
	}
]);

/** what /donate's loader hands its page, as a donor opens it. */
async function visitDonate() {
	const answered = await queryDocument(
		donate,
		new Request(`${ORIGIN}/donate`),
		requestContext({ env: bindings, deferred: createDeferredWork(), client })
	);
	expect(answered.statusCode).toBe(200);
	const data = answered.loaderData.donate as DonateRoute.ComponentProps['loaderData'];
	if (data.kind !== 'page' || data.profile === null) throw new Error(`/donate drew ${data.kind}`);
	return { data, videos: data.profile.videos };
}

describe('videos on /donate', () => {
	it('shows a video only once it is published, in the published order', async () => {
		const [rent, food] = await added(RENT, FOOD);
		expect((await visitDonate()).videos).toEqual([]);

		await post('page-publish');
		await move(FOOD, 'up');

		expect((await visitDonate()).videos).toEqual([
			{
				videoId: RENT,
				title: 'A video',
				durationSeconds: null,
				posterUrl: `/image/${rent?.posterImageId}`
			},
			{
				videoId: FOOD,
				title: 'A video',
				durationSeconds: null,
				posterUrl: `/image/${food?.posterImageId}`
			}
		]);
	});

	it('names no YouTube host anywhere in what the page is handed', async () => {
		await added(RENT, FOOD);
		await post('page-publish');

		const { data, videos } = await visitDonate();

		expect(videos).toHaveLength(2);
		expect(JSON.stringify(data)).not.toMatch(/youtube|youtu\.be|ytimg|googleapis/i);
	});
});
