import { describe, expect, it } from 'vitest';
import type { Route } from '../../routes/+types/_app.admin.donations';
import { APP_NAME, screenTitle } from './screen-title';

// the layout's match as react router hands it to a screen's `meta`, taken off a real screen's
// generated types rather than written out here. that is the whole tie: `orgName` renamed on
// ../../routes/_app.tsx's loader, or the layout no longer among a screen's matches, fails to
// compile in this file instead of falling quietly back to the software's own name at runtime.
type LayoutMatch = Extract<Route.MetaArgs['matches'][number], { id: 'routes/_app' }>;

// the `ready` shape, because that is the only one a screen is rendered under: the layout draws the
// set-up gate in place of every child while any of the five is unfinished (../../routes/_app.tsx),
// so no screen's `meta` ever runs against the other one.
const layout = (orgName: string | null): LayoutMatch => ({
	id: 'routes/_app',
	params: {},
	pathname: '/admin',
	meta: [],
	loaderData: { shape: 'ready', orgName }
});

describe('a screen title', () => {
	it('names the screen and then the organisation the deployment is for', () => {
		expect(screenTitle('Gifts', [layout('Hope Foundation')])).toBe('Gifts · Hope Foundation');
	});

	it('names the software where no organisation name is stored', () => {
		// the same answer the identity band gives, and for the same reason: an operator who has not
		// been to the console yet has nothing for either to print.
		expect(screenTitle('Gifts', [layout(null)])).toBe(`Gifts · ${APP_NAME}`);
	});

	it('still names something where the layout is not among the matches', () => {
		expect(screenTitle('Gifts', [{ id: 'routes/_app.admin.donations' as const }])).toBe(
			`Gifts · ${APP_NAME}`
		);
	});
});
