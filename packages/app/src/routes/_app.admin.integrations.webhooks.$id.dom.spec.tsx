import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data, redirect } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import Destination from './_app.admin.integrations.webhooks.$id';

// what a destination's page does with its loader's answer and its presses: the secret masked with
// its two presses, a paused destination said to be, and the resume asked, answered and reported at
// the header. the server half is ./_app.admin.integrations.webhooks.$id.workers.spec.ts.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIST = '/admin/integrations/webhooks';
const SCREEN = `${LIST}/d1`;
const SECRET = 'whsec_2kP9vQ7mR4tX8zL1nB6cH3jWAbCdEfGhIjKlMnOpQrS=';

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

async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
	}
}

/**
 * the page over a loader and an action standing in for the route's own: `paused` until a resume
 * lands, holding two events, and a resume of one not paused refused as the route refuses it.
 */
async function flow(at: string, start: { paused: boolean }): Promise<HTMLElement> {
	let paused = start.paused;
	const Stub = createRoutesStub([
		{
			path: '/admin/integrations/webhooks/:id',
			Component: Destination as never,
			loader: ({ request }) => {
				const asked = new URL(request.url).searchParams.get('confirm');
				return {
					id: 'd1',
					url: 'https://crm.example.net/webhooks/better-giving',
					title: 'crm.example.net/webhooks/better-giving',
					events: ['gift.made', 'donor.added'],
					signingSecret: SECRET,
					paused,
					held: paused ? 2 : 0,
					confirming:
						asked === 'delete' ? 'delete' : asked === 'resume' && paused ? 'resume' : null,
					added: false,
					saved: false
				};
			},
			action: async ({ request }) => {
				const form = (await request.formData()).get('__form_id__');
				if (form === 'webhook-destination-delete') return redirect(LIST);
				if (!paused) {
					return data(
						{
							form: {
								id: 'webhook-destination-resume',
								result: {
									status: 'error',
									initialValue: {},
									error: { '': ['This destination is not paused, so there was nothing to resume.'] }
								}
							}
						},
						{ status: 409 }
					);
				}
				paused = false;
				return { resumed: 2 };
			}
		},
		{ path: LIST, Component: () => createElement('p', null, 'the list') }
	]);
	const root = mount(createElement(Stub, { initialEntries: [at] }));
	await settle();
	return root;
}

const card = () => document.querySelector('dialog');

function press(within: Element | null | undefined, words: string): HTMLElement {
	const found = [...(within?.querySelectorAll<HTMLElement>('button, a') ?? [])].find(
		(b) => b.textContent === words || b.getAttribute('aria-label') === words
	);
	if (!found) throw new Error(`nothing reading ${words} to press`);
	return found;
}

it('holds the signing secret masked, with a press that shows it and one that copies it', async () => {
	const root = await flow(SCREEN, { paused: false });
	const box = root.querySelector<HTMLInputElement>('#signing-secret');

	expect(box?.type).toBe('password');
	expect(box?.value).toBe(SECRET);
	expect(press(root, 'Copy signing secret')).toBeTruthy();

	act(() => press(root, 'Show the value').click());

	expect(box?.type).toBe('text');
});

it('says a paused destination is paused, how many events it holds, and offers Resume', async () => {
	const root = await flow(SCREEN, { paused: true });

	const said = [...root.querySelectorAll('[role="status"]')].map((region) => region.textContent);
	expect(said).toContain('Paused2 events are held until you resume.');
	expect(press(root, 'Resume').getAttribute('href')).toBe(`${SCREEN}?confirm=resume`);
});

it('offers no Resume on a destination that is not paused', async () => {
	const root = await flow(SCREEN, { paused: false });

	expect(root.textContent).not.toContain('Paused');
	expect([...root.querySelectorAll('a')].some((a) => a.textContent === 'Resume')).toBe(false);
});

it('asks before resuming, saying the held events are sent now', async () => {
	await flow(`${SCREEN}?confirm=resume`, { paused: true });

	expect(card()?.querySelector('h2')?.textContent).toBe('Resume this destination?');
	expect(card()?.textContent).toContain('The 2 held events are sent now.');
});

it('reports a resume at the header, where its press stood, and puts focus there', async () => {
	const root = await flow(`${SCREEN}?confirm=resume`, { paused: true });
	const said = root.querySelector('p[role="status"]');
	expect(said?.textContent).toBe('');

	await act(async () => press(card(), 'Resume').click());
	await settle();

	expect(card()).toBeNull();
	expect(root.textContent).not.toContain('Paused');
	expect(root.querySelector('p[role="status"]')).toBe(said);
	expect(said?.textContent).toBe('Resumed. 2 held events sent again now.');
	expect(document.activeElement).toBe(said);
});

it('asks before deleting, and lands on the list once it is done', async () => {
	const root = await flow(`${SCREEN}?confirm=delete`, { paused: false });

	expect(card()?.querySelector('h2')?.textContent).toBe('Delete this destination?');
	expect(card()?.textContent).toContain('crm.example.net/webhooks/better-giving');

	await act(async () => press(card(), 'Yes, delete').click());
	await settle();

	expect(root.textContent).toBe('the list');
});
