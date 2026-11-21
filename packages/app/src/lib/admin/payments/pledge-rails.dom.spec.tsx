import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { describe, expect, it, onTestFinished } from 'vitest';
import { PLEDGE_RAIL_FORMS } from '$lib/payments/pledge-rail-forms';
import { WHICH_FORM } from '$lib/forms/definition';
import { PledgeRails, type PledgeRailsProps } from './pledge-rails';

// the Stocks and IRA (QCD) cards on /admin/payments, mounted under a stub whose action records each
// body it is sent and whose loader reads the rails back, so a press that lands redraws the card from
// the stored state as the real screen does.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Rails = PledgeRailsProps['rails'];

const OFF: Rails = {
	stock: {
		enabled: false,
		details: { brokerage_name: '', dtc_number: '', account_number: '', account_name: '' }
	},
	ira_qcd: { enabled: false, details: { payee_name: '', mailing_address: '' } }
};

const STOCK_DETAILS = {
	brokerage_name: 'Harbor Street Securities',
	dtc_number: '0164',
	account_number: 'Z12-345678',
	account_name: 'Cedar Fork Community Pantry Inc.'
};

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
	await act(async () => {
		await new Promise((done) => setTimeout(done, 0));
	});
	await act(async () => {
		await new Promise((done) => setTimeout(done, 0));
	});
}

/**
 * the two cards over `stored`, which the action's `answer` may rewrite before it answers: a Save
 * that lands stores the rail, as `enablePledgeRail` does.
 */
async function screen(stored: Rails, answer: (body: FormData, rails: Rails) => [Rails, unknown]) {
	let rails = stored;
	const posted: FormData[] = [];
	const Stub = createRoutesStub([
		{
			path: '/admin/payments',
			loader: () => rails,
			action: async ({ request }) => {
				const body = await request.formData();
				posted.push(body);
				const [next, said] = answer(body, rails);
				rails = next;
				return said;
			},
			Component: () => createElement(PledgeRails, { rails: useLoaderData() as Rails }),
			HydrateFallback: () => null
		}
	]);
	const root = mount(createElement(Stub, { initialEntries: ['/admin/payments'] }));
	await settle();
	return { root, posted };
}

/** an action that answers every press as the route does when it lands. */
const landing = (body: FormData, rails: Rails): [Rails, unknown] => {
	const which = body.get(WHICH_FORM);
	if (which === PLEDGE_RAIL_FORMS.stock) {
		const details = {
			brokerage_name: String(body.get('brokerage_name')),
			dtc_number: String(body.get('dtc_number')),
			account_number: String(body.get('account_number')),
			account_name: String(body.get('account_name'))
		};
		return [
			{ ...rails, stock: { enabled: true, details } },
			{ pledgeRail: { rail: 'stock', outcome: 'saved' } }
		];
	}
	if (which === PLEDGE_RAIL_FORMS.stockOff) {
		return [
			{ ...rails, stock: { ...rails.stock, enabled: false } },
			{ pledgeRail: { rail: 'stock', outcome: 'disabled' } }
		];
	}
	throw new Error(`unexpected press ${String(which)}`);
};

function card(root: HTMLElement, heading: string): HTMLElement {
	const found = [...root.querySelectorAll('section')].find(
		(section) => section.querySelector('h2')?.textContent === heading
	);
	if (found === undefined) throw new Error(`no card headed ${heading}`);
	return found;
}

function box(within: HTMLElement, label: string): HTMLInputElement {
	const named = [...within.querySelectorAll('label')].find((one) => one.textContent === label);
	const found = named === undefined ? null : within.ownerDocument.getElementById(named.htmlFor);
	if (!(found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement)) {
		throw new Error(`no box labelled ${label}`);
	}
	return found as HTMLInputElement;
}

function button(within: HTMLElement, name: string): HTMLButtonElement {
	const found = [...within.querySelectorAll('button')].find((one) => one.textContent === name);
	if (found === undefined) throw new Error(`no ${name} button`);
	return found;
}

async function type(target: HTMLInputElement, text: string): Promise<void> {
	await act(async () => {
		target.value = text;
		target.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

async function press(target: HTMLElement): Promise<void> {
	await act(async () => target.click());
	await settle();
}

async function turnOn(root: HTMLElement, heading: string): Promise<HTMLElement> {
	const toggle = card(root, heading).querySelector<HTMLInputElement>('[role="switch"]');
	if (toggle === null) throw new Error(`no switch on ${heading}`);
	toggle.focus();
	await press(toggle);
	return card(root, heading);
}

const STOCK_BOXES = ['Brokerage name', 'DTC number', 'Account number', 'Account name'];

describe('a rail that is off', () => {
	it('is one row: its heading and an unchecked switch named by it', async () => {
		const { root } = await screen(OFF, landing);
		for (const heading of ['Stocks', 'IRA (QCD)']) {
			const off = card(root, heading);
			const toggle = off.querySelector<HTMLInputElement>('input');
			const named = off.ownerDocument.getElementById(toggle?.getAttribute('aria-labelledby') ?? '');

			expect(toggle?.getAttribute('role')).toBe('switch');
			expect(toggle?.type).toBe('checkbox');
			expect(toggle?.checked).toBe(false);
			expect(named?.textContent).toBe(heading);
			expect(off.querySelectorAll('input')).toHaveLength(1);
			expect(off.querySelectorAll('button, textarea, p')).toHaveLength(0);
		}
	});
});

describe('turning a rail on', () => {
	it('opens the card with empty required boxes, Save and Disable, and posts nothing', async () => {
		const { root, posted } = await screen(OFF, landing);
		const stocks = await turnOn(root, 'Stocks');

		expect(stocks.querySelector('[role="switch"]')).toBeNull();
		expect(stocks.querySelector('h2')?.textContent).toBe('Stocks');
		expect(stocks.querySelector('.adm-hint')?.textContent).toBe(
			'Donors give shares by ticker and are shown where to send them.'
		);
		for (const label of STOCK_BOXES) {
			expect(box(stocks, label).value).toBe('');
			expect(box(stocks, label).getAttribute('aria-required')).toBe('true');
		}
		expect(document.activeElement).toBe(box(stocks, 'Brokerage name'));
		const save = button(stocks, 'Save');
		const disable = button(stocks, 'Disable stocks');
		expect(save.type).toBe('submit');
		expect(save.className).toContain('ds-btn-primary');
		expect(disable.type).toBe('button');
		expect(disable.className).toContain('ds-text-btn');
		expect(disable.parentElement?.lastElementChild).toBe(disable);
		expect(stocks.querySelector('[disabled]')).toBeNull();
		expect(stocks.textContent).not.toContain('Saved');
		expect(posted).toHaveLength(0);
	});

	it('opens IRA (QCD) with its payee and a three-row mailing address', async () => {
		const { root } = await screen(OFF, landing);
		const ira = await turnOn(root, 'IRA (QCD)');

		expect(box(ira, 'Payee name').value).toBe('');
		const address = box(ira, 'Mailing address');
		expect(address.tagName).toBe('TEXTAREA');
		expect(address.getAttribute('rows')).toBe('3');
		expect(button(ira, 'Disable IRA (QCD)').type).toBe('button');
	});
});

describe('Save', () => {
	it('flags every empty box required, focuses the first, and saves nothing', async () => {
		const { root, posted } = await screen(OFF, landing);
		const stocks = await turnOn(root, 'Stocks');
		await type(box(stocks, 'Brokerage name'), 'Harbor Street Securities');
		await type(box(stocks, 'DTC number'), '0164');
		await press(button(stocks, 'Save'));

		for (const label of ['Account number', 'Account name']) {
			const flagged = box(stocks, label);
			const message = document.getElementById(`${flagged.id}-err`);
			expect(flagged.getAttribute('aria-invalid')).toBe('true');
			expect(flagged.getAttribute('aria-describedby')?.split(' ')).toContain(`${flagged.id}-err`);
			expect(message?.textContent).toBe('required');
			expect(message?.classList.contains('ds-field-err')).toBe(true);
			expect(message?.getAttribute('role')).toBe('alert');
		}
		expect(box(stocks, 'Brokerage name').getAttribute('aria-invalid')).toBeNull();
		expect(document.activeElement).toBe(box(stocks, 'Account number'));
		expect(stocks.textContent).not.toContain('Saved');
		expect(posted).toHaveLength(0);
	});

	it('says Saved where Save stood, with the longer intro, until a box is edited', async () => {
		const { root, posted } = await screen(OFF, landing);
		let stocks = await turnOn(root, 'Stocks');
		await type(box(stocks, 'Brokerage name'), STOCK_DETAILS.brokerage_name);
		await type(box(stocks, 'DTC number'), STOCK_DETAILS.dtc_number);
		await type(box(stocks, 'Account number'), STOCK_DETAILS.account_number);
		await type(box(stocks, 'Account name'), STOCK_DETAILS.account_name);
		await press(button(stocks, 'Save'));
		stocks = card(root, 'Stocks');

		expect(posted.map((body) => body.get(WHICH_FORM))).toEqual([PLEDGE_RAIL_FORMS.stock]);
		expect(posted[0]?.get('account_name')).toBe(STOCK_DETAILS.account_name);
		const status = stocks.querySelector('[role="status"]');
		expect(status?.textContent).toBe('Saved');
		expect([...stocks.querySelectorAll('button')].map((one) => one.textContent)).toEqual([
			'Disable stocks'
		]);
		expect(stocks.querySelector('.adm-hint')?.textContent).toBe(
			'Donors give shares by ticker and are shown where to send them. You mark each gift received when the shares arrive.'
		);
		expect(box(stocks, 'Account name').value).toBe(STOCK_DETAILS.account_name);

		await type(box(stocks, 'DTC number'), '0165');
		expect(button(stocks, 'Save').type).toBe('submit');
		expect(stocks.querySelector('[role="status"]')?.textContent).toBe('');
	});
});

describe('Disable', () => {
	it('leaves no Saved behind on a card reopened after it', async () => {
		const { root } = await screen(OFF, landing);
		let stocks = await turnOn(root, 'Stocks');
		for (const label of STOCK_BOXES) await type(box(stocks, label), 'filled');
		await press(button(stocks, 'Save'));
		await press(button(card(root, 'Stocks'), 'Disable stocks'));
		stocks = await turnOn(root, 'Stocks');

		expect(stocks.querySelector('[role="status"]')?.textContent).toBe('');
		expect(button(stocks, 'Save').type).toBe('submit');
	});

	it('posts through its own press, collapses the card, and keeps the details', async () => {
		const { root, posted } = await screen(
			{ ...OFF, stock: { enabled: true, details: STOCK_DETAILS } },
			landing
		);
		const stocks = card(root, 'Stocks');
		expect(box(stocks, 'Brokerage name').value).toBe(STOCK_DETAILS.brokerage_name);

		const disable = button(stocks, 'Disable stocks');
		disable.focus();
		await press(disable);

		expect(posted.map((body) => body.get(WHICH_FORM))).toEqual([PLEDGE_RAIL_FORMS.stockOff]);
		const off = card(root, 'Stocks');
		const toggle = off.querySelector<HTMLInputElement>('[role="switch"]');
		expect(toggle?.checked).toBe(false);
		expect(document.activeElement).toBe(toggle);

		const reopened = await turnOn(root, 'Stocks');
		expect(box(reopened, 'Account number').value).toBe(STOCK_DETAILS.account_number);
		expect(reopened.querySelector('.adm-hint')?.textContent).toBe(
			'Donors give shares by ticker and are shown where to send them.'
		);
	});
});
