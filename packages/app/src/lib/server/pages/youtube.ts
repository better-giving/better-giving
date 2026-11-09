import { z } from 'zod';
import { VIDEO_TITLE_MAX } from '../../page/catalog';
import { IMAGE_BYTES_MAX } from '../db/schema';
import { readUpTo } from '../images/intake';

// what YouTube says about one video, asked from the server when the Videos card adds it
// (./videos.ts): its title from YouTube's oEmbed endpoint (https://oembed.com, §2.3.4 and §2.3.5),
// its poster's bytes from YouTube's image host, and its length from the YouTube Data API's
// `videos.list` (https://developers.google.com/youtube/v3/docs/videos/list) where the deployment
// holds a `YOUTUBE_API_KEY`. read once and stored, so a donor's page asks YouTube for nothing.
//
// **every address is built here from the 11-character id**, never from the link that was typed or
// from an address an answer names (oEmbed's own `thumbnail_url` is not read), and no redirect is
// followed, so these requests reach the three fixed hosts and nowhere else. each has a deadline,
// and a poster is read no further than the largest image the deployment stores.
//
// **the key is a secret** (AGENTS.md → Secrets). it travels only in the Data API's query string,
// which is never logged; a failure is logged by status alone.
//
// nothing here throws. the length is the only part allowed to fail: without it a video is still
// added, with its length unknown.

/** what YouTube said: the video, or why it is no video to add. */
export type YouTubeRead =
	| {
			readonly ok: true;
			readonly title: string;
			/** null where no key is set or the Data API did not say. */
			readonly durationSeconds: number | null;
			/** the poster's bytes as served; the caller holds them to the image intake's rule. */
			readonly poster: Uint8Array;
	  }
	/**
	 * `not_found`: YouTube holds no public video under the id — private, deleted or never there.
	 * `not_embeddable`: the video is public, but its owner allows it on no other site.
	 * `unreachable`: YouTube did not answer in a way to act on, and may next time.
	 */
	| YouTubeFailure;

type YouTubeFailure = {
	readonly ok: false;
	readonly reason: 'not_found' | 'not_embeddable' | 'unreachable';
};

const OEMBED_TIMEOUT_MS = 5_000;
const POSTER_TIMEOUT_MS = 10_000;
const DATA_API_TIMEOUT_MS = 5_000;

/** oEmbed's answers for a URL with no public video behind it: unknown, private or deleted. */
const NOT_FOUND_STATUSES = new Set([400, 403, 404]);
/** oEmbed's answer for a public video whose owner turned embedding off. */
const NOT_EMBEDDABLE_STATUS = 401;

const OEMBED = z.object({ title: z.string().trim().min(1) });
const CONTENT_DETAILS = z.object({
	items: z.array(z.object({ contentDetails: z.object({ duration: z.string() }) }))
});

/** the posters YouTube serves for every video, the full-size first; not every video has one. */
const POSTERS = ['maxresdefault.jpg', 'hqdefault.jpg'] as const;

type Fetched = { readonly ok: true; readonly response: Response } | { readonly ok: false };

/** `url` fetched under the module's rules, or not ok where the request itself failed. */
async function ask(url: URL, timeoutMs: number, what: string): Promise<Fetched> {
	try {
		const response = await fetch(url, {
			redirect: 'error',
			signal: AbortSignal.timeout(timeoutMs)
		});
		return { ok: true, response };
	} catch (error) {
		console.warn(`YouTube's ${what} could not be reached: ${errorName(error)}`);
		return { ok: false };
	}
}

/** an error's name only: a `fetch` failure's message may carry the URL, and the URL the key. */
const errorName = (error: unknown) => (error instanceof Error ? error.name : 'unknown error');

/** the video's title, or why there is none. */
async function readTitle(videoId: string): Promise<{ ok: true; title: string } | YouTubeFailure> {
	const url = new URL('https://www.youtube.com/oembed');
	url.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`);
	url.searchParams.set('format', 'json');
	const asked = await ask(url, OEMBED_TIMEOUT_MS, 'oEmbed endpoint');
	if (!asked.ok) return { ok: false, reason: 'unreachable' };
	const { response } = asked;
	if (NOT_FOUND_STATUSES.has(response.status)) return { ok: false, reason: 'not_found' };
	if (response.status === NOT_EMBEDDABLE_STATUS) return { ok: false, reason: 'not_embeddable' };
	const read = response.ok ? OEMBED.safeParse(await response.json().catch(() => undefined)) : null;
	if (read?.success !== true) {
		console.warn(`YouTube's oEmbed endpoint answered HTTP ${response.status} with no title`);
		return { ok: false, reason: 'unreachable' };
	}
	return { ok: true, title: read.data.title.slice(0, VIDEO_TITLE_MAX) };
}

/** the video's poster bytes, the first of `POSTERS` YouTube holds, or why there are none. */
async function readPoster(
	videoId: string
): Promise<{ ok: true; bytes: Uint8Array } | YouTubeFailure> {
	for (const name of POSTERS) {
		const url = new URL(`https://i.ytimg.com/vi/${videoId}/${name}`);
		const asked = await ask(url, POSTER_TIMEOUT_MS, 'image host');
		if (!asked.ok) return { ok: false, reason: 'unreachable' };
		const { response } = asked;
		if (response.status === 404) {
			await response.body?.cancel();
			continue;
		}
		if (!response.ok) {
			await response.body?.cancel();
			console.warn(`YouTube's image host answered HTTP ${response.status} for a poster`);
			return { ok: false, reason: 'unreachable' };
		}
		let bytes: Uint8Array | null;
		try {
			bytes = await readUpTo(response.body, IMAGE_BYTES_MAX);
		} catch (error) {
			console.warn(`YouTube's image host broke off a poster: ${errorName(error)}`);
			return { ok: false, reason: 'unreachable' };
		}
		if (bytes === null) {
			console.warn(`YouTube's image host served a poster over ${IMAGE_BYTES_MAX} bytes`);
			return { ok: false, reason: 'unreachable' };
		}
		return { ok: true, bytes };
	}
	return { ok: false, reason: 'not_found' };
}

/** the video's length from the Data API, or null where there is no key or no answer to read. */
async function readDuration(videoId: string, apiKey: string | undefined): Promise<number | null> {
	const key = apiKey?.trim() ?? '';
	if (key === '') return null;
	const url = new URL('https://www.googleapis.com/youtube/v3/videos');
	url.searchParams.set('part', 'contentDetails');
	url.searchParams.set('id', videoId);
	url.searchParams.set('key', key);
	const asked = await ask(url, DATA_API_TIMEOUT_MS, 'Data API');
	if (!asked.ok) return null;
	const { response } = asked;
	if (!response.ok) {
		await response.body?.cancel();
		console.warn(`YouTube's Data API answered HTTP ${response.status}; the length is unknown`);
		return null;
	}
	const read = CONTENT_DETAILS.safeParse(await response.json().catch(() => undefined));
	const duration = read.success ? read.data.items[0]?.contentDetails.duration : undefined;
	return duration === undefined ? null : isoDurationSeconds(duration);
}

/** what YouTube says about the video `videoId`, one of `YOUTUBE_VIDEO_ID`'s ids. */
export async function readYouTubeVideo(
	videoId: string,
	apiKey: string | undefined
): Promise<YouTubeRead> {
	const title = await readTitle(videoId);
	if (!title.ok) return title;
	const [poster, durationSeconds] = await Promise.all([
		readPoster(videoId),
		readDuration(videoId, apiKey)
	]);
	if (!poster.ok) return poster;
	return { ok: true, title: title.title, durationSeconds, poster: poster.bytes };
}

/** days, hours, minutes and seconds in whole numbers; years, months, weeks and fractions are no length. */
const DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/**
 * a video's length in seconds from the ISO 8601 duration YouTube's Data API states it in
 * (`contentDetails.duration`, https://developers.google.com/youtube/v3/docs/videos), or null where
 * it states none: an unreadable value, or zero, which is what a live stream reports.
 */
export function isoDurationSeconds(iso: string): number | null {
	const parts = DURATION.exec(iso);
	if (parts === null || iso.endsWith('T')) return null;
	const [days, hours, minutes, seconds] = parts.slice(1).map((part) => Number(part ?? 0));
	const total = (days ?? 0) * 86_400 + (hours ?? 0) * 3_600 + (minutes ?? 0) * 60 + (seconds ?? 0);
	return total > 0 ? total : null;
}
