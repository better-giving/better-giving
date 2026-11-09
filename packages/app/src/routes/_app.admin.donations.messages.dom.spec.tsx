import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { WHICH_FORM } from '$lib/forms/definition';
import { invalid } from '$lib/server/conform';
import PublicMessagesScreen from './_app.admin.donations.messages';

// Public messages as the route mounts it: what Hide and Show again post through the screen's one
// fetcher, the press held while it is out, a landed press drawn over the re-read rows, and a
// refusal carried back to the row it names. the loader and the action are stand-ins, one drawing
// the rows below, the other recording each body and answering what the case scripts; what the real
// ones do is ./_app.admin.donations.messages.db.spec.ts's.

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
type Answer =
	| { readonly landed: 'hidden' | 'shown'; readonly rows: Row[] }
	| { readonly refuse: string; readonly form: string; readonly status: 404 | 500 }
	| 'hang';

let rows: Row[];
let posted: Record<string, string>[];
let answers: Answer[];

beforeEach(() => {
	rows = [MAYA, DEV];
	posted = [];
	answers = [];
});

const never = () => new Promise<never>(() => {});

async function answer({ request }: { request: Request }) {
	const body = await request.formData();
	posted.push(Object.fromEntries([...body].map(([k, v]) => [k, String(v)])));
	const next = answers.shift();
	if (next === undefined) throw new Error('the action was posted to with no answer ready');
	if (next === 'hang') return never();
	const donationId = String(body.get('donation_id'));
	if ('landed' in next) {
		rows = next.rows;
		return { landed: next.landed, donationId };
	}
	// the real refusal's own shape, built by the helper the action answers with.
	return invalid(
		next.status,
		{ id: next.form, result: { status: 'error', error: { '': [next.refuse] } } },
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
			loader: () => ({ messages: rows, total: rows.length, limit: 500 }),
			action: answer,
			HydrateFallback: () => null,
			Component: Screen
		}
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
});
