import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data, useActionData } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import { NO_DONOR } from '$lib/donations/input-schema';
import { ZERO_AMOUNT } from '$lib/ledger/input-schema';
import AddDonation from './_app.admin.donations.new';

// the Add a donation screen, drawn.
//
// what it covers is what the workers spec beside it cannot reach: that file drives the loader and the
// action against a real D1 and renders nothing. which arm of the donor region is showing, when the
// receipt box is held and why, where a refusal is marked, what the confirm itemises and what the
// button says once a gift lands are all markup, and they are read here.
//
// mounted rather than rendered to a string, because the arms are state and the submit is a
// navigation. it is not the browser spec CLAUDE.md bans over a dashboard screen: nothing here reads a
// computed style or a class name.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SCREEN = '/admin/donations/new';

const DONATION_ID = '019fb2c7-5d41-7e0a-9b62-8f3d1c7a4e29';
const PAYMENT_ID = '019fb2c7-5d41-7c93-a4e8-2b70d9f16c85';

const DONORS = [
	{ id: 'd1', displayName: 'Margaret O’Hara', primaryEmail: 'm.ohara@rivergate.example' },
	{ id: 'd2', displayName: 'Cash tin, harvest supper', primaryEmail: null }
];

const PROGRAMS = [{ value: 'p1', label: 'Winter Shelter' }];

type Props = Parameters<typeof AddDonation>[0];
type LoaderData = Props['loaderData'];

function loaderData(over: Partial<LoaderData> = {}): LoaderData {
	return {
		donationId: DONATION_ID,
		paymentId: PAYMENT_ID,
		programs: PROGRAMS,
		landed: null,
		...over
	} as LoaderData;
}

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

/**
 * the screen, what its form posted, and a search route answering from `DONORS`.
 *
 * the action never settles, which holds the screen in the state an operator sees while a press is
 * in flight.
 */
function screen(over: Partial<LoaderData> = {}) {
	const posted: FormData[] = [];
	const Stub = createRoutesStub([
		{
			path: SCREEN,
			Component: () =>
				createElement(AddDonation as never, {
					loaderData: loaderData(over),
					params: {},
					matches: []
				}),
			action: async ({ request }) => {
				posted.push(await request.formData());
				return new Promise<never>(() => {});
			}
		},
		{
			path: '/admin/donors/search',
			loader: ({ request }) => {
				const q = new URL(request.url).searchParams.get('q') ?? '';
				return {
					q,
					matches: DONORS.filter((d) => d.displayName.toLowerCase().includes(q.toLowerCase()))
				};
			}
		}
	]);
	return { root: mount(createElement(Stub, { initialEntries: [SCREEN] })), posted };
}

function box<T = HTMLInputElement>(root: HTMLElement, name: string): T {
	const found = root.querySelector(`form [name="${name}"]:not([type="hidden"])`);
	if (found === null) throw new Error(`the screen drew no box named "${name}"`);
	return found as unknown as T;
}

function hidden(root: HTMLElement, name: string): HTMLInputElement | null {
	return root.querySelector(`form input[type="hidden"][name="${name}"]`);
}

/** the message a control points at, or nothing. */
function messageUnder(control: HTMLElement): string | null {
	const described = control.getAttribute('aria-describedby');
	if (described === null) return null;
	const message = described
		.split(' ')
		.map((id) => document.getElementById(id))
		.find((el) => el?.id.endsWith('-err'));
	return message?.textContent ?? null;
}

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

function buttonReading(root: HTMLElement, label: string): HTMLButtonElement {
	const found = [...root.querySelectorAll('button')].find((b) => b.textContent === label);
	if (found === undefined) throw new Error(`no button reading "${label}"`);
	return found;
}

function status(root: HTMLElement): string {
	return root.querySelector('.adm-actions [role="status"]')?.textContent ?? '';
}

/** waits for the router to settle a fetcher load. */
async function settle(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

async function searchFor(root: HTMLElement, text: string): Promise<void> {
	await act(async () => fill(box(root, 'donor_search'), text));
	await settle();
}

async function pick(root: HTMLElement, name: string): Promise<void> {
	const row = [...root.querySelectorAll('label')].find((l) => l.textContent?.startsWith(name));
	const radio = row?.querySelector('input');
	if (!radio) throw new Error(`no match reading "${name}"`);
	await act(async () => radio.click());
}

async function pressAdd(root: HTMLElement): Promise<void> {
	const form = root.querySelector('form');
	if (form === null) throw new Error('no form');
	await act(async () => form.requestSubmit(buttonReading(root, 'Add donation')));
}

function receiptBox(root: HTMLElement): HTMLInputElement {
	return box(root, 'send_receipt');
}

it('opens searching, with the ids the loader minted, the date box and an unticked receipt', () => {
	const { root } = screen();
	expect(hidden(root, 'donation_id')?.value).toBe(DONATION_ID);
	expect(hidden(root, 'payment_id')?.value).toBe(PAYMENT_ID);
	expect(hidden(root, 'donor')?.value).toBe('existing');
	expect(box(root, 'donor_search').type).toBe('search');
	expect(box(root, 'received_on').type).toBe('date');
	expect(receiptBox(root).checked).toBe(false);
	expect(receiptBox(root).disabled).toBe(false);
	// the program box opens on its blank, which is what says it is optional.
	const program = box<HTMLSelectElement>(root, 'program_id');
	expect(program.value).toBe('');
	expect(program.options[0]?.textContent).toBe('No program');
	// the two ways a gift arrives, in the screen's words.
	const methods = [...root.querySelectorAll('input[name="method"]')].map(
		(r) => r.closest('label')?.textContent
	);
	expect(methods).toEqual(['Cash', 'Cheque']);
});

it('lists the donors matching what was typed, address beneath name', async () => {
	const { root } = screen();
	await searchFor(root, 'o’hara');

	const row = [...root.querySelectorAll('label')].find((l) => l.textContent?.includes('Margaret'));
	expect(row?.textContent).toContain('m.ohara@rivergate.example');
});

it('says nobody matches where nobody does, and still offers to add one', async () => {
	const { root } = screen();
	await searchFor(root, 'zzz');

	expect(root.textContent).toContain('Nobody matches “zzz”.');
	expect(buttonReading(root, 'Add a new donor')).toBeTruthy();
});

it('attaches a picked donor, and offers a way back to searching', async () => {
	const { root } = screen();
	await searchFor(root, 'margaret');
	await pick(root, 'Margaret');

	expect(root.querySelector('[name="donor_search"]:not([type="hidden"])')).toBeNull();
	const attached = box(root, 'contact_id');
	expect(attached.checked).toBe(true);
	expect(attached.value).toBe('d1');
	// focus follows the swap rather than falling to the body.
	expect(document.activeElement).toBe(attached);

	await act(async () => buttonReading(root, 'Choose someone else').click());
	expect(box(root, 'donor_search')).toBeTruthy();
	expect(document.activeElement).toBe(box(root, 'donor_search'));
});

it('holds the receipt box, and says why, for a donor with no address', async () => {
	const { root } = screen();
	await searchFor(root, 'cash');
	await pick(root, 'Cash tin');

	expect(receiptBox(root).disabled).toBe(true);
	expect(root.textContent).toContain('This donor has no email address, so no receipt can be sent.');
});

it('draws the create arm at rest, and holds the receipt until an address is typed', async () => {
	const { root } = screen();
	await act(async () => buttonReading(root, 'Add a new donor').click());

	expect(hidden(root, 'donor')?.value).toBe('new');
	expect(box<HTMLSelectElement>(root, 'kind').value).toBe('individual');
	expect(box(root, 'first_name')).toBeTruthy();
	expect(receiptBox(root).disabled).toBe(true);
	expect(root.textContent).toContain('No email address is entered, so no receipt can be sent.');

	await act(async () => fill(box(root, 'primary_email'), 'deborah@example.org'));
	expect(receiptBox(root).disabled).toBe(false);

	// a kind with no first and last name asks for its own name box, and submits the others empty.
	await act(async () => fill(box<HTMLElement>(root, 'kind'), 'organization'));
	expect(box(root, 'legal_name')).toBeTruthy();
	expect(hidden(root, 'first_name')?.value).toBe('');
});

it('marks every refusal at its box from the first press, and posts nothing', async () => {
	const { root, posted } = screen();
	await act(async () => fill(box(root, 'amount'), '0'));
	await pressAdd(root);

	expect(messageUnder(box(root, 'donor_search'))).toBe(NO_DONOR);
	expect(messageUnder(box(root, 'amount'))).toBe(ZERO_AMOUNT);
	expect(root.querySelector('#donation-add-method-err, [id$="method-err"]')?.textContent).toBe(
		'required'
	);
	expect(root.querySelector('dialog')).toBeNull();
	expect(posted).toHaveLength(0);

	// and a fixed box clears without another press.
	await act(async () => fill(box(root, 'amount'), '25.00'));
	expect(messageUnder(box(root, 'amount'))).toBeNull();
	expect(messageUnder(box(root, 'donor_search'))).toBe(NO_DONOR);
});

/** a donor picked and every box of the gift filled. */
async function fillGift(root: HTMLElement): Promise<void> {
	await searchFor(root, 'margaret');
	await pick(root, 'Margaret');
	await act(async () => {
		fill(box(root, 'amount'), '250.00');
		fill(box(root, 'received_on'), '2026-08-28');
		fill(box<HTMLElement>(root, 'program_id'), 'p1');
		fill(box(root, 'source'), 'Harvest supper, cheque 4471');
	});
	const cheque = root.querySelector<HTMLInputElement>('input[name="method"][value="check"]');
	await act(async () => cheque?.click());
	await act(async () => receiptBox(root).click());
}

it('itemises the gift in the confirm, the receipt stated as mail to that address', async () => {
	const { root, posted } = screen();
	await fillGift(root);
	await pressAdd(root);

	const asked = root.querySelector('dialog')?.textContent ?? '';
	expect(asked).toContain('Add this donation?');
	expect(asked).toContain('$250.00 from Margaret O’Hara, received 2026-08-28, by cheque.');
	expect(asked).toContain('Credited to Winter Shelter.');
	expect(asked).toContain('Source: Harvest supper, cheque 4471');
	expect(asked).toContain('A receipt will be emailed to m.ohara@rivergate.example.');
	expect(posted).toHaveLength(0);

	await act(async () => buttonReading(root, 'Yes, add this donation').click());
	expect(posted).toHaveLength(1);
	const [body] = posted;
	expect(body?.get('contact_id')).toBe('d1');
	expect(body?.get('donation_id')).toBe(DONATION_ID);
	expect(body?.get('send_receipt')).toBe('on');
	expect(body?.getAll('contact_id')).toHaveLength(1);
	expect(buttonReading(root, 'Add donation').getAttribute('aria-disabled')).toBe('true');
});

it('reports a landed gift at the button, with its receipt', () => {
	const { root } = screen({
		landed: {
			filing: 'picked',
			receipt: 'sent',
			gift: { amount: '$250.00', donorName: 'Margaret O’Hara', receivedOn: '2026-08-28' }
		}
	});
	expect(status(root)).toBe(
		'Added. $250.00 from Margaret O’Hara, received 2026-08-28. Receipt sent.'
	);
	// a date, so it keeps to one line where the words around it wrap.
	expect(root.querySelector('[role="status"] time')?.getAttribute('datetime')).toBe('2026-08-28');
});

it('says a gift was filed under the donor already holding the address, and a receipt that did not go', () => {
	const { root } = screen({
		landed: { filing: 'matched', receipt: 'not_sent', gift: null }
	});
	expect(status(root)).toContain('Filed under the donor already holding that email address.');
	expect(status(root)).toContain('Receipt not sent.');
});

/**
 * the screen under a router that answers its presses and hands the answer back as the route's own
 * action data — the loop a press goes round. `answer` returns what the action would.
 */
function liveScreen(answer: (body: FormData) => unknown): {
	root: HTMLElement;
	posted: FormData[];
} {
	const posted: FormData[] = [];
	const Stub = createRoutesStub([
		{
			id: 'add',
			path: SCREEN,
			action: async ({ request }) => {
				const body = await request.formData();
				posted.push(body);
				return answer(body);
			},
			Component: () =>
				createElement(AddDonation as never, {
					loaderData: loaderData(),
					actionData: useActionData(),
					params: {},
					matches: []
				})
		},
		{
			path: '/admin/donors/search',
			loader: () => ({ q: 'margaret', matches: [DONORS[0]] })
		}
	]);
	return { root: mount(createElement(Stub, { initialEntries: [SCREEN] })), posted };
}

/** presses, and answers the confirm yes. */
async function pressThrough(root: HTMLElement): Promise<void> {
	await pressAdd(root);
	await act(async () => buttonReading(root, 'Yes, add this donation').click());
	await settle();
}

/** fills the gift, presses, and answers the confirm yes. */
async function addThrough(root: HTMLElement): Promise<void> {
	await fillGift(root);
	await pressAdd(root);
	await act(async () => buttonReading(root, 'Yes, add this donation').click());
	await settle();
}

it('says nothing on a plain visit', () => {
	expect(status(screen().root)).toBe('');
});

it('says a write failed without calling the gift not added, and keeps the ids', async () => {
	const WRITE_FAILED_SENTENCE =
		'Adding this donation failed, and it may have been recorded anyway. Press again with nothing changed — that cannot record it twice. Check Gifts before pressing with changed details.';
	const { root } = liveScreen(() =>
		data(
			{
				form: {
					id: 'donation-add',
					result: { status: 'error', initialValue: {}, error: { '': [WRITE_FAILED_SENTENCE] } }
				}
			},
			{ status: 500 }
		)
	);
	await addThrough(root);
	expect(root.textContent).toContain(WRITE_FAILED_SENTENCE);
	expect(root.textContent).toContain('Not confirmed');
	expect(root.textContent).not.toContain('Not added');
	expect(hidden(root, 'donation_id')?.value).toBe(DONATION_ID);
});

const FRESH = {
	donationId: '019fb2c7-5d41-7e0a-9b62-000000000777',
	paymentId: '019fb2c7-5d41-7c93-a4e8-000000000777'
};

it('presses again under the same ids after a failed write, and under fresh ones once a box changes', async () => {
	let presses = 0;
	const { root, posted } = liveScreen(() =>
		presses++ < 2
			? data(
					{
						freshIds: FRESH,
						form: {
							id: 'donation-add',
							result: { status: 'error', initialValue: {}, error: { '': ['failed'] } }
						}
					},
					{ status: 500 }
				)
			: new Promise<never>(() => {})
	);
	await addThrough(root);
	// pressed again unchanged: the write may have landed, so it goes under the same ids.
	await pressThrough(root);
	// then with the amount changed: a different gift, which the failed ids may not stand for.
	await act(async () => fill(box(root, 'amount'), '300.00'));
	await pressThrough(root);

	expect(posted.map((b) => b.get('donation_id'))).toEqual([
		DONATION_ID,
		DONATION_ID,
		FRESH.donationId
	]);
	expect(posted[2]?.get('payment_id')).toBe(FRESH.paymentId);
});

it('takes the fresh pair over boxes unchanged, where the action released the ids they were sent under', async () => {
	let presses = 0;
	const { root, posted } = liveScreen(() =>
		presses++ < 1
			? data(
					{
						freshIds: FRESH,
						releasedId: DONATION_ID,
						form: {
							id: 'donation-add',
							result: { status: 'error', initialValue: {}, error: { '': ['held'] } }
						}
					},
					{ status: 409 }
				)
			: new Promise<never>(() => {})
	);
	await addThrough(root);
	await pressThrough(root);

	expect(posted.map((b) => b.get('donation_id'))).toEqual([DONATION_ID, FRESH.donationId]);
});

it('answers an earlier press neutrally, and stops once a box no longer holds what was pressed', async () => {
	const { root } = liveScreen((body) =>
		data(
			{
				freshIds: null,
				releasedId: null,
				recordedAgain: { donationId: body.get('donation_id'), receipt: 'sent' },
				form: { id: 'donation-add', result: { status: 'error', initialValue: {} } }
			},
			{ status: 409 }
		)
	);
	await addThrough(root);
	expect(status(root)).toBe('Already recorded, from the earlier press. Receipt sent.');

	await act(async () => fill(box(root, 'amount'), '300.00'));
	expect(status(root)).toBe('');
});

it('keeps the ids after a failed write when only the receipt box changes', async () => {
	// ticking the box writes nothing about the gift, and a fresh pair would record it a second time.
	let presses = 0;
	const { root, posted } = liveScreen(() =>
		presses++ < 1
			? data(
					{
						freshIds: FRESH,
						releasedId: null,
						recordedAgain: null,
						form: {
							id: 'donation-add',
							result: { status: 'error', initialValue: {}, error: { '': ['failed'] } }
						}
					},
					{ status: 500 }
				)
			: new Promise<never>(() => {})
	);
	await addThrough(root);
	await act(async () => receiptBox(root).click());
	await pressThrough(root);

	expect(posted.map((b) => b.get('donation_id'))).toEqual([DONATION_ID, DONATION_ID]);
	expect(posted[0]?.get('send_receipt')).toBe('on');
	expect(posted[1]?.get('send_receipt')).toBeNull();
});

it('opens no second confirm when enter is pressed in a box while a press is in flight', async () => {
	const { root, posted } = screen();
	await fillGift(root);
	await pressAdd(root);
	await act(async () => buttonReading(root, 'Yes, add this donation').click());
	expect(posted).toHaveLength(1);

	await pressAdd(root);
	expect(root.querySelector('dialog')).toBeNull();
	expect(posted).toHaveLength(1);
});

it('opens the program box on No program and sends it, after the date fills in', async () => {
	// the day is filled in by an effect after mount, which changes the form's seed and resets it: a
	// select the seed names nothing for is left with nothing chosen, submits no value, and every gift
	// is refused as a form that did not arrive whole.
	const { root, posted } = screen();
	await searchFor(root, 'margaret');
	await pick(root, 'Margaret');
	await act(async () => {
		fill(box(root, 'amount'), '25.00');
		root.querySelector<HTMLInputElement>('input[name="method"][value="cash"]')?.click();
	});

	expect(box<HTMLSelectElement>(root, 'program_id').selectedIndex).toBe(0);
	await pressAdd(root);
	await act(async () => buttonReading(root, 'Yes, add this donation').click());
	expect(posted[0]?.get('program_id')).toBe('');
});

it('clears a landed outcome at the first press on the fresh form, a refusal caught here included', async () => {
	const landed = {
		filing: 'picked' as const,
		receipt: 'none' as const,
		gift: { amount: '$250.00', donorName: 'Margaret O’Hara', receivedOn: '2026-08-28' }
	};

	const pressed = screen({ landed }).root;
	expect(status(pressed)).toContain('Added.');
	await pressAdd(pressed);
	// the empty form is refused in the browser, which sets no action data; the old outcome must not
	// stand beside the marks.
	expect(messageUnder(box(pressed, 'amount'))).toBe('required');
	expect(status(pressed)).toBe('');

	const typed = screen({ landed }).root;
	await act(async () => fill(box(typed, 'amount'), '10.00'));
	expect(status(typed)).toBe('');
});
