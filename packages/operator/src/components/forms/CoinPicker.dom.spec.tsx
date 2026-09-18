import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { type Coin, CoinPicker } from './CoinPicker.jsx';

// the searchable list a payout coin is chosen out of. what a case here is about is what the row
// draws, what the form carries away from it, and the keyboard reaching all of it — the machine's
// own listbox roles and arrow keys are ark's and are not restated.
//
// a component spec is `.tsx` and both pools collect either extension — ./Field.dom.spec.tsx says
// why.

const BTC: Coin = {
	code: 'btc',
	ticker: 'btc',
	name: 'Bitcoin',
	network: 'btc',
	logo: 'https://example.test/btc.svg'
};
const USDC: Coin = { code: 'usdc', ticker: 'usdc', name: 'USD Coin', network: 'eth', logo: '' };
// the pair the code and the ticker are two different strings on: one ticker, two networks, and the
// code the network is spelled into is what the deployment stores.
const USDC_MATIC: Coin = {
	code: 'usdcmatic',
	ticker: 'usdc',
	name: 'USD Coin',
	network: 'matic',
	logo: 'https://example.test/usdcmatic.svg'
};
/** a listed coin NOWPayments named no ticker for, which is the row's one fallback to the code. */
const XMR: Coin = { code: 'xmr', ticker: '', name: 'Monero', network: 'xmr', logo: '' };

const COINS: readonly Coin[] = [BTC, USDC, USDC_MATIC];

function input(root: HTMLElement): HTMLInputElement {
	const found = root.querySelector<HTMLInputElement>('input[role="combobox"]');
	if (found === null) throw new Error('the case drew no search field to read');
	return found;
}

/** the rows the list is holding right now, by the first line each one draws. */
function rows(root: HTMLElement): string[] {
	return [...root.querySelectorAll('.adm-coinrow__ticker')].map((node) => node.textContent ?? '');
}

/** what the browser would send, as the pairs a form posts. */
function submitted(root: HTMLElement): [string, string][] {
	const form = root.querySelector('form');
	if (form === null) throw new Error('the case drew no form to read');
	return [...new FormData(form)].map(([name, value]) => [name, String(value)]);
}

/**
 * a search typed into the box.
 *
 * the value goes through the prototype's own setter rather than through the property: react
 * replaces that property on every input it controls so that it can tell a change it made from one
 * it did not, and a value written through the replacement is one react reads as unchanged and
 * reports to nobody.
 */
async function type(root: HTMLElement, text: string): Promise<void> {
	const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
	if (set === undefined) throw new Error('no value setter to write through');
	// async, because the machine settles on a microtask: a synchronous `act` returns before the
	// render the keystroke caused, and every assertion after it would read the list as it was.
	await act(async () => {
		const box = input(root);
		// the machine answers a keystroke only while the caret is in the box, which is a condition a
		// real one cannot be typed without and a dispatched one can.
		box.focus();
		set.call(box, text);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

async function press(root: HTMLElement, key: string): Promise<void> {
	await act(async () => {
		const box = input(root);
		box.focus();
		box.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
	});
}

/** the control inside a form, which is the only place the name and value it submits are readable. */
function Bound(props: { readonly defaultValue?: string; readonly disabled?: boolean }) {
	return (
		<form>
			<CoinPicker
				id="coin"
				name="nowpayments:outcomeCurrency"
				label="Payout currency"
				options={COINS}
				placeholder="Choose a coin"
				defaultValue={props.defaultValue}
				disabled={props.disabled}
			/>
		</form>
	);
}

describe('a coin picker mounted into a document', () => {
	it('draws each coin as its ticker and its network, and never its code or its name', async () => {
		// `usdcmatic` is stored and `usdc` over a `matic` pill is read: the operator's own dashboard
		// names a coin by ticker and network, and this list is what they hold it up against.
		const root = render(CoinPicker, { id: 'coin', name: 'coin', label: 'Coin', options: COINS });

		// the third row is `usdcmatic` drawn as `usdc` over a `matic` pill, which is the whole of the
		// change: its code is on the option and in the payload and on no line of the list.
		expect(rows(root)).toEqual(['btc', 'usdc', 'usdc']);
		expect([...root.querySelectorAll('.adm-netpill')].map((n) => n.textContent)).toEqual([
			'btc',
			'eth',
			'matic'
		]);
		expect(root.textContent).not.toContain('Bitcoin');
	});

	it('draws the code of a listed coin the processor named no ticker for', async () => {
		const root = render(CoinPicker, {
			id: 'coin',
			name: 'coin',
			label: 'Coin',
			options: [BTC, XMR]
		});

		expect(rows(root)).toEqual(['btc', 'xmr']);
	});

	it('paints a network from its own words rather than from a table of them', async () => {
		// the same network is the same entry wherever it is drawn, and two different ones are not
		// held to being two different entries — the palette is smaller than the list of chains.
		const root = render(CoinPicker, {
			id: 'coin',
			name: 'coin',
			label: 'Coin',
			options: [BTC, { ...USDC, code: 'usdc2', network: 'btc' }]
		});
		const tints = [...root.querySelectorAll('.adm-netpill')].map((n) =>
			n.getAttribute('data-tint')
		);

		expect(tints[0]).toBe(tints[1]);
		expect(tints[0]).toMatch(/^[0-5]$/);
	});

	it('draws a logo where the listing carried one and a lettered mark where it did not', async () => {
		const root = render(CoinPicker, { id: 'coin', name: 'coin', label: 'Coin', options: COINS });
		const marks = [...root.querySelectorAll('.adm-coinrow .adm-coinmark')];

		expect(marks.map((m) => m.querySelector('img')?.getAttribute('src'))).toEqual([
			'https://example.test/btc.svg',
			undefined,
			'https://example.test/usdcmatic.svg'
		]);
		// the letter is under every mark, which is what a logo that never arrives falls back to.
		expect(marks.map((m) => m.querySelector('.adm-coinmark__initial')?.textContent)).toEqual([
			'B',
			'U',
			'U'
		]);
	});

	it('falls back to the lettered mark when a logo fails to load', async () => {
		// a picture the console could not fetch must leave the row whole rather than a hole: the
		// sheet hides the letter only while an image is standing on it.
		const root = render(CoinPicker, { id: 'coin', name: 'coin', label: 'Coin', options: [BTC] });
		const image = root.querySelector('.adm-coinmark__logo');
		if (image === null) throw new Error('the case drew no logo to break');

		act(() => image.dispatchEvent(new Event('error', { bubbles: false })));

		expect(root.querySelector('.adm-coinmark__logo')).toBe(null);
		expect(root.querySelector('.adm-coinmark__initial')?.textContent).toBe('B');
	});

	it('narrows the list by ticker, by code, by name and by network', async () => {
		const root = render(CoinPicker, { id: 'coin', name: 'coin', label: 'Coin', options: COINS });

		await type(root, 'matic');
		expect(rows(root)).toEqual(['usdc']);

		// the ticker is the first line, so a search on it answers with every network it is carried on.
		await type(root, 'usdc');
		expect(rows(root)).toEqual(['usdc', 'usdc']);

		// a whole code an operator pasted back out of a var still finds its one coin, though no row
		// draws it: it is what the deployment stores and what they are holding.
		await type(root, 'usdcmatic');
		expect(rows(root)).toEqual(['usdc']);

		// found by a name that is drawn in no row, and still shown as its ticker and its network.
		await type(root, 'USD Coin');
		expect(rows(root)).toEqual(['usdc', 'usdc']);
		expect(root.textContent).not.toContain('USD Coin');

		await type(root, 'bitco');
		expect(rows(root)).toEqual(['btc']);
	});

	it('says so where a search matches no coin', async () => {
		const root = render(CoinPicker, { id: 'coin', name: 'coin', label: 'Coin', options: COINS });

		await type(root, 'dogecoin');

		expect(rows(root)).toEqual([]);
		expect(root.querySelector('.adm-coinempty')?.textContent).toBe('No coin matches');
	});

	it('submits the code of the coin chosen, and blank until one is', async () => {
		const root = render(Bound, {});
		expect(submitted(root)).toEqual([['nowpayments:outcomeCurrency', '']]);

		// the keyboard reaches the list, moves the highlight and takes what it lands on.
		await press(root, 'ArrowDown');
		await press(root, 'ArrowDown');
		await press(root, 'Enter');

		expect(submitted(root)).toEqual([['nowpayments:outcomeCurrency', 'usdc']]);
	});

	it('draws the chosen coin in the closed box, as its ticker and its network', async () => {
		const root = render(Bound, { defaultValue: 'usdcmatic' });
		const chosen = root.querySelector('.adm-coinbox__chosen');

		expect(chosen?.querySelector('.adm-coinbox__ticker')?.textContent).toBe('usdc');
		expect(chosen?.querySelector('.adm-netpill')?.textContent).toBe('matic');
		// and points the box at it: the search field is emptied by a choice, so those words are the
		// only place the chosen coin is said.
		expect(input(root).getAttribute('aria-describedby')).toBe('coin-chosen');
		expect(chosen?.id).toBe('coin-chosen');
	});

	it('keeps a coin the listing came back without chosen, marked, and last', async () => {
		const root = render(CoinPicker, {
			id: 'coin',
			name: 'coin',
			label: 'Coin',
			options: [BTC],
			// the stand-in the console builds for a stored value its listing does not name: a code, and
			// nothing else known about the coin, so the row falls back to it.
			retired: { code: 'lunc', ticker: '', name: 'lunc', network: '', logo: '' },
			defaultValue: 'lunc'
		});

		expect(rows(root)).toEqual(['btc', 'lunc']);
		expect(root.querySelector('.adm-coinrow__note')?.textContent).toBe('No longer offered');
		expect(root.querySelector('.adm-coinbox__ticker')?.textContent).toBe('lunc');
	});

	it('is unusable and sends nothing while the caller says there is nothing to choose', async () => {
		// a `<select disabled>` is out of the payload for the same reason, so a press over a closed
		// box is refused as blank rather than storing a coin nobody chose.
		const root = render(Bound, { disabled: true });

		expect(input(root).disabled).toBe(true);
		expect(submitted(root)).toEqual([]);
	});

	it('says a choice out loud, so the form layer counting events hears it', async () => {
		// the value is written to a hidden input by script, and a value set by script fires nothing.
		const heard: string[] = [];
		const root = render(
			() => (
				<form onInput={(event) => heard.push((event.target as HTMLInputElement).name)}>
					<CoinPicker id="coin" name="coin" label="Coin" options={COINS} />
				</form>
			),
			{}
		);

		await press(root, 'ArrowDown');
		await press(root, 'Enter');

		expect(heard).toContain('coin');
	});

	it('announces the refusal, marks the control, and points it at a paragraph that exists', async () => {
		const root = render(CoinPicker, {
			id: 'coin',
			name: 'coin',
			label: 'Coin',
			error: 'Not a coin NOWPayments offers.'
		});

		expect(input(root).getAttribute('aria-invalid')).toBe('true');
		expect(root.querySelector('.adm-coinbox')?.hasAttribute('data-invalid')).toBe(true);
		expect(
			root.querySelector(`#${input(root).getAttribute('aria-describedby')}`)?.textContent
		).toBe('Not a coin NOWPayments offers.');
		expect(root.querySelector('.adm-field__error')?.getAttribute('role')).toBe('alert');
	});

	it('names the control and describes it from the id it was handed', async () => {
		const root = render(CoinPicker, {
			id: 'coin',
			name: 'coin',
			label: 'Payout currency',
			options: COINS,
			hint: 'Must match the outcome wallet set in your NOWPayments dashboard.',
			note: 'Paste your API key to choose a coin.'
		});

		expect(root.querySelector('label')?.getAttribute('for')).toBe('coin');
		expect(input(root).getAttribute('aria-describedby')).toBe('coin-hint coin-note');
		expect(root.querySelector('.adm-hint')?.id).toBe('coin-hint');
		expect(root.querySelector('.adm-field__needed')?.id).toBe('coin-note');
		// the list is named by the same label the box is, which is the one the machine points at.
		expect(root.querySelector('[role="listbox"]')?.getAttribute('aria-labelledby')).toBe(
			'coin-label'
		);
	});
});
