import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from './raw-values';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

// a settings section's card holds to the 375px floor. the section's column is a grid track sized
// by its cards, and the organisation card's footer holds a quiet press beside Discard and Save
// (packages/app/src/routes/_app.admin.settings_.organisation.tsx): on one unwrapped row at the
// floor that footer is wider than the column and widens the page.

const css = sheet('adm.css');
const registry = stripComments(
	readFileSync(
		fileURLToPath(new URL('../registry/styles/settings-layout-css.css', import.meta.url)),
		'utf8'
	)
);

describe('a card in a settings section', () => {
	it('may shrink to the column rather than widen it', () => {
		expect(ruleOf(css, '.adm-settings > *').get('min-inline-size')).toBe('0');
	});

	it('wraps its footer, so a press beside the save row takes a line of its own', () => {
		expect(ruleOf(css, '.adm-settings > * > footer').get('flex-wrap')).toBe('wrap');
	});

	// the wrap puts the save row on its own line only because the registry stands it across the
	// whole row under 48rem; from 48rem it is its own width and shares the row.
	it('stands the save row across the footer under 48rem, in the registry', () => {
		const across = rulesIn(registry).filter(
			({ selector, stated }) =>
				selector === '.ds-settings-save' && stated.get('inline-size') === '100%'
		);
		expect(across).toHaveLength(1);
		expect(registry).toMatch(
			/@media \(width < 48rem\) \{\s*\.ds-settings-save \{\s*inline-size: 100%;/
		);
	});
});
