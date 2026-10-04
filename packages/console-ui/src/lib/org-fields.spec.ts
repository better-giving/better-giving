import { describe, expect, it } from 'vitest';
import { orgEdits } from './org-fields';

// what a press of the Organisation fold asks the binary to store, read off the form it submitted.

describe('what a press posts', () => {
	it('carries the statements and the brand colour as typed', () => {
		const posted = new FormData();
		posted.set('legal_name', 'Hope Foundation');
		posted.set('mission', 'Clean water for every school.\n\nAnd every clinic.');
		posted.set('vision', '');
		posted.set('brand_colour', '#1F6FEB');

		const { values } = orgEdits(posted);

		expect(values.mission).toBe('Clean water for every school.\n\nAnd every clinic.');
		expect(values.vision).toBe('');
		expect(values.brand_colour).toBe('#1F6FEB');
	});

	it('carries the link boxes in the order they stand, blanks included', () => {
		// blanks are the deployment's to skip (`readSocialLinks`), so a row left empty is sent as it is.
		const posted = new FormData();
		posted.set('legal_name', 'Hope Foundation');
		posted.set('social_links[0]', 'instagram.com/hope');
		posted.set('social_links[1]', '');
		posted.set('social_links[2]', 'https://x.com/hope');

		expect(orgEdits(posted).socialLinks).toEqual(['instagram.com/hope', '', 'https://x.com/hope']);
	});

	it('carries no links where the form holds no link box', () => {
		const posted = new FormData();
		posted.set('legal_name', 'Hope Foundation');

		expect(orgEdits(posted).socialLinks).toEqual([]);
	});
});
