import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import Zapier from './_app.admin.integrations.zapier';

// what the Zapier page draws from its reading and does with the answers its presses get: the key
// shown once in the card, a refusal said under the key, the question a replace asks and the strip
// over a feed that stopped. the server half is ./_app.admin.integrations.zapier.workers.spec.ts;
// what is asserted here is words, focus and which element is on the page, never a class or a
// computed style.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** `appendChild` for the reason ./_app.admin.members.dom.spec.tsx gives. */
function mount(tree: ReactNode): HTMLElement {
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

const SCREEN = '/admin/integrations/zapier';
const KEY = 'bgz_7Qm2Xc9Lr4Tz8Vh1Nw6Pd3Ks5Yb0EjRaQm2Xc9LpEjRa';
const ADDRESS = 'https://give.riverbanktrust.org';

type Reading = {
	address: string;
	report: {
		key: { prefix: string; lastFour: string; madeAt: string } | null;
		listening: { newGift: number; newDonor: number; giftRefunded: number };
		deliveries: { waiting: number; failed: number; oldestWaitingAt: string | null };
	};
	late: boolean;
	replacing: boolean;
};

const NOBODY = { newGift: 0, newDonor: 0, giftRefunded: 0 };
const QUIET = { waiting: 0, failed: 0, oldestWaitingAt: null };
const HELD = { prefix: 'bgz_7Qm2', lastFour: 'EjRa', madeAt: '2026-09-28T12:00:00.000Z' };

function reading(over: Partial<Reading> = {}, report: Partial<Reading['report']> = {}): Reading {
	return {
		address: ADDRESS,
		late: false,
		replacing: false,
		...over,
		report: { key: null, listening: NOBODY, deliveries: QUIET, ...report }
	};
}

/** the page as the server drew it, with no router round behind it. */
function screen(loaderData: Reading, actionData?: object): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: SCREEN,
			Component: () =>
				createElement(Zapier as never, { loaderData, actionData, params: {}, matches: [] })
		}
	]);
	return mount(createElement(Stub, { initialEntries: [SCREEN] }));
}

/** the one dialog on the page, wherever the top layer put it. */
const card = () => document.querySelector('dialog');

function named(root: Element | null | undefined, name: string): HTMLElement {
	const found = [...(root?.querySelectorAll<HTMLElement>('button, a') ?? [])].find(
		(control) => control.getAttribute('aria-label') === name || control.textContent?.trim() === name
	);
	if (!found) throw new Error(`nothing named ${name} to press`);
	return found;
}

const keyBox = (root: HTMLElement) =>
	root.querySelector<HTMLInputElement>('input[aria-label="Zapier key"]');

it('draws the three triggers, the address and an empty key box with Make key before a key', () => {
	const root = screen(reading());

	expect(root.textContent).toContain('Settled gifts');
	expect(root.textContent).toContain('New donors');
	expect(root.textContent).toContain('Refunds');
	expect(root.textContent).not.toContain('listening');
	expect(root.querySelector('[role="group"]')?.textContent).toContain(ADDRESS);
	expect(keyBox(root)?.value).toBe('');
	expect(keyBox(root)?.readOnly).toBe(true);
	expect(named(root, 'Make key').tagName).toBe('BUTTON');
});

it('counts the Zaps listening on each trigger, and says nothing where none listens', () => {
	const root = screen(
		reading({}, { key: HELD, listening: { newGift: 2, newDonor: 1, giftRefunded: 0 } })
	);

	const lines = [...root.querySelectorAll('li')].map((li) => li.textContent);
	expect(lines).toEqual(['Settled gifts2 Zaps listening', 'New donors1 Zap listening', 'Refunds']);
});

it('shows only the key’s head and tail, with Replace key beside it', () => {
	const root = screen(reading({}, { key: HELD }));

	expect(keyBox(root)?.value).toBe('bgz_7Qm2••••••••••••EjRa');
	expect(named(root, 'Replace key').getAttribute('href')).toBe(`${SCREEN}?confirm=replace`);
});

/** lets the stub's loader and action run and the router commit what they answered. */
async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
	}
}

type Answer = 'made' | 'replaced' | 'key_exists' | 'conflict';

/**
 * the page over a loader and an action standing in for the route's own, so a press runs the whole
 * round — which is what the route's server half does (the workers spec beside this one).
 */
async function flow(at: string, start: Reading['report']['key'], answer: Answer) {
	let key = start;
	const Stub = createRoutesStub([
		{
			path: SCREEN,
			Component: Zapier as never,
			// framework mode with SSR reads the loader again after every submission, a refused one
			// included; the stub is data mode, which skips it after a 4xx unless told.
			shouldRevalidate: () => true,
			loader: ({ request }) =>
				reading(
					{ replacing: key !== null && new URL(request.url).searchParams.has('confirm') },
					{ key, listening: { newGift: 2, newDonor: 1, giftRefunded: 0 } }
				),
			action: async ({ request }) => {
				const form = String((await request.formData()).get('__form_id__'));
				const refuse = (sentence: string) =>
					data(
						{
							form: {
								id: form,
								result: { initialValue: {}, error: { '': [sentence] }, status: 'error' }
							}
						},
						{ status: 409 }
					);
				if (answer === 'key_exists') {
					key = HELD;
					return refuse('A key was already made.');
				}
				if (answer === 'conflict') return refuse('Another replace landed first.');
				key = { ...HELD, lastFour: 'Wx9z' };
				return {
					made: {
						press: answer === 'made' ? 'make' : 'replace',
						key: KEY,
						madeAt: HELD.madeAt,
						disconnected: answer === 'made' ? 0 : 3,
						paused: answer === 'made' ? 0 : 2,
						notPaused: answer === 'made' ? 0 : 1
					}
				};
			}
		}
	]);
	const root = mount(createElement(Stub, { initialEntries: [at] }));
	await settle();
	return root;
}

it('shows the key it made once, then puts focus on Replace key, which stands where Make key was', async () => {
	const root = await flow(SCREEN, null, 'made');

	await act(async () => named(root, 'Make key').click());
	await settle();

	expect(card()?.querySelector('h2')?.textContent).toBe('Copy the key for Zapier');
	expect(card()?.textContent).toContain(KEY);
	act(() => named(card(), 'Done').click());

	expect(card()).toBeNull();
	expect(document.body.textContent).not.toContain(KEY);
	expect(document.activeElement).toBe(named(root, 'Replace key'));
});

it('asks before a replace, itemising the Zaps it disconnects', async () => {
	await flow(`${SCREEN}?confirm=replace`, HELD, 'replaced');

	expect(card()?.querySelector('h2')?.textContent).toBe('Replace the Zapier key?');
	expect(card()?.textContent).toContain('The key ending EjRa stops working.');
	expect(card()?.textContent).toContain('3 Zaps disconnect: 2 on settled gifts, 1 on new donors.');
	expect(named(card(), 'Yes, replace').tagName).toBe('BUTTON');
});

it('shows the new key once after a replace, and says which Zaps still read as on', async () => {
	const root = await flow(`${SCREEN}?confirm=replace`, HELD, 'replaced');

	await act(async () => named(card(), 'Yes, replace').click());
	await settle();

	expect(card()?.querySelector('h2')?.textContent).toBe('Copy the key for Zapier');
	expect(card()?.textContent).toContain(KEY);
	act(() => named(card(), 'Done').click());
	expect(keyBox(root)?.value).toBe('bgz_7Qm2••••••••••••Wx9z');
	expect(root.textContent).toContain('3 Zaps disconnected');
	expect(root.textContent).toContain('1 of them still reads as on in Zapier');
});

it('says a refused make under the key, points the press at it and puts focus there', async () => {
	const root = await flow(SCREEN, null, 'key_exists');

	await act(async () => named(root, 'Make key').click());
	await settle();

	const press = named(root, 'Replace key');
	const said = document.getElementById(press.getAttribute('aria-describedby') ?? '');
	expect(said?.textContent).toContain('A key was already made.');
	expect(document.activeElement).toBe(press);
});

it('takes the question down on a refused replace and says why at the key row', async () => {
	const root = await flow(`${SCREEN}?confirm=replace`, HELD, 'conflict');

	await act(async () => named(card(), 'Yes, replace').click());
	await settle();

	expect(card()).toBeNull();
	const press = named(root, 'Replace key');
	const said = document.getElementById(press.getAttribute('aria-describedby') ?? '');
	expect(said?.textContent).toContain('Another replace landed first.');
	expect(document.activeElement).toBe(press);
});

it('draws a red strip over deliveries given up, linking to the operator’s Zaps', () => {
	const root = screen(reading({}, { key: HELD, deliveries: { ...QUIET, failed: 3 } }));

	const strip = root.querySelector('[role="alert"]');
	expect(strip?.textContent).toContain('3 deliveries to your Zaps were given up in the past week');
	expect(named(strip, 'Open your Zaps').getAttribute('href')).toBe('https://zapier.com/app/zaps');
});

it('draws an amber strip when the Zaps are more than an hour behind, and no strip otherwise', () => {
	const behind = screen(
		reading(
			{ late: true },
			{ key: HELD, deliveries: { ...QUIET, waiting: 4, oldestWaitingAt: HELD.madeAt } }
		)
	);
	expect(behind.querySelector('[role="status"]')?.textContent).toContain(
		'4 deliveries are waiting, the oldest for over an hour.'
	);

	const quiet = screen(reading({}, { key: HELD }));
	expect(quiet.textContent).not.toContain('Open your Zaps');
});

it('says every disconnected Zap still reads as on where Zapier paused none of them', () => {
	const root = screen(reading({}, { key: HELD }), {
		made: {
			press: 'replace',
			key: KEY,
			madeAt: HELD.madeAt,
			disconnected: 3,
			paused: 0,
			notPaused: 3
		}
	});

	expect(root.textContent).toContain('3 Zaps disconnected');
	expect(root.textContent).toContain('They still read as on in Zapier.');
	expect(root.textContent).not.toContain('of them');
});
