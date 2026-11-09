import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_BYTES_MAX } from '../db/schema';
import { jpegHeader } from '../images/headers.testing';
import { isoDurationSeconds, readYouTubeVideo } from './youtube';

// what YouTube says about a video, asked from the server when the Videos card adds one, with
// `fetch` stubbed: no spec here reaches YouTube.

const ID = 'dQw4w9WgXcQ';
const KEY = 'AIza-spec-key';
const POSTER = jpegHeader(1280, 720);

type Answer = Response | Error;
type Script = Partial<Record<'oembed' | 'maxres' | 'hq' | 'data', Answer>>;

/** which of the four fixed addresses a request is, or null for any other. */
function addressed(url: URL): keyof Script | null {
	if (url.origin === 'https://www.youtube.com' && url.pathname === '/oembed') return 'oembed';
	if (url.href === `https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`) return 'maxres';
	if (url.href === `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`) return 'hq';
	if (url.origin === 'https://www.googleapis.com' && url.pathname === '/youtube/v3/videos') {
		return 'data';
	}
	return null;
}

/**
 * a `fetch` answering each fixed address from `script`, and remembering every request. an address
 * the script leaves out, or one outside the four, throws, which the adapter reads as unreachable.
 */
function youtube(script: Script) {
	const calls: { url: URL; init: RequestInit | undefined }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input));
			calls.push({ url, init });
			const which = addressed(url);
			const answer = which === null ? undefined : script[which];
			if (answer === undefined) throw new Error(`unscripted request to ${url.origin}`);
			if (answer instanceof Error) throw answer;
			return answer;
		})
	);
	return calls;
}

const oembed = (title = 'How a rent grant works') =>
	Response.json({ type: 'video', version: '1.0', title, thumbnail_url: 'https://evil.test/x.jpg' });
const jpeg = (bytes: Uint8Array = POSTER) =>
	new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/jpeg' } });
const status = (code: number) => new Response('', { status: code });
const durations = (...iso: string[]) =>
	Response.json({ items: iso.map((duration) => ({ id: ID, contentDetails: { duration } })) });

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('readYouTubeVideo()', () => {
	it('reads the title from oEmbed and the poster from YouTube’s own image host', async () => {
		const calls = youtube({ oembed: oembed(), maxres: jpeg() });

		const read = await readYouTubeVideo(ID, undefined);

		expect(read).toEqual({
			ok: true,
			title: 'How a rent grant works',
			durationSeconds: null,
			poster: POSTER
		});
		const asked = new URL(calls[0]?.url ?? '');
		expect(asked.searchParams.get('url')).toBe(`https://www.youtube.com/watch?v=${ID}`);
		expect(asked.searchParams.get('format')).toBe('json');
		// the thumbnail address oEmbed names is never fetched: only addresses built from the id.
		expect(calls.map(({ url }) => addressed(url))).toEqual(['oembed', 'maxres']);
	});

	it('follows no redirect and gives every request a deadline', async () => {
		const calls = youtube({ oembed: oembed(), maxres: jpeg(), data: durations('PT3M42S') });

		await readYouTubeVideo(ID, KEY);

		expect(calls).toHaveLength(3);
		for (const { init } of calls) {
			expect(init?.redirect).toBe('error');
			expect(init?.signal).toBeInstanceOf(AbortSignal);
		}
	});

	it('takes the smaller poster where the video has no full-size one', async () => {
		const calls = youtube({
			oembed: oembed(),
			maxres: status(404),
			hq: jpeg(jpegHeader(480, 360))
		});

		expect(await readYouTubeVideo(ID, undefined)).toMatchObject({
			ok: true,
			poster: jpegHeader(480, 360)
		});
		expect(calls.map(({ url }) => addressed(url))).toEqual(['oembed', 'maxres', 'hq']);
	});

	it('finds the video not embeddable where oEmbed answers 401, and asks for no poster', async () => {
		const calls = youtube({ oembed: status(401) });

		expect(await readYouTubeVideo(ID, KEY)).toEqual({ ok: false, reason: 'not_embeddable' });
		expect(calls).toHaveLength(1);
	});

	it.each([400, 403, 404])(
		'finds no public video where oEmbed answers %i, and asks for no poster',
		async (code) => {
			const calls = youtube({ oembed: status(code) });

			expect(await readYouTubeVideo(ID, KEY)).toEqual({ ok: false, reason: 'not_found' });
			expect(calls).toHaveLength(1);
		}
	);

	it('finds no video where YouTube holds no poster for it', async () => {
		youtube({ oembed: oembed(), maxres: status(404), hq: status(404) });

		expect(await readYouTubeVideo(ID, undefined)).toEqual({ ok: false, reason: 'not_found' });
	});

	it.each<[string, Script]>([
		['oEmbed fails', { oembed: status(503) }],
		['oEmbed is rate limited', { oembed: status(429) }],
		['oEmbed cannot be reached', { oembed: new TypeError('fetch failed') }],
		['oEmbed times out', { oembed: new DOMException('timed out', 'TimeoutError') }],
		['oEmbed answers no title', { oembed: Response.json({ type: 'video' }) }],
		['oEmbed answers no JSON', { oembed: new Response('<html>') }],
		['the poster fails', { oembed: oembed(), maxres: status(500) }],
		['the poster cannot be reached', { oembed: oembed(), maxres: new TypeError('fetch failed') }],
		['the smaller poster fails', { oembed: oembed(), maxres: status(404), hq: status(502) }]
	])('cannot reach YouTube where %s', async (_, script) => {
		youtube(script);

		expect(await readYouTubeVideo(ID, undefined)).toEqual({ ok: false, reason: 'unreachable' });
	});

	it('stops reading a poster past the largest image the deployment stores', async () => {
		const huge = new Uint8Array(IMAGE_BYTES_MAX + 1);
		huge.set(POSTER);
		youtube({ oembed: oembed(), maxres: jpeg(huge) });

		expect(await readYouTubeVideo(ID, undefined)).toEqual({ ok: false, reason: 'unreachable' });
	});

	it('cuts a title past what a page stores', async () => {
		youtube({ oembed: oembed(`  ${'x'.repeat(250)}  `), maxres: jpeg() });

		const read = await readYouTubeVideo(ID, undefined);

		expect(read.ok && read.title).toBe('x'.repeat(200));
	});

	describe('the length, with a YouTube Data API key', () => {
		it('reads it from the video’s content details, sending the key to the Data API alone', async () => {
			const calls = youtube({ oembed: oembed(), maxres: jpeg(), data: durations('PT3M42S') });

			expect(await readYouTubeVideo(ID, KEY)).toMatchObject({ ok: true, durationSeconds: 222 });
			const data = calls.find(({ url }) => addressed(url) === 'data')?.url;
			expect(data?.searchParams.get('part')).toBe('contentDetails');
			expect(data?.searchParams.get('id')).toBe(ID);
			expect(data?.searchParams.get('key')).toBe(KEY);
			const elsewhere = calls.filter(({ url }) => addressed(url) !== 'data');
			expect(elsewhere.map(({ url }) => url.href).join(' ')).not.toContain(KEY);
		});

		it.each<[string, Answer]>([
			['the key is refused', status(403)],
			['the API fails', status(500)],
			['the API cannot be reached', new TypeError('fetch failed')],
			['the API names no such video', durations()],
			['the length is unreadable', durations('soon')],
			['the body is not JSON', new Response('<html>')]
		])('is unknown where %s, and the video is still read', async (_, data) => {
			youtube({ oembed: oembed(), maxres: jpeg(), data });

			expect(await readYouTubeVideo(ID, KEY)).toMatchObject({ ok: true, durationSeconds: null });
		});

		it.each<[string, Answer]>([
			[
				'the API cannot be reached',
				new TypeError(`fetch failed for https://www.googleapis.com/youtube/v3/videos?key=${KEY}`)
			],
			['the key is refused', status(403)]
		])('logs nothing of the key where %s', async (_, data) => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			youtube({ oembed: oembed(), maxres: jpeg(), data });

			await readYouTubeVideo(ID, KEY);

			// the warning is written, so an empty log would be a broken spy rather than a safe one.
			expect(warn).toHaveBeenCalledTimes(1);
			expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
		});

		it('is not asked for where the key is blank', async () => {
			const calls = youtube({ oembed: oembed(), maxres: jpeg() });

			expect(await readYouTubeVideo(ID, '  ')).toMatchObject({ ok: true, durationSeconds: null });
			expect(calls.map(({ url }) => addressed(url))).toEqual(['oembed', 'maxres']);
		});
	});
});

describe('isoDurationSeconds()', () => {
	it.each([
		['PT15M33S', 933],
		['PT45S', 45],
		['PT4M', 240],
		['PT1H2M3S', 3723],
		['PT2H', 7200],
		['PT1H5S', 3605],
		['P1DT2H3M4S', 93_784],
		['P2D', 172_800]
	])('reads %s as %i seconds', (iso, seconds) => {
		expect(isoDurationSeconds(iso)).toBe(seconds);
	});

	it.each([
		['a live stream’s zero length', 'P0D'],
		['zero seconds', 'PT0S'],
		['a period with no parts', 'PT'],
		['no period at all', 'P'],
		['months, which have no fixed length', 'P1M'],
		['a fraction', 'PT1.5S'],
		['a bare number', '933'],
		['words', 'fifteen minutes'],
		['nothing', '']
	])('reads %s as no length', (_, iso) => {
		expect(isoDurationSeconds(iso)).toBeNull();
	});
});
