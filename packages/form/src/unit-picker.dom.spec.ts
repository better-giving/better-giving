import { afterEach, describe, expect, it } from 'vitest';
import { createUnitPicker, type UnitChoice, type UnitOption, type UnitPicker } from './unit-picker';
import { unitWords } from './unit';

// the dom pool: the unit list's own behaviour — the pill, the groups, what a search lists, what the
// keyboard does and what a screen reader is told. which groups a deployment gets is ./unit.spec.ts,
// and where the pill and its panel stand on the card is ./element.dom.spec.ts and
// ./styles/layout.browser.spec.ts.

// happy-dom has no top layer and no popover methods, and the panel is shown as a popover (./zag.ts);
// here the methods only have to exist.
if (!('showPopover' in HTMLElement.prototype)) {
	Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {} });
}

/** lets the machine's deferred work land: its focus moves on a frame, its listeners a tick on. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 40));
}

const USD: UnitOption = {
	value: 'currency:USD',
	kind: 'currency',
	label: 'USD',
	name: 'US Dollar',
	symbol: '$',
	refused: false
};
const COINS: UnitOption[] = [
	{
		value: 'coin:btc',
		kind: 'coin',
		label: 'BTC',
		name: 'Bitcoin',
		network: 'Bitcoin',
		refused: false
	},
	{
		value: 'coin:btt',
		kind: 'coin',
		label: 'BTT',
		name: 'BitTorrent',
		network: 'Tron',
		refused: false
	},
	{
		value: 'coin:eth',
		kind: 'coin',
		label: 'ETH',
		name: 'Ethereum',
		network: 'Ethereum',
		refused: false
	}
];

const pickers: UnitPicker[] = [];

function mounted(options: readonly UnitOption[] = [USD, ...COINS]) {
	const picked: string[] = [];
	let handedOn = 0;
	const coins = options.some((option) => option.kind === 'coin');
	const picker = createUnitPicker(document, unitWords({ coins, stocks: false }), {
		picked: () => {
			handedOn += 1;
		}
	});
	pickers.push(picker);
	document.body.appendChild(picker.host);
	let choice: UnitChoice = {
		value: 'currency:USD',
		options,
		onChange: (value) => {
			picked.push(value);
			choice = { ...choice, value };
			picker.update(choice);
		}
	};
	picker.update(choice);
	const root = picker.host.shadowRoot as ShadowRoot;
	const pill = root.querySelector('[part~="unit-pill"]') as HTMLButtonElement;
	const input = root.querySelector('input') as HTMLInputElement;
	const key = async (target: HTMLElement, name: string) => {
		target.dispatchEvent(
			new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true })
		);
		await settle();
	};
	const typed = async (text: string) => {
		input.value = text;
		input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
		await settle();
	};
	const open = async () => {
		pill.focus();
		pill.click();
		await settle();
	};
	/** each drawn group's heading, with the codes of its drawn rows. */
	const groups = () =>
		[...root.querySelectorAll<HTMLElement>('[role="group"]')]
			.filter((group) => !group.hidden)
			.map((group) => [
				root.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent,
				...[...group.querySelectorAll<HTMLElement>('[role="option"]')]
					.filter((row) => !row.hidden)
					.map((row) => row.querySelector('.coin-ticker')?.textContent)
			]);
	const active = () =>
		root
			.getElementById(input.getAttribute('aria-activedescendant') ?? '')
			?.querySelector('.coin-ticker')?.textContent;
	return {
		picker,
		root,
		pill,
		input,
		picked,
		handedOn: () => handedOn,
		key,
		typed,
		open,
		groups,
		active
	};
}

afterEach(() => {
	for (const picker of pickers.splice(0)) picker.stop();
	document.body.replaceChildren();
});

describe('the pill', () => {
	it('is a button naming what the gift is given in, opening a list it controls', () => {
		const { root, pill } = mounted();

		expect(pill.tagName).toBe('BUTTON');
		expect(pill.type).toBe('button');
		expect(pill.textContent).toBe('USD');
		expect(pill.getAttribute('aria-label')).toBe('What you give: USD');
		expect(pill.getAttribute('aria-haspopup')).toBe('listbox');
		expect(pill.getAttribute('aria-expanded')).toBe('false');
		expect(
			root.getElementById(pill.getAttribute('aria-controls') ?? '')?.getAttribute('role')
		).toBe('listbox');
		expect(pill.getAttribute('part')).toBe('unit-pill');
	});

	it('names the unit picked, in its words and in its name', () => {
		const { picker, pill } = mounted();
		picker.update({ value: 'coin:btc', options: [USD, ...COINS], onChange: () => {} });

		expect(pill.textContent).toBe('BTC');
		expect(pill.getAttribute('aria-label')).toBe('What you give: BTC');
	});

	it('opens on a press and puts the caret in the search', async () => {
		const { root, pill, input, open } = mounted();
		await open();

		expect(pill.getAttribute('aria-expanded')).toBe('true');
		expect(root.activeElement).toBe(input);
		// covered by the panel while it is open, and no second stop on the way out of it.
		expect(pill.tabIndex).toBe(-1);
	});

	it('opens on the down arrow too', async () => {
		const { root, pill, input, key } = mounted();
		pill.focus();
		await key(pill, 'ArrowDown');

		expect(pill.getAttribute('aria-expanded')).toBe('true');
		expect(root.activeElement).toBe(input);
	});
});

describe('the list', () => {
	it('names the search by its sentence and describes it by the hint', async () => {
		const { root, input, open } = mounted();
		await open();

		expect(input.getAttribute('role')).toBe('combobox');
		expect(input.getAttribute('aria-autocomplete')).toBe('list');
		expect(input.getAttribute('aria-expanded')).toBe('true');
		expect(input.placeholder).toBe('Search for currency or crypto token');
		expect(input.getAttribute('aria-label')).toBe('Search for currency or crypto token');
		expect(root.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
			'Currencies and crypto'
		);
	});

	it('groups the rows, currencies first, under a listbox named for the choice', async () => {
		const { root, open, groups } = mounted();
		await open();

		expect(root.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe(
			'What you give'
		);
		expect(groups()).toEqual([
			['Currencies', 'USD'],
			['Crypto', 'BTC', 'BTT', 'ETH']
		]);
		const usd = root.querySelector('[role="option"]') as HTMLElement;
		expect(usd.getAttribute('aria-selected')).toBe('true');
		expect(usd.textContent).toContain('US Dollar');
	});

	it('draws no crypto group and no hint where currencies stand alone', async () => {
		const { root, input, open, groups } = mounted([USD]);
		await open();

		expect(groups()).toEqual([['Currencies', 'USD']]);
		expect(input.hasAttribute('aria-describedby')).toBe(false);
		expect(root.querySelector<HTMLElement>('.unit-hint')?.hidden).toBe(true);
	});

	it('narrows each group to a search, drops a group left empty, and highlights the first row', async () => {
		const { open, typed, groups, active } = mounted();
		await open();
		await typed('bt');

		expect(groups()).toEqual([['Crypto', 'BTC', 'BTT']]);
		expect(active()).toBe('BTC');
	});

	it('moves the highlight with the arrows, Home and End, and picks with Enter', async () => {
		const { input, picked, key, open, active, handedOn, pill } = mounted();
		await open();
		await key(input, 'End');
		expect(active()).toBe('ETH');
		await key(input, 'Home');
		expect(active()).toBe('USD');
		await key(input, 'ArrowDown');
		expect(active()).toBe('BTC');

		await key(input, 'Enter');

		expect(picked).toEqual(['coin:btc']);
		expect(pill.getAttribute('aria-expanded')).toBe('false');
		// the next decision is the figure, so the caret is handed on to it.
		expect(handedOn()).toBe(1);
	});

	it('closes on Escape and gives the caret back to the pill', async () => {
		const { root, input, pill, key, open, picked, handedOn } = mounted();
		await open();

		await key(input, 'Escape');

		expect(pill.getAttribute('aria-expanded')).toBe('false');
		expect(root.activeElement).toBe(pill);
		expect(pill.tabIndex).toBe(0);
		expect(picked).toEqual([]);
		expect(handedOn()).toBe(0);
	});

	it('says how many rows a search finds, and says it only when it changes', async () => {
		const { root, open, typed } = mounted();
		const status = root.querySelector('[role="status"]') as HTMLElement;
		await open();
		await typed('bt');
		expect(status.textContent).toBe('2 results');

		await typed('btc');
		expect(status.textContent).toBe('1 result');

		await typed('zzz');
		expect(status.textContent).toBe('No currency or coin matches.');
		expect(root.querySelector<HTMLElement>('.no-match')?.hidden).toBe(false);
		expect(root.querySelector<HTMLElement>('.no-match')?.textContent).toBe(
			'No currency or coin matches.'
		);
	});

	it('draws the stocks group last where its rail stands, saying what to type', async () => {
		const picker = createUnitPicker(document, unitWords({ coins: false, stocks: true }), {
			picked: () => {},
			stocks: true
		});
		pickers.push(picker);
		document.body.appendChild(picker.host);
		picker.update({ value: 'currency:USD', options: [USD], onChange: () => {} });
		const root = picker.host.shadowRoot as ShadowRoot;
		const groups = [...root.querySelectorAll<HTMLElement>('[role="group"]')].filter(
			(group) => !group.hidden
		);

		expect(
			groups.map(
				(group) => root.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent
			)
		).toEqual(['Currencies', 'Stocks']);
		expect(groups[1]?.querySelector('.unit-hint')?.textContent).toBe(
			'Type a ticker or company name, like AAPL.'
		);
	});

	it('renders no control disabled', async () => {
		const { root, open } = mounted();
		await open();

		expect(root.querySelectorAll('[disabled]')).toHaveLength(0);
	});
});
