import { globSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	currentDestination,
	DESTINATION_GROUPS,
	DESTINATIONS,
	destinationGroupsFor
} from './destinations';

describe('the rail', () => {
	it('opens on the dashboard, then goes to a bare path under /admin, one per section', () => {
		expect(DESTINATIONS.map((d) => d.href)).toEqual([
			'/admin',
			'/admin/campaigns',
			'/admin/forms',
			'/admin/programs',
			'/admin/donors',
			'/admin/donations',
			'/admin/recurring',
			'/admin/organisation',
			'/admin/members',
			'/admin/integrations/zapier',
			'/admin/integrations/api',
			'/admin/integrations/webhooks',
			'/admin/books'
		]);
	});

	it('stands the dashboard alone, then the records of giving, then the organisation and who can sign in, then the integrations, then the books', () => {
		expect(DESTINATION_GROUPS.map((group) => group.destinations.map((d) => d.label))).toEqual([
			['Dashboard'],
			['Campaigns', 'Donation forms', 'Programs', 'Donors', 'Gifts', 'Recurring gifts'],
			['Organisation', 'Members'],
			['Zapier', 'API', 'Webhooks'],
			['Books']
		]);
	});

	it('heads the integrations and no other group', () => {
		expect(DESTINATION_GROUPS.map((group) => ('heading' in group ? group.heading : null))).toEqual([
			null,
			null,
			null,
			'Integrations',
			null
		]);
	});
});

describe('who the rail is drawn for', () => {
	it('is every group for the deployer', () => {
		expect(destinationGroupsFor(true)).toEqual(DESTINATION_GROUPS);
	});

	it('leaves the integrations out for a member, and nothing else', () => {
		expect(
			destinationGroupsFor(false).map((group) => group.destinations.map((d) => d.label))
		).toEqual([
			['Dashboard'],
			['Campaigns', 'Donation forms', 'Programs', 'Donors', 'Gifts', 'Recurring gifts'],
			['Organisation', 'Members'],
			['Books']
		]);
	});
});

describe('the bar at a phone width', () => {
	it('carries the dashboard, the campaigns, the donors and the gifts, and leaves the rest to More', () => {
		expect(DESTINATIONS.filter((d) => 'bar' in d && d.bar).map((d) => d.label)).toEqual([
			'Dashboard',
			'Campaigns',
			'Donors',
			'Gifts'
		]);
	});
});

describe('what a destination is called', () => {
	it('takes the word a fundraiser says, which the path need not', () => {
		// the path takes the domain word and the label takes the word on the page — `/admin/donations`
		// is Gifts. CLAUDE.md → Product surface is the rule.
		expect(DESTINATIONS.find((d) => d.href === '/admin/donations')?.label).toBe('Gifts');
		expect(DESTINATIONS.map((d) => d.label)).not.toContain('Donations');
		// and the people who can sign in are members, never users or accounts.
		expect(DESTINATIONS.find((d) => d.href === '/admin/members')?.label).toBe('Members');
		expect(DESTINATIONS.map((d) => d.label)).not.toContain('Users');
		// and the journal entries are the books, never the ledger.
		expect(DESTINATIONS.find((d) => d.href === '/admin/books')?.label).toBe('Books');
		expect(DESTINATIONS.map((d) => d.label)).not.toContain('Ledger');
	});
});

describe('the destination a page belongs to', () => {
	it('is the one whose address the page is at, and is that page', () => {
		expect(currentDestination('/admin/donors')).toEqual({ label: 'Donors', kind: 'page' });
	});

	it('is the section a page one level down sits in, and only contains that page', () => {
		// a rail that goes blank at /admin/forms/new leaves the reader nothing on screen saying
		// where they are, and a cell claiming to be the page there tells them the section is the
		// screen. the kind is what separates the two, on every address one level below a section.
		expect(currentDestination('/admin/forms/new')).toEqual({
			label: 'Donation forms',
			kind: 'section'
		});
		expect(currentDestination('/admin/recurring/0195-a')).toEqual({
			label: 'Recurring gifts',
			kind: 'section'
		});
	});

	it('is still the section several levels down, not only one', () => {
		expect(currentDestination('/admin/forms/0195-a/embed')).toEqual({
			label: 'Donation forms',
			kind: 'section'
		});
	});

	it('is the dashboard at /admin exactly, and the dashboard is nowhere else', () => {
		// the dashboard's address is a prefix of every other destination's, so a prefix rule would
		// make it the section every screen on this surface sits in — two cells marked on every
		// load, and the rail no longer saying where the reader is.
		expect(currentDestination('/admin')).toEqual({ label: 'Dashboard', kind: 'page' });
		expect(currentDestination('/admin/forms')).toEqual({
			label: 'Donation forms',
			kind: 'page'
		});
		expect(currentDestination('/admin/forms/new')).toEqual({
			label: 'Donation forms',
			kind: 'section'
		});
		expect(currentDestination('/admin/elsewhere')).toBeUndefined();
	});

	it('is nothing for a path under no section', () => {
		expect(currentDestination('/login')).toBeUndefined();
		expect(currentDestination('/join')).toBeUndefined();
		expect(currentDestination('/')).toBeUndefined();
	});

	it('is nothing for a path that merely starts with a destination’s letters', () => {
		// a bare `startsWith` marks Donors here, and the reader is not in that section.
		expect(currentDestination('/admin/donorships')).toBeUndefined();
	});
});

describe('the Zapier cell', () => {
	it('is marked with the image packages/operator publishes, and no glyph', () => {
		const zapier = DESTINATIONS.find((d) => d.href === '/admin/integrations/zapier');

		expect(zapier?.mark).toEqual({ src: expect.stringContaining('zapier') });
	});

	it('draws an image that is in the repository once, in packages/operator', () => {
		const packages = resolve(import.meta.dirname, '../../../..');
		const found = globSync('*/{src,static,public}/**/zapier.{png,svg,webp}', { cwd: packages });

		expect(found).toEqual(['operator/src/styles/brand/zapier.png']);
	});
});
