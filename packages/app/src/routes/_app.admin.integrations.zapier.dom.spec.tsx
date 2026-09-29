import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import Zapier, { shouldRevalidate } from './_app.admin.integrations.zapier';

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
		key: { id: string; prefix: string; lastFour: string; madeAt: string } | null;
		listening: { newGift: number; newDonor: number; giftRefunded: number };
		deliveries: { waiting: number; failed: number; oldestWaitingAt: string | null };
	};
	late: boolean;
	replacing: boolean;
	freePlanPace: number | null;
};

const NOBODY = { newGift: 0, newDonor: 0, giftRefunded: 0 };
const QUIET = { waiting: 0, failed: 0, oldestWaitingAt: null };
const HELD = {
	id: 'key-1',
	prefix: 'bgz_7Qm2',
	lastFour: 'EjRa',
	madeAt: '2026-09-28T12:00:00.000Z'
};

function reading(over: Partial<Reading> = {}, report: Partial<Reading['report']> = {}): Reading {
	return {
		address: ADDRESS,
		late: false,
		replacing: false,
		freePlanPace: null,
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

const keyBox = (root: HTMLElement) => root.querySelector<HTMLInputElement>('input#zapier-key');

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

/** what the stand-in action was posted and what it answers a replace with. */
type Round = {
	readonly listening?: Reading['report']['listening'];
	readonly pause?: { readonly paused: number; readonly notPaused: number };
	/** what the read after a press waits on, so an answer can land before the page is read again. */
	readonly reload?: Promise<void>;
};

/** every body the stand-in action was posted, in order. */
let posted: FormData[] = [];

/**
 * the page over a loader and an action standing in for the route's own, so a press runs the whole
 * round — which is what the route's server half does (the workers spec beside this one). the stub
 * takes the route's own `shouldRevalidate`, which is what decides whether a refusal re-reads.
 */
async function flow(
	at: string,
	start: Reading['report']['key'],
	answer: Answer,
	round: Round = {}
) {
	let key = start;
	posted = [];
	const listening = round.listening ?? { newGift: 2, newDonor: 1, giftRefunded: 0 };
	const pause = round.pause ?? { paused: 2, notPaused: 1 };
	const Stub = createRoutesStub([
		{
			path: SCREEN,
			Component: Zapier as never,
			shouldRevalidate,
			loader: async ({ request }) => {
				if (posted.length > 0) await round.reload;
				return reading(
					{ replacing: key !== null && new URL(request.url).searchParams.has('confirm') },
					{ key, listening }
				);
			},
			action: async ({ request }) => {
				const body = await request.formData();
				posted.push(body);
				const form = String(body.get('__form_id__'));
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
				if (answer === 'conflict') {
					key = { ...HELD, id: 'key-2', lastFour: 'Qq7t' };
					return refuse('The key this page showed was already replaced.');
				}
				key = { ...HELD, id: 'key-2', lastFour: 'Wx9z' };
				const disconnected =
					answer === 'made' ? 0 : listening.newGift + listening.newDonor + listening.giftRefunded;
				return {
					made: {
						press: answer === 'made' ? 'make' : 'replace',
						key: KEY,
						madeAt: HELD.madeAt,
						disconnected,
						...(answer === 'made' ? { paused: 0, notPaused: 0 } : pause)
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

it('posts the id of the key the question named', async () => {
	await flow(`${SCREEN}?confirm=replace`, HELD, 'replaced');

	await act(async () => named(card(), 'Yes, replace').click());
	await settle();

	expect(posted.map((body) => [body.get('__form_id__'), body.get('key_id')])).toEqual([
		['zapier-key-replace', 'key-1']
	]);
});

it('shows the new key once after a replace, saying in the card which Zaps still read as on', async () => {
	const root = await flow(`${SCREEN}?confirm=replace`, HELD, 'replaced');

	await act(async () => named(card(), 'Yes, replace').click());
	await settle();

	const shown = card();
	expect(shown?.querySelector('h2')?.textContent).toBe('Copy the key for Zapier');
	expect(shown?.textContent).toContain(KEY);
	// in the card's body, which is what the card is described by when it opens.
	const body = document.getElementById(shown?.getAttribute('aria-describedby') ?? '');
	expect(body?.textContent).toContain('3 Zaps disconnected.');
	expect(body?.textContent).toContain('1 of them still reads as on in Zapier');
	act(() => named(card(), 'Done').click());
	expect(keyBox(root)?.value).toBe('bgz_7Qm2••••••••••••Wx9z');
});

it('says one disconnected Zap in the singular, in the question and in the answer', async () => {
	const one = { newGift: 0, newDonor: 1, giftRefunded: 0 };
	await flow(`${SCREEN}?confirm=replace`, HELD, 'replaced', {
		listening: one,
		pause: { paused: 1, notPaused: 0 }
	});

	expect(card()?.textContent).toContain('1 Zap disconnects: 1 on new donors.');
	expect(card()?.textContent).toContain('Reconnect it in Zapier with the new key');
	await act(async () => named(card(), 'Yes, replace').click());
	await settle();

	expect(card()?.textContent).toContain('1 Zap disconnected.');
	expect(card()?.textContent).toContain('Reconnect it in Zapier with the new key');
	expect(card()?.textContent).not.toContain('each');
});

it('says a refused make under the key, points the press at it and puts focus there', async () => {
	const root = await flow(SCREEN, null, 'key_exists');

	await act(async () => named(root, 'Make key').click());
	await settle();

	const press = named(root, 'Replace key');
	const said = document.getElementById(press.getAttribute('aria-describedby') ?? '');
	expect(said?.textContent).toContain('A key was already made.');
	// the key box's own message, standing in the box's column rather than after the row.
	expect(keyBox(root)?.getAttribute('aria-describedby')?.split(' ')).toContain(said?.id);
	expect(document.activeElement).toBe(press);
});

it('puts focus on Replace key once the page is read again, when the refusal lands first', async () => {
	let reloaded = () => {};
	const reload = new Promise<void>((resolve) => {
		reloaded = resolve;
	});
	const root = await flow(SCREEN, null, 'key_exists', { reload });

	await act(async () => named(root, 'Make key').click());
	await settle();
	// the refusal is drawn while the page still shows the key it had: Make key stands.
	expect(root.textContent).toContain('A key was already made.');
	expect(named(root, 'Make key')).toBeTruthy();

	await act(async () => reloaded());
	await settle();

	expect(document.activeElement).toBe(named(root, 'Replace key'));
});

it('takes the question down on a refused replace and says why at the key row', async () => {
	const root = await flow(`${SCREEN}?confirm=replace`, HELD, 'conflict');

	await act(async () => named(card(), 'Yes, replace').click());
	await settle();

	expect(card()).toBeNull();
	const press = named(root, 'Replace key');
	const said = document.getElementById(press.getAttribute('aria-describedby') ?? '');
	expect(said?.textContent).toContain('The key this page showed was already replaced.');
	expect(keyBox(root)?.value).toBe('bgz_7Qm2••••••••••••Qq7t');
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
	screen(reading({}, { key: HELD }), {
		made: {
			press: 'replace',
			key: KEY,
			madeAt: HELD.madeAt,
			disconnected: 3,
			paused: 0,
			notPaused: 3
		}
	});

	expect(card()?.textContent).toContain('3 Zaps disconnected.');
	expect(card()?.textContent).toContain('They still read as on in Zapier.');
	expect(card()?.textContent).not.toContain('of them');
});

it('labels the key box where it can be seen, as the address row is', () => {
	const root = screen(reading({}, { key: HELD }));

	expect(root.querySelector('label[for="zapier-key"]')?.textContent).toBe('Zapier key');
	expect(keyBox(root)?.hasAttribute('aria-label')).toBe(false);
});

it('re-reads the page after its own refused press, and otherwise takes the default', () => {
	const args = (form: string, actionStatus: number) => {
		const formData = new FormData();
		formData.set('__form_id__', form);
		return { formData, actionStatus, defaultShouldRevalidate: false } as never;
	};

	expect(shouldRevalidate(args('zapier-key-make', 409))).toBe(true);
	expect(shouldRevalidate(args('zapier-key-replace', 409))).toBe(true);
	expect(shouldRevalidate(args('zapier-key-replace', 400))).toBe(false);
	expect(shouldRevalidate(args('sign-out', 409))).toBe(false);
});

it('says the pace deliveries go out at on the Free plan, and nothing of it once Paid is stated', () => {
	const free = screen(reading({ freePlanPace: 6 }));
	expect(free.textContent).toContain(
		'On the Cloudflare Free plan, deliveries to your Zaps go out 6 a minute, so a busy day can take hours to reach every Zap. If this account is on the Workers Paid plan, say so on the console’s Cloudflare plan page.'
	);
	act(() => free.remove());

	expect(screen(reading()).textContent).not.toContain('Free plan');
});
