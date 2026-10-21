import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { describe, expect, it } from 'vitest';
import { shouldRevalidate } from './_app.admin.books';

// when the Books screen reads its loader again after a press. the loader reads the deployer's
// chart of accounts from Intuit, so a press that changed nothing the loader reads costs a metered
// call and a wait on Intuit for no new value; every press that wrote something is read back.

const SCREEN = new URL('https://give.example/admin/books');

/** the arguments the router hands over after a press of the form `formId`. */
function pressed(formId: string, defaultShouldRevalidate = true): ShouldRevalidateFunctionArgs {
	const formData = new FormData();
	formData.set('__form_id__', formId);
	return {
		currentUrl: SCREEN,
		currentParams: {},
		nextUrl: SCREEN,
		nextParams: {},
		formMethod: 'POST',
		formAction: SCREEN.pathname,
		formData,
		actionStatus: 200,
		defaultShouldRevalidate
	};
}

describe('shouldRevalidate', () => {
	it('reads nothing again after the start-date preview, which writes nothing', () => {
		expect(shouldRevalidate(pressed('quickbooks-start-date-preview'))).toBe(false);
	});

	it.each([
		['a correction', 'correction'],
		['a disconnect', 'quickbooks-disconnect'],
		['a retry', 'quickbooks-retry'],
		['an accounts save', 'quickbooks-accounts'],
		['a start-date move', 'quickbooks-start-date']
	])('reads the screen again after %s, which wrote what it shows', (_, formId) => {
		expect(shouldRevalidate(pressed(formId))).toBe(true);
	});

	it('leaves a refused press to the router, which reads nothing again after one', () => {
		expect(shouldRevalidate(pressed('correction', false))).toBe(false);
	});
});
