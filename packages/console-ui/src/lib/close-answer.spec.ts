import { describe, expect, it } from 'vitest';
import { saidClosing } from './close-answer';

// the reading that decides whether the console is on its way out.
//
// two callers read it and one of them is handed an `any` by the router (../routes/_index.tsx's
// `shouldRevalidate`), so what is asserted here is that every answer the page's own action can
// produce reads false, and that a thrown error does too: a false positive leaves the closed panel
// standing over a console that is still running, and a false negative sends the router at a binary
// that has stopped.

describe('the answer that says the console is closing', () => {
	it('reads the close press', () => {
		expect(saidClosing({ closing: true })).toBe(true);
	});

	it('reads no other answer the page makes', () => {
		expect(saidClosing({ rows: ['example.org'] })).toBe(false);
		expect(saidClosing({ checked: true })).toBe(false);
		expect(saidClosing({ unknown: true })).toBe(false);
	});

	it('reads a press that has made no answer yet', () => {
		expect(saidClosing(undefined)).toBe(false);
		expect(saidClosing(null)).toBe(false);
	});

	it('reads a press that threw', () => {
		expect(saidClosing(new Error('the console answered 500'))).toBe(false);
	});
});
