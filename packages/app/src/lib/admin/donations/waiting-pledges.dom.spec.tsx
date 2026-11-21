import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data, useLoaderData } from 'react-router';
import { describe, expect, it, onTestFinished } from 'vitest';
import { MARK_RECEIVED_FORM_ID } from '$lib/donations/pledge-forms';
import { WHICH_FORM } from '$lib/forms/definition';
import { clientAction } from '../../../routes/_app.admin.donations._index';
import { UNREACHED } from '../unreached';
import { WaitingCard, type WaitingCardProps, type WaitingPledge } from './waiting-pledges';

// the "Waiting to arrive" card and its Mark received dialog, mounted under the Gifts screen's index
// route with a stand-in for the gifts table's scroll plane beside it. each press goes through the
// route's `clientAction`, whose server action answers as the test says, and the loader reads the
// waiting list back, so a press that lands redraws the
// card from what is still waiting. happy-dom implements `showModal()` as a flag with no top layer,
// so focus is asserted only where this card and the Modal move it themselves.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Waiting = WaitingCardProps['waiting'];

const MAYA: WaitingPledge = {
	id: 'pledge-maya',
	method: 'stock',
	donorName: 'Maya Okafor',
	donorEmail: 'maya.okafor@example.org',
	pledged: '50 shares of AAPL',
	reference: 'CFCP-AAPL-7Q2D',
	told: true
};

const JAMES: WaitingPledge = {
	id: 'pledge-james',
	method: 'ira_qcd',
	donorName: 'James Whitfield',
	donorEmail: 'j.whitfield@example.com',
	pledged: '$5,000.00 from Fidelity Investments',
	reference: 'CFCP-IRA-4K9M',
	told: false
};

const BOTH: Waiting = { total: 2, pledges: [MAYA, JAMES] };

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
	for (let turn = 0; turn < 3; turn++) {
		await act(async () => {
			await new Promise((done) => setTimeout(done, 0));
		});
	}
}

/** what the action does with a press: the waiting list it leaves, and what it answers. */
type Answer = (body: FormData, waiting: Waiting) => [Waiting, unknown];

/** the action as the route answers a press that records the gift. */
const recording: Answer = (body, waiting) => {
	const id = String(body.get('pledge_id'));
	const pledges = waiting.pledges.filter((one) => one.id !== id);
	return [{ total: pledges.length, pledges }, { received: { pledgeId: id } }];
};

async function screen(stored: Waiting, answer: Answer) {
	let waiting = stored;
	const posted: FormData[] = [];
	const Page = () => {
		const now = useLoaderData() as Waiting;
		return createElement(
			'div',
			null,
			now.total > 0 ? createElement(WaitingCard, { waiting: now }) : null,
			createElement('section', { className: 'adm-plane', tabIndex: 0 })
		);
	};
	const Stub = createRoutesStub([
		{
			path: '/admin/donations',
			children: [
				{
					index: true,
					loader: () => waiting,
					action: (args) =>
						clientAction({
							...args,
							serverAction: async () => {
								const body = await args.request.formData();
								posted.push(body);
								const [next, said] = answer(body, waiting);
								waiting = next;
								return said;
							}
						} as never),
					Component: Page,
					HydrateFallback: () => null
				}
			]
		}
	]);
	const root = mount(createElement(Stub, { initialEntries: ['/admin/donations'] }));
	await settle();
	return { root, posted };
}

function rowOf(root: HTMLElement, donor: string): HTMLElement {
	const found = [...root.querySelectorAll<HTMLElement>('li')].find((one) =>
		one.textContent?.includes(donor)
	);
	if (found === undefined) throw new Error(`no row for ${donor}`);
	return found;
}

function button(within: Element, name: string): HTMLButtonElement {
	const found = [...within.querySelectorAll('button')].find((one) => one.textContent === name);
	if (found === undefined) throw new Error(`no ${name} button`);
	return found;
}

function box(within: Element, label: string): HTMLInputElement {
	const named = [...within.querySelectorAll('label')].find((one) => one.textContent === label);
	const found = named === undefined ? null : document.getElementById(named.htmlFor);
	if (!(found instanceof HTMLInputElement)) throw new Error(`no box labelled ${label}`);
	return found;
}

/** the value written as a keystroke would, so react's own tracker sees it change. */
async function type(target: HTMLInputElement, text: string): Promise<void> {
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(target, text);
		target.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

async function press(target: HTMLElement): Promise<void> {
	target.focus();
	await act(async () => target.click());
	await settle();
}

async function open(root: HTMLElement, donor: string): Promise<HTMLDialogElement> {
	await press(
		button(
			rowOf(root, donor),
			`Mark received, ${donor}, ${donor === 'Maya Okafor' ? MAYA.pledged : JAMES.pledged}`
		)
	);
	const dialog = root.querySelector('dialog');
	if (dialog === null) throw new Error('no dialog opened');
	return dialog;
}

async function fill(dialog: HTMLDialogElement): Promise<void> {
	await type(box(dialog, 'Value received'), '9512.40');
	await type(box(dialog, 'Date received'), '2026-11-18');
}

describe('the waiting card', () => {
	it('lists each pledge with who, what, the reference and where the donor is', async () => {
		const { root } = await screen(BOTH, recording);
		const badge = root.querySelector('.ds-badge');

		expect(root.querySelector('h2')?.textContent).toBe('Waiting to arrive');
		expect(badge?.textContent).toBe('2 pledges');
		expect(badge?.classList.contains('ds-badge-warning')).toBe(true);
		expect(rowOf(root, 'Maya Okafor').textContent).toBe(
			'Maya Okaformaya.okafor@example.org50 shares of AAPLCFCP-AAPL-7Q2DDonor says it’s sentMark received, Maya Okafor, 50 shares of AAPL'
		);
		expect(rowOf(root, 'James Whitfield').textContent).toContain('IRA (QCD)');
		expect(rowOf(root, 'James Whitfield').textContent).toContain('Instructions shown');
		expect(rowOf(root, 'Maya Okafor').textContent).not.toContain('IRA (QCD)');
	});

	it('names each Mark received by its row, the row’s words seen by a reader alone', async () => {
		const { root } = await screen(BOTH, recording);
		const mark = button(
			rowOf(root, 'Maya Okafor'),
			'Mark received, Maya Okafor, 50 shares of AAPL'
		);

		expect(mark.type).toBe('button');
		expect(mark.querySelector('.adm-vh')?.textContent).toBe(', Maya Okafor, 50 shares of AAPL');
		expect(root.querySelector('[disabled]')).toBeNull();
	});
});

describe('the Mark received dialog', () => {
	it('is the registry dialog, opened modal and named by its heading, with both boxes', async () => {
		const { root } = await screen(BOTH, recording);
		const dialog = await open(root, 'Maya Okafor');

		expect(dialog.classList.contains('ds-dialog')).toBe(true);
		expect(dialog.open).toBe(true);
		expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
			'Mark received'
		);
		expect(dialog.textContent).toContain(
			'50 shares of AAPL from Maya Okafor, reference CFCP-AAPL-7Q2D.'
		);
		const value = box(dialog, 'Value received');
		expect(document.getElementById(`${value.id}-affix`)?.textContent).toBe('$');
		expect(value.getAttribute('aria-describedby')?.split(' ')).toContain(`${value.id}-affix`);
		expect(box(dialog, 'Date received').type).toBe('date');
		expect(button(dialog, 'Mark received').type).toBe('submit');
		expect(button(dialog, 'Cancel').type).toBe('button');
		expect(dialog.querySelector('[disabled]')).toBeNull();
	});

	it('gives focus back to the row’s press when it is cancelled', async () => {
		const { root, posted } = await screen(BOTH, recording);
		const dialog = await open(root, 'James Whitfield');
		await press(button(dialog, 'Cancel'));

		expect(root.querySelector('dialog')).toBeNull();
		expect(document.activeElement?.textContent).toBe(
			'Mark received, James Whitfield, $5,000.00 from Fidelity Investments'
		);
		expect(posted).toHaveLength(0);
	});

	it('posts the pledge, the value and the day, then closes onto the card', async () => {
		const { root, posted } = await screen(BOTH, recording);
		const dialog = await open(root, 'Maya Okafor');
		await fill(dialog);
		await press(button(dialog, 'Mark received'));

		expect(posted.map((body) => body.get(WHICH_FORM))).toEqual([MARK_RECEIVED_FORM_ID]);
		expect(posted[0]?.get('pledge_id')).toBe(MAYA.id);
		expect(posted[0]?.get('value')).toBe('9,512.40');
		expect(posted[0]?.get('received_on')).toBe('2026-11-18');
		expect(root.querySelector('dialog')).toBeNull();
		expect(root.querySelectorAll('li')).toHaveLength(1);
		expect(document.activeElement?.textContent).toBe('Waiting to arrive');
	});

	it('closes onto the gifts table when the last pledge is marked', async () => {
		const { root } = await screen({ total: 1, pledges: [MAYA] }, recording);
		const dialog = await open(root, 'Maya Okafor');
		await fill(dialog);
		await press(button(dialog, 'Mark received'));

		expect(root.querySelector('h2')).toBeNull();
		expect(document.activeElement).toBe(root.querySelector('section.adm-plane'));
	});

	it('flags the box a 400 refuses', async () => {
		const { root } = await screen(BOTH, (_, waiting) => [
			waiting,
			data(
				{
					form: {
						id: MARK_RECEIVED_FORM_ID,
						result: { status: 'error', error: { value: ['must be more than zero'] } }
					}
				},
				{ status: 400 }
			)
		]);
		const dialog = await open(root, 'Maya Okafor');
		await fill(dialog);
		await press(button(dialog, 'Mark received'));

		const open_ = root.querySelector('dialog');
		const value = box(open_ ?? dialog, 'Value received');
		expect(open_).not.toBeNull();
		expect(value.getAttribute('aria-invalid')).toBe('true');
		expect(document.getElementById(`${value.id}-err`)?.textContent).toBe('must be more than zero');
	});

	it('stays open over its sentence when the pledge was already received', async () => {
		const sentence =
			'This gift was already marked received, so nothing was recorded again. Reload the page to see it in the list.';
		const { root } = await screen(BOTH, (_, waiting) => [
			waiting,
			data(
				{
					form: {
						id: MARK_RECEIVED_FORM_ID,
						result: { status: 'error', error: { '': [sentence] } }
					}
				},
				{ status: 409 }
			)
		]);
		const dialog = await open(root, 'Maya Okafor');
		await fill(dialog);
		await press(button(dialog, 'Mark received'));

		const still = root.querySelector('dialog');
		expect(still).not.toBeNull();
		expect(still?.querySelector('[role="alert"]')?.textContent).toBe(sentence);
	});

	it('stays open over what it typed when the press never reaches the server', async () => {
		const { root } = await screen(BOTH, () => {
			throw new TypeError('Failed to fetch');
		});
		const dialog = await open(root, 'Maya Okafor');
		await fill(dialog);
		await press(button(dialog, 'Mark received'));

		const still = root.querySelector('dialog');
		expect(still).not.toBeNull();
		expect(still?.querySelector('[role="alert"]')?.textContent).toBe(UNREACHED);
		expect(box(still ?? dialog, 'Value received').value).toBe('9,512.40');
		expect(rowOf(root, 'Maya Okafor')).toBeDefined();
	});
});
