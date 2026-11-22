import { describe, expect, it } from 'vitest';
import { ruleOf, rulesIn, sheet } from './sheet-rule.testing';

// the two shapes a setting row takes beyond its own, which
// packages/app/src/routes/_app.admin.programs.$id.tsx puts on an archived program's description:
// a row that keeps one column at every width, and a value that breaks inside a long word.

const css = sheet('adm.css');

describe('a stacked setting row', () => {
	it('is one column, stated after the wide label track so it wins that rule at the same weight', () => {
		expect(ruleOf(css, '.adm-setting--stacked').get('grid-template-columns')).toBe(
			'minmax(0, 1fr)'
		);

		const rules = rulesIn(css);
		const wide = rules.findIndex(
			({ selector, stated }) =>
				selector === '.adm-setting' && stated.get('grid-template-columns')?.includes('20rem')
		);
		const stacked = rules.findIndex(({ selector }) => selector === '.adm-setting--stacked');
		expect(wide).toBeGreaterThan(-1);
		expect(stacked).toBeGreaterThan(wide);
	});
});

describe('a wrapping setting value', () => {
	it('breaks anywhere, so one unbroken word neither overflows the cell nor widens the card', () => {
		expect(ruleOf(css, '.adm-setting__value--wrap').get('overflow-wrap')).toBe('anywhere');
	});
});
