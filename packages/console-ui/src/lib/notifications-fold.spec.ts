import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { OrgWrite } from '../api/types';
import { NotificationsFold } from './notifications-fold';
import { IDENTITY_FOLD, NOTIFICATION_BOXES, storedProfile } from './org-fields';
import { OrgWriteOutcome } from './org-write';

// the Notifications fold as first drawn. ../../vite.config.ts pins `node` and there is no dom, so
// what its press would post is read off the controls it draws: the deployment reads a profile
// whole, so everything the Organisation fold draws has to ride along at what is stored.

const STORED = storedProfile({
	legal_name: 'Riverside Community Food Bank',
	notification_email: 'alerts@riverside.org',
	mission: 'Food for every family in Riverside County.',
	vision: 'No family in Riverside goes hungry.',
	brand_colour: '#2f6b3a',
	social_links: [
		{ platform: 'facebook', href: 'https://www.facebook.com/riversidefoodbank' },
		{ platform: 'x', href: 'https://x.com/riversidefood' }
	],
	logo: { id: 'img_1', url: 'https://give.riverside.org/images/img_1' }
});

function drawn(): string {
	const router = createMemoryRouter([
		{
			path: '/',
			Component: () =>
				createElement(NotificationsFold, {
					stored: STORED,
					write: null,
					busy: false,
					pending: false
				})
		}
	]);
	return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** what the press would post that it does not draw, as `name=value`. */
const carried = (markup: string): string[] =>
	[...markup.matchAll(/<input type="hidden"[^>]*name="([^"]*)" value="([^"]*)"/g)].map(
		(found) => `${found[1]}=${found[2]}`
	);

describe('the Notifications fold’s save', () => {
	it('carries every stored link at the address the deployment stored, in order', () => {
		expect(carried(drawn()).filter((entry) => entry.startsWith('social_links'))).toEqual([
			'social_links[0]=https://www.facebook.com/riversidefoodbank',
			'social_links[1]=https://x.com/riversidefood'
		]);
	});

	it('carries the mission, the vision and the brand colour at what is stored', () => {
		expect(carried(drawn())).toEqual(
			expect.arrayContaining([
				'mission=Food for every family in Riverside County.',
				'vision=No family in Riverside goes hungry.',
				'brand_colour=#2f6b3a'
			])
		);
	});
});

describe('a refusal of its press over a part the Organisation fold draws', () => {
	const refused = (key: string): OrgWrite => ({
		kind: 'refused',
		message: null,
		fix: null,
		errors: { [key]: 'Not saved.' },
		unread: 0
	});

	it.each([
		['logo', 'Logo'],
		['social_links', 'Social links']
	])('names %s by its label and sends the operator to the fold that draws it', (key, label) => {
		const markup = renderToStaticMarkup(
			createElement(OrgWriteOutcome, { write: refused(key), drawn: NOTIFICATION_BOXES })
		);

		expect(markup).toContain(`Refused under ${IDENTITY_FOLD}: ${label}.`);
	});
});
