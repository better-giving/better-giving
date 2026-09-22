import { afterEach, describe, expect, it } from 'vitest';
import { createCoinPicker, type CoinChoice, type CoinPicker } from './coin-picker';

// the dom pool: the coin list's own behaviour — what a search lists, what the keyboard does, what a
// refused coin and a refused press look like to a screen reader. how it is ranked is ./coins.spec.ts,
// where it stands on the card is ./element.dom.spec.ts, and where its open list stands on the page is
// ./styles/parts.browser.spec.ts.

// happy-dom has no top layer and no popover methods, and the open list is shown as a popover
// (./zag.ts); here the methods only have to exist.
if (!('showPopover' in HTMLElement.prototype)) {
	Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {} });
}

/** lets the machine's deferred work land: its highlight moves on a frame, its listeners a tick on. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 20));
}

const OPTIONS = [
	{
		value: 'btc',
		label: 'BTC',
		name: 'Bitcoin',
		network: 'Bitcoin',
		logo: 'https://example.test/coins/btc.svg',
		refused: false
	},
	{
		value: 'sol',
		label: 'SOL',
		name: 'Solana',
		network: 'Solana',
		refused: false
	},
	{
		value: 'usdttrc20',
		label: 'USDT',
		name: 'Tether USD (Tron)',
		network: 'Tron',
		logo: 'https://example.test/coins/usdt.svg',
		refused: false
	},
	{
		value: 'xrp',
		label: 'XRP',
		name: 'Ripple',
		network: 'XRP Ledger',
		refused: false
	}
];

const pickers: CoinPicker[] = [];

function mounted(overrides: Partial<CoinChoice> = {}, problem = '') {
	const picked: string[] = [];
	const picker = createCoinPicker(document);
	pickers.push(picker);
	document.body.appendChild(picker.host);
	let choice: CoinChoice = {
		value: '',
		options: OPTIONS,
		onChange: (value) => {
			picked.push(value);
			choice = { ...choice, value };
			picker.update(choice, problem);
		},
		...overrides
	};
	picker.update(choice, problem);
	const root = picker.host.shadowRoot as ShadowRoot;
	const input = root.querySelector('input') as HTMLInputElement;
	/** a key pressed in the box, which holds the caret for it the way a donor's press does. */
	const key = async (name: string) => {
		if (root.activeElement !== input) input.focus();
		input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true }));
		await settle();
	};
	const typed = async (text: string) => {
		input.value = text;
		input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
		await settle();
	};
	const listed = () =>
		[...root.querySelectorAll<HTMLElement>('[role="option"]')]
			.filter((option) => !option.hidden)
			.map((option) => option.querySelector('.coin-ticker')?.textContent);
	const active = () =>
		root
			.getElementById(input.getAttribute('aria-activedescendant') ?? '')
			?.querySelector('.coin-ticker')?.textContent;
	return { picker, root, input, picked, key, typed, listed, active };
}

afterEach(() => {
	for (const picker of pickers.splice(0)) picker.stop();
	document.body.replaceChildren();
});

describe('the coin list', () => {
	it('asks for a coin while none is picked, and names the picked one in the box', async () => {
		const { root, input } = mounted();
		expect(input.placeholder).toBe('Choose a coin');
		expect(input.getAttribute('aria-expanded')).toBe('false');

		const picked = mounted({ value: 'usdttrc20' });
		expect(picked.root.querySelector('.chosen')?.textContent).toBe('USDTTron');
		expect(picked.input.placeholder).toBe('');
		expect(root.querySelector('label')?.textContent).toBe('Which coin');
	});

	it('draws a row as its ticker over its network, and finds a coin by the name no row shows', async () => {
		// the coin's name is the processor's own name for it and says again what the ticker and the
		// network already say, so no row draws it. it stays on the option because a donor typing it is
		// still how the coin is found (`searchCoins` in ./coins.ts) and because the lettered mark a
		// missing logo falls back to is its first letter.
		const { root, typed, listed } = mounted();
		(root.querySelector('.picker') as HTMLElement).click();
		await settle();
		const usdt = [...root.querySelectorAll<HTMLElement>('[role="option"]')][2] as HTMLElement;
		const lines = [...usdt.querySelectorAll('.coin-text > *')].map((line) => line.textContent);

		expect(lines).toEqual(['USDT', 'Tron']);
		expect(usdt.textContent).not.toContain('Tether');

		await typed('tether');
		const found = root.querySelector('[role="option"]:not([hidden]) .coin-text') as HTMLElement;

		expect(listed()).toEqual(['USDT']);
		expect([...found.children].map((line) => line.textContent)).toEqual(['USDT', 'Tron']);
	});

	it('opens on a press into a search, and narrows the list as the donor types', async () => {
		const { root, input, typed, listed } = mounted();
		(root.querySelector('.picker') as HTMLElement).click();
		await settle();

		expect(input.getAttribute('aria-expanded')).toBe('true');
		expect(input.placeholder).toBe('Search by symbol or name');
		expect(listed()).toEqual(['BTC', 'SOL', 'USDT', 'XRP']);

		await typed('tron');
		expect(listed()).toEqual(['USDT']);

		await typed('doge');
		expect(listed()).toEqual([]);
		expect((root.querySelector('.no-match') as HTMLElement).hidden).toBe(false);
	});

	it('picks with the arrow keys and Enter, keeping the caret in the box', async () => {
		const { key, active, picked, input } = mounted();
		await key('ArrowDown');
		expect(active()).toBe('BTC');
		await key('ArrowDown');
		await key('ArrowDown');
		expect(active()).toBe('USDT');
		await key('Enter');

		expect(picked).toEqual(['usdttrc20']);
		expect(input.getAttribute('aria-expanded')).toBe('false');
	});

	it('closes on Escape without picking anything, leaving the box to the picked coin', async () => {
		const { root, key, typed, picked, input } = mounted({ value: 'btc' });
		await key('ArrowDown');
		await typed('tron');
		await key('Escape');

		expect(input.getAttribute('aria-expanded')).toBe('false');
		expect(picked).toEqual([]);
		expect(input.value).toBe('');
		expect(root.querySelector('.chosen')?.textContent).toBe('BTCBitcoin');
	});

	it('closes when the caret leaves the box, without picking anything', async () => {
		const { key, picked, input } = mounted();
		const after = document.createElement('button');
		document.body.appendChild(after);
		await key('ArrowDown');
		after.focus();
		await settle();

		expect(input.getAttribute('aria-expanded')).toBe('false');
		expect(picked).toEqual([]);
	});

	it('keeps a refused coin listed under its own label, and passes it by', async () => {
		const refused = OPTIONS.map((option) =>
			option.value === 'sol' ? { ...option, refused: true } : option
		);
		const { root, key, active, picked } = mounted({ options: refused });
		await key('ArrowDown');
		await key('ArrowDown');
		expect(active()).toBe('USDT');

		const sol = [...root.querySelectorAll<HTMLElement>('[role="option"]')][1] as HTMLElement;
		expect(sol.getAttribute('aria-disabled')).toBe('true');
		expect(sol.querySelector('.coin-ticker')?.textContent).toBe('SOL');
		expect((sol.querySelector('.message') as HTMLElement).hidden).toBe(false);
		expect(sol.querySelector('.message')?.textContent).toBe('no longer accepted');

		sol.click();
		await settle();
		expect(picked).toEqual([]);
	});

	it('picks a coin a pointer presses', async () => {
		const { root, key, picked } = mounted();
		await key('ArrowDown');
		([...root.querySelectorAll<HTMLElement>('[role="option"]')][3] as HTMLElement).click();
		await settle();
		expect(picked).toEqual(['xrp']);
		expect(root.querySelector('.chosen')?.textContent).toBe('XRPXRP Ledger');
		expect(
			[...root.querySelectorAll('[role="option"]')].map((row) => row.getAttribute('part'))
		).toEqual(['select-option', 'select-option', 'select-option', 'select-option selected']);
	});

	it('draws the coin’s own logo where the list carries one, over the mark it falls back to', async () => {
		// the path is the processor's own and the image is fetched from its site into a page this
		// project does not own, so a blocked or broken one leaves the lettered mark showing and
		// nothing else changes.
		const { root } = mounted();
		const rows = [...root.querySelectorAll<HTMLElement>('[role="option"]')];
		const logo = rows[0]?.querySelector('img') as HTMLImageElement;

		expect(logo.getAttribute('src')).toBe('https://example.test/coins/btc.svg');
		expect(logo.getAttribute('loading')).toBe('lazy');
		expect(logo.getAttribute('alt')).toBe('');
		expect(rows[0]?.querySelector('.initial')?.textContent).toBe('B');
		expect(rows[1]?.querySelector('img')).toBeNull();

		logo.dispatchEvent(new Event('error'));
		expect(rows[0]?.querySelector('img')).toBeNull();
		expect(rows[0]?.querySelector('.initial')?.textContent).toBe('B');
	});

	it('draws nothing pressable between the box and the list', async () => {
		// the search is the whole of how a donor narrows the list, so no control stands beside it to
		// take a press: everything the pointer can reach inside the root is the box or an option.
		const { root } = mounted();
		(root.querySelector('.picker') as HTMLElement).click();
		await settle();
		const box = root.querySelector('.picker') as HTMLElement;

		expect(root.querySelectorAll('button')).toHaveLength(0);
		expect(box.nextElementSibling?.firstElementChild?.getAttribute('role')).toBe('listbox');
	});

	it('never points the highlight at a coin the search is hiding', async () => {
		// `aria-activedescendant` is the whole of where the keyboard is standing, so a highlight left
		// on a hidden row is a combobox reading out a coin nobody can see.
		const { typed, key, active, picked } = mounted({ value: 'btc' });
		await key('ArrowDown');
		expect(active()).toBe('BTC');

		await typed('tether');
		expect(active()).toBe('USDT');
		await key('ArrowDown');
		expect(active()).toBe('USDT');

		await key('Enter');
		expect(picked).toEqual(['usdttrc20']);
	});

	it('marks the box and says the problem under it, described from the box', async () => {
		const { root, input } = mounted({}, 'required');
		expect(root.querySelector('.picker')?.getAttribute('part')).toBe('field invalid');
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.getAttribute('aria-describedby')).toContain('coin-problem');
		expect(root.getElementById('coin-problem')?.textContent).toBe('required');
	});
});
