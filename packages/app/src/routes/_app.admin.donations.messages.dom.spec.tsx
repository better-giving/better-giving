import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { WHICH_FORM } from '$lib/forms/definition';
import { invalid } from '$lib/server/conform';
import PublicMessagesScreen from './_app.admin.donations.messages';

// Public messages as the route mounts it: what Hide and Show again post through each row's own
// fetcher, the press held while it is out, a landed press drawn over the re-read rows, a refusal
// carried back to the row it names, and Show older messages paging through the older read. the
// loaders and the action are stand-ins, the loaders drawing the rows below, the action recording
// each body and answering what the case scripts; what the real ones do is
// ./_app.admin.donations.messages.db.spec.ts's and ./_app.admin.donations.messages.older.db.spec.ts's.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SCREEN = '/admin/donations/messages';

type Loaded = Parameters<typeof PublicMessagesScreen>[0]['loaderData'];
type Row = Loaded['messages'][number];

const MAYA: Row = {
	id: 'gift-maya',
	name: 'Maya R.',
	note: 'Paying it forward.',
	receivedAt: '2026-11-08T15:00:00.000Z',
	hidden: false
};
const DEV: Row = {
	id: 'gift-dev',
	name: 'Dev P.',
	note: 'Great work! Visit cheap-watches.example for deals.',
	receivedAt: '2026-10-29T15:00:00.000Z',
	hidden: true
};

/** what the action does with the next post: land it, leaving these rows, refuse it, or never settle. */
type Settled =
	| { readonly landed: 'hidden' | 'shown'; readonly rows: Row[]; readonly olderRows?: Row[] }
	| { readonly refuse: string; readonly form: string; readonly status: 404 | 500 }
	| 'hang';
/** a settled answer, or one held until `once` resolves. */
type Answer = Settled | { readonly once: Promise<void>; readonly answer: Settled };

const ANA: Row = {
	id: 'gift-ana',
	name: 'Ana L.',
	note: 'For the river cleanup.',
	receivedAt: '2026-09-02T15:00:00.000Z',
	hidden: false
};

let rows: Row[];
/** the cursor the first page ends on, and the rows past it, which the older read pages through. */
let next: string | null;
let olderRows: Row[];
let posted: Record<string, string>[];
let answers: Answer[];
let olderAsked: string[];
let olderNext: string | null;
let olderRefused: boolean;

beforeEach(() => {
	rows = [MAYA, DEV];
	next = null;
	olderRows = [];
	posted = [];
	answers = [];
	olderAsked = [];
	olderNext = null;
	olderRefused = false;
});

/** the older read's stand-in: `olderRows` whatever count of pages is asked, or a refusal. */
function olderRead({ request }: { request: Request }) {
	const url = new URL(request.url);
	olderAsked.push(`${url.pathname}${url.search}`);
	// the screen tells a refusal by its `kind`, so the real read's 4xx/5xx status is left off here.
	if (olderRefused) return { kind: 'refused' };
	return { kind: 'messages', messages: olderRows, next: olderNext };
}

const never = () => new Promise<never>(() => {});

async function answer({ request }: { request: Request }) {
	const body = await request.formData();
	posted.push(Object.fromEntries([...body].map(([k, v]) => [k, String(v)])));
	const due = answers.shift();
	if (due === undefined) throw new Error('the action was posted to with no answer ready');
	let settled: Settled;
	if (typeof due === 'object' && 'once' in due) {
		await due.once;
		settled = due.answer;
	} else {
		settled = due;
	}
	if (settled === 'hang') return never();
	const donationId = String(body.get('donation_id'));
	if ('landed' in settled) {
		rows = settled.rows;
		olderRows = settled.olderRows ?? olderRows;
		return { landed: settled.landed, donationId };
	}
	// the real refusal's own shape, built by the helper the action answers with.
	return invalid(
		settled.status,
		{ id: settled.form, result: { status: 'error', error: { '': [settled.refuse] } } },
		{ donationId }
	);
}

function Screen() {
	return createElement(PublicMessagesScreen as never, {
		loaderData: useLoaderData<Loaded>(),
		params: {},
		matches: []
	});
}

function mount(tree: ReactNode) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(tree));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return host;
}

async function screen(): Promise<HTMLElement> {
	const Stub = createRoutesStub([
		{
			path: SCREEN,
			loader: () => ({ messages: rows, total: rows.length + olderRows.length, next }),
			action: answer,
			HydrateFallback: () => null,
			Component: Screen
		},
		{ path: `${SCREEN}/older`, loader: olderRead }
	]);
	const host = mount(createElement(Stub, { initialEntries: [SCREEN] }));
	await settle();
	return host;
}

/** a few rounds of the event loop, so the router's promises and the re-read settle. */
const settle = async () => {
	for (let round = 0; round < 3; round++) {
		await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
	}
};

const row = (host: HTMLElement, name: string) =>
	[...host.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(name)) ?? null;
const press = (host: HTMLElement, name: string) => {
	const found = row(host, name)?.querySelector<HTMLButtonElement>('button');
	if (found == null) throw new Error(`no press on the row of ${name}`);
	return found;
};
const showOlder = (host: HTMLElement) => {
	const found = [...host.querySelectorAll('button')].find(
		(b) => b.textContent === 'Show older messages'
	);
	if (found === undefined) throw new Error('no Show older messages on the screen');
	return found;
};
const dialog = () => document.querySelector('dialog');
const dialogButton = (label: string) => {
	const found = [...(dialog()?.querySelectorAll('button') ?? [])].find(
		(b) => b.textContent === label
	);
	if (found === undefined) throw new Error(`no ${label} in the confirm`);
	return found;
};
const click = (target: HTMLElement) => act(() => target.click());

describe('Public messages, as the route wires it', () => {
	it('posts Hide as message-hide naming the gift, held busy until it lands', async () => {
		const host = await screen();
		answers.push('hang');

		await click(press(host, 'Maya R.'));
		await click(dialogButton('Hide message'));
		await settle();

		expect(posted).toEqual([{ [WHICH_FORM]: 'message-hide', donation_id: 'gift-maya' }]);
		expect(dialogButton('Hide message').getAttribute('aria-busy')).toBe('true');
	});

	it('closes the confirm on landing and says so at the press, over the re-read row', async () => {
		const host = await screen();
		answers.push({ landed: 'hidden', rows: [{ ...MAYA, hidden: true }, DEV] });

		await click(press(host, 'Maya R.'));
		await click(dialogButton('Hide message'));
		await settle();

		expect(dialog()).toBeNull();
		expect(press(host, 'Maya R.').textContent).toBe('Hidden from your page');
		expect(row(host, 'Maya R.')?.textContent).toContain('Hidden');
	});

	it('says a refused Hide inside the confirm, which stays open', async () => {
		const host = await screen();
		const sentence = 'That message is no longer on this list.';
		answers.push({ refuse: sentence, form: 'message-hide', status: 404 });

		await click(press(host, 'Maya R.'));
		await click(dialogButton('Hide message'));
		await settle();

		expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(sentence);
		expect(dialogButton('Hide message').getAttribute('aria-busy')).toBeNull();
	});

	it('posts Show again as message-show, and says a refusal under that row’s press', async () => {
		const host = await screen();
		const sentence = 'Couldn’t show this message again. Try again.';
		answers.push({ refuse: sentence, form: 'message-show', status: 500 });

		await click(press(host, 'Dev P.'));
		await settle();

		expect(posted).toEqual([{ [WHICH_FORM]: 'message-show', donation_id: 'gift-dev' }]);
		expect(dialog()).toBeNull();
		expect(row(host, 'Dev P.')?.querySelector('[role="alert"]')?.textContent).toBe(sentence);
		expect(row(host, 'Maya R.')?.querySelector('[role="alert"]')).toBeNull();
	});

	it('draws both answers when a second row is pressed while the first is out', async () => {
		const host = await screen();
		let release = () => {};
		const devAnswered = new Promise<void>((resolve) => {
			release = resolve;
		});
		const sentence = 'Couldn’t show this message again. Try again.';
		answers.push(
			{ once: devAnswered, answer: { refuse: sentence, form: 'message-show', status: 500 } },
			{ landed: 'hidden', rows: [{ ...MAYA, hidden: true }, DEV] }
		);

		await click(press(host, 'Dev P.'));
		await click(press(host, 'Maya R.'));
		await click(dialogButton('Hide message'));
		await settle();
		release();
		await settle();

		expect(press(host, 'Maya R.').textContent).toBe('Hidden from your page');
		expect(row(host, 'Dev P.')?.querySelector('[role="alert"]')?.textContent).toBe(sentence);
	});

	it('asks for the page past the first one’s cursor and lists it under the rows it has', async () => {
		next = 'cursor/after+50';
		olderRows = [ANA];
		const host = await screen();

		await click(showOlder(host));
		await settle();

		expect(olderAsked).toEqual([
			`${SCREEN}/older?${new URLSearchParams({ after: 'cursor/after+50', pages: '1' })}`
		]);
		expect([...host.querySelectorAll('tbody tr')].map((tr) => tr.textContent)).toEqual([
			expect.stringContaining('Maya R.'),
			expect.stringContaining('Dev P.'),
			expect.stringContaining('Ana L.')
		]);
	});

	it('reads the older pages it holds again after a press, drawing an older row as it landed', async () => {
		next = 'cursor/after+50';
		olderRows = [ANA];
		const host = await screen();
		await click(showOlder(host));
		await settle();
		answers.push({ landed: 'hidden', rows, olderRows: [{ ...ANA, hidden: true }] });

		await click(press(host, 'Ana L.'));
		await click(dialogButton('Hide message'));
		await settle();

		expect(olderAsked.at(-1)).toBe(olderAsked[0]);
		expect(press(host, 'Ana L.').textContent).toBe('Hidden from your page');
		expect(row(host, 'Ana L.')?.textContent).toContain('Hidden');
		expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
	});

	it('asks for one page more from the same cursor on the next press, and keeps rows a refusal finds', async () => {
		next = 'cursor/after+50';
		olderRows = [ANA];
		olderNext = 'cursor/after+100';
		const host = await screen();
		await click(showOlder(host));
		await settle();
		olderRefused = true;

		await click(showOlder(host));
		await settle();

		expect(olderAsked.at(-1)).toBe(
			`${SCREEN}/older?${new URLSearchParams({ after: 'cursor/after+50', pages: '2' })}`
		);
		expect(row(host, 'Ana L.')).not.toBeNull();
		expect(host.textContent).toContain('Couldn’t load older messages. Try again.');
	});
});
