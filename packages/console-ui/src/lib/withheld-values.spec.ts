import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { WithheldValues } from './withheld-values';

// the Remove press as markup. ../../vite.config.ts pins `node` and there is no dom, so focus is held
// by what keeps it — a press that is never natively closed — and the press its click handler turns
// away, and the card's own Remove that only a press puts up, are read by ../closed-while-writing.spec.ts.

/** the block on a page of its own, under a router for the submit it posts with. */
function drawn(state: { busy: boolean; freeing: boolean }): string {
	const router = createMemoryRouter([
		{
			path: '/',
			Component: () =>
				createElement(WithheldValues, {
					names: ['SMTP_PASSWORD'],
					all: ['SMTP_PASSWORD'],
					consequence: 'No receipt is sent until you save it again.',
					written: null,
					trouble: () => null,
					...state
				})
		}
	]);
	return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

const REMOVE = /<button[^>]*>(?:(?!<\/button>).)*Remove SMTP_PASSWORD/s;

describe('the Remove press', () => {
	it('is held without `disabled` while its own write is in flight, and says it is busy', () => {
		const tag = drawn({ busy: false, freeing: true }).match(REMOVE)?.[0];
		expect(tag).toBeDefined();
		expect(tag).not.toMatch(/\sdisabled=/);
		expect(tag).toContain('aria-disabled="true"');
		expect(tag).toContain('aria-busy="true"');
	});

	it('is held without `disabled` while another write on the page is in flight', () => {
		const tag = drawn({ busy: true, freeing: false }).match(REMOVE)?.[0];
		expect(tag).not.toMatch(/\sdisabled=/);
		expect(tag).toContain('aria-disabled="true"');
		expect(tag).not.toContain('aria-busy="true"');
	});

	it('stands open where nothing is writing', () => {
		expect(drawn({ busy: false, freeing: false }).match(REMOVE)?.[0]).not.toContain(
			'aria-disabled'
		);
	});
});
