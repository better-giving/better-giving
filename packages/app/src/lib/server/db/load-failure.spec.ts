import { describe, expect, it } from 'vitest';
import { loadFailure } from './load-failure';

// node pool, no database: this module is a sentence and imports nothing.

describe('loadFailure', () => {
	it('opens on the screen that could not be drawn', () => {
		expect(loadFailure('The gifts list')).toMatch(/^The gifts list could not be loaded\. /);
	});

	/**
	 * the errand is the whole reason this sentence is long: an unapplied migration is what a fresh
	 * deployment actually hits, and the reader of an /admin screen is not the one who can run it.
	 */
	it('names who to ask, the migrate command and where the log is, whatever the screen', () => {
		for (const subject of ['This page', 'This recurring gift']) {
			const sentence = loadFailure(subject);
			expect(sentence).toContain('ask whoever set up this site');
			expect(sentence).toContain('`docker compose run --rm migrate`');
			expect(sentence).toContain('`docker compose logs app`');
		}
	});

	it('says the same thing after the subject on every screen', () => {
		const tail = (subject: string) => loadFailure(subject).slice(subject.length);
		expect(tail('This page')).toBe(tail('The donor list'));
	});
});
