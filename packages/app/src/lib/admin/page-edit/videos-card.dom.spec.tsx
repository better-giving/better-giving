import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { WHICH_FORM } from '$lib/forms/definition';
import {
	type ShownVideo,
	VIDEO_FORMS,
	VIDEO_REFUSALS,
	type VideoCardSeed,
	VIDEOS_MAX
} from '$lib/page/videos';
import { DonationPageVideosCard } from './videos-card';

// the Videos card on the Donation page's edit screen, mounted under a route stub whose action the
// spec answers: the list and its empty and full states, Add video through its refusals, its busy
// press and its landing, and Move and Remove with the line they say and where they leave focus.
// what the real action writes is ../../../routes/_app.admin.donation-page.videos.db.spec.ts's.

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

const seedOf = (videos: readonly ShownVideo[]): VideoCardSeed => ({
	videos,
	count: videos.length,
	cap: VIDEOS_MAX
});

type Answer = {
	readonly body: unknown;
	readonly status?: number;
	readonly after?: readonly ShownVideo[];
};

let seed: VideoCardSeed;
let posted: Record<string, string>[];
let answer: (body: Record<string, string>) => Answer | Promise<Answer>;

beforeEach(() => {
	seed = seedOf([RENT, PANTRY, DRIVERS]);
	posted = [];
	answer = () => ({ body: null });
});

function Screen() {
	return createElement(DonationPageVideosCard, { seed: useLoaderData<VideoCardSeed>() });
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function mount() {
	const Stub = createRoutesStub([
		{
			path: '/admin/donation-page',
			loader: () => seed,
			action: async ({ request }) => {
				const body = Object.fromEntries(
					[...(await request.formData())].map(([k, v]) => [k, String(v)])
				);
				posted.push(body);
				const said = await answer(body);
				if (said.after !== undefined) seed = seedOf(said.after);
				return Response.json(said.body, { status: said.status ?? 200 });
			},
			HydrateFallback: () => null,
			Component: Screen
		}
	]);
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(createElement(Stub, { initialEntries: ['/admin/donation-page'] })));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	await settle();
	return host;
}

const named = (host: HTMLElement, name: string): HTMLButtonElement => {
	const found = [...host.querySelectorAll('button')].find(
		(b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name
	);
	if (found === undefined) throw new Error(`no ${name} button`);
	return found;
};

const linkBox = (host: HTMLElement) =>
	host.querySelector('input[name="video_link"]') as HTMLInputElement;

async function type(box: HTMLInputElement, text: string) {
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, text);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

async function press(button: HTMLButtonElement) {
	await act(async () => {
		button.focus();
		button.click();
	});
	await settle();
	await settle();
}

const refusal = (sentence: string, key = 'video_link', id: string = VIDEO_FORMS.add) => ({
	body: { form: { id, result: { status: 'error', error: { [key]: [sentence] } } } },
	status: 422
});

const status = (host: HTMLElement) => host.querySelector('[role="status"]');
// what the alert regions say: the press refusal's stands empty until it speaks.
const alerts = (host: HTMLElement) =>
	[...host.querySelectorAll('[role="alert"]')]
		.map((one) => one.textContent)
		.filter((said) => said !== '');

describe('the Videos card', () => {
	it('stands Add video on the link box’s row, inside the form adm.css widens it in under the middle breakpoint', async () => {
		const host = await mount();
		const add = named(host, 'Add video');
		// `.adm-videoadd .adm-actions > .adm-btn` in packages/operator/src/styles/adm.css: full width
		// under the box below 44rem, beside it from there.
		expect(add.closest('form')?.classList.contains('adm-videoadd')).toBe(true);
		expect(add.classList.contains('adm-btn')).toBe(true);
		const row = add.parentElement;
		expect(row?.classList.contains('adm-actions')).toBe(true);
		expect(row?.firstElementChild?.contains(linkBox(host))).toBe(true);
		expect(row?.lastElementChild).toBe(add);
	});
	it('lists the videos in order, each with its poster, title, length where known and a link out', async () => {
		const host = await mount();
		expect(host.querySelector('h2')?.textContent).toBe('Videos');
		const list = host.querySelector('ol');
		expect(list?.getAttribute('aria-label')).toBe('Videos on your donation page');
		const rows = [...(list?.querySelectorAll('li') ?? [])];
		expect(rows.map((row) => row.querySelector('.adm-video__title')?.textContent)).toEqual([
			RENT.title,
			PANTRY.title,
			DRIVERS.title
		]);
		expect(rows[0]?.querySelector('img')?.getAttribute('src')).toBe('/images/poster-9bZkp7q19f0');
		expect(rows[0]?.querySelector('img')?.getAttribute('alt')).toBe('');
		expect(rows[0]?.querySelector('.adm-video__meta span')?.textContent).toBe('1:48');
		expect(rows[2]?.querySelector('.adm-video__meta')?.textContent).toBe(
			'Watch on YouTube: “Meet our volunteer drivers” (opens in a new tab)'
		);
		const link = rows[0]?.querySelector('a');
		expect(link?.getAttribute('href')).toBe('https://www.youtube.com/watch?v=9bZkp7q19f0');
		expect(link?.getAttribute('target')).toBe('_blank');
		expect(link?.getAttribute('rel')).toBe('noopener');
		// named for its video, so a list of links reads each row apart.
		expect(link?.textContent).toBe(
			'Watch on YouTube: “How a rent grant works” (opens in a new tab)'
		);
	});

	it('counts what is added in the link box’s hint, under its label', async () => {
		const host = await mount();
		const box = linkBox(host);
		expect(host.querySelector(`label[for="${box.id}"]`)?.textContent).toBe('YouTube link');
		const hint = document.getElementById(`${box.id}-hint`);
		expect(hint?.textContent).toBe(
			'Paste the address of a public or unlisted video. 3 of 6 added.'
		);
		expect(box.getAttribute('aria-describedby')).toContain(hint?.id);
		expect(box.disabled).toBe(false);
	});

	it('names each row’s presses for its video, and closes the first Move up and the last Move down', async () => {
		const host = await mount();
		const up = named(host, `Move “${RENT.title}” up`);
		const down = named(host, `Move “${DRIVERS.title}” down`);
		expect(up.getAttribute('aria-disabled')).toBe('true');
		expect(down.getAttribute('aria-disabled')).toBe('true');
		expect(named(host, `Move “${RENT.title}” down`).getAttribute('aria-disabled')).toBeNull();
		expect(named(host, `Move “${PANTRY.title}” up`).getAttribute('aria-disabled')).toBeNull();
		expect(named(host, `Remove “${PANTRY.title}”`).textContent).toBe('Remove');
		await press(up);
		expect(posted).toEqual([]);
	});

	it('says what to do with no video, in place of the list', async () => {
		seed = seedOf([]);
		const host = await mount();
		expect(host.querySelector('ol')).toBeNull();
		expect(host.textContent).toContain(
			'No videos yet. Add a YouTube link and donors will see it between About us and Messages from donors.'
		);
		expect(document.getElementById(`${linkBox(host).id}-hint`)?.textContent).toContain(
			'0 of 6 added.'
		);
	});

	it('closes the box and the press at the cap and says why in the hint, with nothing refused', async () => {
		seed = seedOf(
			Array.from({ length: 6 }, (_, at) => video(`video-00${at}xx`, `Video ${at}`, 60))
		);
		const host = await mount();
		const box = linkBox(host);
		expect(box.disabled).toBe(true);
		expect(document.getElementById(`${box.id}-hint`)?.textContent).toBe(
			'6 of 6 added. A page shows at most 6 videos. Remove one to add another.'
		);
		const add = named(host, 'Add video');
		expect(add.getAttribute('aria-disabled')).toBe('true');
		await press(add);
		expect(posted).toEqual([]);
		expect(alerts(host)).toEqual([]);
	});
});

describe('Add video', () => {
	it('refuses a link that is no YouTube video before it is sent, keeping what was typed', async () => {
		const host = await mount();
		const box = linkBox(host);
		await type(box, 'https://vimeo.com/76979871');
		await press(named(host, 'Add video'));
		expect(posted).toEqual([]);
		expect(alerts(host)).toEqual([VIDEO_REFUSALS.notYouTube]);
		expect(box.getAttribute('aria-invalid')).toBe('true');
		expect(box.getAttribute('aria-describedby')).toContain(`${box.id}-err`);
		expect(box.value).toBe('https://vimeo.com/76979871');
	});

	it.each([
		['private or gone', VIDEO_REFUSALS.notFound],
		['already added', VIDEO_REFUSALS.alreadyAdded],
		['YouTube unreachable', VIDEO_REFUSALS.unreachable]
	])(
		'says the server’s refusal (%s) at the box, which keeps the link and takes focus',
		async (_, sentence) => {
			answer = () => refusal(sentence);
			const host = await mount();
			const box = linkBox(host);
			await type(box, 'https://youtu.be/dQw4w9WgXcQ?t=40');
			await press(named(host, 'Add video'));
			expect(posted).toEqual([
				{ [WHICH_FORM]: VIDEO_FORMS.add, video_link: 'https://youtu.be/dQw4w9WgXcQ?t=40' }
			]);
			expect(alerts(host)).toEqual([sentence]);
			expect(linkBox(host).getAttribute('aria-invalid')).toBe('true');
			expect(linkBox(host).value).toBe('https://youtu.be/dQw4w9WgXcQ?t=40');
			expect(document.activeElement).toBe(linkBox(host));
		}
	);

	it('holds the box read-only and the press busy while it is out', async () => {
		let land: (said: Answer) => void = () => {};
		answer = () => new Promise<Answer>((resolve) => (land = resolve));
		const host = await mount();
		await type(linkBox(host), 'https://youtu.be/k3Ld9Qp2WmA');
		await press(named(host, 'Add video'));
		const busy = host.querySelector<HTMLButtonElement>('button[aria-busy="true"]');
		expect(busy?.textContent).toBe('Adding video');
		expect(busy?.querySelector('.adm-dots')).not.toBeNull();
		expect(linkBox(host).readOnly).toBe(true);
		// every row press is held while the add is out.
		expect(named(host, `Remove “${RENT.title}”`).getAttribute('aria-disabled')).toBe('true');
		await act(async () => land({ body: { saved: VIDEO_FORMS.add, videoId: 'k3Ld9Qp2WmA' } }));
		await settle();
		expect(host.querySelector('button[aria-busy="true"]')).toBeNull();
	});

	it('empties the box once the video is added, lists it and says so', async () => {
		const added = video('k3Ld9Qp2WmA', 'Thank you, 2025 donors', 58);
		answer = () => ({
			body: { saved: VIDEO_FORMS.add, videoId: added.videoId },
			after: [RENT, PANTRY, DRIVERS, added]
		});
		const host = await mount();
		await type(linkBox(host), 'https://youtu.be/k3Ld9Qp2WmA');
		await press(named(host, 'Add video'));
		expect(linkBox(host).value).toBe('');
		expect(host.querySelectorAll('li')).toHaveLength(4);
		expect(status(host)?.textContent).toBe('Added “Thank you, 2025 donors”.');
		expect(document.getElementById(`${linkBox(host).id}-hint`)?.textContent).toContain(
			'4 of 6 added.'
		);
		expect(alerts(host)).toEqual([]);
	});

	it('keeps focus on the page when Enter in the box adds the video that fills it', async () => {
		const five = Array.from({ length: 5 }, (_, at) => video(`video-00${at}xx`, `Video ${at}`, 60));
		const added = video('k3Ld9Qp2WmA', 'Thank you, 2025 donors', 58);
		seed = seedOf(five);
		answer = () => ({
			body: { saved: VIDEO_FORMS.add, videoId: added.videoId },
			after: [...five, added]
		});
		const host = await mount();
		const box = linkBox(host);
		await type(box, 'https://youtu.be/k3Ld9Qp2WmA');
		await act(async () => {
			box.focus();
			// Enter in a box submits through the form's one submit press, focus staying in the box.
			box.form?.requestSubmit(named(host, 'Add video'));
		});
		await settle();
		await settle();
		expect(posted).toHaveLength(1);
		expect(linkBox(host).disabled).toBe(true);
		// the box closes at the cap, so focus goes to the video it just added.
		expect(document.activeElement).toBe(named(host, `Remove “${added.title}”`));
		expect(status(host)?.textContent).toBe('Added “Thank you, 2025 donors”.');
	});
});

describe('Move up and Move down', () => {
	it('posts the video and the way, says where it now stands, and keeps focus on the press', async () => {
		answer = () => ({
			body: { saved: VIDEO_FORMS.move, videoId: PANTRY.videoId, position: 3, count: 3 },
			after: [RENT, DRIVERS, PANTRY]
		});
		const host = await mount();
		// the press is the middle row's down, which the move takes to the end: it closes, so focus
		// goes to the row's other move press.
		await press(named(host, `Move “${PANTRY.title}” down`));
		expect(posted).toEqual([
			{ [WHICH_FORM]: VIDEO_FORMS.move, video_id: PANTRY.videoId, direction: 'down' }
		]);
		expect(status(host)?.textContent).toBe(
			'Moved “A winter night with the pantry crew” down, now 3 of 3.'
		);
		expect(document.activeElement).toBe(named(host, `Move “${PANTRY.title}” up`));
		expect(named(host, `Move “${PANTRY.title}” down`).getAttribute('aria-disabled')).toBe('true');
	});

	it('leaves focus on the press just used where it is still open', async () => {
		answer = () => ({
			body: { saved: VIDEO_FORMS.move, videoId: DRIVERS.videoId, position: 2, count: 3 },
			after: [RENT, DRIVERS, PANTRY]
		});
		const host = await mount();
		await press(named(host, `Move “${DRIVERS.title}” up`));
		expect(status(host)?.textContent).toBe('Moved “Meet our volunteer drivers” up, now 2 of 3.');
		expect(document.activeElement).toBe(named(host, `Move “${DRIVERS.title}” up`));
	});

	it('says a refused move in a region there before it speaks, described by the refused row alone', async () => {
		answer = () => refusal(VIDEO_REFUSALS.gone, '', VIDEO_FORMS.move);
		const host = await mount();
		const region = host.querySelector('[role="alert"]');
		expect(region?.textContent).toBe('');
		await press(named(host, `Move “${PANTRY.title}” up`));
		expect(host.querySelector('[role="alert"]')).toBe(region);
		expect(alerts(host)).toEqual([VIDEO_REFUSALS.gone]);
		const said = region?.id;
		expect(said).toBeTruthy();
		expect(named(host, `Move “${PANTRY.title}” up`).getAttribute('aria-describedby')).toBe(said);
		expect(named(host, `Remove “${PANTRY.title}”`).getAttribute('aria-describedby')).toBe(said);
		expect(named(host, `Move “${RENT.title}” down`).hasAttribute('aria-describedby')).toBe(false);
		expect(named(host, `Remove “${DRIVERS.title}”`).hasAttribute('aria-describedby')).toBe(false);
		expect(status(host)?.textContent).toBe('');
	});
});

describe('Remove', () => {
	it('posts the video at once and puts focus on the next row’s Remove', async () => {
		answer = () => ({
			body: { saved: VIDEO_FORMS.remove, videoId: RENT.videoId },
			after: [PANTRY, DRIVERS]
		});
		const host = await mount();
		await press(named(host, `Remove “${RENT.title}”`));
		expect(posted).toEqual([{ [WHICH_FORM]: VIDEO_FORMS.remove, video_id: RENT.videoId }]);
		expect(host.querySelectorAll('li')).toHaveLength(2);
		expect(document.activeElement).toBe(named(host, `Remove “${PANTRY.title}”`));
		expect(status(host)?.textContent).toBe('Removed “How a rent grant works”.');
	});

	it('puts focus on the link box where no row follows', async () => {
		answer = () => ({
			body: { saved: VIDEO_FORMS.remove, videoId: DRIVERS.videoId },
			after: [RENT, PANTRY]
		});
		const host = await mount();
		await press(named(host, `Remove “${DRIVERS.title}”`));
		expect(document.activeElement).toBe(linkBox(host));
	});

	it('says a refused remove, described by the refused row alone', async () => {
		answer = () => refusal(VIDEO_REFUSALS.gone, '', VIDEO_FORMS.remove);
		const host = await mount();
		await press(named(host, `Remove “${RENT.title}”`));
		expect(alerts(host)).toEqual([VIDEO_REFUSALS.gone]);
		const said = host.querySelector('[role="alert"]')?.id;
		expect(named(host, `Remove “${RENT.title}”`).getAttribute('aria-describedby')).toBe(said);
		expect(named(host, `Remove “${PANTRY.title}”`).hasAttribute('aria-describedby')).toBe(false);
	});

	it('opens the box again once a full page has one removed', async () => {
		const six = Array.from({ length: 6 }, (_, at) => video(`video-00${at}xx`, `Video ${at}`, 60));
		seed = seedOf(six);
		answer = () => ({
			body: { saved: VIDEO_FORMS.remove, videoId: 'video-005xx' },
			after: six.slice(0, 5)
		});
		const host = await mount();
		await press(named(host, 'Remove “Video 5”'));
		expect(linkBox(host).disabled).toBe(false);
		expect(document.activeElement).toBe(linkBox(host));
		expect(named(host, 'Add video').getAttribute('aria-disabled')).toBeNull();
	});
});
