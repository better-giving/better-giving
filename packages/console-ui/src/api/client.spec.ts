import { describe, expect, it, vi } from 'vitest';
import {
	chariotRun,
	consoleVersion,
	levelWallets,
	startChariotSetup,
	startStripeSetup
} from './client';

// what the page does with each way the binary answers a press.
//
// every way a call did not happen that a screen has words for comes back as a value; anything else
// the local process can answer with does not, so it is thrown for the route's own error boundary to
// draw.

/** a local process answering one status and one body. */
const answering = (status: number, body: unknown) =>
	vi.stubGlobal('fetch', () =>
		Promise.resolve(new Response(JSON.stringify(body), { status, headers: {} }))
	);

/** a local process answering one body, and the call it was asked, recorded. */
const recording = (body: unknown) => {
	const calls: [path: string, init: RequestInit | undefined][] = [];
	vi.stubGlobal('fetch', (path: string, init: RequestInit | undefined) => {
		calls.push([path, init]);
		return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: {} }));
	});
	return calls;
};

describe('the release this binary was built as', () => {
	it('answers the version and the commit the binary named', async () => {
		answering(200, { version: '0.4.1', commit: '9f3c2a1d' });

		await expect(consoleVersion()).resolves.toEqual({ version: '0.4.1', commit: '9f3c2a1d' });
	});

	it('answers empty where the call was turned down', async () => {
		// nothing on the page before there is a page depends on the answer, so a refusal is a strip
		// with one end standing empty rather than a route that will not draw.
		answering(404, { error: 'no such endpoint' });

		await expect(consoleVersion()).resolves.toEqual({ version: '', commit: '' });
	});

	it('answers empty where the call did not land at all', async () => {
		vi.stubGlobal('fetch', () => Promise.reject(new Error('the console has stopped')));

		await expect(consoleVersion()).resolves.toEqual({ version: '', commit: '' });
	});

	it('answers empty for a field that came back in another shape', async () => {
		// these mirror go structs by hand (./types.ts), so a field renamed on one side arrives here
		// as something that is not a string — and the strip prints whatever this hands it.
		answering(200, { version: 41, commit: null });

		await expect(consoleVersion()).resolves.toEqual({ version: '', commit: '' });
	});
});

describe('the press that sets stripe up from the two keys', () => {
	const keys = { secret: 'sk_live_x', publishable: 'pk_live_x' };

	it('answers a run the binary started as started', async () => {
		answering(200, { run: { kind: 'running' } });

		await expect(startStripeSetup(keys)).resolves.toEqual({
			started: true,
			run: { kind: 'running' }
		});
	});

	it('answers a write the binary could not make as unwritten rather than as a run', async () => {
		// a machine holding no cloudflare sign-in gets the values door's own body back at 200, and
		// no run began, so there is nothing to poll.
		const nowhere = { kind: 'nowhere', address: { kind: 'no-credential', detail: '' } };
		answering(200, nowhere);

		await expect(startStripeSetup(keys)).resolves.toEqual({ started: false, unwritten: nowhere });
	});
});

describe('the press that sets chariot up from the key, the address and a contact email', () => {
	const boxes = { apiKey: 'ck_x', address: '', contactEmail: 'ops@example.org' };

	it('posts the three boxes to the binary and answers the run it started', async () => {
		const calls = recording({ run: { kind: 'running', stage: 'checking' } });

		await expect(startChariotSetup(boxes)).resolves.toEqual({
			started: true,
			run: { kind: 'running', stage: 'checking' }
		});
		expect(calls[0]?.[0]).toBe('/api/chariot/setup');
		expect(calls[0]?.[1]?.method).toBe('POST');
		expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual(boxes);
	});

	it('answers a run already going as not started, carrying that run', async () => {
		answering(409, { run: { kind: 'running', stage: 'finding' } });

		await expect(startChariotSetup(boxes)).resolves.toEqual({
			started: false,
			run: { kind: 'running', stage: 'finding' }
		});
	});

	it('answers boxes the door would not take as turned down', async () => {
		answering(400, { error: 'the contact email slot holds no single email address' });

		await expect(startChariotSetup(boxes)).resolves.toEqual({ started: false, turnedDown: true });
	});

	it('answers a write the binary could not make as unwritten rather than as a run', async () => {
		const nowhere = { kind: 'nowhere', address: { kind: 'no-credential', detail: '' } };
		answering(200, nowhere);

		await expect(startChariotSetup(boxes)).resolves.toEqual({ started: false, unwritten: nowhere });
	});

	it('reads the run off the binary, and null where nothing was pressed', async () => {
		const calls = recording({ run: null });

		await expect(chariotRun()).resolves.toBeNull();
		expect(calls[0]?.[0]).toBe('/api/chariot/run');
	});
});

describe('the press that registers the hostnames wallet buttons are drawn on', () => {
	it("posts to the binary with no body, because the hostnames are the deployment's own", async () => {
		// a hostname that travelled through a page would be a registration made on the operator's own
		// Stripe account against whatever the page said.
		const calls = recording({ kind: 'reported', report: { state: 'levelled', hosts: [] } });

		await levelWallets();

		expect(calls).toHaveLength(1);
		const [path, init] = calls[0] ?? [];
		expect(path).toBe('/api/deployment/wallet-domains');
		expect(init?.method).toBe('POST');
		expect(init?.body).toBeUndefined();
	});

	it('carries a levelling the deployment could not open back as a value', async () => {
		// one hostname's failure is a line on the report; this arm is the deployment saying it could
		// not read the account at all, which is a state the fold draws rather than an error.
		answering(200, {
			kind: 'reported',
			report: { state: 'unreadable', reason: 'no_key', detail: 'Set `STRIPE_SECRET_KEY`.' }
		});

		await expect(levelWallets()).resolves.toMatchObject({
			report: { state: 'unreadable', reason: 'no_key' }
		});
	});
});
