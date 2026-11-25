import { afterEach, describe, expect, it } from 'vitest';
import { createUnitPanel, type UnitPanel } from './unit-panel';
import tokens from './styles/tokens.css?inline';

// the browser pool: where the open panel stands against the pill and the field, and the sizes the
// registry's rows give its marks, which happy-dom lays out at nothing. run with `pnpm test:browser`.

const panels: UnitPanel[] = [];

afterEach(() => {
	for (const panel of panels.splice(0)) panel.stop();
	document.body.replaceChildren();
});

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
	panel.update({
		value: 'currency',
		search: 'Search currency, crypto or stock',
		options: [
			{ group: 'currency', value: 'currency', label: 'USD', name: 'US dollar', country: 'us' },
			{ group: 'coin', value: 'coin:btc', label: 'BTC', name: 'Bitcoin', network: 'Bitcoin' }
		],
		stocks: true,
		onChange: () => {}
	});
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
});
