import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { describe, expect, it } from 'vitest';
import { opensOrDropsDialog } from './dialog-params';

/** a link press between two addresses on this one page, which is every navigation but a submission. */
const pressed = (from: string, to: string): ShouldRevalidateFunctionArgs => ({
	currentUrl: new URL(from, 'http://127.0.0.1:5322'),
	currentParams: {},
	nextUrl: new URL(to, 'http://127.0.0.1:5322'),
	nextParams: {},
	defaultShouldRevalidate: true
});

describe('a navigation that does nothing but open or drop a dialog', () => {
	it('reads the close confirm opening', () => {
		expect(opensOrDropsDialog(pressed('/', '/?close'))).toBe(true);
	});

	it('reads the close confirm being left', () => {
		expect(opensOrDropsDialog(pressed('/?close', '/'))).toBe(true);
	});
});

/**
 * the answer the router hands the page after a press, which carries the submission whichever
 * address it lands on: the router carries a submission through any redirect it followed.
 */
const posted = (from: string, to: string, answer?: unknown): ShouldRevalidateFunctionArgs => ({
	...pressed(from, to),
	formMethod: 'POST',
	formAction: from,
	formEncType: 'application/x-www-form-urlencoded',
	formData: new FormData(),
	...(answer === undefined ? {} : { actionResult: answer })
});

describe("a navigation carrying a press's answer", () => {
	it('is never one of them, however the dialog parameter moved', () => {
		expect(opensOrDropsDialog(posted('/?close', '/'))).toBe(false);
		expect(opensOrDropsDialog(posted('/?close', '/?close', { closing: true }))).toBe(false);
	});
});

describe('every other navigation', () => {
	it('is not one of them when the path is a different one', () => {
		expect(opensOrDropsDialog(pressed('/', '/somewhere-else'))).toBe(false);
		expect(opensOrDropsDialog(pressed('/?close', '/somewhere-else?close'))).toBe(false);
	});

	it('is not one of them when the address differs in anything besides those parameters', () => {
		expect(opensOrDropsDialog(pressed('/?fold=mail', '/?fold=payments'))).toBe(false);
		expect(opensOrDropsDialog(pressed('/?close', '/?close&fold=mail'))).toBe(false);
	});

	it('is one of them when what else the address carries is unchanged', () => {
		expect(opensOrDropsDialog(pressed('/?fold=mail', '/?fold=mail&close'))).toBe(true);
	});
});
