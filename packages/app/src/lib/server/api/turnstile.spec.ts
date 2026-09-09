import { describe, expect, it, vi } from 'vitest';
import {
	SITEVERIFY_URL,
	TURNSTILE_FAILURE_REASONS,
	verifyTurnstile,
	type TurnstileCheck,
	type TurnstileFailureReason
} from './turnstile';

// what actually goes on the wire to siteverify, and how every answer it can give is classified.
//
// the seam is `fetch` rather than a wrapper around it, for the reason ../payments/stripe.spec.ts
// gives one level lower: a fake "turnstile client" would prove this module calls a method, which
// was never in doubt, while every mistake worth catching is in the request — a secret that never
// left, a token sent under the wrong parameter name, a call made at all for a token that could not
// possibly verify.

/** one request the module made, as the assertions need to read it. */
type Recorded = {
	readonly url: string;
	readonly method: string;
	readonly body: URLSearchParams;
};

/**
 * a `fetch` that answers from a script and remembers what it was asked.
 *
 * responses are consumed in order and running out is an error rather than a default, because a
 * test that made one more call than it scripted is a test whose subject did something it was not
 * asked to.
 */
function recording(responses: readonly (Response | Error)[]) {
	const remaining = [...responses];
	const calls: Recorded[] = [];
	const stub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({
			url: String(input),
			method: init?.method ?? 'GET',
			body: new URLSearchParams(String(init?.body ?? ''))
		});
		const next = remaining.shift();
		if (next === undefined) throw new Error(`unscripted request to ${String(input)}`);
		if (next instanceof Error) throw next;
		return next;
	});
	vi.stubGlobal('fetch', stub);
	return calls;
}

/** a siteverify answer, as siteverify serialises one. */
const answer = (payload: unknown, status = 200): Response =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' }
	});

/** what siteverify says about a token it honoured, on the site the fixture form allows. */
const solved = (over: Record<string, unknown> = {}) =>
	answer({ success: true, hostname: 'example.org', 'error-codes': [], ...over });

const SECRET = '0x4AAAAAAABBBBBBBBCCCCCCCCDD';
const SITE_KEY = '0x4AAAAAAABBBBBBBBCCCCCCCCEE';

/** the donor's submission, as the Worker received it. */
const submission = (headers: Record<string, string> = {}): Request =>
	new Request('https://donations.example.workers.dev/api/v1/forms/frm_x/donations', {
		method: 'POST',
		headers
	});

/** one check, with whatever this case needs replaced. */
const check = (over: Partial<TurnstileCheck> = {}): TurnstileCheck => ({
	secretKey: SECRET,
	siteKey: SITE_KEY,
	token: 'tok_from_the_widget',
	allowedHostnames: ['example.org'],
	request: submission(),
	...over
});

/** the check, required to have refused — hands back the reason, the sentence and the fix. */
async function refusal(over: Partial<TurnstileCheck> = {}) {
	const result = await verifyTurnstile(check(over));
	if (result.ok) throw new Error('expected verifyTurnstile to refuse this submission');
	return result;
}

describe('verifyTurnstile() — the request', () => {
	it('posts the secret, the token and the caller IP, form-encoded', async () => {
		const calls = recording([solved()]);

		const result = await verifyTurnstile(
			check({ request: submission({ 'cf-connecting-ip': '203.0.113.7' }) })
		);

		expect(result.ok).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(SITEVERIFY_URL);
		expect(calls[0]?.method).toBe('POST');
		expect(calls[0]?.body.get('secret')).toBe(SECRET);
		expect(calls[0]?.body.get('response')).toBe('tok_from_the_widget');
		expect(calls[0]?.body.get('remoteip')).toBe('203.0.113.7');
	});

	it('omits remoteip when the request carried no client IP', async () => {
		const calls = recording([solved()]);

		await verifyTurnstile(check());

		expect(calls[0]?.body.has('remoteip')).toBe(false);
	});

	it('omits remoteip for a present-but-empty header', async () => {
		const calls = recording([solved()]);

		await verifyTurnstile(check({ request: submission({ 'cf-connecting-ip': '' }) }));

		// `Headers.get` answers `''` rather than null for one of those, and `remoteip=` is a
		// parameter this app sent with nothing in it.
		expect(calls[0]?.body.has('remoteip')).toBe(false);
	});

	it('sends no idempotency key, so a replayed token is still refused as a duplicate', async () => {
		const calls = recording([solved()]);

		await verifyTurnstile(check());

		expect(calls[0]?.body.has('idempotency_key')).toBe(false);
	});
});

describe('verifyTurnstile() — what it refuses without calling out', () => {
	it.each([
		['a deployment holding no secret', { secretKey: undefined }],
		['a secret that is only whitespace', { secretKey: '   ' }]
	] as const)('answers misconfigured for %s', async (_label, over) => {
		const calls = recording([]);

		const result = await refusal(over);

		expect(result.reason).toBe('misconfigured');
		expect(calls).toHaveLength(0);
	});

	it.each([
		['a deployment serving no sitekey', { siteKey: undefined }],
		['a sitekey that is only whitespace', { siteKey: '   ' }]
	] as const)(
		'answers misconfigured for %s, whatever the submission carried',
		async (_label, over) => {
			const calls = recording([]);

			// the pair is one credential in two halves. without the sitekey the form served this donor
			// rendered no widget, so there is no token they could have sent and no fresh one to ask for
			// — telling them to solve another challenge would put them in a loop. it is answered before
			// the token is looked at for exactly that reason.
			const withNoToken = await refusal({ ...over, token: undefined });
			const withAToken = await refusal(over);

			expect(withNoToken.reason).toBe('misconfigured');
			expect(withAToken.reason).toBe('misconfigured');
			expect(withNoToken.operatorFix).toContain('TURNSTILE_SITE_KEY');
			expect(calls).toHaveLength(0);
		}
	);

	it.each([
		['no token', { token: undefined }],
		['a token that is only whitespace', { token: ' \t ' }],
		['a token past the documented 2048-character maximum', { token: 'x'.repeat(2049) }]
	] as const)('answers rejected for %s', async (_label, over) => {
		const calls = recording([]);

		const result = await refusal(over);

		expect(result.reason).toBe('rejected');
		expect(calls).toHaveLength(0);
	});
});

describe('verifyTurnstile() — where the challenge was solved', () => {
	it('accepts a token solved on a site the form is served from', async () => {
		recording([solved({ hostname: 'example.org' })]);

		const result = await verifyTurnstile(
			check({ allowedHostnames: ['other.test', 'example.org'] })
		);

		expect(result.ok).toBe(true);
	});

	it('compares hostnames without regard to case', async () => {
		recording([solved({ hostname: 'Example.ORG' })]);

		const result = await verifyTurnstile(check({ allowedHostnames: ['  EXAMPLE.org '] }));

		expect(result.ok).toBe(true);
	});

	it('refuses a token solved somewhere else', async () => {
		recording([solved({ hostname: 'attacker.test' })]);

		const result = await refusal({ allowedHostnames: ['example.org'] });

		// the sitekey ships in the embed and is public by construction, so anyone can render the
		// widget on a page of their own and solve it honestly. this is the one server-side signal
		// that says where they did it.
		expect(result.reason).toBe('rejected');
	});

	it('does not repeat the allowed sites back to whoever asked', async () => {
		recording([solved({ hostname: 'attacker.test' })]);

		const result = await refusal({ allowedHostnames: ['secret-staging.example.org'] });

		expect(result.detail).not.toContain('secret-staging.example.org');
	});

	it('answers unavailable when a verified token names no site at all', async () => {
		recording([answer({ success: true, 'error-codes': [] })]);

		const result = await refusal();

		// nothing to compare against is not the same as a comparison that passed.
		expect(result.reason).toBe('unavailable');
	});
});

describe('verifyTurnstile() — classifying what siteverify answers', () => {
	it.each(['invalid-input-response', 'missing-input-response', 'timeout-or-duplicate'] as const)(
		'answers rejected for %s',
		async (code) => {
			recording([answer({ success: false, 'error-codes': [code] })]);

			expect((await refusal()).reason).toBe('rejected');
		}
	);

	it.each(['invalid-input-secret', 'missing-input-secret'] as const)(
		'answers misconfigured for %s',
		async (code) => {
			recording([answer({ success: false, 'error-codes': [code] })]);

			expect((await refusal()).reason).toBe('misconfigured');
		}
	);

	it('reports the deployment first when the answer names both a secret and a token fault', async () => {
		recording([
			answer({ success: false, 'error-codes': ['invalid-input-response', 'invalid-input-secret'] })
		]);

		expect((await refusal()).reason).toBe('misconfigured');
	});

	it.each(['internal-error', 'bad-request'] as const)(
		'answers unavailable for %s',
		async (code) => {
			recording([answer({ success: false, 'error-codes': [code] })]);

			expect((await refusal()).reason).toBe('unavailable');
		}
	);

	it('answers unavailable for a refusal naming a code this app has never seen', async () => {
		recording([answer({ success: false, 'error-codes': ['some-code-minted-next-year'] })]);

		expect((await refusal()).reason).toBe('unavailable');
	});

	it('answers unavailable rather than rejected for a body with no success field', async () => {
		recording([answer({ 'error-codes': [] })]);

		// the distinction the arm exists for: an unreadable answer must never be reported as the
		// visitor's token having failed.
		expect((await refusal()).reason).toBe('unavailable');
	});

	it('does not read the string "true" as success', async () => {
		recording([answer({ success: 'true', hostname: 'example.org' })]);

		// the one case where being generous would let a submission through: only the boolean
		// passes, and anything else is an answer this app cannot read.
		expect((await refusal()).reason).toBe('unavailable');
	});

	it('answers unavailable for a JSON body that is not an object', async () => {
		recording([answer('nope')]);

		expect((await refusal()).reason).toBe('unavailable');
	});
});

describe('verifyTurnstile() — when siteverify itself does not answer', () => {
	it('answers unavailable when the connection fails', async () => {
		recording([new TypeError('network error')]);

		expect((await refusal()).reason).toBe('unavailable');
	});

	it('answers unavailable, naming the budget, when the call times out', async () => {
		const timeout = new Error('the operation was aborted due to timeout');
		timeout.name = 'TimeoutError';
		recording([timeout]);

		const result = await refusal();

		expect(result.reason).toBe('unavailable');
		expect(result.detail).toContain('5 seconds');
	});

	it('answers unavailable for a status other than 2xx', async () => {
		recording([answer({ success: true, hostname: 'example.org' }, 502)]);

		// a 200 body is not read off a 502, even one that says `success`.
		expect((await refusal()).reason).toBe('unavailable');
	});

	it('gives up on a call that never answers', async () => {
		vi.stubGlobal(
			'fetch',
			(_input: string, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
				})
		);

		// the abort signal is real rather than asserted on: nothing resolves this fetch, so the
		// only way this test finishes is the module's own timeout firing.
		expect((await refusal()).reason).toBe('unavailable');
	}, 10_000);
});

describe('verifyTurnstile() — what a failure may say, and to whom', () => {
	it('keeps the deployment’s own variables out of the field a body is built from', async () => {
		recording([answer({ success: false, 'error-codes': ['invalid-input-secret'] })]);

		const result = await refusal();

		// `detail` is the sentence an endpoint answers with. publishing an env-var name from a
		// public path would tell a stranger which knob is unset and that bot protection on a
		// payment-initiating endpoint is currently unenforced.
		expect(result.detail).not.toContain('TURNSTILE_SECRET_KEY');
		expect(result.detail).not.toContain('--var');
	});

	it('puts the variable and the command where an operator reads them', async () => {
		recording([answer({ success: false, 'error-codes': ['invalid-input-secret'] })]);

		const result = await refusal();

		expect(result.operatorFix).toContain('TURNSTILE_SECRET_KEY');
		expect(result.operatorFix).toContain('--var');
	});

	it('carries no operator fix for a refusal an operator cannot act on', async () => {
		recording([answer({ success: false, 'error-codes': ['invalid-input-response'] })]);

		expect((await refusal()).operatorFix).toBeNull();
	});

	it('never echoes the secret, whatever siteverify answers', async () => {
		recording([
			answer({ success: false, 'error-codes': ['invalid-input-secret'] }),
			answer({ success: false, 'error-codes': ['invalid-input-response'] }),
			new TypeError('connect ECONNREFUSED')
		]);

		const said: string[] = [];
		for (let i = 0; i < 3; i++) {
			const result = await refusal();
			said.push(result.detail, result.operatorFix ?? '');
		}

		expect(said).toHaveLength(6);
		for (const sentence of said) expect(sentence).not.toContain(SECRET);
	});
});

describe('TURNSTILE_FAILURE_REASONS', () => {
	it('lists exactly the reasons this module can produce', async () => {
		const produced = new Set<TurnstileFailureReason>();

		// one case per arm, driven through the module rather than asserted about it — a fourth
		// reason added to the array with nothing producing it fails here, and so does one produced
		// without being listed.
		recording([
			answer({ success: false, 'error-codes': ['invalid-input-response'] }),
			answer({ success: false, 'error-codes': ['invalid-input-secret'] }),
			answer({ success: false, 'error-codes': ['internal-error'] })
		]);
		for (let i = 0; i < 3; i++) produced.add((await refusal()).reason);

		expect([...produced].sort()).toEqual([...TURNSTILE_FAILURE_REASONS].sort());
	});
});
