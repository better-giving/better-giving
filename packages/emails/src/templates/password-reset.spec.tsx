import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import * as passwordReset from './password-reset';
import type { PasswordResetData } from './password-reset';

const LINK =
	'https://give.example/reset?token=1f2e3d4c5b6a798807162534435261708f9e0d1c2b3a49586776859403a2b1c0';

function data(overrides: Partial<PasswordResetData> = {}): PasswordResetData {
	return {
		orgName: 'Hope Kitchen',
		link: LINK,
		...overrides
	};
}

/** renders both arms. */
function rendered(overrides: Partial<PasswordResetData> = {}) {
	return renderEmail(passwordReset.template(data(overrides)));
}

describe('passwordReset.template', () => {
	it('names the organisation in the subject', async () => {
		expect((await rendered()).subject).toContain('Hope Kitchen');
	});

	// the link is the whole message: an arm that lost it is a reset nobody can complete.
	it('carries the link and the hour it lives in both arms', async () => {
		const message = await rendered();
		for (const arm of [message.text, message.html]) {
			expect(arm).toContain(LINK);
			expect(arm).toContain('hour');
		}
	});

	/**
	 * the address is its own text as well as its href, and the text arm is derived from that
	 * markup — so a stripper that printed `text [href]` would hand the recipient the same long
	 * token twice and leave them to work out that the two are one link.
	 */
	it('prints the address once in the plain-text arm, not twice', async () => {
		const message = await rendered();
		expect(message.text.split(LINK).length - 1).toBe(1);
	});

	it('always produces both arms', async () => {
		const message = await rendered();
		expect(message.text.length).toBeGreaterThan(0);
		// the doctype is the one react-email writes and not one this package chose, so the claim is
		// that there is one and that `<html>` follows.
		expect(message.html.toLowerCase()).toContain('<!doctype html');
		expect(message.html).toContain('<html');
	});

	// a legal name with an ampersand in it is ordinary, and an unescaped one breaks the markup.
	it('escapes the organisation name in the HTML arm', async () => {
		const message = await rendered({ orgName: 'Food & Shelter <Trust>' });
		expect(message.html).toContain('Food &amp; Shelter &lt;Trust&gt;');
		expect(message.html).not.toContain('<Trust>');
	});

	// the href is an attribute, which is the one place an unescaped quote ends the value early and
	// leaves the rest of the address as markup.
	it('escapes the link into the href', async () => {
		const message = await rendered({ link: 'https://give.example/reset?token=a"b' });
		expect(message.html).toContain('href="https://give.example/reset?token=a&quot;b"');
	});
});
