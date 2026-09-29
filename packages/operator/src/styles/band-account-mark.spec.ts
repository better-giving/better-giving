import { describe, expect, it } from 'vitest';
import { ruleOf, sheet } from './sheet-rule.testing';

// the console's account at phone width is a press in the shell's band carrying the account's logo
// and, where the plan slows a feed in use, a warning mark after it
// (packages/console-ui/src/routes/_sections.tsx). the rail's foot draws the same mark in the
// attention tone at `.adm-footaccount__status`, but that rule sits in ./adm.css's wide-breakpoint
// block because the foot is only drawn there — so the band's mark needs a rule of its own, and one
// that holds at every width, or it is drawn in the press's ink where it is the only account the
// operator can see.
//
// the band's press carries no class of its own for it: the rule is keyed on position, a mark after
// a logo inside a press in the band, which is what makes the mark the logo's status.

const css = sheet('adm.css');
const BAND_MARK = '.adm-identity > .adm-btn > .adm-btn__label > .adm-brand ~ .adm-mark';

/** the at-rule heads enclosing the first rule written with this selector, outermost first; null
 * where no rule is written with it. */
function enclosing(text: string, selector: string): string[] | null {
	const at = text.indexOf(`${selector} {`);
	if (at === -1) return null;
	const heads: string[] = [];
	let start = 0;
	for (let i = 0; i < at; i++) {
		if (text[i] === '{') {
			heads.push(text.slice(start, i).trim());
			start = i + 1;
		} else if (text[i] === '}') {
			heads.pop();
			start = i + 1;
		} else if (text[i] === ';') {
			start = i + 1;
		}
	}
	return heads;
}

describe("the band's account mark is drawn in the attention tone", () => {
	it('colours the mark after the logo with the tone the foot uses', () => {
		expect(ruleOf(css, BAND_MARK).get('color')).toBe(
			ruleOf(css, '.adm-footaccount__status').get('color')
		);
		expect(ruleOf(css, BAND_MARK).get('color')).toBe('var(--admin-tone-attention-mark)');
	});

	it('states it under no width condition', () => {
		const heads = enclosing(css, BAND_MARK);
		expect(heads).not.toBeNull();
		expect(heads?.filter((head) => head.startsWith('@media'))).toEqual([]);
	});
});
