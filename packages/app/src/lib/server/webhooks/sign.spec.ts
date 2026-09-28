import { describe, expect, it } from 'vitest';
import { signedHeaders } from './sign';

// the signature against a vector the Standard Webhooks reference library signs, so a receiver's
// library verifies what this module sends. the vector is `test_sign_function` in
// https://github.com/standard-webhooks/standard-webhooks/blob/main/libraries/python/tests/test_webhooks.py.
// ./deliver.workers.spec.ts verifies a whole post against the spec's algorithm, written there
// without this module.

describe('signedHeaders()', () => {
	it('signs the reference library’s vector to the signature it expects', async () => {
		const headers = await signedHeaders({
			secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
			id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
			at: new Date(1614265330 * 1_000),
			body: '{"test": 2432232314}'
		});

		expect(headers).toEqual({
			'webhook-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
			'webhook-timestamp': '1614265330',
			'webhook-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE='
		});
	});

	it('states the time in whole seconds, dropping the milliseconds', async () => {
		const headers = await signedHeaders({
			secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
			id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
			at: new Date(1614265330 * 1_000 + 999),
			body: '{"test": 2432232314}'
		});

		expect(headers['webhook-timestamp']).toBe('1614265330');
		expect(headers['webhook-signature']).toBe('v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
	});
});
