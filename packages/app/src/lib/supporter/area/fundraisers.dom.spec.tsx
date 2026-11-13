import { describe, expect, it } from 'vitest';
import { ACCOUNT, mountScreen, ORG, one } from './area.testing';
import { type FundraiserSummary, YourFundraisers, type YourFundraisersProps } from './fundraisers';

// /fundraise/pages: a live, a hidden and an ended page, and none at all.

const page = (overrides: Partial<FundraiserSummary>): FundraiserSummary => ({
	id: 'p1',
	title: 'Keep the pantry trucks running this winter',
	status: 'live',
	hidden: false,
	address: '/f/keep-the-pantry-trucks-7k2p',
	endedAt: null,
	manageHref: '/fundraise/pages/p1',
	raisedMinor: 324_000,
	goalMinor: 500_000,
	gifts: 41,
	currency: 'USD',
	...overrides
});

const LIVE = page({});
const HIDDEN = page({
	id: 'p2',
	title: 'Birthday pantry drive',
	hidden: true,
	address: '/f/birthday-pantry-drive-3m9c',
	manageHref: '/fundraise/pages/p2',
	raisedMinor: 31_000,
	goalMinor: 100_000,
	gifts: 9
});
const ENDED = page({
	id: 'p3',
	title: 'Holiday meals for 40 families',
	status: 'ended',
	endedAt: '2026-01-06T15:00:00.000Z',
	address: '/f/holiday-meals-for-40-families-q8d1',
	manageHref: '/fundraise/pages/p3',
	raisedMinor: 115_000,
	goalMinor: 100_000,
	gifts: 23
});

const list = (props: Partial<YourFundraisersProps> = {}) =>
	mountScreen(() => (
		<YourFundraisers
			org={ORG}
			account={ACCOUNT}
			pages={[LIVE, HIDDEN, ENDED]}
			startHref="/fundraise"
			{...props}
		/>
	));

const cards = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.sa-cards > li')];

describe('your fundraisers', () => {
	it('carries the signed-in address and Sign out in the bar', () => {
		const { root } = list();
		const bar = one(root, '.page-mast');
		const out = one<HTMLFormElement>(bar, 'form');
		// the bar's own row on a phone: the organisation first, then the address and Sign out.
		expect(out.previousElementSibling?.className).toBe('page-mast-name');
		expect(one(out, '.sa-account-email').textContent).toBe('maya@example.org');
		expect(out.getAttribute('action')).toBe('/fundraise/sign-out');
		expect(one(out, 'input[name="intent"]').getAttribute('value')).toBe('sign-out');
		expect(one(out, 'button').className).toBe('ds-btn ds-btn-ghost ds-btn-sm');
		expect(one(out, 'button').textContent).toBe('Sign out');
	});

	it('draws one plane per page, in the order given, the title opening Manage', () => {
		const { root } = list();
		const drawn = cards(root);
		expect(drawn.map((card) => one(card, 'h2').textContent)).toEqual([
			'Keep the pantry trucks running this winter',
			'Birthday pantry drive',
			'Holiday meals for 40 families'
		]);
		expect(one(drawn[0] as HTMLElement, 'h2 a').getAttribute('href')).toBe('/fundraise/pages/p1');
		expect(one(drawn[0] as HTMLElement, '.sa-address').textContent).toBe(
			'/f/keep-the-pantry-trucks-7k2p'
		);
	});

	it('marks a live page live, with its total and View page', () => {
		const card = cards(list().root)[0] as HTMLElement;
		expect(one(card, '.ds-badge').className).toBe('ds-badge ds-badge-success');
		expect(one(card, '.ds-badge').textContent).toBe('Live');
		expect(card.textContent).toContain('$3,240');
		expect(card.textContent).toContain('of $5,000 goal · 41 gifts');
		const bar = one(card, '[role="progressbar"]');
		expect(bar.getAttribute('aria-valuenow')).toBe('64');
		expect(bar.getAttribute('aria-valuetext')).toBe('64% of goal');
		expect(one(card, 'a.ds-btn-primary').textContent).toBe('Manage');
		expect(one(card, 'a.ds-btn-ghost').getAttribute('href')).toBe('/f/keep-the-pantry-trucks-7k2p');
	});

	it('says a hidden page takes no gifts and offers no View page', () => {
		const card = cards(list().root)[1] as HTMLElement;
		expect(one(card, '.ds-badge').className).toBe('ds-badge ds-badge-warning');
		expect(one(card, '.ds-badge').textContent).toBe('Hidden by Harbor Light');
		expect(card.textContent).toContain('Visitors can’t see this page, and it isn’t taking gifts.');
		expect(card.querySelector('a.ds-btn-ghost')).toBeNull();
		expect(one(card, 'a.ds-btn-primary').textContent).toBe('Manage');
	});

	it('steps an ended page’s Manage down, keeps View page, says when it ended, and lets the bar pass the goal', () => {
		const card = cards(list().root)[2] as HTMLElement;
		expect(one(card, '.ds-badge').className).toBe('ds-badge ds-badge-neutral');
		expect(one(card, '.ds-badge').textContent).toBe('Ended');
		expect(card.textContent).toContain('of $1,000 goal · 23 gifts · ended Jan 6, 2026');
		expect(card.querySelector('a.ds-btn-primary')).toBeNull();
		expect(one(card, 'a.ds-btn-secondary').textContent).toBe('Manage');
		expect(one(card, 'a.ds-btn-ghost').textContent).toBe('View page');
		const track = one(card, '.ds-progress-track');
		expect(track.dataset.state).toBe('met');
		expect(track.getAttribute('aria-valuenow')).toBe('100');
		expect(one(card, '.ds-progress-label').textContent).toBe('115%');
	});

	it('offers Start another while the organisation takes new pages', () => {
		expect(one(list().root, '.sa-head a').textContent).toBe('Start another');
		expect(list({ startHref: null }).root.querySelector('.sa-head a')).toBeNull();
	});
});

describe('no fundraisers yet', () => {
	it('draws the state card with its one primary', () => {
		const { root } = list({ pages: [] });
		expect(root.querySelector('.sa-cards')).toBeNull();
		expect(one(root, '.ds-state-card-title').textContent).toBe('You haven’t started a fundraiser');
		expect(one(root, '.ds-state-card a').className).toBe('ds-btn ds-btn-primary');
		expect(root.querySelector('.sa-head a')).toBeNull();
	});

	it('draws no press while the organisation takes no new pages', () => {
		const { root } = list({ pages: [], startHref: null });
		expect(root.querySelector('.ds-state-card a')).toBeNull();
	});
});
