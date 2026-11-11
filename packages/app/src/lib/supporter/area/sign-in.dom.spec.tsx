import { parseWithZod } from '@conform-to/zod/v4';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SUPPORTER_SIGN_IN_INPUT } from '$lib/supporters/input';
import { boxLabelled, mountScreen, ORG, one, submit } from './area.testing';
import { SIGN_IN_FORM } from './forms';
import { CheckEmail, type CheckEmailProps, SignIn, type SignInProps } from './sign-in';

// Check your email, the sign-in request, a link that no longer opens, and the limit reached.

const CHECK: CheckEmailProps = {
	org: ORG,
	email: 'maya@example.org',
	kind: 'start',
	differentAddressHref: '/fundraise',
	resentAt: null,
	sending: false
};

const check = (props: Partial<CheckEmailProps> = {}) =>
	mountScreen(() => <CheckEmail {...CHECK} {...props} />);

const signIn = (props: Partial<SignInProps> = {}) =>
	mountScreen(() => <SignIn org={ORG} state={{ kind: 'ask' }} sending={false} {...props} />);

const resend = (root: HTMLElement) => one<HTMLButtonElement>(root, 'button[type="submit"]');

describe('check your email', () => {
	it('puts focus on its heading when it arrives', () => {
		const { root } = check();
		const heading = one(root, 'h1');
		expect(heading.textContent).toBe('Check your email');
		expect(document.activeElement).toBe(heading);
	});

	it('names the address after a start, and says the link opens once for an hour', () => {
		const { root } = check();
		expect(one(root, 'b').textContent).toBe('maya@example.org');
		expect(root.textContent).toContain('Open it to publish your page.');
		expect(root.textContent).toContain('It works once and expires in an hour.');
		expect(one<HTMLAnchorElement>(root, 'a[href="/fundraise"]').textContent).toBe(
			'Use a different address'
		);
	});

	it('never says whether the address has a fundraiser after a sign-in request', () => {
		const { root } = check({ kind: 'sign-in', differentAddressHref: '/fundraise/sign-in' });
		expect(root.textContent).toContain(
			'If maya@example.org has a fundraiser here, a link is on its way.'
		);
		expect(root.textContent).not.toMatch(/publish/);
	});

	it('posts a resend with the address', async () => {
		const { root, posted } = check();
		expect(resend(root).textContent).toBe('Send it again');
		await submit(one<HTMLFormElement>(root, 'main form'));
		expect(posted).toHaveLength(1);
		expect(posted[0]?.get('intent')).toBe('resend');
		expect(posted[0]?.get('email')).toBe('maya@example.org');
	});

	it('closes Send it again for a minute after a resend, counting down in its label', () => {
		vi.useFakeTimers();
		try {
			const { root } = check({ resentAt: 1_000 });
			expect(resend(root).disabled).toBe(true);
			expect(resend(root).textContent).toBe('Send again in 1:00');
			expect(one(root, '[role="status"]').textContent).toBe(
				'Sent again. The newest link is the one that works.'
			);
			act(() => vi.advanceTimersByTime(18_000));
			expect(resend(root).textContent).toBe('Send again in 0:42');
			act(() => vi.advanceTimersByTime(42_000));
			expect(resend(root).disabled).toBe(false);
			expect(resend(root).textContent).toBe('Send it again');
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps its status region on the page before anything is resent', () => {
		const { root } = check({ kind: 'sign-in' });
		expect(one(root, '[role="status"]').textContent).toBe('');
	});
});

describe('the sign-in request', () => {
	it('asks for the address the page was started with', async () => {
		const { root, posted } = signIn();
		expect(one(root, 'h1').textContent).toBe('Manage your fundraisers');
		const box = boxLabelled(root, 'Email');
		expect(box.type).toBe('email');
		box.value = 'maya@example.org';
		await submit(one<HTMLFormElement>(root, `form#${SIGN_IN_FORM.id}`));
		expect(posted[0]?.get('intent')).toBe('request-link');
		expect(posted[0]?.get('email')).toBe('maya@example.org');
	});

	it('says how to write an address under a refused box', () => {
		const body = new FormData();
		body.set('email', 'maya at example.org');
		const { root } = signIn({
			lastResult: parseWithZod(body, { schema: SUPPORTER_SIGN_IN_INPUT }).reply()
		});
		const box = boxLabelled(root, 'Email');
		expect(box.getAttribute('aria-invalid')).toBe('true');
		expect(one(root, `#${box.id}-err`).textContent).toBe(
			'Enter an email address like maya@example.org.'
		);
	});

	it('meets an expired or used link with one warning and a box to ask again', () => {
		const { root } = signIn({ state: { kind: 'expired' } });
		const notice = one(root, '.ds-notice-card');
		expect(notice.className).toContain('ds-notice-card-warning');
		expect(one(notice, 'h1').textContent).toBe('That link has expired or was already used');
		expect(notice.getAttribute('role')).toBeNull();
		expect(resend(root).textContent).toBe('Send a new link');
		expect(resend(root).disabled).toBe(false);
	});

	it('meets the limit with an alert, the box kept and the press closed', () => {
		const { root } = signIn({ state: { kind: 'too-many', email: 'maya@example.org' } });
		const notice = one(root, '.ds-notice-card');
		expect(notice.className).toContain('ds-notice-card-destructive');
		expect(notice.getAttribute('role')).toBe('alert');
		expect(one(notice, 'h1').textContent).toBe('Too many tries');
		expect(boxLabelled(root, 'Email').value).toBe('maya@example.org');
		expect(resend(root).disabled).toBe(true);
	});

	it('marks the press busy while the request is in flight', () => {
		const { root } = signIn({ sending: true });
		expect(resend(root).getAttribute('aria-busy')).toBe('true');
	});
});
