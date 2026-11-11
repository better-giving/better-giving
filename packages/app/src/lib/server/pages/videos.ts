import { defineForm, type RejectionStatus } from '../../forms/definition';
import type { Page, Video } from '../../page/catalog';
import {
	VIDEO_ADD_INPUT,
	VIDEO_BOXES,
	VIDEO_FORMS,
	VIDEO_MOVE_INPUT,
	VIDEO_REFUSALS,
	VIDEO_REMOVE_INPUT,
	type VideoFormId,
	type VideoSaved,
	VIDEOS_MAX,
	youTubeVideoId
} from '../../page/videos';
import { invalid, parseForm } from '../conform';
import type { Db } from '../db/client';
import { checkPhotoBytes } from '../images/intake';
import { freeImageStatements } from '../images/free';
import { readableDraft } from './document';
import { type DraftCommand, editPageDraft } from './draft-writer';
import { STALE } from './publish';
import { readTarget } from './queries';
import { readYouTubeVideo } from './youtube';

// the Videos card's presses on the Donation page's edit page ($lib/page/videos.ts): Add video,
// Move up, Move down and Remove, each written to the draft at once through `editPageDraft`
// (./draft-writer.ts), and reaching donors at Publish changes with the rest of the page.
//
// each press names a video by its YouTube id and is applied to the draft as it stands when the
// write lands, rather than against the version the card was drawn at: a second press on Move up
// before the card redraws moves the video again rather than being refused as stale, and a second
// Remove finds the video gone and answers as the first did.
//
// **Add video asks YouTube only for a link that can be added**: one that is no YouTube video, one
// the draft already holds and one past `VIDEOS_MAX` are refused before any request. the poster's
// bytes are held to the rule a posted photo is (`checkPhotoBytes` in ../images/intake.ts) and land
// in the draft's own `batch()`, so a video is never saved without its poster and a poster never
// without its video. a poster YouTube serves that is no image refuses the add as unreachable.
//
// a poster let go of — a removed video's — is freed in the draft's write where nothing else names
// it (../images/free.ts): the live page keeps naming it until a Publish lets it go too.

type DonationPage = { readonly type: 'donation_page' };

const FAILED = 'Saving failed and nothing was changed. Try again.';

const ADD = defineForm({ id: VIDEO_FORMS.add, schema: VIDEO_ADD_INPUT });
const MOVE = defineForm({ id: VIDEO_FORMS.move, schema: VIDEO_MOVE_INPUT });
const REMOVE = defineForm({ id: VIDEO_FORMS.remove, schema: VIDEO_REMOVE_INPUT });

/** why the draft takes no video `videoId`, or null where it does. */
function addRefusal(
	draft: Page,
	videoId: string
): { status: RejectionStatus; sentence: string } | null {
	const videos = draft.videos ?? [];
	if (videos.some((video) => video.videoId === videoId)) {
		return { status: 409, sentence: VIDEO_REFUSALS.alreadyAdded };
	}
	if (videos.length >= VIDEOS_MAX) return { status: 422, sentence: VIDEO_REFUSALS.atCap };
	return null;
}

/**
 * Add video: the pasted link's video, after the last, with the title, length and poster YouTube
 * gives for it now. `apiKey` is the deployment's `YOUTUBE_API_KEY`, which only the length needs.
 */
export async function addDonationPageVideo(
	db: Db,
	apiKey: string | undefined,
	body: FormData,
	gone: string
) {
	const submission = parseForm(body, ADD);
	if (!submission.ok) return invalid(400, submission.reject());
	const refuse = (status: RejectionStatus, sentence: string) =>
		invalid(status, submission.reject({ fieldErrors: { [VIDEO_BOXES.link]: [sentence] } }));
	const videoId = youTubeVideoId(submission.value.video_link);
	// unreachable: the schema refuses a link with no video id.
	if (videoId === null) return refuse(400, VIDEO_REFUSALS.notYouTube);
	const target: DonationPage = { type: 'donation_page' };
	try {
		const row = await readTarget(db, target);
		if (row === null) return invalid(404, submission.reject({ formErrors: [gone] }));
		const early = addRefusal(readableDraft(row), videoId);
		if (early !== null) return refuse(early.status, early.sentence);

		const read = await readYouTubeVideo(videoId, apiKey);
		if (!read.ok) {
			switch (read.reason) {
				case 'not_found':
					return refuse(422, VIDEO_REFUSALS.notFound);
				case 'not_embeddable':
					return refuse(422, VIDEO_REFUSALS.notEmbeddable);
				case 'unreachable':
					return refuse(500, VIDEO_REFUSALS.unreachable);
			}
		}
		const poster = checkPhotoBytes(db, read.poster);
		if (!poster.ok) {
			console.warn(`YouTube served a poster this deployment does not store: ${poster.error}`);
			return refuse(500, VIDEO_REFUSALS.unreachable);
		}
		const video: Video = {
			videoId,
			title: read.title,
			durationSeconds: read.durationSeconds,
			posterImageId: poster.id
		};
		// a video added or the cap reached between the read above and the write.
		const late: { refusal: ReturnType<typeof addRefusal> } = { refusal: null };
		const written = await editPageDraft(db, target, 'current', (draft) => {
			late.refusal = addRefusal(draft, videoId);
			if (late.refusal !== null) return { ok: false, path: [], message: late.refusal.sentence };
			return {
				ok: true,
				draft: { ...draft, videos: [...(draft.videos ?? []), video] },
				alongside: { before: () => poster.statements }
			};
		});
		switch (written.kind) {
			case 'written':
				return { saved: VIDEO_FORMS.add, videoId } satisfies VideoSaved;
			case 'refused':
				return late.refusal === null
					? invalid(400, submission.reject({ formErrors: [written.message] }))
					: refuse(late.refusal.status, late.refusal.sentence);
			case 'stale':
				// the poster rode the batch whose update matched no row: free it again.
				await db.batch(freeImageStatements(db, poster.id));
				return invalid(409, submission.reject({ formErrors: [STALE] }));
			case 'gone':
				return invalid(404, submission.reject({ formErrors: [gone] }));
		}
	} catch (e) {
		console.error('adding a video to the Donation page failed:', e);
		return invalid(500, submission.reject({ formErrors: [FAILED] }));
	}
}

/** what a move or a remove made of the draft's list, or that it changes nothing. */
type ListEdit = { readonly videos: Video[] } | { readonly unchanged: true };

/** the draft with `edit` applied to its videos, written; a list `edit` leaves as it was is not. */
async function editVideos(
	db: Db,
	edit: (videos: Video[]) => ListEdit
): Promise<'written' | 'unchanged' | 'stale' | 'gone'> {
	let unchanged = false;
	const command: DraftCommand = (draft) => {
		const edited = edit([...(draft.videos ?? [])]);
		if ('unchanged' in edited) {
			unchanged = true;
			return { ok: false, path: [], message: 'unchanged' };
		}
		return {
			ok: true,
			draft: { ...draft, videos: edited.videos.length === 0 ? undefined : edited.videos }
		};
	};
	const written = await editPageDraft(db, { type: 'donation_page' }, 'current', command);
	if (written.kind === 'refused') {
		if (unchanged) return 'unchanged';
		throw new Error(`the page rule refused a video list edit: ${written.message}`);
	}
	return written.kind;
}

/** Move up and Move down: the video one place earlier or later; past an end, nothing moves. */
export async function moveDonationPageVideo(db: Db, body: FormData, gone: string) {
	const submission = parseForm(body, MOVE);
	if (!submission.ok) return invalid(400, submission.reject());
	const { video_id: videoId, direction } = submission.value;
	let at = -1;
	let count = 0;
	try {
		const outcome = await editVideos(db, (videos) => {
			count = videos.length;
			const from = videos.findIndex((video) => video.videoId === videoId);
			const to = direction === 'up' ? from - 1 : from + 1;
			at = from;
			if (from === -1 || to < 0 || to >= videos.length) return { unchanged: true };
			const [moved] = videos.splice(from, 1);
			if (moved === undefined) return { unchanged: true };
			videos.splice(to, 0, moved);
			at = to;
			return { videos };
		});
		if (outcome === 'gone') return invalid(404, submission.reject({ formErrors: [gone] }));
		if (outcome === 'stale') return invalid(409, submission.reject({ formErrors: [STALE] }));
		if (at === -1) {
			return invalid(404, submission.reject({ formErrors: [VIDEO_REFUSALS.gone] }));
		}
		return { saved: VIDEO_FORMS.move, videoId, position: at + 1, count } satisfies VideoSaved;
	} catch (e) {
		console.error('moving a video on the Donation page failed:', e);
		return invalid(500, submission.reject({ formErrors: [FAILED] }));
	}
}

/** Remove: the video off the draft, its poster freed where nothing else names it. */
export async function removeDonationPageVideo(db: Db, body: FormData, gone: string) {
	const submission = parseForm(body, REMOVE);
	if (!submission.ok) return invalid(400, submission.reject());
	const videoId = submission.value.video_id;
	try {
		const outcome = await editVideos(db, (videos) => {
			const kept = videos.filter((video) => video.videoId !== videoId);
			return kept.length === videos.length ? { unchanged: true } : { videos: kept };
		});
		if (outcome === 'gone') return invalid(404, submission.reject({ formErrors: [gone] }));
		if (outcome === 'stale') return invalid(409, submission.reject({ formErrors: [STALE] }));
		return { saved: VIDEO_FORMS.remove, videoId } satisfies VideoSaved;
	} catch (e) {
		console.error('removing a video from the Donation page failed:', e);
		return invalid(500, submission.reject({ formErrors: [FAILED] }));
	}
}

/** a press on the Videos card, by the form its body names. */
export function answerVideoPress(
	db: Db,
	env: Env,
	form: VideoFormId,
	body: FormData,
	gone: string
) {
	switch (form) {
		case VIDEO_FORMS.add:
			return addDonationPageVideo(db, env.YOUTUBE_API_KEY, body, gone);
		case VIDEO_FORMS.move:
			return moveDonationPageVideo(db, body, gone);
		case VIDEO_FORMS.remove:
			return removeDonationPageVideo(db, body, gone);
	}
}
