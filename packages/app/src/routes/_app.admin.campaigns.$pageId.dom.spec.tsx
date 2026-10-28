import type { Resized } from '@better-giving/operator/images/resize';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import type { BannerState } from '$lib/page/edit-forms';
import CampaignEditPage, { clientAction } from './_app.admin.campaigns.$pageId';

// happy-dom decodes no image, so the resize is the boundary stood in for: every pick resizes at once.
vi.mock('@better-giving/operator/images/resize', async (actual) => ({
	...(await actual<typeof import('@better-giving/operator/images/resize')>()),
	resizeImage: async (): Promise<Resized> => ({
		ok: true,
		blob: new Blob(['webp'], { type: 'image/webp' }),
		width: 1600,
		height: 400
	})
}));

// a campaign's edit page as the route mounts it: a plain form of section cards under the publish
// banner, with no preview; each card's Save held until that card changes, Media's until its upload
// lands; the four-amount cap and the label counter; and the banner's three states and their
// presses. the loader and the server's action are stand-ins, one drawing the fixture below and the
// other recording each body and answering what the case scripts; what the real ones do is
// ./_app.admin.campaigns.$pageId.db.spec.ts's. every press goes through the route's own
// `clientAction`, as it does in a browser.
//
// it is not the browser spec AGENTS.md bans over a dashboard screen: nothing here reads a computed
// style.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE = '/admin/campaigns/p1';

type Drawn = Parameters<typeof CampaignEditPage>[0]['loaderData'];
type Loaded = Extract<Drawn, { unreadable: false }>;

const BLANK_STORY = { type: 'doc' as const, content: [{ type: 'paragraph' as const }] };

function fixture(state: BannerState = 'not_public'): Loaded {
	return {
		id: 'p1',
		name: 'Winter coat drive',
		host: 'give.example.org/',
		version: 1,
		banner: {
			state,
			address: '/winter-coat-drive',
			preview: '/preview/p1',
			unpublishable: state === 'public' || state === 'changed',
			endable: state !== 'ended'
		},
		unreadable: false,
		seeds: {
			general: {
				boxes: { name: 'Winter coat drive', slug: 'winter-coat-drive' },
				story: BLANK_STORY
			},
			media: { boxes: { hero_image_id: '', logo_image_id: '' }, hero: null, logo: null },
			goal: {
				boxes: { goal_mode: 'none', goal_amount: '', amount: ['25'], amount_label: [''] },
				currency: 'USD'
			},
			settings: {
				boxes: {
					program_mode: 'none',
					program_id: '',
					min_minor: '1',
					max_minor: '10,000',
					open_on_monthly: false,
					dedication_on: true,
					share_message: '',
					end_date: ''
				},
				currency: 'USD',
				programs: [],
				retired: null,
				monthlyOffered: true
			}
		}
	};
}

let drawn: Loaded;
let posted: Record<string, string>[];
/** what the action answers each post, in turn, and the page it leaves for the loader to draw. */
let answers: { body: unknown; status?: number; drawn?: Loaded }[];
/** the upload the images route holds open until a case answers it. */
let upload: { resolve: (answer: Response) => void } | null;

beforeEach(() => {
	drawn = fixture();
	posted = [];
	answers = [];
	upload = null;
});

function mount(tree: ReactNode) {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
}

function Page() {
	return createElement(CampaignEditPage as never, {
		loaderData: useLoaderData<Drawn>(),
		params: { pageId: 'p1' },
		matches: []
	});
}

async function screen() {
	const Stub = createRoutesStub([
		{
			path: '/admin/campaigns/:pageId',
			loader: () => drawn,
			action: (args) =>
				clientAction({
					...args,
					serverAction: async () => {
						const body = await args.request.formData();
						posted.push(Object.fromEntries([...body].map(([k, v]) => [k, String(v)])));
						const answer = answers.shift();
						if (answer === undefined) throw new Error('posted to with no answer ready');
						if (answer.drawn !== undefined) drawn = answer.drawn;
						return Response.json(answer.body, { status: answer.status ?? 200 });
					}
				} as never),
			HydrateFallback: () => null,
			Component: Page
		},
		{
			path: '/admin/images',
			action: () =>
				new Promise<Response>((resolve) => {
					upload = { resolve };
				})
		}
	]);
	mount(createElement(Stub, { initialEntries: [PAGE] }));
	await settle();
}

/** a round of the event loop, so the router's promises settle. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function button(name: string, within: Element | Document = document): HTMLButtonElement {
	const found = [...within.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name
	);
	if (found === undefined) throw new Error(`no ${name} button`);
	return found;
}

/** the card headed `title`. */
function card(title: string): HTMLElement {
	const found = [...document.querySelectorAll<HTMLElement>('section.adm-card')].find(
		(one) => one.querySelector('h2')?.textContent === title
	);
	if (found === undefined) throw new Error(`no card is headed ${title}`);
	return found;
}

const held = (press: HTMLElement) => press.getAttribute('aria-disabled') === 'true';

async function press(target: HTMLElement) {
	await act(async () => {
		target.focus();
		target.click();
	});
	await settle();
}

/** text put in a box the way a keystroke puts it there. */
async function type(box: HTMLInputElement | HTMLTextAreaElement, text: string) {
	const proto = box instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
	await act(async () => {
		Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(box, text);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

function box(within: Element, label: string): HTMLInputElement {
	const found = [...within.querySelectorAll<HTMLInputElement>('input, textarea')].find(
		(one) =>
			one.getAttribute('aria-label') === label ||
			(one.id !== '' &&
				within.querySelector(`label[for="${one.id}"]`)?.textContent?.startsWith(label))
	);
	if (found === undefined) throw new Error(`no box named ${label}`);
	return found;
}

describe('the edit page as it opens', () => {
	it('is a form of section cards in order, with no preview', async () => {
		await screen();

		expect(document.querySelector('iframe')).toBeNull();
		expect(
			[...document.querySelectorAll('section.adm-card h2')].map((one) => one.textContent)
		).toEqual(['General', 'Media', 'Goal and amounts', 'Settings', 'End campaign']);
	});

	it('offers every Save held, until its card changes', async () => {
		await screen();

		for (const name of ['general', 'media', 'goal and amounts', 'settings']) {
			expect(held(button(`Save ${name}`))).toBe(true);
		}
		expect(document.body.textContent).not.toContain('Unsaved changes');
	});

	it('links End campaign to the Campaigns list’s own confirmation', async () => {
		await screen();

		const end = card('End campaign').querySelector('a');
		expect(end?.getAttribute('href')).toBe('/admin/campaigns?end=p1');
	});
});

describe('a section’s Save', () => {
	it('is offered on the card that changed alone, saying it holds unsaved changes', async () => {
		await screen();

		await type(box(card('General'), 'Name'), 'Warm hands winter');

		expect(held(button('Save general'))).toBe(false);
		expect(card('General').textContent).toContain('Unsaved changes');
		expect(held(button('Save settings'))).toBe(true);
		expect(card('Settings').textContent).not.toContain('Unsaved changes');
	});

	it('is held again once the card is put back as it was', async () => {
		await screen();
		const name = box(card('General'), 'Name');

		await type(name, 'Warm hands winter');
		await type(name, 'Winter coat drive');

		expect(held(button('Save general'))).toBe(true);
	});

	it('posts its own card, against the version drawn, and says it saved', async () => {
		await screen();
		await type(box(card('Settings'), 'Share message'), 'I gave to keep a child warm.');
		const saved = fixture();
		answers.push({
			body: { saved: 'campaign-settings' },
			drawn: {
				...saved,
				version: 2,
				seeds: {
					...saved.seeds,
					settings: {
						...saved.seeds.settings,
						boxes: { ...saved.seeds.settings.boxes, share_message: 'I gave to keep a child warm.' }
					}
				}
			}
		});

		await press(button('Save settings'));

		expect(posted).toHaveLength(1);
		expect(posted[0]).toMatchObject({
			[WHICH_FORM]: 'campaign-settings',
			[RECORD_VERSION]: '1',
			share_message: 'I gave to keep a child warm.'
		});
		expect(button('Save settings').textContent).toContain('Saved');
	});
});

describe('Goal and amounts', () => {
	it('asks how much to raise only for a fixed goal', async () => {
		await screen();
		const goal = card('Goal and amounts');
		expect(goal.textContent).not.toContain('How much money do you want to raise?');

		const fixed = [...goal.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
			(one) => one.value === 'fixed'
		);
		await press(fixed as HTMLInputElement);

		expect(goal.textContent).toContain('How much money do you want to raise?');
		expect(held(button('Save goal and amounts'))).toBe(false);
	});

	it('holds Add at four amounts, saying why', async () => {
		await screen();
		const add = button('Add an amount');

		for (let n = 0; n < 3; n += 1) await press(add);

		expect(card('Goal and amounts').querySelectorAll('input[aria-label^="Amount "]')).toHaveLength(
			4
		);
		expect(held(add)).toBe(true);
		expect(card('Goal and amounts').textContent).toContain('You can suggest up to 4 amounts.');
		await press(add);
		expect(card('Goal and amounts').querySelectorAll('input[aria-label^="Amount "]')).toHaveLength(
			4
		);
	});

	it('counts a label’s characters against its forty', async () => {
		await screen();
		const label = box(card('Goal and amounts'), 'Label for amount 1');
		const counter = document.getElementById(`${label.id}-count`);
		expect(counter?.textContent).toBe('0/40');

		await type(label, 'A scarf');

		expect(counter?.textContent).toBe('7/40');
		expect(held(button('Save goal and amounts'))).toBe(false);
	});

	it('posts every box it states, an empty goal among them where there is none', async () => {
		await screen();
		await type(box(card('Goal and amounts'), 'Label for amount 1'), 'A scarf');
		answers.push({ body: { saved: 'campaign-goal' } });

		await press(button('Save goal and amounts'));

		expect(posted[0]).toEqual({
			[WHICH_FORM]: 'campaign-goal',
			[RECORD_VERSION]: '1',
			goal_mode: 'none',
			goal_amount: '',
			'amount[0]': '25',
			'amount_label[0]': 'A scarf'
		});
	});
});

describe('Media', () => {
	it('holds Save media while a photo uploads, and offers it once the upload lands', async () => {
		vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
		await screen();
		const banner = card('Media').querySelector('input[type="file"]') as HTMLInputElement;
		Object.defineProperty(banner, 'files', {
			value: [new File(['jpg'], 'coats.jpg', { type: 'image/jpeg' })]
		});

		await act(async () => {
			banner.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await settle();

		expect(upload).not.toBeNull();
		expect(held(button('Save media'))).toBe(true);

		await act(async () => {
			upload?.resolve(Response.json({ id: 'img1', width: 1600, height: 400 }));
		});
		await settle();

		expect(held(button('Save media'))).toBe(false);
		expect(
			card('Media').querySelector<HTMLInputElement>('input[name="hero_image_id"]')?.value
		).toBe('img1');
		expect(held(button('Reset', card('Media')))).toBe(false);
	});
});

describe('the banner', () => {
	const banner = () => document.querySelector('.adm-banner') as HTMLElement;
	const presses = () =>
		[...banner().querySelectorAll('button, a')].map((one) => one.textContent?.trim());

	it('says a campaign never published is not public, offering Publish and the draft’s preview', async () => {
		await screen();

		expect(banner().textContent).toContain('Your campaign is not public yet');
		expect(presses()).toEqual(['Publish', 'Preview page']);
		expect(banner().querySelector('a')?.getAttribute('href')).toBe('/preview/p1');
	});

	it('says a public campaign is public, with its address, Unpublish and the live page', async () => {
		drawn = fixture('public');
		await screen();

		expect(banner().textContent).toContain('Your campaign is public');
		expect(banner().textContent).toContain('give.example.org/winter-coat-drive');
		expect(presses()).toEqual(['Unpublish', 'View live page']);
		const live = banner().querySelector('a');
		expect(live?.getAttribute('href')).toBe('/winter-coat-drive');
		expect(live?.getAttribute('target')).toBe('_blank');
	});

	it('says saved changes are not public yet, offering Publish changes and Unpublish', async () => {
		drawn = fixture('changed');
		await screen();

		expect(banner().textContent).toContain('Changes not public yet');
		expect(presses()).toEqual(['Publish changes', 'Unpublish', 'View live page']);
	});

	it('posts Publish changes and Unpublish against the version drawn', async () => {
		drawn = fixture('changed');
		await screen();
		answers.push({ body: { published: true, undoable: true } });

		await press(button('Publish changes'));

		answers.push({ body: { unpublished: true } });
		await press(button('Unpublish'));

		expect(posted.map((body) => [body[WHICH_FORM], body[RECORD_VERSION]])).toEqual([
			['page-publish', '1'],
			['page-unpublish', '1']
		]);
	});

	it('says why a press was refused, beside the banner', async () => {
		await screen();
		answers.push({
			status: 422,
			body: {
				form: {
					id: 'page-publish',
					result: { status: 'error', error: { '': ['the end date has passed'] } }
				}
			}
		});

		await press(button('Publish'));

		expect(document.body.textContent).toContain('the end date has passed');
	});
});
