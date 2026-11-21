import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, useLoaderData } from 'react-router';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
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
	await vi.waitFor(() => expect(root.querySelectorAll('section')).toHaveLength(2));
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
	if (which === PLEDGE_RAIL_FORMS.iraQcd) {
		const details = {
			payee_name: String(body.get('payee_name')),
			mailing_address: String(body.get('mailing_address'))
		};
		return [
			{ ...rails, ira_qcd: { enabled: true, details } },
			{ pledgeRail: { rail: 'ira_qcd', outcome: 'saved' } }
		];
	}
	if (which === PLEDGE_RAIL_FORMS.iraQcdOff) {
		return [
			{ ...rails, ira_qcd: { ...rails.ira_qcd, enabled: false } },
			{ pledgeRail: { rail: 'ira_qcd', outcome: 'disabled' } }
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

/** a press, committed; what it sets off is waited for by what it should come to. */
async function press(target: HTMLElement): Promise<void> {
	await act(async () => target.click());
}

/** a press that posts, waited for until the action has answered and the rails are read back. */
async function pressPosting(target: HTMLElement, posted: readonly FormData[]): Promise<void> {
	const before = posted.length;
	await press(target);
	await vi.waitFor(() => {
		expect(posted).toHaveLength(before + 1);
		expect(target.ownerDocument.querySelector('[aria-busy="true"]')).toBeNull();
	});
}

async function turnOn(root: HTMLElement, heading: string): Promise<HTMLElement> {
	const toggle = card(root, heading).querySelector<HTMLInputElement>('[role="switch"]');
	if (toggle === null) throw new Error(`no switch on ${heading}`);
	toggle.focus();
	await press(toggle);
	return card(root, heading);
}

/** the card's switch, where the card is collapsed to its one row. */
const switchOf = (root: HTMLElement, heading: string) =>
	card(root, heading).querySelector<HTMLInputElement>('[role="switch"]');

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
		await pressPosting(button(stocks, 'Save'), posted);
		await vi.waitFor(() =>
			expect(card(root, 'Stocks').querySelector('[role="status"]')?.textContent).toBe('Saved')
		);
		stocks = card(root, 'Stocks');

		expect(posted.map((body) => body.get(WHICH_FORM))).toEqual([PLEDGE_RAIL_FORMS.stock]);
		expect(posted[0]?.get('account_name')).toBe(STOCK_DETAILS.account_name);
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

	it('keeps Save, and says no Saved, over a box edited while the Save was out', async () => {
		let release: () => void = () => {};
		// a Save of the details already stored, so the landing moves no record and resets no box.
		const { root, posted } = await screen(
			{ ...OFF, stock: { enabled: true, details: STOCK_DETAILS } },
			(body, rails) => {
				const [next, said] = landing(body, rails);
				return [next, new Promise((done) => (release = () => done(said)))];
			}
		);
		const stocks = card(root, 'Stocks');
		await press(button(stocks, 'Save'));
		await vi.waitFor(() => expect(posted).toHaveLength(1));
		await type(box(stocks, 'DTC number'), '0165');
		await act(async () => release());
		await vi.waitFor(() => expect(root.querySelector('[aria-busy="true"]')).toBeNull());

		const after = card(root, 'Stocks');
		expect(box(after, 'DTC number').value).toBe('0165');
		expect(button(after, 'Save').type).toBe('submit');
		expect(after.querySelector('[role="status"]')?.textContent).toBe('');
	});
});

describe('Disable', () => {
	it('leaves no Saved behind on a card reopened after it', async () => {
		const { root, posted } = await screen(OFF, landing);
		let stocks = await turnOn(root, 'Stocks');
		for (const label of STOCK_BOXES) await type(box(stocks, label), 'filled');
		await pressPosting(button(stocks, 'Save'), posted);
		await vi.waitFor(() => expect(card(root, 'Stocks').textContent).toContain('Saved'));
		await pressPosting(button(card(root, 'Stocks'), 'Disable stocks'), posted);
		await vi.waitFor(() => expect(switchOf(root, 'Stocks')).not.toBeNull());
		stocks = await turnOn(root, 'Stocks');

		expect(posted.map((body) => body.get(WHICH_FORM))).toEqual([
			PLEDGE_RAIL_FORMS.stock,
			PLEDGE_RAIL_FORMS.stockOff
		]);
		expect(stocks.querySelector('[role="status"]')?.textContent).toBe('');
		expect(button(stocks, 'Save').type).toBe('submit');
	});

	it('only closes a rail switched on and never saved, posting nothing', async () => {
		const { root, posted } = await screen(OFF, landing);
		for (const [heading, disable] of [
			['Stocks', 'Disable stocks'],
			['IRA (QCD)', 'Disable IRA (QCD)']
		] as const) {
			const opened = await turnOn(root, heading);
			const press_ = button(opened, disable);
			press_.focus();
			await press(press_);

			const toggle = switchOf(root, heading);
			expect(toggle?.checked, heading).toBe(false);
			expect(document.activeElement, heading).toBe(toggle);
		}
		expect(posted).toHaveLength(0);
	});

	it('saves IRA (QCD) with its payee and address, then disables it', async () => {
		const { root, posted } = await screen(OFF, landing);
		const ira = await turnOn(root, 'IRA (QCD)');
		await type(box(ira, 'Payee name'), 'Cedar Fork Community Pantry Inc.');
		await type(box(ira, 'Mailing address'), '412 Alder Lane, Suite 3\nCedar Fork, OR 97330');
		await pressPosting(button(ira, 'Save'), posted);
		await vi.waitFor(() =>
			expect(card(root, 'IRA (QCD)').querySelector('[role="status"]')?.textContent).toBe('Saved')
		);

		expect(posted[0]?.get(WHICH_FORM)).toBe(PLEDGE_RAIL_FORMS.iraQcd);
		expect(posted[0]?.get('payee_name')).toBe('Cedar Fork Community Pantry Inc.');
		expect(posted[0]?.get('mailing_address')).toBe('412 Alder Lane, Suite 3\nCedar Fork, OR 97330');
		expect(card(root, 'IRA (QCD)').querySelector('.adm-hint')?.textContent).toBe(
			'Donors pledge a gift from their IRA and are shown who to make the check out to. You mark each gift received when the check arrives.'
		);

		await pressPosting(button(card(root, 'IRA (QCD)'), 'Disable IRA (QCD)'), posted);
		await vi.waitFor(() => expect(switchOf(root, 'IRA (QCD)')?.checked).toBe(false));
		expect(posted[1]?.get(WHICH_FORM)).toBe(PLEDGE_RAIL_FORMS.iraQcdOff);
		// the other rail was never touched.
		expect(switchOf(root, 'Stocks')?.checked).toBe(false);
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
		await pressPosting(disable, posted);

		expect(posted.map((body) => body.get(WHICH_FORM))).toEqual([PLEDGE_RAIL_FORMS.stockOff]);
		await vi.waitFor(() => expect(switchOf(root, 'Stocks')).not.toBeNull());
		const toggle = switchOf(root, 'Stocks');
		expect(toggle?.checked).toBe(false);
		expect(document.activeElement).toBe(toggle);

		const reopened = await turnOn(root, 'Stocks');
		expect(box(reopened, 'Account number').value).toBe(STOCK_DETAILS.account_number);
		expect(reopened.querySelector('.adm-hint')?.textContent).toBe(
			'Donors give shares by ticker and are shown where to send them.'
		);
	});
});
