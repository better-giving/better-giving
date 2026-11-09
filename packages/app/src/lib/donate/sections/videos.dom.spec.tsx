/**
 * @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { ShownVideo } from '../../page/videos';
import { clock, playLabel, Videos } from './videos';

// Videos on /donate, over the profile's videos: nothing with none, a figure per video with its
// poster and play press, a caption with the length only where known, and a press through loading
// to the player or to the failed face. the player's frame never loads a page here: happy-dom is
// told not to, and its `load` is dispatched by hand.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const video = (videoId: string, title: string, durationSeconds: number | null): ShownVideo => ({
	videoId,
	title,
	durationSeconds,
	posterUrl: `/images/poster-${videoId}`
});

const PANTRY = video('dQw4w9WgXcQ', 'A winter night with the pantry crew', 192);
const RENT = video('9bZkp7q19f0', 'How a rent grant works', 108);
const DRIVERS = video('kJQP7kiw5Fk', 'Meet our volunteer drivers', null);

function mount(videos: readonly ShownVideo[]) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(<Videos videos={videos} />));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return host;
}

const play = (host: HTMLElement, at = 0) => {
	const press = host.querySelectorAll<HTMLButtonElement>('.page-video-play')[at];
	if (press === undefined) throw new Error('no play press');
	act(() => {
		press.focus();
		press.click();
	});
};

describe('the videos section', () => {
	it('draws nothing at all with no video', () => {
		expect(mount([]).childNodes).toHaveLength(0);
	});

	it('is a section labelled by its "Videos" heading, a figure per video', () => {
		const host = mount([PANTRY, RENT, DRIVERS]);
		const section = host.querySelector('section');
		const heading = section?.querySelector('h2');
		expect(heading?.textContent).toBe('Videos');
		expect(section?.getAttribute('aria-labelledby')).toBe(heading?.id);
		expect(host.querySelectorAll('figure')).toHaveLength(3);
	});

	it('shows at most six videos', () => {
		const many = Array.from({ length: 8 }, (_, at) => video(`video-000${at}x`, `Video ${at}`, 60));
		expect(mount(many).querySelectorAll('figure')).toHaveLength(6);
	});

	it('draws each poster from this deployment, with the play press named for the video and its length', () => {
		const host = mount([PANTRY, RENT]);
		const posters = [...host.querySelectorAll('img')];
		expect(posters.map((img) => img.getAttribute('src'))).toEqual([
			'/images/poster-dQw4w9WgXcQ',
			'/images/poster-9bZkp7q19f0'
		]);
		expect(posters.every((img) => img.getAttribute('alt') === '')).toBe(true);
		const presses = [...host.querySelectorAll('button')];
		expect(presses.map((press) => press.getAttribute('aria-label'))).toEqual([
			'Play video: A winter night with the pantry crew, 3 minutes 12 seconds',
			'Play video: How a rent grant works, 1 minute 48 seconds'
		]);
		expect(presses[0]?.className).toBe(
			'ds-btn ds-btn-primary ds-btn-lg ds-btn-icon page-video-play'
		);
	});

	it('captions the title and the length as m:ss, and leaves the length out where it is not known', () => {
		const host = mount([PANTRY, DRIVERS]);
		const captions = [...host.querySelectorAll('figcaption')];
		expect(captions[0]?.querySelector('.page-video-title')?.textContent).toBe(PANTRY.title);
		expect(captions[0]?.querySelector('.page-video-length')?.textContent).toBe('3:12');
		expect(captions[1]?.querySelector('.page-video-length')).toBeNull();
		expect(host.querySelectorAll('button')[1]?.getAttribute('aria-label')).toBe(
			'Play video: Meet our volunteer drivers'
		);
	});

	it('names no YouTube address before a press: no iframe, no script, no link', () => {
		const markup = renderToStaticMarkup(<Videos videos={[PANTRY, RENT, DRIVERS]} />);
		expect(markup).not.toMatch(/youtube|youtu\.be/i);
		expect(markup).not.toMatch(/<iframe|<script|<a /);
	});

	it('loads the player under a loading panel on a press, holding focus in the box', () => {
		const host = mount([PANTRY, RENT]);
		play(host);
		const box = host.querySelector<HTMLElement>('.page-video-box');
		expect(box?.dataset.face).toBe('loading');
		const status = box?.querySelector('[role="status"]');
		expect(status?.getAttribute('aria-live')).toBe('polite');
		expect(status?.textContent).toBe('Loading video…');
		expect(status?.querySelector('.page-spinner')?.getAttribute('aria-hidden')).toBe('true');
		const frame = host.querySelector('iframe');
		expect(frame?.getAttribute('src')).toBe(
			'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1'
		);
		expect(frame?.getAttribute('title')).toBe(PANTRY.title);
		expect(document.activeElement).toBe(box);
		// the other video is still its poster.
		expect(host.querySelectorAll('iframe')).toHaveLength(1);
		expect(host.querySelectorAll('.page-video-play')).toHaveLength(1);
	});

	it('keeps the status region in the poster face, empty, so loading is a change to it', () => {
		const host = mount([PANTRY]);
		const status = host.querySelector('[role="status"]');
		expect(status?.textContent).toBe('');
		play(host);
		expect(host.querySelector('[role="status"]')).toBe(status);
	});

	it('shows the player once it loads, with focus moved into it', () => {
		const host = mount([PANTRY]);
		play(host);
		const frame = host.querySelector('iframe') as HTMLIFrameElement;
		act(() => {
			frame.dispatchEvent(new Event('load'));
		});
		expect(host.querySelector<HTMLElement>('.page-video-box')?.dataset.face).toBe('playing');
		expect(host.querySelector('[role="status"]')?.textContent).toBe('');
		expect(host.querySelector('iframe')).toBe(frame);
		expect(document.activeElement).toBe(frame);
		expect(host.querySelector('[role="alert"]')).toBeNull();
	});

	it('says it couldn’t load a player that has not loaded in time, and links out in a new tab', () => {
		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const host = mount([PANTRY]);
		play(host);
		act(() => {
			vi.advanceTimersByTime(15_000);
		});
		const box = host.querySelector<HTMLElement>('.page-video-box');
		expect(box?.dataset.face).toBe('error');
		expect(host.querySelector('iframe')).toBeNull();
		const alert = host.querySelector('[role="alert"]');
		expect(alert?.querySelector('.page-video-error-title')?.textContent).toBe('Video unavailable');
		expect(alert?.querySelector('.page-video-error-body')?.textContent).toBe(
			'We couldn’t load this video.'
		);
		const link = alert?.querySelector('a');
		expect(link?.getAttribute('href')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
		expect(link?.getAttribute('target')).toBe('_blank');
		expect(link?.getAttribute('rel')).toBe('noopener');
		expect(link?.textContent).toBe('Watch on YouTube (opens in a new tab)');
		// focus was held on the box, which offers nothing to press: it goes to the one way on.
		expect(document.activeElement).toBe(link);
	});

	it('leaves focus where a reader moved it while the player loaded', () => {
		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const host = mount([PANTRY, RENT]);
		play(host);
		const other = host.querySelector<HTMLButtonElement>('.page-video-play');
		act(() => other?.focus());
		act(() => {
			vi.advanceTimersByTime(15_000);
		});
		expect(host.querySelector<HTMLElement>('.page-video-box')?.dataset.face).toBe('error');
		expect(document.activeElement).toBe(other);
	});

	it('does not fail a player that loaded before the wait ran out', () => {
		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const host = mount([PANTRY]);
		play(host);
		act(() => {
			host.querySelector('iframe')?.dispatchEvent(new Event('load'));
		});
		act(() => {
			vi.advanceTimersByTime(60_000);
		});
		expect(host.querySelector<HTMLElement>('.page-video-box')?.dataset.face).toBe('playing');
	});
});

describe('a video’s length', () => {
	it.each([
		[58, '0:58', 'Play video: T, 58 seconds'],
		[108, '1:48', 'Play video: T, 1 minute 48 seconds'],
		[180, '3:00', 'Play video: T, 3 minutes'],
		[3_725, '1:02:05', 'Play video: T, 1 hour 2 minutes 5 seconds'],
		[0, '0:00', 'Play video: T, 0 seconds']
	])('%i seconds is %s, said as "%s"', (seconds, shown, said) => {
		expect(clock(seconds)).toBe(shown);
		expect(playLabel({ title: 'T', durationSeconds: seconds })).toBe(said);
	});
});
