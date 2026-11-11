import { describe, expect, it } from 'vitest';
import { GOAL_MINOR_MAX } from '../page/catalog';
import { SUPPORTER_EDIT_INPUT, SUPPORTER_HIDE_INPUT, SUPPORTER_START_INPUT } from './input';

const START = {
	name: ' Maya Rivera ',
	email: ' Maya@Example.ORG ',
	title: 'Run for the shelter',
	goal: '500',
	story: 'I am running 10k.'
};

const issuesAt = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
	result.error?.issues.map((issue) => issue.path.join('.')) ?? [];

describe('starting a fundraiser, as posted', () => {
	it('reads the boxes, the goal in minor units and the address lowercased', () => {
		expect(SUPPORTER_START_INPUT.parse(START)).toEqual({
			name: 'Maya Rivera',
			email: 'maya@example.org',
			title: 'Run for the shelter',
			goal: 50_000,
			story: 'I am running 10k.',
			photo_id: null
		});
	});

	it('lowercases past ASCII, which the database cannot', () => {
		expect(SUPPORTER_START_INPUT.parse({ ...START, email: 'ÉLODIE@example.org' }).email).toBe(
			'élodie@example.org'
		);
	});

	it('takes a goal of 50 and refuses one under it', () => {
		expect(SUPPORTER_START_INPUT.parse({ ...START, goal: '50' }).goal).toBe(5_000);
		expect(issuesAt(SUPPORTER_START_INPUT.safeParse({ ...START, goal: '49.99' }))).toEqual([
			'goal'
		]);
	});

	it('refuses a goal past the cap a campaign goal has', () => {
		const over = String((GOAL_MINOR_MAX + 1) / 100);
		expect(issuesAt(SUPPORTER_START_INPUT.safeParse({ ...START, goal: over }))).toEqual(['goal']);
	});

	it('refuses a title past 80 and a story past 1,500 characters', () => {
		expect(
			issuesAt(
				SUPPORTER_START_INPUT.safeParse({
					...START,
					title: 'x'.repeat(81),
					story: 'y'.repeat(1_501)
				})
			)
		).toEqual(['title', 'story']);
	});

	it('refuses a blank name, title or story and an address that is none', () => {
		expect(
			issuesAt(
				SUPPORTER_START_INPUT.safeParse({
					...START,
					name: ' ',
					email: 'maya',
					title: '',
					story: '  '
				})
			)
		).toEqual(['name', 'email', 'title', 'story']);
	});

	it('carries a photo by its id, and a blank box as none', () => {
		expect(SUPPORTER_START_INPUT.parse({ ...START, photo_id: ' img-1 ' }).photo_id).toBe('img-1');
		expect(SUPPORTER_START_INPUT.parse({ ...START, photo_id: '' }).photo_id).toBeNull();
	});
});

describe('editing a fundraiser, as posted', () => {
	it('takes no address and no email', () => {
		const { email: _email, ...edit } = START;
		expect(SUPPORTER_EDIT_INPUT.parse({ ...edit, slug: 'elsewhere' })).toEqual({
			name: 'Maya Rivera',
			title: 'Run for the shelter',
			goal: 50_000,
			story: 'I am running 10k.',
			photo_id: null
		});
	});
});

describe('hiding a fundraiser, as posted', () => {
	it('takes a note of up to 300 characters, and a blank one as none', () => {
		expect(SUPPORTER_HIDE_INPUT.parse({ note: ' spam ' })).toEqual({ note: 'spam' });
		expect(SUPPORTER_HIDE_INPUT.parse({ note: '' })).toEqual({ note: null });
		expect(issuesAt(SUPPORTER_HIDE_INPUT.safeParse({ note: 'z'.repeat(301) }))).toEqual(['note']);
	});
});
