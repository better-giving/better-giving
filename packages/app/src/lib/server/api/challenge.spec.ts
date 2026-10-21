import { describe, expect, it, vi } from 'vitest';
import type { Altcha } from './altcha';
import { type ChallengeCheck, challengeKind, verifyChallenge } from './challenge';

function check(over: Partial<ChallengeCheck> = {}): ChallengeCheck {
	return {
		secretKey: undefined,
		siteKey: undefined,
		token: 'turnstile-token',
		altchaPayload: 'altcha-payload',
		allowedHostnames: ['donate.example.org'],
		request: new Request('https://donate.example.org/api/v1/forms/f/donations'),
		...over
	};
}

function altchaStub(): Altcha & { verify: ReturnType<typeof vi.fn> } {
	return {
		challenge: vi.fn(),
		verify: vi.fn(async () => ({ ok: true }) as const)
	};
}

describe('challengeKind', () => {
	it('is Turnstile where both keys are set', () => {
		expect(challengeKind({ TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' })).toBe(
			'turnstile'
		);
	});

	it.each([
		['neither key', {}],
		['the sitekey alone', { TURNSTILE_SITE_KEY: 'site' }],
		['the secret alone', { TURNSTILE_SECRET_KEY: 'secret' }],
		['blank keys', { TURNSTILE_SITE_KEY: ' ', TURNSTILE_SECRET_KEY: ' ' }]
	])('is ALTCHA with %s', (_, env) => {
		expect(challengeKind(env)).toBe('altcha');
	});
});

describe('verifyChallenge', () => {
	it('asks Turnstile, and not ALTCHA, where both keys are set', async () => {
		const altcha = altchaStub();
		const turnstile = vi.fn(async () => ({ ok: true }) as const);
		const submitted = check({ siteKey: 'site', secretKey: 'secret' });

		expect(await verifyChallenge(submitted, altcha, turnstile)).toEqual({ ok: true });
		expect(turnstile).toHaveBeenCalledWith(submitted);
		expect(altcha.verify).not.toHaveBeenCalled();
	});

	it('asks ALTCHA for the payload where the pair is not set', async () => {
		const altcha = altchaStub();
		const turnstile = vi.fn();

		expect(await verifyChallenge(check({ siteKey: 'site' }), altcha, turnstile)).toEqual({
			ok: true
		});
		expect(altcha.verify).toHaveBeenCalledWith('altcha-payload');
		expect(turnstile).not.toHaveBeenCalled();
	});
});
