import { describe, expect, it, vi } from 'vitest';
import type { EmailMessage, EmailProvider, SendResult } from './provider';
import { sendSupporterSignInEmail, type SupporterSignInInput } from './supporter-sign-in';

// that the sign-in link leaves for the address it was asked for, and that the port's answer comes
// back untouched. what the mail says is packages/emails/src/templates/supporter-sign-in.spec.tsx's.

// the lifetime links.ts enforces, moved off the hour: the mail has to follow it there.
vi.mock('../supporters/links', async (original) => ({
	...(await original<typeof import('../supporters/links')>()),
	LINK_LIFETIME_MS: 30 * 60 * 1000
}));

const LINK = 'https://give.example.org/fundraise/open?token=Hs6wP2nLq9ZbX4tYd8VkE3gR7cUa5MfJ';

/** a provider that records what it was handed and answers with `result`. */
function recording(result: SendResult = { ok: true }) {
	const sent: EmailMessage[] = [];
	const email: EmailProvider = {
		async send(message) {
			sent.push(message);
			return result;
		}
	};
	return { sent, email };
}

function input(overrides: Partial<SupporterSignInInput> = {}): SupporterSignInInput {
	return {
		to: 'maya@example.org',
		link: LINK,
		signInUrl: 'https://give.example.org/fundraise/sign-in',
		orgName: 'Harbor Light',
		arm: { kind: 'returning' },
		...overrides
	};
}

describe('sendSupporterSignInEmail', () => {
	it('sends one message, to the address it was handed, carrying the link in both arms', async () => {
		const mail = recording();
		const result = await sendSupporterSignInEmail({ email: mail.email }, input());

		expect(result).toEqual({ ok: true });
		expect(mail.sent).toHaveLength(1);
		const [message] = mail.sent;
		expect(message?.to).toBe('maya@example.org');
		expect(message?.subject).toBe('Your sign-in link for Harbor Light fundraisers');
		expect(message?.text).toContain(LINK);
		expect(message?.html).toContain(LINK);
	});

	it('sends the first-time arm, naming the page', async () => {
		const mail = recording();
		await sendSupporterSignInEmail(
			{ email: mail.email },
			input({ arm: { kind: 'first', pageTitle: 'Keep the pantry trucks running' } })
		);

		expect(mail.sent[0]?.subject).toBe('Confirm your email to publish your fundraiser');
		expect(mail.sent[0]?.text).toContain('Keep the pantry trucks running');
	});

	it('states the lifetime links.ts gives a link', async () => {
		const mail = recording();
		await sendSupporterSignInEmail({ email: mail.email }, input());

		expect(mail.sent[0]?.text).toContain('This link works once and expires in 30 minutes.');
	});

	// what a failure means for the person who asked is the caller's: the port's answer is handed back
	// as it came, so a refusal still names the value to fix.
	it('hands the port’s refusal back unchanged', async () => {
		const refusal: SendResult = {
			ok: false,
			reason: 'connect_failed',
			detail: 'SMTP_HOST could not be reached.',
			indeterminate: false
		};
		const mail = recording(refusal);

		expect(await sendSupporterSignInEmail({ email: mail.email }, input())).toEqual(refusal);
	});
});
