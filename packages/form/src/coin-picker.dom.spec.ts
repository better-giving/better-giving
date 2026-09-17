import { afterEach, describe, expect, it } from 'vitest';
import { createCoinPicker, type CoinChoice } from './coin-picker';

// the dom pool: the coin list's own behaviour — what a search lists, what the keyboard does, what a
// refused coin and a refused press look like to a screen reader. how it is ranked is ./coins.spec.ts,
// and where it stands on the card is ./element.dom.spec.ts.

const OPTIONS = [
	{ value: 'btc', label: 'BTC', name: 'Bitcoin', refused: false },
	{ value: 'sol', label: 'SOL', name: 'Solana', refused: false },
	{ value: 'usdttrc20', label: 'USDT', name: 'Tether USD (Tron)', refused: false },
	{ value: 'xrp', label: 'XRP', name: 'Ripple', refused: false }
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
	const active = () =>
		root
			.getElementById(input.getAttribute('aria-activedescendant') ?? '')
			?.querySelector('.coin-ticker')?.textContent;
	return { picker, root, input, picked, key, typed, listed, active };
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
		expect(picked.root.querySelector('.chosen')?.textContent).toBe('USDT Tether USD (Tron)');
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

	it('marks the box and says the problem under it, described from the box', () => {
		const { root, input } = mounted({}, 'required');
		expect(root.querySelector('.picker')?.getAttribute('part')).toBe('field invalid');
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.getAttribute('aria-describedby')).toContain('coin-problem');
		expect(root.getElementById('coin-problem')?.textContent).toBe('required');
	});
});
