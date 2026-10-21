import { describe, expect, it, vi } from 'vitest';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import type { Auth } from './index';
import { requestPasswordReset } from './members';
import { STAFF_USER_EMAIL } from './staff-plugin';

/** an auth instance whose reset request settles only when the test says so. */
function pendingAuth() {
	let settle: (value?: unknown) => void = () => {};
	const call = vi.fn(() => new Promise((resolve) => (settle = resolve)));
	const auth = { api: { requestPasswordReset: call } } as unknown as Auth;
	return { auth, call, settle: () => settle() };
}

describe('requestPasswordReset', () => {
	it('hands the reset to deferred work and returns before it settles', async () => {
		const deferred = createDeferredWork();
		const { auth, call, settle } = pendingAuth();

		requestPasswordReset(auth, { email: 'priya@example.org' }, deferred.waitUntil);

		expect(call).toHaveBeenCalledWith({ body: { email: 'priya@example.org' } });
		expect(deferred.pending()).toBe(1);
		settle();
		await deferred.settled();
		expect(deferred.pending()).toBe(0);
	});

	it('logs a failed reset inside the work, so deferred work sees no rejection', async () => {
		const log = vi.fn();
		const deferred = createDeferredWork(log);
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const auth = {
			api: { requestPasswordReset: () => Promise.reject(new Error('no auth_verification')) }
		} as unknown as Auth;

		requestPasswordReset(auth, { email: 'priya@example.org' }, deferred.waitUntil);
		await deferred.settled();

		expect(log).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});

	it('starts no work for the deployer’s identifier or a value that is not an address', () => {
		const deferred = createDeferredWork();
		const { auth, call } = pendingAuth();

		requestPasswordReset(auth, { email: STAFF_USER_EMAIL }, deferred.waitUntil);
		requestPasswordReset(auth, { email: 'not an address' }, deferred.waitUntil);

		expect(call).not.toHaveBeenCalled();
		expect(deferred.pending()).toBe(0);
	});
});
