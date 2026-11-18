import { describe, expect, it } from 'vitest';
import { rulesIn, sheet } from './sheet-rule.testing';

// a settings section's card body stacks its rows (packages/app/src/routes/_app.admin.settings_.*.tsx,
// each body `ds-card-body adm-stack`, inside `SettingsLayout`'s `.adm-settings`). the approved
// Settings frames stand those rows `--admin-space-7` apart, a step wider than `.adm-stack`'s own.
// a status line mounted empty in that body, so the sentence arriving in it is announced, takes back
// the same step while it is empty, or it holds a second gap of nothing.

const css = sheet('adm.css');

/** what the rule whose selector list holds `selector` states. */
const ruleHolding = (selector: string) =>
	rulesIn(css).find((rule) => rule.selector.split(', ').includes(selector))?.stated ??
	new Map<string, string>();

const gap = ruleHolding('.adm-settings > * > .adm-stack').get('gap');

describe('a settings card’s body', () => {
	it('stands its rows the frames’ step apart', () => {
		expect(gap).toBe('var(--admin-space-7)');
	});
});

describe.each([
	['.adm-findnote:empty', 'the organisation’s fill note'],
	['.adm-sendnote:empty', 'mail’s test-send line']
])('%s, %s', (selector) => {
	it('takes back the body’s own gap while it is empty', () => {
		expect(ruleHolding(selector).get('margin-block-start')).toBe(`calc(-1 * ${gap})`);
	});
});
