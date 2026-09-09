import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import * as invitation from './invitation';
import type { InvitationData } from './invitation';

const LINK =
	'https://give.example/join/1f2e3d4c5b6a798807162534435261708f9e0d1c2b3a49586776859403a2b1c0';

function data(overrides: Partial<InvitationData> = {}): InvitationData {
	return {
		orgName: 'Hope Kitchen',
		link: LINK,
		expiresAt: new Date('2026-01-12T09:00:00.000Z'),
		...overrides
	};
}

/** renders both arms. */
function rendered(overrides: Partial<InvitationData> = {}) {
	return renderEmail(invitation.template(data(overrides)));
}

describe('invitation.template', () => {
	it('names the organisation in the subject', async () => {
		expect((await rendered()).subject).toContain('Hope Kitchen');
	});

	// the link is the whole message: an arm that lost it is an invitation nobody can accept.
	it('carries the link and the expiry date in both arms', async () => {
		const message = await rendered();
		for (const arm of [message.text, message.html]) {
			expect(arm).toContain(LINK);
			expect(arm).toContain('January 12, 2026');
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
		const message = await rendered({ link: 'https://give.example/join/a"b' });
		expect(message.html).toContain('href="https://give.example/join/a&quot;b"');
	});
});
