import { describe, expect, it } from 'vitest';
import { rulesIn, sheet } from './sheet-rule.testing';

// a field's box stands at the top of its row. in a `.adm-pair--side` from 44rem the two fields
// subgrid one set of rows, so the box row is as tall as the taller box: the IRA (QCD) card's
// payee name beside its three-line mailing address (packages/app/src/lib/admin/payments/
// pledge-rails.tsx). a box stretched to that row is a single line drawn three lines tall, with
// its text floating in the middle of it.

const css = sheet('adm.css');

describe("a field's box row", () => {
	it('places every box at the top of the row rather than stretching it to the row', () => {
		const boxRow = rulesIn(css).filter(({ selector }) =>
			selector.startsWith('.adm-field > :is(.adm-input, .adm-field__box,')
		);
		expect(boxRow).toHaveLength(1);
		expect(boxRow[0]?.stated.get('grid-row')).toBe('3');
		expect(boxRow[0]?.stated.get('align-self')).toBe('start');
	});
});
