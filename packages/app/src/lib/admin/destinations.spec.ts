import { describe, expect, it } from 'vitest';
import { currentDestination, DESTINATIONS } from './destinations';

describe('the rail', () => {
	it('opens on the dashboard, then goes to a bare path under /admin, one per section', () => {
		expect(DESTINATIONS.map((d) => d.href)).toEqual([
			'/admin',
			'/admin/forms',
			'/admin/programs',
			'/admin/donors',
			'/admin/donations',
			'/admin/recurring',
			'/admin/members'
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
