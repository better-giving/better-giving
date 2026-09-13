import { describe, expect, it } from 'vitest';
import { loadFailure } from './load-failure';

// node pool, no database: this module is a sentence and imports nothing.

describe('loadFailure', () => {
	it('opens on the screen that could not be drawn', () => {
		expect(loadFailure('The gifts list')).toMatch(/^The gifts list could not be loaded\. /);
	});

	/**
	 * the errand is the whole reason this sentence is long, and it is the half that was written
	 * out once per `load` before this module existed: an unapplied migration is what a fresh
	 * deployment actually hits, and the two ways are not the same one — a local D1 is migrated by
	 * wrangler, and the deployed one by the console's update press, which applies migrations as it
	 * deploys.
	 */
	it('names both ways to migrate and where the logs are, whatever the screen', () => {
		for (const subject of ['This page', 'This recurring gift']) {
			const sentence = loadFailure(subject);
			expect(sentence).toContain('pnpm wrangler d1 migrations apply DB --local');
			expect(sentence).toContain('better-giving start');
			expect(sentence).toContain('Cloudflare dashboard');
			expect(sentence).toContain('pnpm run logs');
		}
	});

	it('says the same thing after the subject on every screen', () => {
		const tail = (subject: string) => loadFailure(subject).slice(subject.length);
		expect(tail('This page')).toBe(tail('The donor list'));
	});
});
