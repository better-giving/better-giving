import { describe, expect, it } from 'vitest';
import { ruleOf, sheet } from './sheet-rule.testing';

// a table plane scrolls sideways inside its own box (../components/data/DataTable.jsx). a column
// head named only for a reader is an `.adm-vh` box, absolutely positioned (./base.css): unless the
// plane is its containing block, below the rail's width that block is the viewport, the plane's
// overflow clips nothing of it, and a head standing past the plane's edge widens the page itself.

const css = sheet('adm.css');

describe('a table plane', () => {
	it('scrolls sideways in its own box', () => {
		expect(ruleOf(css, '.adm-plane').get('overflow-x')).toBe('auto');
	});

	it('is the containing block of the reader-only boxes inside it', () => {
		expect(ruleOf(css, '.adm-plane').get('position')).toBe('relative');
		expect(ruleOf(sheet('base.css'), '.adm-vh').get('position')).toBe('absolute');
	});
});
