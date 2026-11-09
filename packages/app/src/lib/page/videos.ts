// the Donation page's videos as the dashboard and the donor page share them: which pasted link is a
// YouTube video and its id, the Videos card's three forms and their boxes, what each refusal says,
// and a video as a page draws it. the stored entry is `video` in ./catalog.ts; the server half,
// which asks YouTube and writes the draft, is $lib/server/pages/videos.ts.
//
// a video is held by its 11-character id and nothing else from the link, so every YouTube address
// this app builds — the ones the server fetches, the player, the "Watch on YouTube" link — is built
// here from that id and never taken from what was typed.
//
// pure and not under `$lib/server/**`: a component imports every name here.
import { z } from 'zod';
import { REQUIRED } from '../forms/input-schema';
import type { Video } from './catalog';
import { imageSrc } from './image-src';

/** the videos the Donation page shows at most. */
export const VIDEOS_MAX = 6;

/** a YouTube video id: 11 characters of the URL-safe base64 alphabet. */
export const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** the hosts a pasted link may name, each holding the paths `youTubeVideoId` reads. */
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const SHORT_HOST = 'youtu.be';

/** the path heads on a YouTube host whose next segment is the video id. */
const ID_PATHS = new Set(['shorts', 'embed', 'live']);

/**
 * the video id `text` links to, or null where it is no link to one video: another host, a playlist,
 * a channel or anything else on YouTube. a link typed without its scheme is read as `https://`.
 */
export function youTubeVideoId(text: string): string | null {
	const typed = text.trim();
	let url: URL;
	try {
		url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
	const [head, next] = url.pathname.split('/').slice(1);
	let id: string | null | undefined;
	if (url.hostname === SHORT_HOST) id = head;
	else if (!YOUTUBE_HOSTS.has(url.hostname)) return null;
	else if (head === 'watch') id = url.searchParams.get('v');
	// `/embed/videoseries` is a playlist, and its 11 letters would pass for an id.
	else if (head !== undefined && ID_PATHS.has(head) && next !== 'videoseries') id = next;
	return id !== null && id !== undefined && YOUTUBE_VIDEO_ID.test(id) ? id : null;
}

/** where "Watch on YouTube" goes. */
export const youTubeWatchUrl = (videoId: string) =>
	`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

/**
 * the player's address, for the iframe a donor's press puts in the poster's place: until then the
 * donor's browser asks YouTube for nothing. the no-cookie host sets no cookie before play.
 */
export const youTubeEmbedUrl = (videoId: string) =>
	`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1`;

/** the Videos card's forms, each posting its id under `WHICH_FORM`. */
export const VIDEO_FORMS = {
	add: 'donation-page-video-add',
	move: 'donation-page-video-move',
	remove: 'donation-page-video-remove'
} as const;

export const VIDEO_FORM_IDS = [VIDEO_FORMS.add, VIDEO_FORMS.move, VIDEO_FORMS.remove] as const;
export type VideoFormId = (typeof VIDEO_FORM_IDS)[number];

/** the name each of the Videos card's boxes posts under. */
export const VIDEO_BOXES = {
	/** the pasted YouTube link, on Add video. */
	link: 'video_link',
	/** the video a move or a remove is for, by its YouTube id. */
	videoId: 'video_id',
	/** `up` or `down`, on a move. */
	direction: 'direction'
} as const;

export const VIDEO_DIRECTIONS = ['up', 'down'] as const;
export type VideoDirection = (typeof VIDEO_DIRECTIONS)[number];

/** each refusal the Videos card can be answered with, as the card shows it. */
export const VIDEO_REFUSALS = {
	notYouTube:
		'That isn’t a YouTube link. Paste the address of a video from youtube.com or youtu.be.',
	notFound:
		'We couldn’t find a public video at that link. If it’s private or was deleted, donors couldn’t watch it. Make it public or unlisted on YouTube, then add it again.',
	notEmbeddable:
		'That video’s owner doesn’t let it play on other sites, so donors couldn’t watch it here. If it’s your video, turn on Allow embedding in YouTube Studio, then add it again.',
	alreadyAdded: 'That video is already on your page.',
	atCap: `A page shows at most ${VIDEOS_MAX} videos. Remove one to add another.`,
	unreachable: 'We couldn’t reach YouTube just now. Try again in a moment.',
	gone: 'That video is no longer on your page. Reload the page.'
} as const;

/** Add video: one link, refused in the browser and again on the server where it is no video. */
export const VIDEO_ADD_INPUT = z.object({
	[VIDEO_BOXES.link]: z
		.string(REQUIRED)
		.trim()
		.min(1, REQUIRED)
		.refine((link) => youTubeVideoId(link) !== null, VIDEO_REFUSALS.notYouTube)
});

const videoIdBox = z.string(REQUIRED).regex(YOUTUBE_VIDEO_ID, VIDEO_REFUSALS.gone);

/** Move up and Move down: the video, and which way. */
export const VIDEO_MOVE_INPUT = z.object({
	[VIDEO_BOXES.videoId]: videoIdBox,
	[VIDEO_BOXES.direction]: z.enum(VIDEO_DIRECTIONS, { error: REQUIRED })
});

/** Remove: the video. */
export const VIDEO_REMOVE_INPUT = z.object({ [VIDEO_BOXES.videoId]: videoIdBox });

/** a video as a page draws it: its poster at the address this deployment serves it from. */
export type ShownVideo = {
	readonly videoId: string;
	readonly title: string;
	/** null where YouTube's length was not read; the length is then left out. */
	readonly durationSeconds: number | null;
	readonly posterUrl: string;
};

/** a document's videos as a page draws them, in its order. */
export function shownVideos(videos: readonly Video[] | undefined): ShownVideo[] {
	return (videos ?? []).map(({ videoId, title, durationSeconds, posterImageId }) => ({
		videoId,
		title,
		durationSeconds,
		posterUrl: imageSrc(posterImageId)
	}));
}

/** the Videos card's seed: the draft's videos, and how many it holds of how many it may. */
export type VideoCardSeed = {
	readonly videos: readonly ShownVideo[];
	readonly count: number;
	readonly cap: number;
};

/** what each of the Videos card's presses answers once its write lands. */
export type VideoSaved =
	| { readonly saved: typeof VIDEO_FORMS.add; readonly videoId: string }
	| {
			readonly saved: typeof VIDEO_FORMS.move;
			readonly videoId: string;
			/** where the video now stands, from 1, of `count`; unchanged by a move past an end. */
			readonly position: number;
			readonly count: number;
	  }
	| { readonly saved: typeof VIDEO_FORMS.remove; readonly videoId: string };
