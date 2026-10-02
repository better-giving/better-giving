import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccountBand, AccountRow } from '../components/shell/AccountRow.jsx';
import { ruleOf, sheet } from './sheet-rule.testing';

// the console's account at phone width is a press in the shell's band carrying the account's logo
// and, where the plan slows a feed in use, a warning mark after it; the rail's foot draws the same
// mark at the wide width (../components/shell/AccountRow.jsx). the foot is drawn only past the
// wide breakpoint and the band only short of it, so the rule toning the mark has to hold at every
// width, or the band's is drawn in the press's ink where it is the only account the operator sees.
//
// the tone is keyed on the class both faces put on the mark, and read here off the markup the
// component draws: a mark that lost its class, or a rule keyed on where the mark happens to stand,
// fails here rather than rendering in the wrong ink.

const css = sheet('adm.css');
const MARK = '.adm-accountmark';

const account = {
	name: 'Riverside Shelter’s Account',
	brand: 'cloudflare',
	whose: 'Cloudflare account',
	concern: 'Needs attention',
	href: '/sites?account'
} as const;

/** the element wrapping the drawn warning mark, as its open tag. */
function markHolder(markup: string): string {
	const found = markup.match(/<span class="([^"]*)"><svg\b[^>]*\badm-mark\b/);
	if (found === null) throw new Error('no mark drawn');
	return found[1] as string;
}

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

describe("the account's mark is drawn in the attention tone", () => {
	it('is worn by the mark at both faces', () => {
		const band = renderToStaticMarkup(createElement(AccountBand, account));
		const row = renderToStaticMarkup(createElement(AccountRow, { ...account, out: null }));
		expect(markHolder(band).split(' ')).toContain(MARK.slice(1));
		expect(markHolder(row).split(' ')).toContain(MARK.slice(1));
	});

	it('colours the mark with the attention tone', () => {
		expect(ruleOf(css, MARK).get('color')).toBe('var(--admin-tone-attention-mark)');
	});

	it('states it under no width condition', () => {
		const heads = enclosing(css, MARK);
		expect(heads).not.toBeNull();
		expect(heads?.filter((head) => head.startsWith('@media'))).toEqual([]);
	});
});
