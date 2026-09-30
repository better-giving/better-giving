import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data, redirect } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import Destination, { shouldRevalidate } from './_app.admin.integrations.webhooks.$id';

// what a destination's page does with its loader's answer and its presses: its recent deliveries
// listed, the secret masked with its two presses, a paused destination said to be, the resume
// asked, answered and reported at the header, and a test reported there too. the server half is
// ./_app.admin.integrations.webhooks.$id.workers.spec.ts.

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
 * lands, holding two events, and a resume of one not paused refused as the route refuses it —
 * `resumedElsewhere` resumes it under the page just before the press lands. a
 * test is answered with `tested`, and each read of the page is noted in `reads`.
 */
async function flow(
	at: string,
	start: {
		paused: boolean;
		resumedElsewhere?: boolean;
		tested?: unknown;
		deliveries?: unknown[];
		reads?: string[];
	}
): Promise<HTMLElement> {
	let paused = start.paused;
	const Stub = createRoutesStub([
		{
			path: '/admin/integrations/webhooks/:id',
			Component: Destination as never,
			shouldRevalidate,
			loader: ({ request }) => {
				start.reads?.push(request.url);
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
					saved: false,
					deliveries: start.deliveries ?? []
				};
			},
			action: async ({ request }) => {
				const form = (await request.formData()).get('__form_id__');
				if (form === 'webhook-destination-delete') return redirect(LIST);
				if (form === 'webhook-destination-test') return { tested: start.tested };
				if (start.resumedElsewhere) paused = false;
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

	act(() => press(root, 'Show signing secret').click());

	expect(box?.type).toBe('text');
	expect(press(root, 'Hide signing secret')).toBeTruthy();
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

it('puts focus on Resume when a question loaded from its address is dismissed', async () => {
	const root = await flow(`${SCREEN}?confirm=resume`, { paused: true });

	await act(async () => card()?.dispatchEvent(new Event('cancel', { cancelable: true })));
	await settle();

	expect(card()).toBeNull();
	expect(document.activeElement).toBe(press(root, 'Resume'));
});

it('reports a resume refused because it was resumed under the page, and reads the page again', async () => {
	const reads: string[] = [];
	const root = await flow(`${SCREEN}?confirm=resume`, {
		paused: true,
		resumedElsewhere: true,
		reads
	});
	const said = root.querySelector('p[role="status"]');
	const loads = reads.length;

	await act(async () => press(card(), 'Resume').click());
	await settle();

	expect(said?.textContent).toBe('This destination is not paused, so there was nothing to resume.');
	expect(said?.querySelector('.adm-momentary--neutral svg.lucide-info')).not.toBeNull();
	expect(reads.length).toBeGreaterThan(loads);
	expect([...root.querySelectorAll('a')].some((a) => a.textContent === 'Resume')).toBe(false);
	expect(root.textContent).not.toContain('held until you resume');
});

it('asks before deleting, and lands on the list once it is done', async () => {
	const root = await flow(`${SCREEN}?confirm=delete`, { paused: false });

	expect(card()?.querySelector('h2')?.textContent).toBe('Delete this destination?');
	expect(card()?.textContent).toContain('crm.example.net/webhooks/better-giving');

	await act(async () => press(card(), 'Yes, delete').click());
	await settle();

	expect(root.textContent).toBe('the list');
});

const recorded = (
	id: string,
	event: string,
	status: string,
	answer: number | null,
	attempts: number
) => ({
	id,
	event,
	status,
	at: '2026-09-28T10:41:00.000Z',
	when: '28 Sep 2026, 10:41 UTC',
	answer,
	attempts
});

it('lists its recent deliveries: the event, when, where each stands, the answer and the attempts', async () => {
	const root = await flow(SCREEN, {
		paused: false,
		deliveries: [
			recorded('m1', 'gift.made', 'delivered', 200, 1),
			recorded('m2', 'donor.added', 'pending', 503, 2),
			recorded('m3', 'gift.refunded', 'failed', null, 9),
			recorded('m4', 'recurring_gift.charge_failed', 'dropped', null, 0)
		]
	});
	const table = [...root.querySelectorAll('table')].find(
		(t) => t.getAttribute('aria-labelledby') === 'recent-deliveries-heading'
	);

	expect(root.querySelector('#recent-deliveries-heading')?.textContent).toBe('Recent deliveries');
	expect([...(table?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent)).toEqual([
		'Event',
		'When',
		'Outcome',
		'Answer',
		'Attempts'
	]);
	expect(
		[...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) =>
			[...tr.children].map((cell) => cell.textContent)
		)
	).toEqual([
		['Gift made', '28 Sep 2026, 10:41 UTC', 'Delivered', '200', '1'],
		['Donor added', '28 Sep 2026, 10:41 UTC', 'Waiting', '503', '2'],
		['Gift refunded', '28 Sep 2026, 10:41 UTC', 'Failed', '—', '9'],
		['Recurring charge failed', '28 Sep 2026, 10:41 UTC', 'Withheld', '—', '0']
	]);
	expect(table?.querySelector('time')?.getAttribute('datetime')).toBe('2026-09-28T10:41:00.000Z');
});

it('says a destination sent nothing yet has no deliveries', async () => {
	const root = await flow(SCREEN, { paused: false });

	expect(root.querySelector('.adm-table__empty')?.textContent).toBe('No deliveries yet');
});

for (const [tested, word] of [
	[{ outcome: 'sent', status: 200 }, 'Sent: 200'],
	[{ outcome: 'refused', status: 500 }, 'Refused: 500'],
	[{ outcome: 'unanswered' }, 'No answer']
] as const) {
	it(`reports a test answered ${word} at the header, where its press stands`, async () => {
		const root = await flow(SCREEN, { paused: false, tested });
		const said = root.querySelector('p[role="status"]');
		const sending = press(root, 'Send a test');

		act(() => sending.focus());
		await act(async () => sending.click());
		await settle();

		expect(said?.textContent).toBe(word);
		expect(document.activeElement).toBe(sending);
	});
}

it('says a second test’s answer afresh, even the same words as the first', async () => {
	const root = await flow(SCREEN, { paused: false, tested: { outcome: 'unanswered' } });
	const said = root.querySelector('p[role="status"]');
	if (said === null) throw new Error('no status line');
	const written: string[] = [];
	const watching = new MutationObserver((changes) => {
		for (const change of changes) {
			for (const node of change.addedNodes) written.push(node.textContent ?? '');
		}
	});
	watching.observe(said, { childList: true });
	onTestFinished(() => watching.disconnect());

	for (let i = 0; i < 2; i++) {
		await act(async () => press(root, 'Send a test').click());
		await settle();
	}

	expect(written).toEqual(['No answer', 'No answer']);
	expect(said.textContent).toBe('No answer');
});

it('reads nothing again after a test, which changed nothing', async () => {
	const reads: string[] = [];
	const root = await flow(SCREEN, {
		paused: false,
		tested: { outcome: 'sent', status: 200 },
		reads
	});
	const loads = reads.length;

	await act(async () => press(root, 'Send a test').click());
	await settle();

	expect(root.querySelector('p[role="status"]')?.textContent).toBe('Sent: 200');
	expect(reads).toHaveLength(loads);
	expect(press(root, 'Send a test').getAttribute('aria-disabled')).toBeNull();
});

it('offers the test on a paused destination too', async () => {
	const root = await flow(SCREEN, { paused: true });

	expect(press(root, 'Send a test').getAttribute('type')).toBe('submit');
});

it('stands the status line on its own line under the header, so an answer landing moves no press', async () => {
	// inside the presses' row the words growing it push the presses along it, or wrap the row
	// under the title, at one width or another; a line of its own under the header grows downward
	// alone.
	const root = await flow(SCREEN, { paused: true });
	const said = root.querySelector('p[role="status"]');
	const header = root.querySelector('header.adm-pageheader');

	expect(header?.contains(press(root, 'Resume'))).toBe(true);
	expect(header?.contains(press(root, 'Send a test'))).toBe(true);
	expect(header?.contains(said ?? null)).toBe(false);
	expect(header?.nextElementSibling).toBe(said);
});
