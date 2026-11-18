import { describe, expect, it } from 'vitest';
import { ruleOf, sheet } from './sheet-rule.testing';

// the organisation's logo in the shell's head (../components/shell/Shell.jsx). ./base.css gives
// every image `height: auto`, which beats the `height` the markup states, so a 72px file draws
// 72px tall and a 480x320 one spills over the nav. the logo takes the block size of the box
// app-shell-css draws for it — nine of its spacing steps in the head, and the rail's seven-step
// box, which is the same `calc` that sheet states — its width follows from the file's own ratio,
// and a file wider than the head is fitted inside it rather than cropped or stretched.

const css = sheet('adm.css');

describe('the logo in the shell’s head', () => {
	const logo = ruleOf(css, '.adm-logo');

	it('takes the head’s block size, not its file’s', () => {
		expect(logo.get('block-size')).toBe('calc(var(--ds-spacing) * 9)');
	});

	it('takes its width from the file’s ratio, and never more than the head', () => {
		expect(logo.get('inline-size')).toBe('auto');
		expect(logo.get('max-inline-size')).toBe('100%');
	});

	it('fits a file the head cannot hold whole, rather than cropping or stretching it', () => {
		expect(logo.get('object-fit')).toBe('contain');
	});
});

describe('the logo on the rail', () => {
	it('takes the rail box’s seven steps', () => {
		expect(ruleOf(css, '.adm-logo--rail').get('block-size')).toBe('calc(var(--ds-spacing) * 7)');
	});
});
