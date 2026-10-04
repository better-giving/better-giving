import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { NonprofitLookup, NonprofitSearch } from '../api/types';
import { orgBoxes } from './org-fields';
import { OrgFold } from './org-fold';

// the Legal details fold as drawn, around the IRS list. ../../vite.config.ts pins `node` and there
// is no dom, so what is read here is the first draw; when the list is asked and what an answer
// fills are ./ein-lookup.spec.ts's, and the dialog's states are ./find-org-dialog.spec.ts's.

const STORED = orgBoxes({
	legal_name: 'Riverside Community Food Bank',
	tax_id: '12-3456789',
	address_line1: '400 Mill Road',
	city: 'Riverside',
	region: 'CA',
	country: 'United States'
});

function drawn(stored: ReturnType<typeof orgBoxes>, lookups = true) {
	const lookUp = vi.fn(
		async (): Promise<NonprofitLookup> => ({
			state: 'unavailable',
			organisation: {
				ein: '',
				name: '',
				address_line1: '',
				city: '',
				region: '',
				postal_code: '',
				deductible: false,
				revokedOn: '',
				website: ''
			}
		})
	);
	const search = vi.fn(
		async (): Promise<NonprofitSearch> => ({ state: 'unavailable', matches: [] })
	);
	const router = createMemoryRouter([
		{
			path: '/',
			Component: () =>
				createElement(OrgFold, {
					stored,
					write: null,
					busy: false,
					pending: false,
					lookups,
					lookUp,
					search
				})
		}
	]);
	const markup = renderToStaticMarkup(createElement(RouterProvider, { router }));
	return { markup, lookUp, search };
}

/** the EIN box's own tag. */
const einBox = (markup: string): string => {
	const tag = markup.match(/<input[^>]*name="tax_id"[^>]*>/)?.[0];
	expect(tag).toBeDefined();
	return tag as string;
};

describe('the Legal details fold', () => {
	it('asks the list nothing when it is drawn holding a stored EIN', () => {
		const { lookUp, search } = drawn(STORED);

		expect(lookUp).not.toHaveBeenCalled();
		expect(search).not.toHaveBeenCalled();
	});

	it('takes the EIN on a number pad, ahead of the name it fills', () => {
		const { markup } = drawn(STORED);

		expect(einBox(markup)).toContain('inputMode="numeric"');
		expect(markup.indexOf('name="tax_id"')).toBeLessThan(markup.indexOf('name="legal_name"'));
	});

	it('stands the region the list’s note is said in under the EIN box, empty, before it speaks', () => {
		const { markup } = drawn(STORED);

		expect(markup).toContain(
			'<p class="adm-field__needed" id="org-tax_id-status" role="status"></p>'
		);
		expect(einBox(markup)).not.toContain('aria-describedby');
	});

	it('opens on the find dialog for a fresh set-up', () => {
		const { markup } = drawn(orgBoxes({}));

		expect(markup).toContain('Find your organisation</h2>');
	});

	it('opens on a fresh set-up whatever notification address is stored', () => {
		const { markup } = drawn(orgBoxes({ notification_email: 'alerts@example.org' }));

		expect(markup).toContain('Find your organisation</h2>');
	});

	it('opens on the plain form where any of the identity is stored', () => {
		const { markup } = drawn(orgBoxes({ city: 'Riverside' }));

		expect(markup).not.toContain('<dialog');
	});

	it('offers the dialog at any time from a quiet press beside Save', () => {
		const { markup } = drawn(STORED);
		const press = markup.match(/<button[^>]*>(?:(?!<\/button>).)*Find your organisation/s)?.[0];

		expect(press).toContain('type="button"');
		expect(press).toContain('adm-btn--quiet');
	});

	describe('on a console built with no address for the IRS list', () => {
		it('draws no press that opens the find dialog', () => {
			expect(drawn(STORED, false).markup).not.toContain('Find your organisation');
		});

		it('opens a fresh set-up on the plain form', () => {
			expect(drawn(orgBoxes({}), false).markup).not.toContain('<dialog');
		});

		it('stands no region for a note the list will never give', () => {
			expect(drawn(STORED, false).markup).not.toContain('id="org-tax_id-status"');
		});

		it('still spells the EIN as it is typed, on a number pad', () => {
			expect(einBox(drawn(STORED, false).markup)).toContain('inputMode="numeric"');
		});
	});
});
