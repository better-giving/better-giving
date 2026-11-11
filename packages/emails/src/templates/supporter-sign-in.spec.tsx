import { describe, expect, it } from 'vitest';
import { renderEmail } from '../render';
import * as supporterSignIn from './supporter-sign-in';
import type { SupporterSignInData } from './supporter-sign-in';

const LINK = 'https://give.example.org/fundraise/open?token=Zk3f9QxT7mWb2LpV8aDn5EyH1cRj4uSg';
const SIGN_IN = 'https://give.example.org/fundraise/sign-in';
const ORG = 'Harbor Light Community Rescue and Family Services Network';

function data(overrides: Partial<SupporterSignInData> = {}): SupporterSignInData {
	return {
		orgName: ORG,
		link: LINK,
		signInUrl: SIGN_IN,
		arm: { kind: 'first', pageTitle: 'Keep the pantry trucks running this winter' },
		...overrides
	};
}

function rendered(overrides: Partial<SupporterSignInData> = {}) {
	return renderEmail(supporterSignIn.template(data(overrides)));
}

const EXPIRY = `This link works once and expires in an hour. If it has run out, ask for a new one at ${SIGN_IN}.`;

describe('supporterSignIn.template, first time', () => {
	it('asks the supporter to confirm their address to publish', async () => {
		const message = await rendered();
		expect(message.subject).toBe('Confirm your email to publish your fundraiser');
		expect(message.html).toContain('<h1');
		expect(message.text).toContain('Confirm your email to publish your fundraiser');
	});

	it('names the page and the organisation, and says the link publishes it', async () => {
		const message = await rendered();
		for (const arm of [message.text, message.html]) {
			expect(arm).toContain(
				`Open the link below to publish Keep the pantry trucks running this winter, your fundraiser for ${ORG}, and to manage it.`
			);
		}
	});

	it('carries the expiry and the closing in both arms', async () => {
		const message = await rendered();
		for (const arm of [message.text, message.html]) {
			expect(arm).toContain(EXPIRY);
			expect(arm).toContain(
				'If you didn’t start a fundraiser, ignore this message. Nothing is published until the link is opened.'
			);
		}
	});

	// the link is its own text as well as its href, so a stripper that printed `text [href]` would
	// hand the supporter the same token twice.
	it('prints the link once in the plain-text arm, and as its own text in the HTML arm', async () => {
		const message = await rendered();
		expect(message.text.split(LINK).length - 1).toBe(1);
		expect(message.html).toContain(`href="${LINK}"`);
		expect(message.html).toContain(`>${LINK}</a>`);
	});

	// a page title is the supporter's own typing, and it reaches the HTML arm escaped.
	it('escapes the page title in the HTML arm', async () => {
		const message = await rendered({ arm: { kind: 'first', pageTitle: 'Soup & <b>bread</b>' } });
		expect(message.html).toContain('Soup &amp; &lt;b&gt;bread&lt;/b&gt;');
		expect(message.html).not.toContain('<b>bread</b>');
	});
});

describe('supporterSignIn.template, returning', () => {
	const returning = { arm: { kind: 'returning' } } as const;

	it('names the organisation in the subject and the heading', async () => {
		const message = await rendered(returning);
		expect(message.subject).toBe(`Your sign-in link for ${ORG} fundraisers`);
		expect(message.text).toContain(`Your sign-in link for ${ORG} fundraisers`);
	});

	it('says the link manages their fundraisers, with the same expiry and its own closing', async () => {
		const message = await rendered(returning);
		for (const arm of [message.text, message.html]) {
			expect(arm).toContain(`Open the link below to manage your fundraisers for ${ORG}.`);
			expect(arm).toContain(EXPIRY);
			expect(arm).toContain(
				'If you didn’t ask for this, ignore this message. Nobody can sign in without the link.'
			);
			expect(arm).not.toContain('publish');
		}
	});

	it('prints the link once in the plain-text arm', async () => {
		const message = await rendered(returning);
		expect(message.text.split(LINK).length - 1).toBe(1);
		expect(message.html).toContain(`href="${LINK}"`);
	});
});
