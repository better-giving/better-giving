import { useEffect, useId, useRef, useState } from 'react';
import { type ShownVideo, VIDEOS_MAX, youTubeEmbedUrl, youTubeWatchUrl } from '../../page/videos';
import { Glyph } from './glyph';

// "Videos" on /donate: the nonprofit's YouTube videos, each a poster this deployment serves with a
// play press over it, in a grid of one column below 48rem of page width and two from there (an odd
// count opens with one video across both); the feature's, from 60rem, stand in one row of up to
// four, four abreast where there are more (../page.css). with no video the section is not drawn.
//
// **a donor's browser asks YouTube for nothing until play is pressed**: the poster is our own copy
// and nothing in the markup names a YouTube address. the press mounts the player's iframe under a
// loading panel; the iframe's `load` shows it, and a player that has not loaded within
// `PLAYER_WAIT_MS` is taken as failed and gives way to the link out. the load event says the frame
// arrived, not that the video plays: a video YouTube refuses is its own player's message, inside the
// frame. the link out exists only in the failed face. either face takes the focus the box was holding
// while the player loaded, and leaves be a reader who moved it.
//
// one video plays at a time: the section holds which one was pressed last, and every other figure
// is back to its poster, its player unmounted, so a second press never plays over the first.

/** how long a pressed video's player may take to load before the box says it couldn't. */
const PLAYER_WAIT_MS = 15_000;

type Face = 'poster' | 'loading' | 'playing' | 'error';

export function Videos({ videos }: { readonly videos: readonly ShownVideo[] }) {
	const headingId = useId();
	const [pressed, setPressed] = useState<string | null>(null);
	if (videos.length === 0) return null;
	return (
		<section aria-labelledby={headingId} data-area="videos">
			<h2 className="page-videos-heading" id={headingId}>
				Videos
			</h2>
			<div className="page-videos-grid">
				{videos.slice(0, VIDEOS_MAX).map((video) => (
					<VideoFigure
						key={video.videoId}
						video={video}
						current={pressed === video.videoId}
						onPlay={() => setPressed(video.videoId)}
					/>
				))}
			</div>
		</section>
	);
}

function VideoFigure({
	video,
	current,
	onPlay
}: {
	readonly video: ShownVideo;
	/** this is the video pressed last; every other one stands as its poster. */
	readonly current: boolean;
	readonly onPlay: () => void;
}) {
	const [pressedFace, setFace] = useState<Face>('poster');
	const face = current ? pressedFace : 'poster';
	const box = useRef<HTMLDivElement>(null);
	const player = useRef<HTMLIFrameElement>(null);
	const watch = useRef<HTMLAnchorElement>(null);

	// keyed on the face that landed: the press unmounts the play button, so focus is held on the box,
	// a group named for the video, while the player loads, handed into the player once it has, and to
	// the link out if it fails, unless the reader has moved it from the box meanwhile.
	useEffect(() => {
		if (face === 'playing' || face === 'error') {
			if (document.activeElement !== box.current) return;
			(face === 'playing' ? player : watch).current?.focus();
			return;
		}
		if (face !== 'loading') return;
		box.current?.focus();
		const giveUp = setTimeout(
			() => setFace((now) => (now === 'loading' ? 'error' : now)),
			PLAYER_WAIT_MS
		);
		return () => clearTimeout(giveUp);
	}, [face]);

	const length = video.durationSeconds === null ? null : clock(video.durationSeconds);
	return (
		<figure className="page-video">
			{/* biome-ignore lint/a11y/useSemanticElements: a `<fieldset>` groups form controls, and this
			    box holds a poster, a player or a link out. the role is here so the place focus is held
			    while the player loads announces the video by name. */}
			<div
				className="page-video-box"
				data-face={face}
				ref={box}
				tabIndex={face === 'poster' ? undefined : -1}
				role="group"
				aria-label={video.title}
			>
				{face === 'poster' ? (
					<>
						<img
							className="page-video-poster"
							src={video.posterUrl}
							alt=""
							loading="lazy"
							decoding="async"
						/>
						<button
							type="button"
							className="ds-btn ds-btn-primary ds-btn-lg ds-btn-icon page-video-play"
							aria-label={playLabel(video)}
							onClick={() => {
								onPlay();
								setFace('loading');
							}}
						>
							<Glyph name="play" className="page-video-glyph" />
						</button>
					</>
				) : null}
				{face === 'loading' || face === 'playing' ? (
					<iframe
						ref={player}
						className="page-video-player"
						src={youTubeEmbedUrl(video.videoId)}
						title={video.title}
						// the player's script needs its own origin to play, and its links out to youtube.com
						// open as popups that must leave the sandbox to work as a plain tab.
						sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
						allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
						allowFullScreen
						referrerPolicy="strict-origin-when-cross-origin"
						onLoad={() => setFace((now) => (now === 'loading' ? 'playing' : now))}
					/>
				) : null}
				{/* mounted in every face so "Loading video…" is a change a reader is told of. */}
				<div className="page-video-status" role="status" aria-live="polite">
					{face === 'loading' ? (
						<>
							<span className="page-spinner" aria-hidden="true" />
							Loading video…
						</>
					) : null}
				</div>
				{face === 'error' ? (
					<div className="page-video-error" role="alert">
						<p className="page-video-error-title">Video unavailable</p>
						<p className="page-video-error-body">We couldn’t load this video.</p>
						<a ref={watch} href={youTubeWatchUrl(video.videoId)} target="_blank" rel="noopener">
							Watch on YouTube<span className="vh">: “{video.title}” (opens in a new tab)</span>
						</a>
					</div>
				) : null}
			</div>
			<figcaption className="page-video-caption">
				<span className="page-video-title">{video.title}</span>
				{length === null ? null : <span className="page-video-length">{length}</span>}
			</figcaption>
		</figure>
	);
}

/** a length as the caption shows it: `m:ss`, or `h:mm:ss` from an hour. */
export function clock(seconds: number): string {
	const whole = Math.max(0, Math.round(seconds));
	const h = Math.floor(whole / 3600);
	const m = Math.floor((whole % 3600) / 60);
	const s = String(whole % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const unit = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

/** the play press's name: "Play video: {title}, 3 minutes 12 seconds", the length where known. */
export function playLabel(video: Pick<ShownVideo, 'title' | 'durationSeconds'>): string {
	if (video.durationSeconds === null) return `Play video: ${video.title}`;
	const whole = Math.max(0, Math.round(video.durationSeconds));
	const parts = [
		[Math.floor(whole / 3600), 'hour'],
		[Math.floor((whole % 3600) / 60), 'minute'],
		[whole % 60, 'second']
	] as const;
	const said = parts.filter(([count]) => count > 0).map(([count, one]) => unit(count, one));
	return `Play video: ${video.title}, ${said.length === 0 ? unit(0, 'second') : said.join(' ')}`;
}
