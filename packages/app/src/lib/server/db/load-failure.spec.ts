import { describe, expect, it } from 'vitest';
import { loadFailure } from './load-failure';

// node pool, no database: this module is a sentence and imports nothing.

describe('loadFailure', () => {
	it('opens on the screen that could not be drawn', () => {
		expect(loadFailure('The gifts list')).toMatch(/^The gifts list could not be loaded\. /);
	});

	/**
	 * the errand is the whole reason this sentence is long: an unapplied migration is what a site hits
	 * after an update that skipped `migrate` (DEPLOY.md → Upgrading), and the server never migrates on
	 * start (AGENTS.md → Schema).
	 */
	it('covers a site just set up or just updated', () => {
		expect(loadFailure('This page')).toContain('If this site was just set up or updated');
	});

	it('names who runs the fix, both migrate commands and where the log is', () => {
		const sentence = loadFailure('This page');
		expect(sentence).toContain('whoever runs the server');
		expect(sentence).toContain('`docker compose run --rm migrate`');
		expect(sentence).toContain('`pnpm db:migrate`');
		expect(sentence).toContain('`docker compose logs app`');
	});

	it('says the same thing after the subject on every screen', () => {
		const tail = (subject: string) => loadFailure(subject).slice(subject.length);
		expect(tail('This page')).toBe(tail('The donor list'));
	});
});
