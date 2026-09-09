import { describe, expect, it, vi } from 'vitest';
import type { EmailMessage } from './provider';
import { createSmtpProvider, type MailerModule, type SmtpProviderConfig } from './smtp';

// the module that makes the promise, held to it.
//
// a `worker-mailer` constructed inside `send` cannot be handed a client that throws, which
// leaves ./provider.ts's rule about mail never reaching the ledger's write path as prose that
// nothing checks. `createSmtpProvider` takes its loader instead, so a failing transport is one
// argument away.
//
// in the node pool, and nothing here loads `worker-mailer` or opens a socket. every case
// either refuses before dialling or is handed a stub in place of the client.

const MESSAGE: EmailMessage = {
	to: 'donor@example.org',
	subject: 'Your donation receipt',
	text: 'Thank you.',
	html: '<p>Thank you.</p>'
};

const CONFIG: SmtpProviderConfig = {
	host: 'mail.example.org',
	username: 'user',
	password: 'pw',
	from: 'donations@example.org'
};

/** the two members `send` destructures, and nothing else the library exports. */
function stubMailer(send: (options: unknown, message: unknown) => Promise<void>): MailerModule {
	return {
		LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
		WorkerMailer: { send }
	} as unknown as MailerModule;
}

/** sends through a provider whose loader/transport is whatever the case supplies. */
async function send(load: () => Promise<MailerModule>, config = CONFIG) {
	return createSmtpProvider(config, load).send(MESSAGE);
}

describe('createSmtpProvider — nothing escapes as an exception', () => {
	/**
	 * the one rule the ledger depends on, asserted against the real transport's code path. the
	 * caller that sends a receipt has already committed a `batch()` and D1 has no way to take
	 * it back (CLAUDE.md), so every one of these has to arrive as a value.
	 */
	it.each([
		{
			label: 'the client fails to load',
			load: () => Promise.reject(new Error('Cannot find module cloudflare:sockets'))
		},
		{
			label: 'the client throws a string',
			load: async () =>
				stubMailer(() => {
					throw 'connection closed';
				})
		},
		{
			label: 'the client throws a DOMException',
			load: async () =>
				stubMailer(() => {
					throw new DOMException('aborted', 'AbortError');
				})
		},
		{
			label: 'the client throws something with no message at all',
			load: async () =>
				stubMailer(() => {
					throw undefined;
				})
		},
		{
			label: 'the client rejects',
			load: async () => stubMailer(() => Promise.reject(new Error('550 relay denied')))
		}
	])('resolves rather than throwing when $label', async ({ load }) => {
		const result = await send(load);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.detail.length).toBeGreaterThan(0);
	});

	// the failure a loader produces is a `connect_failed` like any other: the operator's
	// instruction is the same either way, and the classifier's fallback carries the text.
	it('reports a rejected import with the reason the classifier chose, not a special case', async () => {
		const result = await send(() => Promise.reject(new Error('Failed to connect: chunk missing')));
		if (result.ok) throw new Error('a failed import reported a send');
		expect(result.reason).toBe('connect_failed');
	});

	it('reports a refused credential as auth_failed', async () => {
		const result = await send(async () =>
			stubMailer(() =>
				Promise.reject(new Error('Failed to plain authentication: 535 credentials invalid'))
			)
		);
		if (result.ok) throw new Error('a refused credential reported a send');
		expect(result.reason).toBe('auth_failed');
	});

	it('reports a successful send as `ok` and nothing else', async () => {
		expect(await send(async () => stubMailer(async () => {}))).toEqual({ ok: true });
	});
});

describe('createSmtpProvider — what it refuses before dialling', () => {
	/** a loader that fails the test if it is ever reached. */
	const neverLoads = () => {
		throw new Error('the transport was loaded for a message that should have been refused');
	};

	it.each([
		{ label: 'no host', config: { ...CONFIG, host: undefined } },
		{ label: 'no password', config: { ...CONFIG, password: undefined } },
		{ label: 'port 587', config: { ...CONFIG, port: '587' } },
		{ label: 'a port that is not a number', config: { ...CONFIG, port: 'submission' } },
		{ label: 'an unreachable host', config: { ...CONFIG, host: '127.1' } },
		{ label: 'a From with a display name', config: { ...CONFIG, from: 'Hope <a@b.org>' } }
	])('refuses $label as not_configured, without loading the client', async ({ config }) => {
		const result = await send(neverLoads, config);
		if (result.ok) throw new Error('a bad configuration reported a send');
		expect(result.reason).toBe('not_configured');
		expect(result.indeterminate).toBe(false);
	});

	/**
	 * the message is checked before the socket, and it is its own reason. `worker-mailer`
	 * writes `RCPT TO: <…>` and the headers verbatim, so a CR/LF that reaches it is a command
	 * the caller never wrote — and it is not the operator's settings, so calling it
	 * `not_configured` would send them to edit a secret that is fine.
	 */
	it.each([
		{
			label: 'a recipient carrying a second RCPT TO',
			message: { ...MESSAGE, to: 'donor@x.org>\r\nRCPT TO: <attacker@evil.com' }
		},
		{ label: 'a recipient that is not an address', message: { ...MESSAGE, to: 'nobody' } },
		{
			label: 'a subject carrying a header',
			message: { ...MESSAGE, subject: 'Receipt\r\nBcc: attacker@evil.com' }
		}
	])('refuses $label as invalid_message, without loading the client', async ({ message }) => {
		const result = await createSmtpProvider(CONFIG, neverLoads).send(message);
		if (result.ok) throw new Error('an unsafe message reported a send');
		expect(result.reason).toBe('invalid_message');
		expect(result.indeterminate).toBe(false);
	});
});

describe('createSmtpProvider — the deadline', () => {
	/**
	 * `socketTimeoutMs` bounds one read, not the session. a full exchange is roughly ten reads,
	 * so a host that answers each one just inside the per-read deadline holds the request open
	 * for ten times the number that looks like the timeout — inside a webhook or an admin
	 * action somebody is waiting on. this is the bound on the whole thing.
	 */
	it('gives up on a transport that never resolves, and says the outcome is unknown', async () => {
		vi.useFakeTimers();
		try {
			const pending = send(async () => stubMailer(() => new Promise<void>(() => {})));
			await vi.advanceTimersByTimeAsync(20_000);
			const result = await pending;
			if (result.ok) throw new Error('a hung transport reported a send');
			expect(result.reason).toBe('connect_failed');
			// a timeout is not proof of non-delivery. the deadline can expire after data was
			// accepted just as easily as before the connection opened.
			expect(result.indeterminate).toBe(true);
			expect(result.detail).not.toContain('nothing was delivered');
		} finally {
			vi.useRealTimers();
		}
	});

	// the deadline covers the import too, which has no timeout of its own.
	it('bounds a loader that never settles', async () => {
		vi.useFakeTimers();
		try {
			const pending = send(() => new Promise<MailerModule>(() => {}));
			await vi.advanceTimersByTimeAsync(20_000);
			expect((await pending).ok).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('createSmtpProvider — the options the client is actually handed', () => {
	/**
	 * read off the object that reaches `WorkerMailer.send`, not off a helper's return value. a
	 * block that called an exported `connectionOptions` and asserted the keys it named would let
	 * a missing `authType` sit in the one code path every send takes with nothing going red: a
	 * spec that names keys can only pin the keys that are already there. the assertions below run
	 * through the production path, so an option that disappears takes one of them with it.
	 */
	async function optionsFor(config = CONFIG): Promise<Record<string, unknown>> {
		let captured: unknown;
		const result = await send(
			async () =>
				stubMailer(async (options) => {
					captured = options;
				}),
			config
		);
		if (!result.ok) throw new Error(`the send never reached the client: ${result.detail}`);
		return captured as Record<string, unknown>;
	}

	/**
	 * the credential reaches the AUTH exchange byte for byte, and this is the assertion the
	 * split into four variables exists for.
	 *
	 * nothing parses these values, and this is what says so. put the credential back inside one
	 * connection URL's userinfo and an operator has to percent-encode any `@`, `:`, `/` or `#`
	 * and this app has to percent-decode it again — and a decode that is forgotten, doubled or
	 * applied to a literal `%` authenticates as a password nobody set, which surfaces as `535`
	 * against a credential that is correct, the least debuggable failure this app can produce.
	 */
	it('hands the credential to the client exactly as it was configured', async () => {
		const username = 'postmaster@example.org';
		const password = 'p@ss:w/rd#1%20 plus a space';
		const options = await optionsFor({ ...CONFIG, username, password });
		expect(options.credentials).toEqual({ username, password });
	});

	// the host and the default port travel the same way — nothing rewrites either.
	it('dials the configured host on 465 when no port is set', async () => {
		const options = await optionsFor();
		expect(options.host).toBe('mail.example.org');
		expect(options.port).toBe(465);
	});

	/**
	 * without this option nothing sends, on any host. `worker-mailer` authenticates only where
	 * two lists intersect — what the server advertised in its EHLO reply, and what `authType`
	 * names — and an absent option becomes `[]`, so the intersection is empty and `auth()`
	 * throws `No supported auth method found.` every submission host on 465 advertises AUTH,
	 * so that is every send.
	 */
	it('names the auth methods, without which every send fails', async () => {
		const authType = (await optionsFor()).authType;
		expect(authType).toContain('plain');
		expect(authType).toContain('login');
	});

	/**
	 * `cram-md5` is excluded deliberately. `authWithCramMD5` asks WebCrypto for an HMAC key with
	 * `hash: 'MD5'`, which workerd does not have — and the library reaches that method only when
	 * neither plain nor login is mutually supported, so naming it swaps one failure for a
	 * stranger one rather than buying a host.
	 */
	it('never offers cram-md5', async () => {
		expect((await optionsFor()).authType).not.toContain('cram-md5');
	});

	/**
	 * `secure: true` is implicit TLS — encrypted from the first byte. there is no `startTls`
	 * key at all: the library reads it only when `secure` is false, and passing it would read
	 * as though there were a mode it selects.
	 */
	it('always asks for implicit TLS and never offers a STARTTLS path', async () => {
		const options = await optionsFor();
		expect(options.secure).toBe(true);
		expect(options.port).toBe(465);
		expect('startTls' in options).toBe(false);
	});

	/**
	 * never `DEBUG`. the debug stream logs the SMTP conversation in both directions and the
	 * AUTH exchange is in that conversation — base64 is not encryption, so a debug-level send
	 * writes the mail password into `wrangler tail` and into this Worker's observability logs.
	 */
	it('runs the client at WARN and never at DEBUG', async () => {
		// LogLevel.DEBUG is 0 and LogLevel.WARN is 2 in `worker-mailer@1.2.1`, which is what the
		// stub's enum mirrors. asserted as the number because importing the real enum would load
		// `cloudflare:sockets` into the node pool.
		expect((await optionsFor()).logLevel).toBe(2);
	});

	// bounded, and shorter than the library's own 30s default: this runs inside a request.
	it('bounds each read', async () => {
		expect((await optionsFor()).socketTimeoutMs).toBeLessThanOrEqual(10_000);
	});
});
