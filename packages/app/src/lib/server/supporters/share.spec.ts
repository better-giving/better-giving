import { describe, expect, it } from 'vitest';
import { SHARE_DESCRIPTION_MAX, shareDescription } from './share';

// the description a supporter's page is shared with: its story, cut on a word to fit.

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
