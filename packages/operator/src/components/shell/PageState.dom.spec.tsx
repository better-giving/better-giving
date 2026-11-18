import { act } from 'react';
import { describe, expect, it, onTestFinished } from 'vitest';
import { mount, render } from '../render.testing';
import { PageState } from './PageState.jsx';

// what a page shows in place of its content, on page-state-css: the empty state under a page's
// header, the 404 and 500 as the page itself, and loading as a polite status.

describe('a page state', () => {
	it('empty: an h2 under the page header, with no code', () => {
		const root = render(PageState, {
			variant: 'empty',
			title: 'No gifts yet',
			body: 'Gifts show up here as soon as a donor gives, or when you add one by hand.'
		});

		const state = root.querySelector('.ds-page-state');
		expect(state?.className).toBe('ds-page-state');
		expect(state?.querySelector('.ds-page-state-title')?.tagName).toBe('H2');
		expect(state?.querySelector('.ds-page-state-code')).toBeNull();
		expect(state?.querySelector('.ds-page-state-actions')).toBeNull();
		expect(state?.querySelector('[role]')).toBeNull();
	});

	it('not found: the 404 code, an h1 and its one way on', () => {
		const root = render(PageState, {
			variant: 'not-found',
			title: 'No such page',
			body: 'It may have been deleted, or the address may be wrong.',
			action: (
				<a className="ds-btn ds-btn-primary" href="/admin">
					Go to dashboard
				</a>
			)
		});

		expect(root.querySelector('.ds-page-state-code')?.textContent).toBe('404');
		expect(root.querySelector('h1.ds-page-state-title')?.textContent).toBe('No such page');
		expect(root.querySelector('.ds-page-state-actions a')?.getAttribute('href')).toBe('/admin');
	});

	it('error: the 500 code outside an alert holding the title and body, and no action', () => {
		const root = render(PageState, {
			variant: 'error',
			title: 'This deployment could not answer',
			body: 'Nothing more is known here.'
		});

		const state = root.querySelector('.ds-page-state');
		expect(state?.className).toBe('ds-page-state ds-page-state-error');
		expect(state?.firstElementChild?.textContent).toBe('500');
		const alert = state?.querySelector('[role="alert"]');
		expect(alert?.className).toBe('ds-page-state-message');
		expect(alert?.querySelector('h1')?.textContent).toBe('This deployment could not answer');
		expect(alert?.querySelector('.ds-page-state-body')?.textContent).toBe(
			'Nothing more is known here.'
		);
		expect(state?.querySelector('.ds-page-state-actions, button, a')).toBeNull();
	});

	it('takes focus on its title where the caller says a navigation landed on it', () => {
		const root = render(PageState, {
			variant: 'not-found',
			title: 'No such page',
			focusTitle: true
		});

		const title = root.querySelector('.ds-page-state-title');
		expect(title?.getAttribute('tabindex')).toBe('-1');
		expect(document.activeElement).toBe(title);
		// the hook ../../styles/adm.css takes base.css's ring off by (../../styles/page-state.spec.ts).
		expect(title?.className).toBe('ds-page-state-title adm-pagestate__title');
	});

	it('takes focus again for each arrival its caller keys, even one that reads the same', () => {
		const state = mount(PageState, {
			variant: 'not-found',
			title: 'No such page',
			focusTitle: 'first-arrival'
		});
		const elsewhere = document.createElement('button');
		document.body.append(elsewhere);
		onTestFinished(() => elsewhere.remove());
		act(() => elsewhere.focus());

		state.again({ variant: 'not-found', title: 'No such page', focusTitle: 'first-arrival' });
		expect(document.activeElement).toBe(elsewhere);

		state.again({ variant: 'not-found', title: 'No such page', focusTitle: 'second-arrival' });
		expect(document.activeElement).toBe(state.root.querySelector('.ds-page-state-title'));
	});

	it('takes focus again when the state changes in place under one arrival', () => {
		const state = mount(PageState, {
			variant: 'not-found',
			title: 'No such page',
			focusTitle: true
		});
		const elsewhere = document.createElement('button');
		document.body.append(elsewhere);
		onTestFinished(() => elsewhere.remove());
		act(() => elsewhere.focus());

		state.again({ variant: 'error', title: 'This deployment could not answer', focusTitle: true });

		expect(document.activeElement).toBe(state.root.querySelector('.ds-page-state-title'));
	});

	it('loading: a polite status whose line is written once it is on the page', async () => {
		const root = render(PageState, { variant: 'loading', label: 'Loading gifts…' });
		await act(async () => {});

		const state = root.querySelector('.ds-page-state-loading');
		expect(state?.getAttribute('role')).toBe('status');
		expect(state?.getAttribute('aria-live')).toBe('polite');
		expect(state?.querySelector('.ds-spinner')?.getAttribute('aria-hidden')).toBe('true');
		expect(state?.textContent).toBe('Loading gifts…');
	});
});
