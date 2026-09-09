import { describe, expect, it } from 'vitest';
import { codeSpans } from './code-spans';

// node pool, no database: the segmenter is a pure function over a string and imports nothing.

describe('the code-span segmenter', () => {
	it('hands back one plain run when nothing is marked', () => {
		expect(codeSpans('This deployment sends no email.')).toEqual([
			{ text: 'This deployment sends no email.', code: false }
		]);
	});

	it('splits a marked run out of the prose around it', () => {
		expect(codeSpans('Run `pnpm run doctor` first.')).toEqual([
			{ text: 'Run ', code: false },
			{ text: 'pnpm run doctor', code: true },
			{ text: ' first.', code: false }
		]);
	});

	it('keeps an unpaired backtick as text', () => {
		// the tail is the half of the sentence naming what to set, so it may never be swallowed
		// by a mark that was never closed. a stray backtick on the screen is a typo a reader can
		// see; a truncated sentence is one nobody can.
		expect(codeSpans('Set `SMTP_HOST and try again')).toEqual([
			{ text: 'Set `SMTP_HOST and try again', code: false }
		]);
	});

	it('resolves the pairs it has before an unpaired one', () => {
		expect(codeSpans('Set `SMTP_HOST`, then `SMTP_PORT')).toEqual([
			{ text: 'Set ', code: false },
			{ text: 'SMTP_HOST', code: true },
			{ text: ', then `SMTP_PORT', code: false }
		]);
	});

	it('marks a run at the very start and at the very end', () => {
		expect(codeSpans('`MAIL_FROM` is not set')).toEqual([
			{ text: 'MAIL_FROM', code: true },
			{ text: ' is not set', code: false }
		]);
		expect(codeSpans('the value is `redacted`')).toEqual([
			{ text: 'the value is ', code: false },
			{ text: 'redacted', code: true }
		]);
	});

	it('keeps adjacent marked runs apart', () => {
		expect(codeSpans('`SMTP_HOST``SMTP_PORT`')).toEqual([
			{ text: 'SMTP_HOST', code: true },
			{ text: 'SMTP_PORT', code: true }
		]);
	});

	it('emits nothing for an empty mark, and no seam where it was', () => {
		// the two backticks are the source marking nothing, so what is left is one run of prose
		// rather than two that happen to render side by side.
		expect(codeSpans('nothing `` here')).toEqual([{ text: 'nothing  here', code: false }]);
		expect(codeSpans('``')).toEqual([]);
		expect(codeSpans('')).toEqual([]);
	});

	it('parses backticks and nothing else', () => {
		// there is one mark in these strings and no others. an asterisk, a bracket or an
		// underscore is a character an operator's own value can contain.
		expect(codeSpans('*not emphasis*, [not a link](nowhere), _not italic_')).toEqual([
			{ text: '*not emphasis*, [not a link](nowhere), _not italic_', code: false }
		]);
		expect(codeSpans('the address is `a*b_c@example.org`')).toEqual([
			{ text: 'the address is ', code: false },
			{ text: 'a*b_c@example.org', code: true }
		]);
	});
});
