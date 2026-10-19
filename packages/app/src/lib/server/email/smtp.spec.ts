import { createTransport, type SendMailOptions, type SMTPTransportOptions } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';
import type { EmailMessage } from './provider';
import { createSmtpProvider, type MailTransport, type SmtpProviderConfig } from './smtp';

// the module that makes the promise, held to it.
//
// a transport constructed inside `send` cannot be handed a client that throws, which leaves
// ./provider.ts's rule about mail never reaching the ledger's write path as prose that nothing
// checks. `createSmtpProvider` takes its `connect` instead, so a failing transport is one argument
// away.
//
// nothing here opens a socket. every case either refuses before dialling or is handed a stub in
// place of the transport.

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

type Connect = (options: SMTPTransportOptions) => MailTransport;

/** a `connect` whose transport sends with `sendMail`, handing it the options it was opened with. */
function stubTransport(
	sendMail: (mail: SendMailOptions, options: SMTPTransportOptions) => Promise<unknown>
): Connect {
	return (options) => ({ sendMail: (mail) => sendMail(mail, options), close: () => {} });
}

/** sends through a provider whose transport is whatever the case supplies. */
async function send(connect: Connect, config = CONFIG) {
	return createSmtpProvider(config, connect).send(MESSAGE);
}

/** a nodemailer error as its SMTP connection raises one: a message, a `code`, a `command`. */
function smtpError(message: string, fields: Record<string, unknown>): Error {
	return Object.assign(new Error(message), fields);
}

describe('createSmtpProvider — nothing escapes as an exception', () => {
	/**
	 * the one rule the ledger depends on, asserted against the real transport's code path. the
	 * caller that sends a receipt has already committed a `batch()` and D1 has no way to take
	 * it back (CLAUDE.md), so every one of these has to arrive as a value.
	 */
	it.each([
		{
			label: 'the transport cannot be opened',
			connect: (() => {
				throw new Error('transport construction failed');
			}) as Connect
		},
		{
			label: 'the client throws a string',
			connect: stubTransport(() => {
				throw 'connection closed';
			})
		},
		{
			label: 'the client throws a DOMException',
			connect: stubTransport(() => {
				throw new DOMException('aborted', 'AbortError');
			})
		},
		{
			label: 'the client throws something with no message at all',
			connect: stubTransport(() => {
				throw undefined;
			})
		},
		{
			label: 'the client rejects',
			connect: stubTransport(() => Promise.reject(new Error('550 relay denied')))
		}
	])('resolves rather than throwing when $label', async ({ connect }) => {
		const result = await send(connect);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.detail.length).toBeGreaterThan(0);
	});

	it('reports a host that cannot be found as never connected', async () => {
		const result = await send(
			stubTransport(() =>
				Promise.reject(
					smtpError('getaddrinfo ENOTFOUND mail.example.org', { code: 'EDNS', command: 'CONN' })
				)
			)
		);
		if (result.ok) throw new Error('an unknown host reported a send');
		expect(result.reason).toBe('connect_failed');
		expect(result.indeterminate).toBe(false);
	});

	it('reports a refused credential as auth_failed', async () => {
		const result = await send(
			stubTransport(() =>
				Promise.reject(
					smtpError('Invalid login: 535 5.7.8 credentials invalid', {
						code: 'EAUTH',
						command: 'AUTH PLAIN',
						response: '535 5.7.8 credentials invalid',
						responseCode: 535
					})
				)
			)
		);
		if (result.ok) throw new Error('a refused credential reported a send');
		expect(result.reason).toBe('auth_failed');
	});

	it('reports a refused mailbox as one no later send to the address reaches', async () => {
		const result = await send(
			stubTransport(() =>
				Promise.reject(
					smtpError("Can't send mail - all recipients were rejected: 550 5.1.1 No such user here", {
						code: 'EENVELOPE',
						command: 'RCPT TO',
						response: '550 5.1.1 No such user here',
						responseCode: 550,
						rejected: ['donor@example.org']
					})
				)
			)
		);
		if (result.ok) throw new Error('a refused mailbox reported a send');
		expect(result.reason).toBe('rejected');
		expect(result.addressRefused).toBe(true);
	});

	it('reports a refused sender as rejected, naming MAIL_FROM', async () => {
		const result = await send(
			stubTransport(() =>
				Promise.reject(
					smtpError('Mail command failed: 553 5.7.1 sender not owned', {
						code: 'EENVELOPE',
						command: 'MAIL FROM',
						response: '553 5.7.1 sender not owned',
						responseCode: 553
					})
				)
			)
		);
		if (result.ok) throw new Error('a refused sender reported a send');
		expect(result.reason).toBe('rejected');
		expect(result.detail).toContain('MAIL_FROM');
	});

	it('reports a refused body as rejected, with nothing delivered', async () => {
		const result = await send(
			stubTransport(() =>
				Promise.reject(
					smtpError('Message failed: 550 5.7.26 DMARC policy', {
						code: 'EMESSAGE',
						command: 'DATA',
						response: '550 5.7.26 DMARC policy',
						responseCode: 550
					})
				)
			)
		);
		if (result.ok) throw new Error('a refused body reported a send');
		expect(result.reason).toBe('rejected');
		expect(result.indeterminate).toBe(false);
	});

	it('reports a successful send as `ok` and nothing else', async () => {
		expect(await send(stubTransport(async () => ({})))).toEqual({ ok: true });
	});

	it('closes the transport once the send is over, whichever way it went', async () => {
		const close = vi.fn();
		const failing: Connect = () => ({
			sendMail: () => Promise.reject(new Error('550 relay denied')),
			close
		});
		await send(failing);
		expect(close).toHaveBeenCalledOnce();
	});
});

describe('createSmtpProvider — what it refuses before dialling', () => {
	/** a `connect` that fails the test if it is ever reached. */
	const neverConnects: Connect = () => {
		throw new Error('a transport was opened for a message that should have been refused');
	};

	it.each([
		{ label: 'no host', config: { ...CONFIG, host: undefined } },
		{ label: 'no password', config: { ...CONFIG, password: undefined } },
		{ label: 'port 587', config: { ...CONFIG, port: '587' } },
		{ label: 'port 25', config: { ...CONFIG, port: '25' } },
		{ label: 'a port that is not a number', config: { ...CONFIG, port: 'submission' } },
		{ label: 'an unreachable host', config: { ...CONFIG, host: '127.1' } },
		{ label: 'a From with a display name', config: { ...CONFIG, from: 'Hope <a@b.org>' } }
	])('refuses $label as not_configured, without opening a transport', async ({ config }) => {
		const result = await send(neverConnects, config);
		if (result.ok) throw new Error('a bad configuration reported a send');
		expect(result.reason).toBe('not_configured');
		expect(result.indeterminate).toBe(false);
	});

	/**
	 * the message is checked before the socket, and it is its own reason. a CR/LF that reaches an
	 * SMTP exchange is a command or a header the caller never wrote — and it is not the operator's
	 * settings, so calling it `not_configured` would send them to edit a secret that is fine.
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
	])('refuses $label as invalid_message, without opening a transport', async ({ message }) => {
		const result = await createSmtpProvider(CONFIG, neverConnects).send(message);
		if (result.ok) throw new Error('an unsafe message reported a send');
		expect(result.reason).toBe('invalid_message');
		expect(result.indeterminate).toBe(false);
	});
});

describe('createSmtpProvider — the deadline', () => {
	/**
	 * `socketTimeout` bounds one idle stretch, not the session. a full exchange is roughly ten reads,
	 * so a host that answers each one just inside the per-read deadline holds the request open
	 * for ten times the number that looks like the timeout — inside a webhook or an admin
	 * action somebody is waiting on. this is the bound on the whole thing.
	 */
	it('gives up on a transport that never resolves, and says the outcome is unknown', async () => {
		vi.useFakeTimers();
		try {
			const pending = send(stubTransport(() => new Promise<void>(() => {})));
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
});

describe('createSmtpProvider — the options the transport is actually opened with', () => {
	/**
	 * read off the object `connect` is handed, not off a helper's return value: a spec that names
	 * keys on a helper can only pin the keys that are already there. the assertions below run
	 * through the production path, so an option that disappears takes one of them with it.
	 */
	async function optionsFor(config = CONFIG): Promise<SMTPTransportOptions> {
		let captured: SMTPTransportOptions | undefined;
		const result = await send(
			stubTransport(async (_mail, options) => {
				captured = options;
			}),
			config
		);
		if (!result.ok) throw new Error(`the send never reached the transport: ${result.detail}`);
		if (captured === undefined) throw new Error('the transport was never opened');
		return captured;
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
	it('hands the credential to the transport exactly as it was configured', async () => {
		const username = 'postmaster@example.org';
		const password = 'p@ss:w/rd#1%20 plus a space';
		const options = await optionsFor({ ...CONFIG, username, password });
		expect(options.auth).toEqual({ user: username, pass: password });
	});

	// the host and the default port travel the same way — nothing rewrites either.
	it('dials the configured host on 465 when no port is set', async () => {
		const options = await optionsFor();
		expect(options.host).toBe('mail.example.org');
		expect(options.port).toBe(465);
	});

	/**
	 * `secure: true` is implicit TLS — encrypted from the first byte, so the credential never
	 * crosses a plaintext socket. nothing asks for STARTTLS, and nothing may skip the certificate
	 * check.
	 */
	it('always asks for implicit TLS on 465 and never a STARTTLS path', async () => {
		const options = await optionsFor({ ...CONFIG, port: '465' });
		expect(options.secure).toBe(true);
		expect(options.port).toBe(465);
		expect(options.requireTLS).toBeUndefined();
		expect(options.ignoreTLS).toBeUndefined();
		expect(options.tls).toBeUndefined();
	});

	/**
	 * no transcript. nodemailer's debug stream logs the SMTP conversation in both directions and
	 * the AUTH exchange is in that conversation — base64 is not encryption, so a debug-level send
	 * writes the mail password into the server's logs.
	 */
	it('logs nothing of the SMTP conversation', async () => {
		const options = await optionsFor();
		expect(options.logger).toBe(false);
		expect(options.debug).toBe(false);
	});

	// bounded, and shorter than the library's own defaults: this runs inside a request.
	it('bounds each wait', async () => {
		const options = await optionsFor();
		for (const timeout of [
			options.connectionTimeout,
			options.greetingTimeout,
			options.socketTimeout
		]) {
			expect(timeout).toBeLessThanOrEqual(10_000);
		}
	});
});

describe('createSmtpProvider — the subject the message is sent with', () => {
	/**
	 * the `Subject:` header as nodemailer writes it onto the wire, rendered by its own composer
	 * from the message the provider handed the transport.
	 */
	async function subjectHeaderFor(subject: string): Promise<string> {
		let mail: SendMailOptions | undefined;
		const result = await createSmtpProvider(
			CONFIG,
			stubTransport(async (sent) => {
				mail = sent;
			})
		).send({ ...MESSAGE, subject });
		if (!result.ok || mail === undefined) throw new Error('the send never reached the transport');

		const rendered = await createTransport({ streamTransport: true, buffer: true }).sendMail(mail);
		const head = (rendered.message as Buffer).toString('utf8').split('\r\n\r\n')[0] ?? '';
		const found = /^Subject: .*(?:\r\n[ \t].*)*/m.exec(head);
		if (found === null) throw new Error('the rendered message carries no subject');
		return found[0];
	}

	/**
	 * the value of a header, every RFC 2047 encoded-word decoded on its own with a fatal decoder —
	 * so a word that ends inside a multi-byte sequence throws rather than decoding to a
	 * replacement character. folding whitespace between two encoded-words is dropped, as a reader
	 * drops it.
	 */
	function decode(header: string): string {
		const value = header.slice('Subject: '.length).replace(/\r\n([ \t])/g, '$1');
		const fatal = new TextDecoder('utf-8', { fatal: true });
		return value
			.replace(/(\?=)\s+(=\?)/g, '$1$2')
			.replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=/gi, (_, kind: string, text: string) => {
				const bytes =
					kind.toUpperCase() === 'B'
						? Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
						: Uint8Array.from(
								text
									.replace(/_/g, ' ')
									.replace(/=([0-9A-F]{2})/gi, (_m, hex: string) =>
										String.fromCharCode(Number.parseInt(hex, 16))
									),
								(c) => c.charCodeAt(0)
							);
				return fatal.decode(bytes);
			});
	}

	it('sends an ASCII subject as it is', async () => {
		expect(await subjectHeaderFor('Your donation receipt from Hope Fund')).toBe(
			'Subject: Your donation receipt from Hope Fund'
		);
	});

	// RFC 2047 §2 caps an encoded-word at 75 characters.
	it('encodes a non-ASCII subject as encoded-words of at most 75 characters that decode back', async () => {
		const subject = 'Your donation receipt from Fundación Niños del Perú';
		const header = await subjectHeaderFor(subject);
		for (const word of header.match(/=\?[^?]+\?[BQ]\?[^?]*\?=/gi) ?? []) {
			expect(word.length).toBeLessThanOrEqual(75);
		}
		expect(decode(header)).toBe(subject);
	});

	// RFC 2047 §2 caps a line holding an encoded-word at 76 characters, which also keeps every line
	// inside RFC 5322's 998. 400 CJK characters are 1,200 bytes, so this subject left unfolded would
	// pass both.
	it('folds a long non-ASCII subject so no line passes 76, `Subject: ` included', async () => {
		const subject = `A gift was made in memory of ${'山田太郎の思い出に'.repeat(45).slice(0, 400)}`;
		const header = await subjectHeaderFor(subject);
		const lines = header.split('\r\n');
		expect(lines.length).toBeGreaterThan(1);
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(76);
		expect(decode(header)).toBe(subject);
	});

	// four-byte characters: a split inside one is what the fatal decoder exists to catch.
	it('splits only between characters, never inside one', async () => {
		const subject = '🎁'.repeat(40);
		expect(decode(await subjectHeaderFor(subject))).toBe(subject);
	});
});
