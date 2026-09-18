import { afterEach, describe, expect, it } from 'vitest';
import { createCoinPicker, type CoinChoice } from './coin-picker';

// the dom pool: the coin list's own behaviour — what a search lists, what the keyboard does, what a
// refused coin and a refused press look like to a screen reader. how it is ranked is ./coins.spec.ts,
// and where it stands on the card is ./element.dom.spec.ts.

const OPTIONS = [
	{
		value: 'btc',
		label: 'BTC',
		name: 'Bitcoin',
		network: 'Bitcoin',
		logo: 'https://example.test/coins/btc.svg',
		popular: true,
		stablecoin: false,
		refused: false
	},
	{
		value: 'sol',
		label: 'SOL',
		name: 'Solana',
		network: 'Solana',
		popular: true,
		stablecoin: false,
		refused: false
	},
	{
		value: 'usdttrc20',
		label: 'USDT',
		name: 'Tether USD (Tron)',
		network: 'Tron',
		logo: 'https://example.test/coins/usdt.svg',
		popular: false,
		stablecoin: true,
		refused: false
	},
	{
		value: 'xrp',
		label: 'XRP',
		name: 'Ripple',
		network: 'XRP Ledger',
		popular: false,
		stablecoin: false,
		refused: false
	}
];

function mounted(overrides: Partial<CoinChoice> = {}, problem = '') {
	const picked: string[] = [];
	const picker = createCoinPicker(document);
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
	const key = (name: string) =>
		input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
	const typed = (text: string) => {
		input.value = text;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	};
	const listed = () =>
		[...root.querySelectorAll<HTMLElement>('[role="option"]')]
			.filter((option) => !option.hidden)
			.map((option) => option.querySelector('.coin-ticker')?.textContent);
	const chips = () =>
		[...root.querySelectorAll<HTMLButtonElement>('.chip')].map((chip) => chip.textContent);
	const chip = (words: string) =>
		[...root.querySelectorAll<HTMLButtonElement>('.chip')].find(
			(candidate) => candidate.textContent === words
		) as HTMLButtonElement;
	const active = () =>
		root
			.getElementById(input.getAttribute('aria-activedescendant') ?? '')
			?.querySelector('.coin-ticker')?.textContent;
	return { picker, root, input, picked, key, typed, listed, active, chips, chip };
}

afterEach(() => {
	document.body.replaceChildren();
});

describe('the coin list', () => {
	it('asks for a coin while none is picked, and names the picked one in the box', () => {
		const { root, input } = mounted();
		expect(input.placeholder).toBe('Choose a coin');
		expect(input.getAttribute('aria-expanded')).toBe('false');

		const picked = mounted({ value: 'usdttrc20' });
		expect(picked.root.querySelector('.chosen')?.textContent).toBe('USDTTronTether USD (Tron)');
		expect(picked.input.placeholder).toBe('');
		expect(root.querySelector('label')?.textContent).toBe('Which coin');
	});

	it('opens on a press into a search, and narrows the list as the donor types', () => {
		const { root, input, typed, listed } = mounted();
		(root.querySelector('.picker') as HTMLElement).click();

		expect(input.getAttribute('aria-expanded')).toBe('true');
		expect(input.placeholder).toBe('Search by symbol or name');
		expect(listed()).toEqual(['BTC', 'SOL', 'USDT', 'XRP']);

		typed('tron');
		expect(listed()).toEqual(['USDT']);

		typed('doge');
		expect(listed()).toEqual([]);
		expect((root.querySelector('.no-match') as HTMLElement).hidden).toBe(false);
	});

	it('picks with the arrow keys and Enter, keeping the caret in the box', () => {
		const { key, active, picked, input } = mounted();
		key('ArrowDown');
		expect(active()).toBe('BTC');
		key('ArrowDown');
		key('ArrowDown');
		expect(active()).toBe('USDT');
		key('Enter');

		expect(picked).toEqual(['usdttrc20']);
		expect(input.getAttribute('aria-expanded')).toBe('false');
	});

	it('closes on Escape without picking anything', () => {
		const { key, picked, input } = mounted();
		key('ArrowDown');
		key('Escape');
		expect(input.getAttribute('aria-expanded')).toBe('false');
		expect(picked).toEqual([]);
	});

	it('keeps a refused coin listed under its own label, and passes it by', () => {
		const refused = OPTIONS.map((option) =>
			option.value === 'sol' ? { ...option, refused: true } : option
		);
		const { root, key, active, picked } = mounted({ options: refused });
		key('ArrowDown');
		key('ArrowDown');
		expect(active()).toBe('USDT');

		const sol = [...root.querySelectorAll<HTMLElement>('[role="option"]')][1] as HTMLElement;
		expect(sol.getAttribute('aria-disabled')).toBe('true');
		expect(sol.querySelector('.coin-ticker')?.textContent).toBe('SOL');
		expect((sol.querySelector('.message') as HTMLElement).hidden).toBe(false);
		expect(sol.querySelector('.message')?.textContent).toBe('no longer accepted');

		sol.click();
		expect(picked).toEqual([]);
	});

	it('picks a coin a pointer presses', () => {
		const { root, key, picked } = mounted();
		key('ArrowDown');
		([...root.querySelectorAll<HTMLElement>('[role="option"]')][3] as HTMLElement).click();
		expect(picked).toEqual(['xrp']);
	});

	it('draws the coin’s own logo where the list carries one, over the mark it falls back to', () => {
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

	it('draws a chip for a flag the list carries, and none where it carries neither', () => {
		// the flags are the served list's own, so a deployment serving none draws the list it drew
		// before the chips existed rather than a row of controls that narrow nothing.
		expect(mounted().chips()).toEqual(['All', 'Popular', 'Stablecoins']);

		const plain = OPTIONS.map((option) => ({ ...option, popular: false, stablecoin: false }));
		const bare = mounted({ options: plain });
		expect(bare.chips()).toEqual([]);
		expect((bare.root.querySelector('.chips') as HTMLElement).hidden).toBe(true);
	});

	it('narrows the list to the chosen chip, and searches inside it', () => {
		const { chip, chips, listed, typed, input } = mounted();
		chip('Stablecoins').click();

		expect(chip('Stablecoins').getAttribute('aria-pressed')).toBe('true');
		expect(chip('All').getAttribute('aria-pressed')).toBe('false');
		expect(input.getAttribute('aria-expanded')).toBe('true');
		expect(listed()).toEqual(['USDT']);

		typed('bitcoin');
		expect(listed()).toEqual([]);
		typed('');
		chip('All').click();
		expect(listed()).toEqual(['BTC', 'SOL', 'USDT', 'XRP']);
		expect(chips()).toHaveLength(3);
	});

	it('never points the highlight at a coin the chip is hiding', () => {
		// `aria-activedescendant` is the whole of where the keyboard is standing, so a highlight left
		// on a hidden row is a combobox reading out a coin nobody can see.
		const { chip, key, active, picked } = mounted({ value: 'btc' });
		key('ArrowDown');
		expect(active()).toBe('BTC');

		chip('Stablecoins').click();
		expect(active()).toBe('USDT');
		key('ArrowDown');
		expect(active()).toBe('USDT');

		key('Enter');
		expect(picked).toEqual(['usdttrc20']);
	});

	it('keeps the chips out of the listbox the caret is pointing into', () => {
		// the chips sit inside the combobox pattern rather than across it: they are buttons of their
		// own, outside the list, so nothing the arrow keys walk and nothing `aria-activedescendant`
		// can name is anything but an option.
		const { root, chip, key, active } = mounted();
		const list = root.getElementById('coin-list') as HTMLElement;

		expect(list.querySelector('.chip')).toBeNull();
		expect(chip('Popular').tagName).toBe('BUTTON');
		expect(chip('Popular').closest('[role="listbox"]')).toBeNull();

		key('ArrowDown');
		key('ArrowUp');
		expect(active()).toBe('XRP');
		expect(
			root.getElementById(root.querySelector('input')?.getAttribute('aria-activedescendant') ?? '')
		).toHaveProperty('role', 'option');
	});

	it('marks the box and says the problem under it, described from the box', () => {
		const { root, input } = mounted({}, 'required');
		expect(root.querySelector('.picker')?.getAttribute('part')).toBe('field invalid');
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.getAttribute('aria-describedby')).toContain('coin-problem');
		expect(root.getElementById('coin-problem')?.textContent).toBe('required');
	});
});
