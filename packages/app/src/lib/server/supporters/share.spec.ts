import { describe, expect, it } from 'vitest';
import { fundraiserShare, SHARE_DESCRIPTION_MAX, shareDescription } from './share';

// what a supporter's page is shared with: its story cut on a word to fit, and the addresses on the pinned origin.

describe('a fundraiser’s share description', () => {
	it('is the story as written where it fits, with no mark added', () => {
		expect(shareDescription('I am running 10k for the shelter.')).toBe(
			'I am running 10k for the shelter.'
		);
		const exactly = 'a'.repeat(SHARE_DESCRIPTION_MAX);
		expect(shareDescription(exactly)).toBe(exactly);
	});

	it('runs the story’s lines together as one line', () => {
		expect(shareDescription('  First line.\n\nSecond   line.  ')).toBe('First line. Second line.');
	});

	it('cuts a longer story at the last whole word, an ellipsis inside the limit', () => {
		const story = `${'word '.repeat(40)}end`;
		const cut = shareDescription(story);
		expect(cut).toBe(`${'word '.repeat(32).trimEnd()}…`);
		expect([...cut].length).toBeLessThanOrEqual(SHARE_DESCRIPTION_MAX);
	});

	it('cuts a single word longer than the limit where it must, keeping whole characters', () => {
		const cut = shareDescription('🏃'.repeat(SHARE_DESCRIPTION_MAX + 5));
		expect(cut).toBe(`${'🏃'.repeat(SHARE_DESCRIPTION_MAX - 1)}…`);
	});
});

describe('a fundraiser’s share addresses', () => {
	const PAGE = { slug: 'run-for-the-shelter', title: 'Run', story: 'A story.', photoId: 'photo1' };
	const LOGO = { imageId: 'logo1', width: 400, height: 400 };

	it('names its own address and its photo on the pinned origin', () => {
		const env = { BETTER_AUTH_URL: 'https://give.example.org' } as Env;
		expect(fundraiserShare(env, PAGE, LOGO)).toMatchObject({
			url: 'https://give.example.org/f/run-for-the-shelter',
			image: 'https://give.example.org/image/photo1'
		});
	});

	it('names neither an address nor an image where no origin is pinned, a photo and a logo held', () => {
		expect(fundraiserShare({} as Env, PAGE, LOGO)).toEqual({
			title: 'Run',
			description: 'A story.',
			url: null,
			image: null
		});
	});
});
