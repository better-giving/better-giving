import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { createRoutesStub, data, useActionData, useLoaderData } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import { SAME_ACCOUNT, ZERO_AMOUNT } from '$lib/ledger/input-schema';
import Books from './_app.admin.books';

// the Books screen, drawn.
//
// what it covers is everything the workers spec beside it cannot reach. that file drives the
// `loader` and the `action` through a real chain against a real D1, and never renders anything —
// so the markup this screen composes has no reader at all: which boxes exist, what the two pickers
// open on, where a refusal is drawn, what the confirm states, where the answer lands and which id the
// next press carries. this is the one screen on the dashboard whose button being wrong is a money
// defect, since the boxes still hold the correction after it posts.
//
// mounted rather than rendered to a string, and that is why this file is in the dom pool:
// `useNavigation()` is idle in a server render, so the in-flight arm of the submit is unrenderable
// there.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen. nothing here reads a computed
// style or a class: what is asserted is which controls exist, what each is named, what each holds
// and which state the screen is in.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** the address the screen is served on in every stub below. */
const SCREEN = '/admin/books';

/** the id the stub's one route is mounted under, which is what its hydration data is keyed by. */
const STUB_ROUTE = 'books';

/**
 * mounts `tree` into a document that lives as long as the case, and hands back its root element.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
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

type LoaderData = Parameters<typeof Books>[0]['loaderData'];
type Entry = NonNullable<LoaderData['entries']>[number];

/** the id the `loader` minted for the next correction, which the hidden box carries. */
const SOURCE_ID = '019fb0d2-7d57-7c5e-a7df-baed1f27b405';

/** an id a later load minted, which a case expects the box either to take or to ignore. */
const LATER_ID = '019fb0d2-7d57-7c5e-a7df-000000000999';

/** the id a refusal hands back for a press whose boxes no longer match what was sent. */
const FRESH_ID = '019fb0d2-7d57-7c5e-a7df-000000000777';

/** what a write whose outcome could not be read is told, as the action words it. */
const WRITE_FAILED =
	'Posting this correction failed. Press again — this page posts under one id, so a correction cannot be recorded twice.';

/** the chart, as the pickers are handed it. */
const ACCOUNTS = [
	{ value: 'acc_1020', label: '1020 — Undeposited Funds' },
	{ value: 'acc_4110', label: '4110 — Tax-Deductible Donations' },
	{ value: 'acc_5200', label: '5200 — Processor Fees' }
];

/** the two lines the correction every case posts moves, as the action reads them back. */
const MOVEMENT = ['5200 — Processor Fees +$4.75', '1020 — Undeposited Funds −$4.75'];

/** one entry as the loader hands it over. */
function entry(over: Partial<Entry> = {}): Entry {
	return {
		id: '019fb400-0000-7000-8000-000000000001',
		datedOn: '2026-03-31',
		source: 'adjustment',
		movement: MOVEMENT,
		memo: 'Stripe fee for payment pi_123 that never posted.',
		...over
	} as Entry;
}

/** the two packages the download block offers, as the loader hands them over. */
const TARGETS = [
	{ value: 'quickbooks', label: 'QuickBooks Online' },
	{ value: 'xero', label: 'Xero' }
];

/** what a screen a case did not spoil is handed. */
function loaderData(over: Partial<LoaderData> = {}): LoaderData {
	return {
		accounts: ACCOUNTS,
		sourceId: SOURCE_ID,
		entries: [],
		limit: 50,
		hasMore: false,
		// a visit with no range asked about, which is what every case but the download block's is.
		asked: { from: '', to: '', target: '' },
		journal: null,
		targets: TARGETS,
		...over
	} as LoaderData;
}

/** the answer the action gives a press that reached the books, on either arm. */
function answered(kind: 'posted' | 'already_posted', sourceId = SOURCE_ID) {
	return { outcome: { kind, sourceId, movement: MOVEMENT } };
}

/**
 * the screen, and what its form posted.
 *
 * inside a `createRoutesStub`, because the submit is a navigation and `useNavigation()` has nothing
 * to report without a router above it. the action never settles, which holds the screen in the
 * state an operator is looking at while a correction is in flight.
 */
function screen(
	over: Partial<LoaderData> = {},
	options: { holdCheck?: boolean } = {}
): { root: HTMLElement; posted: FormData[]; visited: string[] } {
	const posted: FormData[] = [];
	const visited: string[] = [];
	const Stub = createRoutesStub([
		{
			id: STUB_ROUTE,
			path: SCREEN,
			Component: () =>
				createElement(Books as never, {
					loaderData: loaderData(over),
					params: {},
					matches: []
				}),
			// the screen is handed its data above rather than through this, which is here for the
			// address a range check moves to — the landing is hydrated, so every call of this is a
			// check. it is held where a case wants to read the screen while one is in flight.
			loader: ({ request }: { request: Request }) => {
				visited.push(new URL(request.url).search);
				return options.holdCheck === true ? new Promise<never>(() => {}) : null;
			},
			action: async ({ request }) => {
				posted.push(await request.formData());
				return new Promise<never>(() => {});
			}
		}
	]);
	return {
		// hydrated, so the landing renders in one synchronous pass: a route carrying a `loader` is
		// otherwise entered through an initial load, and every case below reads the screen as soon
		// as it is mounted.
		root: mount(
			createElement(Stub, {
				initialEntries: [SCREEN],
				hydrationData: { loaderData: { [STUB_ROUTE]: null } }
			})
		),
		posted,
		visited
	};
}

/**
 * the control named by `name`, whichever kind of box it is.
 *
 * unconstrained, and the double assertion is what that costs: worker-configuration.d.ts declares
 * HTMLRewriter's own `Element`, whose `remove()` answers an element where the DOM's answers
 * nothing — so the two merge into a type no `HTMLSelectElement` satisfies.
 */
function box<T = HTMLElement>(root: HTMLElement, name: string): T {
	const found = root.querySelector(`form [name="${name}"]`);
	if (found === null) throw new Error(`the screen drew no box named "${name}"`);
	return found as unknown as T;
}

/** the visible words labelling the box named `name`, which is what an operator reads. */
function labelOf(root: HTMLElement, name: string): string {
	const control = box(root, name);
	const label = root.querySelector(`label[for="${control.id}"]`);
	if (label === null) throw new Error(`the box named "${name}" carries no label`);
	return label.textContent ?? '';
}

/** the message drawn under the box named `name`, or nothing where the box carries none. */
function messageUnder(root: HTMLElement, name: string): string | null {
	const control = box(root, name);
	const described = control.getAttribute('aria-describedby');
	if (described === null) return null;
	const message = described
		.split(' ')
		.map((id) => root.querySelector(`#${id}`))
		.find((el) => el !== null);
	return message?.textContent ?? null;
}

/**
 * every message on the screen that no box points at, as the words it says.
 *
 * read that way rather than by the element a banner is drawn as, because "no box points at it" is
 * the property that matters: a sentence keyed to a field is drawn under that field and is covered
 * by `messageUnder`, and one keyed to nothing has to be somewhere an operator will still meet it.
 * an empty region says nothing and is left out.
 */
function unboxed(root: HTMLElement): string[] {
	const pointedAt = new Set(
		[...root.querySelectorAll('[aria-describedby]')].flatMap((el) =>
			(el.getAttribute('aria-describedby') ?? '').split(' ')
		)
	);
	return [...root.querySelectorAll('[role="alert"], [role="status"]')]
		.filter((el) => el.id === '' || !pointedAt.has(el.id))
		.map((el) => el.textContent ?? '')
		.filter((text) => text !== '');
}

/**
 * the correction's own form.
 *
 * found by the hidden box only it carries, rather than by position: the screen draws a second form
 * above it — the range the accountant's download is asked for — and the first `<form>` in the
 * document is that one.
 */
function correctionForm(root: HTMLElement): HTMLFormElement {
	const found = [...root.querySelectorAll('form')].find(
		(form) => form.querySelector('[name="source_id"]') !== null
	);
	if (found === undefined) throw new Error('the screen drew no correction form');
	return found;
}

/** the press at the foot of the correction form, which is never the dialog's own. */
function press(root: HTMLElement): HTMLButtonElement {
	const found = correctionForm(root).querySelector('.adm-actions button[type="submit"]');
	if (found === null) throw new Error('the screen drew no press');
	return found as HTMLButtonElement;
}

/** the confirm dialog, or null while none is open. */
function dialog(root: HTMLElement): HTMLDialogElement | null {
	return root.querySelector('dialog');
}

/** the dialog's button reading `label`. */
function dialogButton(root: HTMLElement, label: string): HTMLButtonElement {
	const found = [...(dialog(root)?.querySelectorAll('button') ?? [])].find(
		(b) => b.textContent === label
	);
	if (found === undefined) throw new Error(`the dialog drew no button reading "${label}"`);
	return found as HTMLButtonElement;
}

/**
 * fills one box the way a keystroke does.
 *
 * through the prototype setter, which is what react's own change tracking reads — assigning
 * `.value` leaves it believing the box still holds what it rendered.
 */
function fill(control: HTMLElement, value: string): void {
	const setter = Object.getOwnPropertyDescriptor(
		Object.getPrototypeOf(control) as object,
		'value'
	)?.set;
	if (setter === undefined) throw new Error('that control holds no value');
	setter.call(control, value);
	control.dispatchEvent(new Event('input', { bubbles: true }));
	control.dispatchEvent(new Event('change', { bubbles: true }));
}

/** fills every box a correction needs. the date carries the loader's day already and the id is hidden. */
async function fillCorrection(root: HTMLElement): Promise<void> {
	await act(async () => {
		fill(box(root, 'amount'), '4.75');
		fill(box(root, 'note'), 'Stripe fee that never posted.');
		fill(box(root, 'out_of'), 'acc_1020');
		fill(box(root, 'into'), 'acc_5200');
	});
}

/** the range the accountant's download is asked for, found by a box only it carries. */
function rangeForm(root: HTMLElement): HTMLFormElement {
	const found = [...root.querySelectorAll('form')].find(
		(form) => form.querySelector('[name="from"]') !== null
	);
	if (found === undefined) throw new Error('the screen drew no range form');
	return found;
}

/** the press that asks what a range holds. */
function pressCheck(root: HTMLElement): HTMLButtonElement {
	const found = rangeForm(root).querySelector('.adm-actions button[type="submit"]');
	if (found === null) throw new Error('the range form drew no press');
	return found as HTMLButtonElement;
}

/** fills the range and asks what it holds. */
async function askRange(
	root: HTMLElement,
	from: string,
	to: string,
	target: string
): Promise<void> {
	await act(async () => {
		fill(box(root, 'from'), from);
		fill(box(root, 'to'), to);
		fill(box(root, 'target'), target);
	});
	await act(async () => {
		rangeForm(root).requestSubmit(pressCheck(root));
	});
}

/** presses the correction form's own submit, which asks before it posts. */
async function pressPost(root: HTMLElement): Promise<void> {
	const form = correctionForm(root);
	await act(async () => {
		form.requestSubmit(press(root));
	});
}

/** answers the open dialog yes. */
async function confirmPost(root: HTMLElement): Promise<void> {
	await act(async () => {
		dialogButton(root, 'Yes, post this correction').click();
	});
}

it('draws every box a correction needs, each one labelled', () => {
	const { root } = screen();

	expect(labelOf(root, 'occurred_on')).toBe('Dated');
	expect(labelOf(root, 'amount')).toBe('Amount');
	expect(labelOf(root, 'out_of')).toBe('Out of');
	expect(labelOf(root, 'into')).toBe('Into');
	expect(labelOf(root, 'note')).toBe('Note');
});

/** the operator's own calendar day, as the browser's clock and zone read it. */
function localDay(at = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

it('opens the date box on the operator’s own calendar day', () => {
	const { root } = screen();
	expect(box<HTMLInputElement>(root, 'occurred_on').value).toBe(localDay());
	expect(box<HTMLInputElement>(root, 'occurred_on').type).toBe('date');
});

it('renders no clock into the server’s markup, so hydration has nothing to disagree with', () => {
	// the server's zone is not the operator's, so the day is filled in once the page is in the
	// browser. a day rendered on the server would be the Worker's UTC one, and a different day
	// rendered on the first client pass would be a hydration mismatch.
	const Stub = createRoutesStub([
		{
			id: STUB_ROUTE,
			path: SCREEN,
			Component: () =>
				createElement(Books as never, { loaderData: loaderData(), params: {}, matches: [] })
		}
	]);
	const markup = renderToString(createElement(Stub, { initialEntries: [SCREEN] }));
	const held = document.createElement('div');
	held.innerHTML = markup;

	expect(held.querySelector<HTMLInputElement>('[name="occurred_on"]')?.value).toBe('');
});

it('offers the chart it was handed on both sides, and opens on neither', () => {
	const { root } = screen();

	for (const name of ['out_of', 'into']) {
		const picker = box<HTMLSelectElement>(root, name);
		// the blank leads, and it is what stops the browser falling to the first account: a picker
		// that opened on an account would post a correction against one nobody chose.
		expect(picker.value).toBe('');
		expect([...picker.options].map((o) => o.value)).toEqual([
			'',
			'acc_1020',
			'acc_4110',
			'acc_5200'
		]);
	}
});

it('carries the id the loader minted, in a box nobody can edit', () => {
	const held = box<HTMLInputElement>(screen().root, 'source_id');
	expect(held.type).toBe('hidden');
	expect(held.value).toBe(SOURCE_ID);
});

it('says what a deployment with empty books is waiting for', () => {
	const { root } = screen();

	expect(root.textContent).toContain('Nothing has been posted to the books yet.');
	expect(root.querySelector('tbody th')).toBeNull();
});

it('says the entries could not be read rather than drawing a list with nothing in it', () => {
	const { root } = screen({ entries: null });

	expect(unboxed(root).join(' ')).toContain('Entries could not be read');
	expect(root.textContent).not.toContain('Nothing has been posted to the books yet.');
	expect(root.querySelector('table')).toBeNull();
	// and the form still stands: the pickers are the chart's, which needed no read.
	expect(box<HTMLSelectElement>(root, 'out_of').options).toHaveLength(4);
});

it('lists an entry as its date, its cause and its lines, newest first as handed', () => {
	const { root } = screen({
		entries: [entry(), entry({ id: 'older', datedOn: '2026-03-01', source: 'fee', memo: null })]
	});

	const rows = [...root.querySelectorAll('tbody tr')].map((row) =>
		[...row.children].map((c) => c.textContent)
	);
	expect(rows[0]).toEqual([
		'2026-03-31',
		// the word a fundraiser says, never the column value.
		'Correction',
		'5200 — Processor Fees +$4.75 · 1020 — Undeposited Funds −$4.75',
		'Stripe fee for payment pi_123 that never posted.'
	]);
	expect(rows[1]?.[0]).toBe('2026-03-01');
	expect(rows[1]?.[1]).toBe('Processor fee');
});

it('names how many entries there are, and says when it is showing only some', () => {
	expect(screen({ entries: [entry()] }).root.textContent).toContain('1 entry, newest first.');

	const capped = screen({ entries: [entry(), entry({ id: 'b' })], hasMore: true });
	expect(capped.root.textContent).toContain('2 entries, newest first.');
	expect(capped.root.textContent).toContain('Only the most recent 50 are shown.');
});

it('marks every refusal at its box from the first press, and posts nothing', async () => {
	const { root, posted } = screen();
	await act(async () => {
		fill(box(root, 'amount'), '0');
		fill(box(root, 'out_of'), 'acc_1020');
		fill(box(root, 'into'), 'acc_1020');
	});
	await pressPost(root);

	expect(messageUnder(root, 'amount')).toBe(ZERO_AMOUNT);
	expect(messageUnder(root, 'into')).toBe(SAME_ACCOUNT);
	expect(messageUnder(root, 'note')).toBe('required');
	// the box the refusal is not about carries nothing, so an operator fixes one thing.
	expect(messageUnder(root, 'out_of')).toBeNull();
	expect(dialog(root)).toBeNull();
	expect(posted).toHaveLength(0);
});

it('clears a refusal the moment its box is fixed, without another press', async () => {
	const { root } = screen();
	await act(async () => {
		fill(box(root, 'amount'), '0');
		fill(box(root, 'out_of'), 'acc_1020');
		fill(box(root, 'into'), 'acc_1020');
	});
	await pressPost(root);

	await act(async () => {
		fill(box(root, 'amount'), '4.75');
		fill(box(root, 'into'), 'acc_5200');
	});

	expect(messageUnder(root, 'amount')).toBeNull();
	expect(messageUnder(root, 'into')).toBeNull();
	// and the one still wrong stays marked.
	expect(messageUnder(root, 'note')).toBe('required');
});

/** a rejection as `invalid()` puts it on the wire, for the boxes named. */
function refused(errors: Record<string, string[]>, values: Record<string, string> = {}) {
	return {
		form: {
			id: 'correction',
			result: {
				status: 'error' as const,
				initialValue: { source_id: SOURCE_ID, ...values },
				error: errors
			}
		}
	};
}

/**
 * the write that failed, as its own arm of the action puts it on the wire.
 *
 * `freshId` rides beside it for a press whose boxes change before it is made again: a `batch()`
 * that commits and then loses the connection reads exactly like one that never ran, so the id the
 * failed write was sent under may already stand for it.
 */
function writeFailed() {
	return {
		...refused({ '': [WRITE_FAILED] }),
		freshId: FRESH_ID
	};
}

it('asks before it posts, stating the amount, both accounts and the date', async () => {
	const { root, posted } = screen();
	await fillCorrection(root);
	await pressPost(root);

	const asked = dialog(root);
	expect(asked?.textContent).toContain('Post this correction?');
	expect(asked?.textContent).toContain(
		'$4.75 out of 1020 — Undeposited Funds, into 5200 — Processor Fees.'
	);
	expect(asked?.textContent).toContain(`Dated ${localDay()}.`);
	expect(posted).toHaveLength(0);
});

it('posts nothing when the question is answered no', async () => {
	const { root, posted } = screen();
	await fillCorrection(root);
	await pressPost(root);

	await act(async () => {
		dialogButton(root, 'Cancel').click();
	});

	expect(dialog(root)).toBeNull();
	expect(posted).toHaveLength(0);
});

it('posts every box the form states, under the id the page is holding, once answered yes', async () => {
	const { root, posted } = screen();
	await fillCorrection(root);
	await pressPost(root);
	await confirmPost(root);

	expect(posted).toHaveLength(1);
	const [body] = posted;
	expect(body?.get('source_id')).toBe(SOURCE_ID);
	expect(body?.get('occurred_on')).toBe(localDay());
	expect(body?.get('amount')).toBe('4.75');
	expect(body?.get('out_of')).toBe('acc_1020');
	expect(body?.get('into')).toBe('acc_5200');
	expect(body?.get('note')).toBe('Stripe fee that never posted.');
	expect(dialog(root)).toBeNull();
});

it('holds the press while the correction is in flight', async () => {
	const { root } = screen();
	expect(press(root).getAttribute('aria-disabled')).toBeNull();

	await fillCorrection(root);
	await pressPost(root);
	await confirmPost(root);

	// one operator intent is one write. held with `aria-disabled` rather than `disabled`, so the
	// dialog can hand focus back to it as it closes.
	expect(press(root).getAttribute('aria-disabled')).toBe('true');
	expect(press(root).getAttribute('aria-busy')).toBe('true');
});

it('keeps the press held through the load that follows the answer', async () => {
	// the window `navigation.state === 'submitting'` misses: the action answers, the loaders
	// revalidate, and a press held only through the first state is live again for the whole of the
	// second — with the boxes still holding the correction.
	const Stub = createRoutesStub([
		{
			id: 'books',
			path: SCREEN,
			loader: () => new Promise<never>(() => {}),
			Component: () =>
				createElement(Books as never, {
					loaderData: loaderData(),
					actionData: undefined,
					params: {},
					matches: []
				}),
			action: () => answered('posted')
		}
	]);
	const root = mount(
		createElement(Stub, {
			initialEntries: [SCREEN],
			hydrationData: { loaderData: { books: null } }
		})
	);
	await fillCorrection(root);
	await pressPost(root);
	await confirmPost(root);

	expect(press(root).getAttribute('aria-disabled')).toBe('true');
});

it('draws nothing about a posting on a plain visit', () => {
	expect(unboxed(screen().root)).toEqual([]);
});

/** a promise a case settles by hand, so it can act while a press is still in flight. */
function deferred<T>(): { promise: Promise<T>; settle: (value: T) => void } {
	let settle: (value: T) => void = () => {};
	const promise = new Promise<T>((resolve) => {
		settle = resolve;
	});
	return { promise, settle };
}

/**
 * the screen under a router that answers its presses, revalidates after them, and hands the answer
 * back as the route's own action data — the whole loop a press goes round, which is what the id and
 * the answer beside the press are decided over.
 *
 * `answer` is handed each body and returns what the action would; a load after an answer that
 * revalidates takes the next id off `ids`, the way the real loader mints one per request.
 */
function liveScreen(
	answer: (body: FormData) => unknown,
	ids: string[] = [LATER_ID]
): { root: HTMLElement; posted: FormData[] } {
	const posted: FormData[] = [];
	const Stub = createRoutesStub([
		{
			id: 'books',
			path: SCREEN,
			loader: () => loaderData({ sourceId: ids.shift() ?? LATER_ID }),
			action: async ({ request }) => {
				const body = await request.formData();
				posted.push(body);
				return answer(body);
			},
			Component: () =>
				createElement(Books as never, {
					loaderData: useLoaderData(),
					actionData: useActionData(),
					params: {},
					matches: []
				})
		}
	]);
	const root = mount(
		createElement(Stub, {
			initialEntries: [SCREEN],
			hydrationData: { loaderData: { books: loaderData() } }
		})
	);
	return { root, posted };
}

/** the answer the action gives a body that reached the books under its own id. */
function answeredFor(kind: 'posted' | 'already_posted') {
	return (body: FormData) => answered(kind, String(body.get('source_id')));
}

/** fills, presses, answers the dialog yes, and lets the router settle. */
async function postThrough(root: HTMLElement): Promise<void> {
	await pressPost(root);
	await confirmPost(root);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

it('says a correction was posted beside the press, naming the movement', async () => {
	const { root } = liveScreen(answeredFor('posted'));
	await fillCorrection(root);
	await postThrough(root);

	const said = unboxed(root).join(' ');
	expect(said).toContain('Posted.');
	expect(said).toContain('5200 — Processor Fees +$4.75 · 1020 — Undeposited Funds −$4.75');
	// beside the press, not at the head of the page.
	expect(press(root).parentElement?.textContent).toContain('Posted.');
});

it('presses the same correction twice under one id, and says the second is already in the books', async () => {
	let presses = 0;
	const { root, posted } = liveScreen((body) =>
		answered(presses++ === 0 ? 'posted' : 'already_posted', String(body.get('source_id')))
	);
	await fillCorrection(root);
	await postThrough(root);
	await postThrough(root);

	expect(posted.map((b) => b.get('source_id'))).toEqual([SOURCE_ID, SOURCE_ID]);
	const said = unboxed(root).join(' ');
	expect(said).toContain('Already in the books');
	expect(said).not.toContain('Posted.');
	expect(said).not.toMatch(/fail|error|not posted/i);
});

it('reuses the id when an edit is undone back to what was sent', async () => {
	const { root, posted } = liveScreen(answeredFor('posted'));
	await fillCorrection(root);
	await postThrough(root);

	await act(async () => {
		fill(box(root, 'note'), 'Stripe fee that never posted!');
		fill(box(root, 'note'), 'Stripe fee that never posted.');
	});
	// the boxes hold what was sent, so the answer still stands beside the press.
	expect(unboxed(root).join(' ')).toContain('Posted.');
	await postThrough(root);

	expect(posted.map((b) => b.get('source_id'))).toEqual([SOURCE_ID, SOURCE_ID]);
});

it('takes the page’s fresh id for a correction edited after it posted, and drops the answer', async () => {
	const { root, posted } = liveScreen(answeredFor('posted'));
	await fillCorrection(root);
	await postThrough(root);

	await act(async () => {
		fill(box(root, 'amount'), '5.00');
	});
	expect(unboxed(root)).toEqual([]);
	await postThrough(root);

	expect(posted.map((b) => b.get('source_id'))).toEqual([SOURCE_ID, LATER_ID]);
});

it('takes a fresh id for a correction edited while its post was in flight', async () => {
	// the edit lands before the answer does, so the boxes no longer hold what the answer is about:
	// holding the answered id would present the edited correction under the first one's pair.
	const flight = deferred<unknown>();
	let presses = 0;
	const { root, posted } = liveScreen((body) =>
		presses++ === 0 ? flight.promise : answered('posted', String(body.get('source_id')))
	);
	await fillCorrection(root);
	await pressPost(root);
	await confirmPost(root);

	await act(async () => {
		fill(box(root, 'amount'), '5.00');
	});
	await act(async () => {
		flight.settle(answered('posted', SOURCE_ID));
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	expect(unboxed(root)).toEqual([]);
	await postThrough(root);

	expect(posted.map((b) => b.get('source_id'))).toEqual([SOURCE_ID, LATER_ID]);
});

it('retries a failed write under its own id, and a changed one under the fresh id it handed back', async () => {
	let presses = 0;
	const { root, posted } = liveScreen((body) =>
		presses++ < 2
			? data(writeFailed(), { status: 500 })
			: answered('posted', String(body.get('source_id')))
	);
	await fillCorrection(root);
	await postThrough(root);
	expect(unboxed(root).join(' ')).toContain('Posting this correction failed.');

	// pressed again unchanged: the write may have landed, so it goes under the same id.
	await postThrough(root);
	// then with the amount fixed: a different correction, which the failed id may not stand for.
	await act(async () => {
		fill(box(root, 'amount'), '5.00');
	});
	await postThrough(root);

	expect(posted.map((b) => b.get('source_id'))).toEqual([SOURCE_ID, SOURCE_ID, FRESH_ID]);
});

it('takes the fresh id after the books refuse a different correction under the held one', async () => {
	let presses = 0;
	const { root, posted } = liveScreen((body) =>
		presses++ === 0
			? data(
					{
						...refused({
							'': ['This press matched an earlier correction. Press again to post it.']
						}),
						freshId: FRESH_ID,
						releasedId: SOURCE_ID
					},
					{ status: 409 }
				)
			: answered('posted', String(body.get('source_id')))
	);
	await fillCorrection(root);
	await postThrough(root);
	expect(unboxed(root).join(' ')).toContain('matched an earlier correction');

	await postThrough(root);

	expect(posted.map((b) => b.get('source_id'))).toEqual([SOURCE_ID, FRESH_ID]);
});

/** a rejection for the boxes named, on the wire with the status the action puts on it. */
function refusedWith(status: number, errors: Record<string, string[]>, extra: object = {}) {
	return (body: FormData) =>
		data(
			{
				form: {
					id: 'correction',
					result: {
						status: 'error' as const,
						initialValue: Object.fromEntries(body),
						error: errors
					}
				},
				...extra
			},
			{ status }
		);
}

it('keeps what was typed, and puts the refusal under its box, when the action refuses a press', async () => {
	const { root } = liveScreen(
		refusedWith(400, { out_of: ['That account is not one this deployment can post to.'] })
	);
	await fillCorrection(root);
	await postThrough(root);

	expect(box<HTMLInputElement>(root, 'occurred_on').value).toBe(localDay());
	expect(box<HTMLInputElement>(root, 'amount').value).toBe('4.75');
	expect(box<HTMLSelectElement>(root, 'out_of').value).toBe('acc_1020');
	expect(box<HTMLSelectElement>(root, 'into').value).toBe('acc_5200');
	expect(messageUnder(root, 'out_of')).toBe('That account is not one this deployment can post to.');
});

it('draws a write that failed as the form’s own, without calling it not posted', async () => {
	const { root } = liveScreen(refusedWith(500, { '': [WRITE_FAILED] }, { freshId: FRESH_ID }));
	await fillCorrection(root);
	await postThrough(root);

	const said = unboxed(root).join(' ');
	expect(said).toContain('Posting this correction failed.');
	expect(said).toContain('Press again');
	// the write may have landed and lost its answer, so nothing on the screen may say it did not.
	expect(said).not.toMatch(/not posted|nothing (was|has been) (recorded|posted)/i);
});

it('draws the hidden box’s refusal as the form’s own, since it has no control to sit under', async () => {
	const { root } = liveScreen(refusedWith(400, { source_id: ['This page did not submit an id.'] }));
	await fillCorrection(root);
	await postThrough(root);

	expect(unboxed(root).join(' ')).toContain('This page did not submit an id.');
});

it('opens both account boxes on their blank, and sends them, after the date fills in', async () => {
	// the day is filled in by an effect after mount, which changes the form's seed and resets it: a
	// select the seed names nothing for is left with nothing chosen and submits no value at all.
	const { root, posted } = screen();

	for (const name of ['out_of', 'into']) {
		expect(box<HTMLSelectElement>(root, name).selectedIndex).toBe(0);
	}
	await act(async () => {
		fill(box(root, 'amount'), '4.75');
		fill(box(root, 'note'), 'Stripe fee that never posted.');
	});
	await pressPost(root);

	// refused in the browser for the two unchosen accounts, and never posted — but refused as blank
	// boxes, which only a select still holding its blank can be.
	const body = new FormData(correctionForm(root));
	expect(body.get('out_of')).toBe('');
	expect(body.get('into')).toBe('');
	expect(posted).toHaveLength(0);
});

it('asks what a range holds over the address, so the screen and the file take the same three values', async () => {
	const { root, visited, posted } = screen();

	await askRange(root, '2026-03-01', '2026-03-31', 'quickbooks');

	expect(visited.at(-1)).toBe('?from=2026-03-01&to=2026-03-31&target=quickbooks');
	// a read and never a write: nothing about a range reaches the action that posts corrections.
	expect(posted).toHaveLength(0);
});

it('offers the file over a range that makes one, and says how many lines it holds', () => {
	const { root } = screen({
		asked: { from: '2026-03-01', to: '2026-03-31', target: 'quickbooks' },
		journal: {
			href: '/admin/books/journal?from=2026-03-01&to=2026-03-31&target=quickbooks',
			lines: 2
		}
	} as Partial<LoaderData>);

	const link = rangeForm(root).querySelector('a');
	expect(link?.getAttribute('href')).toBe(
		'/admin/books/journal?from=2026-03-01&to=2026-03-31&target=quickbooks'
	);
	expect(rangeForm(root).textContent).toContain('2 lines in that range');
});

it('offers no file over a range the shaping refuses, and says why instead', () => {
	const { root } = screen({
		asked: { from: '2026-01-01', to: '2026-12-31', target: 'xero' },
		journal: { refusal: 'That range holds 1402 lines and Xero takes 300 in one file.' }
	} as Partial<LoaderData>);

	// unpressable by not being there: a refusal is not a thing to meet after the file is on disk.
	expect(rangeForm(root).querySelector('a')).toBeNull();
	expect(rangeForm(root).textContent).toContain('takes 300 in one file');
});

it('holds the range press while a check is in flight, and leaves the correction press alone', async () => {
	const { root } = screen({}, { holdCheck: true });

	await askRange(root, '2026-03-01', '2026-03-31', 'quickbooks');

	// both forms submit to this same address, so a press held on `formAction` alone would hold the
	// correction's too — over boxes holding a correction nobody has sent.
	expect(pressCheck(root).getAttribute('aria-busy')).toBe('true');
	expect(pressCheck(root).getAttribute('aria-disabled')).toBe('true');
	expect(press(root).getAttribute('aria-busy')).toBe('false');
	expect(press(root).getAttribute('aria-disabled')).toBeNull();
});
