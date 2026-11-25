import { afterEach, describe, expect, it } from 'vitest';
import { createUnitPanel, type UnitChoice, type UnitPanel } from './unit-panel';
import type { TickerMatch } from './v1';

// the dom pool: the unit list's own behaviour — what it draws for a search, what the keyboard does,
// what a screen reader is told and what it reports to the surface that opened it. where it stands
// against the pill is measured in ./unit-panel.browser.spec.ts.

// happy-dom has no top layer and no popover methods, and the panel is shown as a popover (./zag.ts);
// here the methods only have to exist.
if (!('showPopover' in HTMLElement.prototype)) {
	Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {} });
}

/** lets the machine's deferred work land: its highlight moves on a frame, its listeners a tick on. */
function settle(ms = 20): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** past the ticker search's debounce (`TICKER_DEBOUNCE_MS` in ./ticker-search.ts) and its answer. */
const SEARCHED = 260;

const OPTIONS: UnitChoice['options'] = [
	{ group: 'currency', value: 'currency', label: 'USD', name: 'US dollar', country: 'us' },
	{
		group: 'coin',
		value: 'coin:btc',
		label: 'BTC',
		name: 'Bitcoin',
		network: 'Bitcoin',
		logo: 'https://example.test/coins/btc.svg',
		refused: false
	},
	{
		group: 'coin',
		value: 'coin:eth',
		label: 'ETH',
		name: 'Ethereum',
		network: 'Ethereum',
		refused: false
	},
	{
		group: 'coin',
		value: 'coin:usdttrc20',
		label: 'USDT',
		name: 'Tether',
		network: 'Tron',
		refused: false
	},
	{
		group: 'coin',
		value: 'coin:wbtc',
		label: 'WBTC',
		name: 'Wrapped Bitcoin',
		network: 'Ethereum',
		refused: false
	}
];

const STOCKS: readonly TickerMatch[] = [
	{ symbol: 'AAPL', name: 'Apple Inc.' },
	{ symbol: 'AAL', name: 'American Airlines Group Inc.' }
];

const panels: UnitPanel[] = [];

type Mount = {
	readonly choice?: Partial<UnitChoice>;
	/** what the ticker read answers for a query; a throw is a search that could not be made. */
	readonly answer?: (query: string) => Promise<readonly TickerMatch[]>;
	/** where the pill, the field and the panel's host go; the page's body unless a test says. */
	readonly within?: ParentNode;
};

function mounted({
	choice: overrides = {},
	answer = async () => STOCKS,
	within = document.body
}: Mount = {}) {
	const picked: string[] = [];
	const closed: { restoreFocus: boolean }[] = [];
	const asked: string[] = [];
	const pill = document.createElement('button');
	const field = document.createElement('div');
	within.append(pill, field);
	const panel = createUnitPanel(document, {
		searchTickers: (query) => {
			asked.push(query);
			return answer(query);
		},
		onClose: (detail) => closed.push(detail)
	});
	panels.push(panel);
	within.appendChild(panel.host);
	let choice: UnitChoice = {
		value: '',
		search: 'Search currency, crypto or stock',
		options: OPTIONS,
		stocks: true,
		onChange: (value) => {
			picked.push(value);
			choice = { ...choice, value };
			panel.update(choice);
		},
		...overrides
	};
	panel.update(choice);
	panel.open({ pill, field });
	const root = panel.host.shadowRoot as ShadowRoot;
	const input = root.querySelector('input') as HTMLInputElement;
	const key = async (name: string) => {
		const event = new KeyboardEvent('keydown', {
			key: name,
			bubbles: true,
			composed: true,
			cancelable: true
		});
		input.dispatchEvent(event);
		await settle();
		return event;
	};
	const typed = async (text: string, wait = 20) => {
		input.value = text;
		input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
		await settle(wait);
	};
	const groups = () =>
		[...root.querySelectorAll<HTMLElement>('[role="group"]')].map((group) => {
			const heading = root.getElementById(group.getAttribute('aria-labelledby') ?? '');
			return heading?.textContent;
		});
	const listed = () =>
		[...root.querySelectorAll<HTMLElement>('[role="option"]')].map(
			(option) => option.querySelector('.ds-option-label')?.textContent
		);
	const active = () =>
		root
			.getElementById(input.getAttribute('aria-activedescendant') ?? '')
			?.querySelector('.ds-option-label')?.textContent;
	return { panel, root, input, pill, picked, closed, asked, key, typed, groups, listed, active };
}

afterEach(async () => {
	// the machine moves the caret into the box a frame after opening, and a frame landing on a
	// root already taken down throws inside happy-dom.
	await settle();
	for (const panel of panels.splice(0)) panel.stop();
	document.body.replaceChildren();
});

describe('the unit panel', () => {
	it('is a dialog named for what the donor gives', async () => {
		const { root } = mounted();
		const dialog = root.querySelector('[role="dialog"]') as HTMLElement;

		expect(dialog).not.toBeNull();
		expect(dialog.getAttribute('aria-label')).toBe('What you give');
	});

	// one panel per case: happy-dom cannot read a shadow root's active element while the caret
	// stands in a sibling root, and each panel puts the caret in its own box.
	for (const [stocks, search] of [
		[true, 'Search currency, crypto or stock'],
		[false, 'Search currency or crypto']
	] as const) {
		it(`asks “${search}” and labels the box the same`, () => {
			const { root, input } = mounted({ choice: { stocks, search } });
			const label = root.querySelector(`label[for="${input.id}"]`);

			expect(input.getAttribute('role')).toBe('combobox');
			expect(input.getAttribute('aria-autocomplete')).toBe('list');
			expect(input.placeholder).toBe(search);
			expect(label?.textContent).toBe(search);
			expect(label?.classList.contains('ds-sr-only')).toBe(true);
		});
	}

	it('groups the currency and the coins under their headings, and no Stocks on an empty search', () => {
		const { groups, listed } = mounted();

		expect(groups()).toEqual(['Currencies', 'Crypto']);
		expect(listed()).toEqual(['USD', 'BTC', 'ETH', 'USDT', 'WBTC']);
	});

	it('draws a group only with rows, and the Stocks group once a search answers', async () => {
		const { groups, listed, typed, asked } = mounted();
		await typed('bt', SEARCHED);

		expect(asked).toEqual(['bt']);
		expect(groups()).toEqual(['Crypto', 'Stocks']);
		expect(listed()).toEqual(['BTC', 'WBTC', 'AAPL', 'AAL']);
	});

	it('draws no Stocks group where stocks are not offered, and asks for none', async () => {
		const { groups, typed, asked } = mounted({ choice: { stocks: false } });
		await typed('aa', SEARCHED);

		expect(asked).toEqual([]);
		expect(groups()).not.toContain('Stocks');
	});

	it('draws a stock row as its ticker over its company name, and nothing else', async () => {
		const { root, typed } = mounted();
		await typed('aa', SEARCHED);
		const aapl = root.querySelector('[role="option"][data-value="stock:AAPL"]') as HTMLElement;
		const text = aapl.querySelector('.ds-combobox-text') as HTMLElement;

		expect([...text.querySelectorAll('span')].map((line) => line.textContent)).toEqual([
			'AAPL',
			'AAPL',
			'Apple Inc.'
		]);
		expect(aapl.textContent).toBe('AAPLApple Inc.');
		expect(aapl.textContent).not.toMatch(/\$|\d/);
		expect(aapl.querySelector('.ds-combobox-mark svg')).not.toBeNull();
	});

	it('ticks the picked row and no other', () => {
		const { root } = mounted({ choice: { value: 'coin:eth' } });
		const ticked = [...root.querySelectorAll<HTMLElement>('[role="option"]')]
			.filter((row) => row.querySelector('.ds-combobox-tick svg') !== null)
			.map((row) => row.dataset.value);

		expect(ticked).toEqual(['coin:eth']);
		expect(root.querySelector('[data-value="coin:eth"]')?.getAttribute('aria-selected')).toBe(
			'true'
		);
	});

	it('badges a network only where it is not the coin’s own name', () => {
		const { root } = mounted();
		const badges = Object.fromEntries(
			[...root.querySelectorAll<HTMLElement>('[role="option"]')].map((row) => [
				row.dataset.value,
				row.querySelector('.ds-combobox-line .ds-combobox-badge')?.textContent ?? null
			])
		);

		expect(badges).toEqual({
			currency: null,
			'coin:btc': null,
			'coin:eth': null,
			'coin:usdttrc20': 'Tron',
			'coin:wbtc': 'Ethereum'
		});
	});

	it('marks a currency with its inline flag and a coin with its logo over the letter', () => {
		const { root } = mounted();
		const mark = (value: string) =>
			root.querySelector(`[data-value="${value}"] .ds-combobox-mark`) as HTMLElement;
		const flag = mark('currency').querySelector('img') as HTMLImageElement;
		const logo = mark('coin:btc').querySelector('img') as HTMLImageElement;

		expect(mark('currency').getAttribute('aria-hidden')).toBe('true');
		expect(flag.getAttribute('src')).toMatch(/^data:image\/svg\+xml,/);
		expect(flag.getAttribute('alt')).toBe('');
		expect(logo.getAttribute('src')).toBe('https://example.test/coins/btc.svg');
		expect(logo.getAttribute('loading')).toBe('lazy');
		expect(logo.getAttribute('referrerpolicy')).toBe('no-referrer');
		expect(mark('coin:btc').textContent).toBe('B');
		expect(mark('coin:usdttrc20').querySelector('img')).toBeNull();
		expect(mark('coin:usdttrc20').textContent).toBe('T');

		logo.dispatchEvent(new Event('error'));
		expect(mark('coin:btc').querySelector('img')).toBeNull();
		expect(mark('coin:btc').textContent).toBe('B');
	});

	it('marks a currency the flag table lacks with its code’s first letter', () => {
		const yen = [
			{ group: 'currency', value: 'currency', label: 'JPY', name: 'Japanese yen' }
		] as const;
		const { root } = mounted({ choice: { options: yen } });
		const mark = root.querySelector('[data-value="currency"] .ds-combobox-mark') as HTMLElement;

		expect(mark.querySelector('img')).toBeNull();
		expect(mark.textContent).toBe('J');
	});

	it('says no match in the Stocks group with the typed text, described and read out', async () => {
		const { root, groups, listed, typed } = mounted({ answer: async () => [] });
		await typed('zzq', SEARCHED);
		const stocks = root.querySelector('#unit-group-stock') as HTMLElement;
		const sentence = 'No match for “zzq”. Try a name or a ticker.';

		expect(groups()).toEqual(['Stocks']);
		expect(listed()).toEqual([]);
		expect(root.getElementById(stocks.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
			sentence
		);
		expect(root.querySelector('[role="status"]')?.textContent).toBe(sentence);
	});

	// with stocks off no Stocks group answers a search, so the sentence stands in the Crypto group, as
	// the registry's own example draws a group's no-match (combobox-css.usage.md).
	it('says no match where stocks are not offered, under Crypto, described and read out', async () => {
		const { root, groups, listed, typed } = mounted({ choice: { stocks: false } });
		await typed('zzq');
		const crypto = root.querySelector('#unit-group-coin') as HTMLElement;
		const sentence = 'No match for “zzq”. Try a name or a ticker.';

		expect(groups()).toEqual(['Crypto']);
		expect(listed()).toEqual([]);
		expect(root.getElementById(crypto.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
			sentence
		);
		expect(root.querySelector('[role="status"]')?.textContent).toBe(sentence);

		await typed('bt');

		expect(groups()).toEqual(['Crypto']);
		expect(crypto.hasAttribute('aria-describedby')).toBe(false);
		expect(root.querySelector('[role="status"]')?.textContent).toBe('');
	});

	it('says the stock search failed in the Stocks group, and still lists what it found', async () => {
		const { root, groups, typed } = mounted({
			answer: async () => {
				throw new Error('GET /tickers answered 503');
			}
		});
		await typed('bt', SEARCHED);
		const stocks = root.querySelector('#unit-group-stock') as HTMLElement;
		const sentence = 'Couldn’t search stocks. Try again in a moment.';

		expect(groups()).toEqual(['Crypto', 'Stocks']);
		expect(stocks.querySelector('.ds-combobox-message')?.textContent).toBe(sentence);
		expect(root.querySelector('[role="status"]')?.textContent).toBe(sentence);
	});

	it('draws only the newest search’s answer, never one that arrives after it', async () => {
		const pending = new Map<string, (rows: readonly TickerMatch[]) => void>();
		const { typed, listed } = mounted({
			answer: (query) => new Promise((resolve) => pending.set(query, resolve))
		});
		await typed('aa', SEARCHED);
		await typed('aap', SEARCHED);
		pending.get('aap')?.([{ symbol: 'AAPL', name: 'Apple Inc.' }]);
		await settle();
		pending.get('aa')?.([{ symbol: 'AAL', name: 'American Airlines Group Inc.' }]);
		await settle();

		expect(listed()).toEqual(['AAPL']);
	});

	// the machine prevents the default of every Escape the box hears, so a panel that skipped
	// prevented events would never close on one.
	it('closes on Escape in an empty search, asking for the caret back on the pill', async () => {
		const { root, key, closed, picked } = mounted();
		const outer: KeyboardEvent[] = [];
		document.body.addEventListener('keydown', (event) => outer.push(event));
		const pressed = await key('Escape');

		expect(pressed.defaultPrevented).toBe(true);
		expect(closed).toEqual([{ restoreFocus: true }]);
		expect(picked).toEqual([]);
		expect(outer).toEqual([]);
		expect((root.querySelector('[role="listbox"]') as HTMLElement).hidden).toBe(true);
	});

	it('clears a typed search on Escape and stays open, then closes on the next', async () => {
		const { input, key, typed, closed, listed } = mounted();
		await typed('bt');
		await key('Escape');

		expect(closed).toEqual([]);
		expect(input.value).toBe('');
		expect(input.getAttribute('aria-expanded')).toBe('true');
		expect(listed()).toEqual(['USD', 'BTC', 'ETH', 'USDT', 'WBTC']);

		await key('Escape');
		expect(closed).toEqual([{ restoreFocus: true }]);
	});

	it('picks with the arrow keys and Enter, and closes asking for the caret back', async () => {
		const { key, active, picked, closed } = mounted();
		await key('ArrowDown');
		await key('ArrowDown');
		expect(active()).toBe('BTC');
		await key('Enter');

		expect(picked).toEqual(['coin:btc']);
		expect(closed).toEqual([{ restoreFocus: true }]);
	});

	it('picks a stock a search found, by its ticker', async () => {
		const { typed, key, picked } = mounted();
		await typed('aa', SEARCHED);
		await key('Enter');

		expect(picked).toEqual(['stock:AAPL']);
	});

	it('closes again on picking the row already picked, changing nothing', async () => {
		const { root, picked, closed } = mounted({ choice: { value: 'currency' } });
		(root.querySelector('[data-value="currency"]') as HTMLElement).click();
		await settle();

		expect(picked).toEqual([]);
		expect(closed).toEqual([{ restoreFocus: true }]);
	});

	it('closes on a press outside it, leaving the caret where the donor took it', async () => {
		const { root, pill, closed } = mounted();
		const press = (target: Element) =>
			target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
		press(root.querySelector('[data-value="coin:eth"]') as Element);
		press(pill);
		expect(closed).toEqual([]);

		press(document.body);
		expect(closed).toEqual([{ restoreFocus: false }]);
	});

	// guards, not the proof: happy-dom's path reaches into a closed root as if it were open, so these
	// hold the inside and outside rule there; the closed root itself is proven in the browser by
	// ./element.browser.spec.ts.
	it('tells a press inside it from one outside where it stands in a shadow root', async () => {
		const outer = document.createElement('div');
		document.body.appendChild(outer);
		const closedRoot = outer.attachShadow({ mode: 'closed' });
		const beside = document.createElement('button');
		closedRoot.appendChild(beside);
		const { root, input, pill, closed } = mounted({ within: closedRoot });
		const press = (target: Element) =>
			target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
		press(root.querySelector('[data-value="coin:eth"]') as Element);
		press(input);
		press(pill);
		expect(closed).toEqual([]);

		press(beside);
		expect(closed).toEqual([{ restoreFocus: false }]);
	});

	it('closes on a press on the page outside a shadow root it stands in', async () => {
		const outer = document.createElement('div');
		document.body.appendChild(outer);
		const { closed } = mounted({ within: outer.attachShadow({ mode: 'closed' }) });
		document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));

		expect(closed).toEqual([{ restoreFocus: false }]);
	});

	// a press on the pill moves the caret onto it before the pill's own click toggles the panel, so
	// a panel closing on that focus would be opened again by the same press.
	it('closes when the caret leaves for anything but the pill', async () => {
		const { input, pill, closed } = mounted();
		const after = document.createElement('button');
		document.body.appendChild(after);
		const leave = (next: Element) =>
			input.dispatchEvent(
				new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: next })
			);
		leave(pill);
		expect(closed).toEqual([]);

		leave(after);
		expect(closed).toEqual([{ restoreFocus: false }]);
	});

	it('renders no control disabled, a refused coin included', async () => {
		const options = OPTIONS.map((option) =>
			option.value === 'coin:eth' ? { ...option, refused: true } : option
		);
		const { root, typed } = mounted({ choice: { options } });
		await typed('e', SEARCHED);
		const eth = root.querySelector('[data-value="coin:eth"]') as HTMLElement;

		expect(root.querySelectorAll('[disabled]')).toHaveLength(0);
		expect(eth.getAttribute('aria-disabled')).toBe('true');
		expect(eth.textContent).toContain('no longer accepted');
	});
});
