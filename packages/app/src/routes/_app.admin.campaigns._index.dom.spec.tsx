import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, Outlet, redirect, useActionData, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import Campaigns from './_app.admin.campaigns._index';

// the Campaigns list as the route mounts it: the rows each state draws, the ended ones apart, and
// what New campaign, End, Delete and Publish post — each press held from its post through the
// redirect's load. the loader and the action are stand-ins, one drawing the rows below and the
// dialog its address asks for, the other recording each body and answering what the case scripts;
// what the real ones do is ./_app.admin.campaigns._index.workers.spec.ts's.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen: nothing here reads a computed
// style, and the classes named below are read as structure.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SCREEN = '/admin/campaigns';

type Loaded = Parameters<typeof Campaigns>[0]['loaderData'];
type Row = Loaded['campaigns'][number];

const LIVE: Row = {
	id: 'pg_live',
	name: 'Winter coat drive',
	address: '/winter-coat-drive',
	state: 'live',
	version: 11,
	goal: '$15K',
	ends: 'Dec 31, 2026'
};

const UNPUBLISHED: Row = {
	id: 'pg_draft',
	name: 'Spring gala',
	address: '/spring-gala',
	state: 'never_published',
	version: 12,
	goal: null,
	ends: null
};

const ENDED: Row = {
	id: 'pg_ended',
	name: 'Giving Tuesday',
	address: '/giving-tuesday',
	state: 'ended',
	version: 13,
	goal: '$5K',
	ends: 'Dec 3, 2025'
};

/** what the action does with the next post: refuse it, redirect, or never settle. */
type Answer =
	| { readonly refuse: unknown; readonly status: number }
	| {
			readonly redirect: string;
			readonly thenHoldLoads?: boolean;
			/** the press landed: the rows it leaves, and the flash the redirect carries. */
			readonly landed?: { readonly rows: Row[]; readonly flash: NonNullable<Loaded['landed']> };
	  }
	| 'hang';

let rows: Row[];
let posted: Record<string, string>[];
let answers: Answer[];
/** set once a redirect is to leave its load unsettled. */
let holdLoads: boolean;
/** the flash the next load takes, one-shot as the real one is. */
let flash: Loaded['landed'];

beforeEach(() => {
	rows = [LIVE, UNPUBLISHED, ENDED];
	posted = [];
	answers = [];
	holdLoads = false;
	flash = null;
});

const never = () => new Promise<never>(() => {});

/** the rows split as the list draws them, and the dialog the address asks for. */
async function load({ request }: { request: Request }): Promise<Loaded> {
	if (holdLoads) return never();
	const url = new URL(request.url);
	const asked = (param: string, state: Row['state']) =>
		rows.find((row) => row.id === url.searchParams.get(param) && row.state === state) ?? null;
	const landed = flash;
	flash = null;
	return {
		campaigns: rows.filter((row) => row.state !== 'ended'),
		ended: rows.filter((row) => row.state === 'ended'),
		asking: url.searchParams.has('new'),
		ending: asked('end', 'live'),
		deleting: asked('delete', 'never_published'),
		landed
	};
}

async function answer({ request }: { request: Request }) {
	posted.push(Object.fromEntries([...(await request.formData())].map(([k, v]) => [k, String(v)])));
	const next = answers.shift();
	if (next === undefined) throw new Error('the action was posted to with no answer ready');
	if (next === 'hang') return never();
	if ('redirect' in next) {
		holdLoads = next.thenHoldLoads ?? false;
		if (next.landed) {
			rows = next.landed.rows;
			flash = next.landed.flash;
		}
		return redirect(next.redirect);
	}
	return Response.json(next.refuse, { status: next.status });
}

function List() {
	return createElement(Campaigns as never, {
		loaderData: useLoaderData<Loaded>(),
		actionData: useActionData(),
		params: {},
		matches: []
	});
}

function mount(tree: ReactNode) {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

async function screen(at = SCREEN): Promise<HTMLElement> {
	const Stub = createRoutesStub([
		{
			// the protected layout's own name for the screen, which a press whose row is gone lands on.
			Component: () =>
				createElement(
					'main',
					null,
					createElement('h1', { className: 'adm-vh', tabIndex: -1 }, 'Campaigns'),
					createElement(Outlet)
				),
			children: [
				{
					path: SCREEN,
					loader: load,
					action: answer,
					HydrateFallback: () => null,
					Component: List
				}
			]
		},
		{
			path: `${SCREEN}/:pageId`,
			loader: () => (holdLoads ? never() : null),
			HydrateFallback: () => null,
			Component: () => createElement('p', null, 'the editor')
		}
	]);
	const root = mount(createElement(Stub, { initialEntries: [at] }));
	await settle();
	return root;
}

/** a round of the event loop, so the router's promises settle. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function control<E extends HTMLElement = HTMLElement>(
	name: string,
	within: Element | Document = document
): E {
	const found = [...within.querySelectorAll<E>('button, a')].find(
		(one) => one.getAttribute('aria-label') === name || one.textContent?.trim() === name
	);
	if (found === undefined) throw new Error(`no control named ${name}`);
	return found;
}

/** the card whose heading reads `title`, or null where none is up. */
function card(title: string): HTMLDialogElement | null {
	return (
		[...document.querySelectorAll('dialog')].find(
			(one) => one.querySelector('h2')?.textContent === title
		) ?? null
	);
}

function shown(title: string): HTMLDialogElement {
	const found = card(title);
	if (found === null) throw new Error(`no card is headed ${title}`);
	return found;
}

/** the record the list draws for `name`, which is never the create card's hidden sample. */
function record(root: HTMLElement, name: string): HTMLElement {
	const found = [...root.querySelectorAll<HTMLElement>('article.adm-record')].find(
		(one) => one.querySelector('h2')?.textContent === name
	);
	if (found === undefined) throw new Error(`no record for ${name}`);
	return found;
}

async function press(target: HTMLElement) {
	await act(async () => {
		target.focus();
		target.click();
	});
	await settle();
}

/** writes `text` into a box the way typing would, so react hears it. */
function typeInto(box: HTMLInputElement | HTMLTextAreaElement, text: string): void {
	const proto = box instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
	act(() => {
		Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(box, text);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

function box(within: Element, name: string): HTMLInputElement | HTMLTextAreaElement {
	const found = within.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
	if (found === null) throw new Error(`no box named ${name}`);
	return found;
}

describe('the list', () => {
	it('draws the create card and nothing else while there are no campaigns', async () => {
		rows = [];
		const root = await screen();

		expect(root.querySelectorAll('article.adm-record')).toHaveLength(0);
		expect(root.querySelector('.adm-list')?.childElementCount).toBe(1);
		expect(root.textContent).not.toContain('Ended (');
	});

	it('draws a live row as a link to its address with End, and an unpublished one as bare text with Delete', async () => {
		const root = await screen();

		const live = record(root, 'Winter coat drive');
		expect(live.textContent).toContain('Live');
		expect(live.textContent).toContain('Goal $15K · Ends Dec 31, 2026');
		const open = control('Open Winter coat drive at /winter-coat-drive', live);
		expect(open.getAttribute('href')).toBe('/winter-coat-drive');
		// the same chip an unpublished row draws, standing in its list's own item.
		expect(open.parentElement?.tagName).toBe('LI');
		expect(open.querySelector('code.adm-chip')?.textContent).toBe('/winter-coat-drive');
		expect(control('End Winter coat drive', live).getAttribute('href')).toBe(
			'/admin/campaigns?end=pg_live'
		);

		const unpublished = record(root, 'Spring gala');
		expect(unpublished.textContent).toContain('Not published');
		expect(unpublished.querySelector('code')?.textContent).toBe('/spring-gala');
		expect(unpublished.querySelector('a[href="/spring-gala"]')).toBeNull();
		expect(control('Delete Spring gala', unpublished).getAttribute('href')).toBe(
			'/admin/campaigns?delete=pg_draft'
		);
	});

	it('puts the ended campaigns in a group of their own, each with Publish', async () => {
		const root = await screen();
		const group = root.querySelector<HTMLDetailsElement>('details.adm-disclosure');
		if (group === null) throw new Error('no Ended group');

		expect(group.querySelector('summary')?.textContent).toBe('Ended (1)');
		const ended = record(group, 'Giving Tuesday');
		expect(ended.textContent).toContain('Ended Dec 3, 2025');
		expect(control('Publish Giving Tuesday', ended).tagName).toBe('BUTTON');
		const main = root.querySelector('.adm-list');
		expect(main?.contains(ended)).toBe(false);
		expect([...(main?.querySelectorAll('article h2') ?? [])].map((h) => h.textContent)).toEqual([
			'Winter coat drive',
			'Spring gala'
		]);
	});
});

describe('New campaign', () => {
	const ZONE = 'America/Chicago';

	/** the browser's zone, as the dialog reads it. */
	function browserIn(zone: string) {
		const real = Intl.DateTimeFormat.prototype.resolvedOptions;
		vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
			this: Intl.DateTimeFormat
		) {
			return { ...real.call(this), timeZone: zone };
		});
	}

	async function opened(): Promise<HTMLDialogElement> {
		const root = await screen();
		// the card leading the list; its text carries the hidden sample's too.
		const create = root.querySelector<HTMLAnchorElement>('.adm-list > a:first-child');
		if (create === null) throw new Error('no create card');
		await press(create);
		return shown('New campaign');
	}

	it('posts the title alone, and the browser’s zone, when nothing says what it’s for', async () => {
		browserIn(ZONE);
		answers = [{ redirect: `${SCREEN}/pg_new` }];
		const dialog = await opened();

		typeInto(box(dialog, 'title'), 'Winter coat drive');
		await press(control('Create', dialog));

		expect(posted).toEqual([
			{
				[WHICH_FORM]: 'campaign-create',
				title: 'Winter coat drive',
				purpose: '',
				time_zone: ZONE
			}
		]);
		expect(document.body.textContent).toContain('the editor');
	});

	it('posts what it’s for beside the title, and the browser’s zone', async () => {
		browserIn(ZONE);
		answers = [{ redirect: `${SCREEN}/pg_new?chat` }];
		const dialog = await opened();

		typeInto(box(dialog, 'title'), 'Winter coat drive');
		typeInto(box(dialog, 'purpose'), 'coats for 300 kids, goal $15k by Dec 31');
		await press(control('Create', dialog));

		expect(posted).toEqual([
			{
				[WHICH_FORM]: 'campaign-create',
				title: 'Winter coat drive',
				purpose: 'coats for 300 kids, goal $15k by Dec 31',
				time_zone: ZONE
			}
		]);
	});

	it('refuses a blank title at its box, posting nothing', async () => {
		const dialog = await opened();

		typeInto(box(dialog, 'title'), '   ');
		await press(control('Create', dialog));

		expect(posted).toEqual([]);
		const title = box(dialog, 'title');
		expect(title.getAttribute('aria-invalid')).toBe('true');
		const said = document.getElementById(title.getAttribute('aria-describedby') ?? '');
		expect(said?.textContent).toContain('Give the campaign a title.');
	});
});

describe('a row’s press', () => {
	it('asks before ending a live campaign, then posts End with the row’s version', async () => {
		answers = [{ redirect: SCREEN }];
		const root = await screen();

		await press(control('End Winter coat drive', record(root, 'Winter coat drive')));
		const asked = shown('End Winter coat drive?');
		expect(posted).toEqual([]);

		await press(control('End campaign', asked));

		expect(posted).toEqual([
			{ [WHICH_FORM]: 'campaign-end', [RECORD_VERSION]: '11', page_id: 'pg_live' }
		]);
		expect(card('End Winter coat drive?')).toBeNull();
	});

	it('asks before deleting a never-published campaign, then posts Delete with the row’s version', async () => {
		answers = [{ redirect: SCREEN }];
		const root = await screen();

		await press(control('Delete Spring gala', record(root, 'Spring gala')));
		const asked = shown('Delete Spring gala?');
		expect(asked.textContent).toContain('It was never published.');
		expect(posted).toEqual([]);

		await press(control('Delete campaign', asked));

		expect(posted).toEqual([
			{ [WHICH_FORM]: 'campaign-delete', [RECORD_VERSION]: '12', page_id: 'pg_draft' }
		]);
		expect(card('Delete Spring gala?')).toBeNull();
	});

	it('publishes an ended campaign at once, with the row’s version', async () => {
		answers = [{ redirect: SCREEN }];
		const root = await screen();

		await press(control('Publish Giving Tuesday', record(root, 'Giving Tuesday')));

		expect(posted).toEqual([
			{ [WHICH_FORM]: 'campaign-publish', [RECORD_VERSION]: '13', page_id: 'pg_ended' }
		]);
	});

	it('says a refused Publish on the row it was pressed on', async () => {
		const text = 'Nothing was published: this campaign’s end date has passed. Change it first.';
		rows = [LIVE, ENDED, { ...ENDED, id: 'pg_other', name: 'Spring appeal', version: 14 }];
		answers = [
			{
				refuse: {
					pageId: 'pg_ended',
					form: { id: 'campaign-publish', result: { status: 'error', error: { '': [text] } } }
				},
				status: 422
			}
		];
		const root = await screen();

		await press(control('Publish Giving Tuesday', record(root, 'Giving Tuesday')));

		const refused = record(root, 'Giving Tuesday').textContent;
		expect(refused).toContain('Not published');
		expect(refused).toContain(text);
		expect(record(root, 'Spring appeal').textContent).not.toContain(text);
	});
});

describe('a press in flight', () => {
	/** the post, pressed a second time while it is still in flight. */
	async function pressedTwice(target: () => HTMLElement): Promise<HTMLElement> {
		await press(target());
		const held = target();
		await press(held);
		return held;
	}

	it.each([
		['while its post is unanswered', 'hang' as const],
		['while the redirect it was answered with loads', { redirect: SCREEN, thenHoldLoads: true }]
	])('holds Publish %s', async (_, first) => {
		answers = [first];
		const root = await screen();

		const held = await pressedTwice(() =>
			control('Publish Giving Tuesday', record(root, 'Giving Tuesday'))
		);

		expect(posted).toHaveLength(1);
		expect(held.getAttribute('aria-disabled')).toBe('true');
		expect(held.getAttribute('aria-busy')).toBe('true');
	});

	it.each([
		['while its post is unanswered', 'hang' as const],
		['while the redirect it was answered with loads', { redirect: SCREEN, thenHoldLoads: true }]
	])('holds End campaign %s', async (_, first) => {
		answers = [first];
		await screen(`${SCREEN}?end=pg_live`);

		const held = await pressedTwice(() => control('End campaign', shown('End Winter coat drive?')));

		expect(posted).toHaveLength(1);
		expect(held.getAttribute('aria-disabled')).toBe('true');
	});

	it.each([
		['while its post is unanswered', 'hang' as const],
		['while the redirect it was answered with loads', { redirect: SCREEN, thenHoldLoads: true }]
	])('holds Delete %s', async (_, first) => {
		answers = [first];
		await screen(`${SCREEN}?delete=pg_draft`);

		const held = await pressedTwice(() => control('Delete campaign', shown('Delete Spring gala?')));

		expect(posted).toHaveLength(1);
		expect(held.getAttribute('aria-disabled')).toBe('true');
	});

	it.each([
		['while its post is unanswered', 'hang' as const],
		[
			'while the redirect it was answered with loads',
			{ redirect: `${SCREEN}/pg_new`, thenHoldLoads: true }
		]
	])('holds Create %s', async (_, first) => {
		answers = [first];
		await screen(`${SCREEN}?new`);
		typeInto(box(shown('New campaign'), 'title'), 'Winter coat drive');

		const held = await pressedTwice(() => control('Create', shown('New campaign')));

		expect(posted).toHaveLength(1);
		expect(held.getAttribute('aria-disabled')).toBe('true');
	});
});

describe('a press that lands', () => {
	/** the list's status region, which is on the page before anything is said in it. */
	function status(root: HTMLElement): HTMLElement {
		const found = root.querySelector<HTMLElement>('[role="status"]');
		if (found === null) throw new Error('no status region');
		return found;
	}

	it('says nothing, in a region already on the list, before any press', async () => {
		const root = await screen();

		expect(status(root).textContent).toBe('');
	});

	it('puts focus on a published row’s title, in the list it moved to, and says Published', async () => {
		const live = { ...ENDED, state: 'live' as const };
		answers = [
			{
				redirect: SCREEN,
				landed: {
					rows: [LIVE, UNPUBLISHED, live],
					flash: { outcome: 'published', pageId: ENDED.id }
				}
			}
		];
		const root = await screen();
		const region = status(root);

		await press(control('Publish Giving Tuesday', record(root, 'Giving Tuesday')));

		const title = record(root, 'Giving Tuesday').querySelector('h2 a');
		expect(root.querySelector('.adm-list')?.contains(title ?? null)).toBe(true);
		expect(document.activeElement).toBe(title);
		expect(status(root)).toBe(region);
		expect(region.textContent).toBe('Published');
	});

	it('puts focus on the Ended group an ended row moved into, and says Ended', async () => {
		answers = [
			{
				redirect: SCREEN,
				landed: {
					rows: [{ ...LIVE, state: 'ended' }, UNPUBLISHED, ENDED],
					flash: { outcome: 'ended', pageId: LIVE.id }
				}
			}
		];
		const root = await screen(`${SCREEN}?end=pg_live`);
		const region = status(root);

		await press(control('End campaign', shown('End Winter coat drive?')));

		const group = root.querySelector<HTMLDetailsElement>('details.adm-disclosure');
		expect(group?.open).toBe(false);
		expect(document.activeElement).toBe(group?.querySelector('summary'));
		expect(region.textContent).toBe('Ended');
	});

	it('puts focus on the list’s heading when the deleted row is gone, and says Deleted', async () => {
		answers = [
			{
				redirect: SCREEN,
				landed: { rows: [LIVE, ENDED], flash: { outcome: 'deleted', pageId: null } }
			}
		];
		const root = await screen(`${SCREEN}?delete=pg_draft`);
		const region = status(root);

		await press(control('Delete campaign', shown('Delete Spring gala?')));

		expect(document.activeElement?.tagName).toBe('H1');
		expect(document.activeElement?.textContent).toBe('Campaigns');
		expect(region.textContent).toBe('Deleted');
	});

	it('moves nobody when the list is opened with no press behind it', async () => {
		flash = null;
		await screen();

		expect(document.activeElement).toBe(document.body);
	});
});
