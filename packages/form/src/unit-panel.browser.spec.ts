import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import { CARD_THEME } from './parts';
import variablesSource from './registry/styles/variables.css?raw';
import { createUnitPanel, type UnitChoice, type UnitPanel } from './unit-panel';
import tokens from './styles/tokens.css?inline';

// the browser pool: where the open panel stands against the pill and the field, and the sizes the
// registry's rows give its marks, which happy-dom lays out at nothing. run with `pnpm test:browser`.

const panels: UnitPanel[] = [];

afterEach(() => {
	for (const panel of panels.splice(0)) panel.stop();
	document.body.replaceChildren();
});

const CHOICE: UnitChoice = {
	value: 'currency',
	search: 'Search currency, crypto or stock',
	options: [
		{ group: 'currency', value: 'currency', label: 'USD', name: 'US dollar', country: 'us' },
		{ group: 'coin', value: 'coin:btc', label: 'BTC', name: 'Bitcoin', network: 'Bitcoin' }
	],
	stocks: true,
	onChange: () => {}
};

/**
 * the panel as the element holds it: in a shadow root dressed by ./styles/tokens.css, under the
 * card's root node, on a page whose own `:root` names both registry variables the panel reads.
 */
function mountedInElement() {
	const page = document.createElement('style');
	page.textContent = ':root { --shadow-floating: none; --duration-fast: 5s; }';
	document.head.appendChild(page);
	onTestFinished(() => page.remove());
	const element = document.createElement('div');
	const shadow = element.attachShadow({ mode: 'open' });
	const sheet = document.createElement('style');
	sheet.textContent = tokens;
	const card = document.createElement('div');
	card.setAttribute('data-theme', CARD_THEME);
	const pill = document.createElement('button');
	const field = document.createElement('div');
	const probe = document.createElement('div');
	const panel = createUnitPanel(document, { searchTickers: async () => [], onClose: () => {} });
	panels.push(panel);
	card.append(pill, field, probe, panel.host);
	shadow.append(sheet, card);
	document.body.appendChild(element);
	panel.update(CHOICE);
	panel.open({ pill, field });
	const dialog = panel.host.shadowRoot?.querySelector('[role="dialog"]') as HTMLElement;
	return { dialog, probe };
}

/** the registry's floating shadow as ../registry/styles/variables.css declares it on `:root`. */
const SHADOW_FLOATING = /--shadow-floating:([^;]+);/.exec(variablesSource)?.[1]?.trim() ?? '';

/** a 375px card holding the How much line, the pill at its right end, and the field under it. */
function mounted() {
	const card = document.createElement('div');
	// the tokens reach the panel by inheritance from the card around it, which `data-donate-root`
	// in ./styles/tokens.css stands in for.
	card.setAttribute('data-donate-root', '');
	card.style.cssText = 'inline-size: 375px; padding: 16px; box-sizing: border-box;';
	const sheet = document.createElement('style');
	sheet.textContent = tokens;
	const line = document.createElement('div');
	line.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
	const heading = document.createElement('span');
	heading.textContent = 'How much';
	const pill = document.createElement('button');
	pill.textContent = 'USD';
	pill.style.cssText = 'block-size: 28px;';
	line.append(heading, pill);
	const field = document.createElement('div');
	field.style.cssText = 'block-size: 120px;';
	const panel = createUnitPanel(document, {
		searchTickers: async () => [],
		onClose: () => {}
	});
	panels.push(panel);
	card.append(sheet, line, field, panel.host);
	document.body.appendChild(card);
	panel.update(CHOICE);
	panel.open({ pill, field });
	const root = panel.host.shadowRoot as ShadowRoot;
	const dialog = root.querySelector('[role="dialog"]') as HTMLElement;
	return { card, pill, field, root, dialog };
}

describe('the open unit panel', () => {
	it('covers the pill from its top right, as wide as the field, inside the card', async () => {
		const { card, pill, field, dialog } = mounted();
		const at = pill.getBoundingClientRect();
		await expect
			.poll(() => Math.round(dialog.getBoundingClientRect().top))
			.toBe(Math.round(at.top));
		const box = dialog.getBoundingClientRect();
		const inside = card.getBoundingClientRect();

		expect(Math.round(box.right)).toBe(Math.round(at.right));
		expect(Math.round(box.width)).toBe(Math.round(field.getBoundingClientRect().width));
		expect(box.left).toBeGreaterThanOrEqual(inside.left);
		expect(box.right).toBeLessThanOrEqual(inside.right);
		expect(dialog.matches(':popover-open')).toBe(true);
	});

	it('draws each row at least 48px tall with a 32px round mark', async () => {
		const { root } = mounted();
		const rows = [...root.querySelectorAll<HTMLElement>('[role="option"]')];

		expect(rows).toHaveLength(2);
		// the machine takes an `open` it was handed on a microtask (`send` in @zag-js/vanilla), and its
		// list carries `hidden` until then, so a row measured in the task that opened the panel is 0px.
		await expect
			.poll(() => rows[0]?.getBoundingClientRect().height ?? 0)
			.toBeGreaterThanOrEqual(48);
		for (const row of rows) {
			const mark = row.querySelector('.unit-mark') as HTMLElement;
			const { width, height } = mark.getBoundingClientRect();
			expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
			expect([width, height]).toEqual([32, 32]);
			expect(getComputedStyle(mark).borderRadius).toBe('50%');
		}
	});

	// the registry declares both on `:root`, which matches nothing in a shadow tree, so without the
	// card's own declarations the panel reads the page's: `none` and 5s here.
	it('floats on the registry’s shadow and times on its fast duration, whatever the page declares', () => {
		const { dialog, probe } = mountedInElement();
		probe.style.boxShadow = SHADOW_FLOATING;
		const drawn = getComputedStyle(dialog);

		expect(SHADOW_FLOATING).toMatch(/^0 10px 15px -3px color-mix/);
		expect(drawn.boxShadow).not.toBe('none');
		expect(drawn.boxShadow).toBe(getComputedStyle(probe).boxShadow);
		expect(drawn.getPropertyValue('--duration-fast').trim()).toBe('150ms');
	});
});
