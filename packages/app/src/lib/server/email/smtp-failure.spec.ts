import { describe, expect, it } from 'vitest';
import { classifySmtpFailure } from './smtp-failure';

// the messages below are the literal strings `worker-mailer@1.2.1` throws, plus the two
// workerd raises for a connection the platform will not make. they are transcribed rather
// than provoked: producing a real auth rejection or a real blocked port from a test would
// mean opening a socket, which no test here does.

describe('classifySmtpFailure', () => {
	/**
	 * the platform refusal is checked first and is `not_configured`, not `connect_failed`.
	 * "Cloudflare will never allow this" and "the host did not answer just now" are different
	 * instructions to the person reading the message: one is a settings edit, the other is
	 * waiting.
	 *
	 * nothing can produce this string today and the case is here to pin a backstop rather than a
	 * live path: `parseSmtpEndpoint` refuses port 25 before a socket exists, so Cloudflare never gets
	 * to say so. the reachable half of this arm is the case below it.
	 */
	it('reads a prohibited port as a misconfiguration, not an outage', () => {
		const failure = classifySmtpFailure(
			new Error('Failed to connect to SMTP server: Connections to port 25 are prohibited')
		);
		expect(failure.reason).toBe('not_configured');
		// 465 and nothing else — 587 is refused by `parseSmtpEndpoint` too, so pointing an operator
		// at it here would send them from one refusal to another.
		expect(failure.detail).toContain('465');
		expect(failure.detail).not.toContain('587');
	});

	/**
	 * and the one that can actually happen: a server's own prose must not reach that arm. a
	 * pattern as loose as `/port 25|prohibited/i` reads `550 5.7.1 Relaying prohibited` — a host
	 * refusing a message on a connection that is working perfectly — as a settings problem, and
	 * tells the operator to move to port 465, which is the port they are already on.
	 */
	it.each(['550 5.7.1 Relaying prohibited', '554 5.7.1 Relay access denied'])(
		'does not read %j as a platform refusal',
		(message) => {
			expect(classifySmtpFailure(new Error(message)).reason).not.toBe('not_configured');
		}
	);

	// the credential was refused. classified ahead of the connect patterns because the
	// library phrases these as `Failed to … authentication`, and the word "failed" is shared
	// with everything else it throws while "auth" is not.
	it.each([
		'Failed to plain authentication: 535 5.7.8 Authentication credentials invalid',
		'Failed to login authentication: 535 Incorrect authentication data',
		'Invalid login: 534 5.7.9 Application-specific password required',
		'smtp server requires authentication, but no credentials found',
		'No supported auth method found.',
		// and the wordings the big hosts put after the reply code, for the day the library
		// rewords its own prefixes.
		'535 5.7.8 Error: authentication failed',
		'535 5.7.3 Authentication unsuccessful',
		'534-5.7.9 Username and Password not accepted'
	])('reads %j as auth_failed', (message) => {
		expect(classifySmtpFailure(new Error(message)).reason).toBe('auth_failed');
	});

	/**
	 * a rejected message is not a refused credential, even when the server says "authentication".
	 * DMARC failures are about the sending domain's DNS records and arrive on a connection whose
	 * password worked — a pattern as loose as a bare `/authentication/` reads these as
	 * `auth_failed` and sends the operator to rotate a credential that is fine. the `rejected`
	 * arm's own sentence, about a MAIL_FROM the host will not send as, is the right advice here.
	 */
	it.each([
		"550 5.7.1 Unauthenticated email from example.org is not accepted due to domain's DMARC policy",
		'550-5.7.26 This message does not pass authentication checks (DMARC authentication failure)'
	])('reads %j as rejected, not as a refused credential', (message) => {
		expect(classifySmtpFailure(new Error(message)).reason).toBe('rejected');
	});

	// nothing to talk to, or the conversation never started: DNS, socket, TLS upgrade,
	// greeting, timeout. one answer to an operator, and the transient one.
	it.each([
		'Failed to connect to SMTP server: proxy request failed, cannot connect to the specified address',
		'Socket timeout!',
		'Timeout while waiting for smtp server response',
		'Failed to start TLS: connection reset',
		'Failed to EHLO. 421 Service not available'
	])('reads %j as connect_failed', (message) => {
		expect(classifySmtpFailure(new Error(message)).reason).toBe('connect_failed');
	});

	/**
	 * the default, and the one that carries the weight. there is no code, no class and no
	 * reply code on anything thrown here — only prose, which an upgrade may reword — so a
	 * pattern going stale has to degrade into something useful rather than into a lie. the
	 * unmatched case quotes the server verbatim, which is the part that gets it fixed.
	 */
	it.each([
		'Invalid MAIL FROM 550 5.7.1 Sender address not authorised',
		'Failed to send DATA: 552 Message size exceeds fixed maximum',
		'something nobody has ever seen'
	])('falls back to rejected for %j, quoting the server', (message) => {
		const failure = classifySmtpFailure(new Error(message));
		expect(failure.reason).toBe('rejected');
		expect(failure.detail).toContain(message);
	});

	/**
	 * total over `unknown`, because that is what a `catch` binds. a transport can throw a
	 * string, a `DOMException`, or something with no message at all, and a classifier that
	 * threw while classifying would put an exception right back on the path the port exists
	 * to keep clear.
	 */
	it.each([
		{ label: 'a bare string', thrown: 'connection closed' },
		{ label: 'a plain object', thrown: { code: 500 } },
		{ label: 'null', thrown: null },
		{ label: 'undefined', thrown: undefined }
	])('classifies $label without throwing', ({ thrown }) => {
		expect(() => classifySmtpFailure(thrown)).not.toThrow();
		expect(classifySmtpFailure(thrown).detail.length).toBeGreaterThan(0);
	});

	/**
	 * `String(error)` is itself a throw site, which is what would make the totality above a claim
	 * rather than a fact. it calls the value's own `toString`, and a null-prototype object has
	 * none while a poisoned one throws outright. this function runs inside `send`'s `catch`, so
	 * a throw here escapes the one method in the app that promises it cannot — on the path
	 * where a `batch()` has already committed.
	 */
	it.each([
		{ label: 'an object with no prototype', thrown: Object.create(null) as unknown },
		{
			label: 'an object whose toString throws',
			thrown: {
				toString() {
					throw new Error('nope');
				}
			}
		},
		{
			label: 'a Symbol, which String() alone would refuse to coerce implicitly',
			thrown: Symbol('boom')
		}
	])('describes $label rather than throwing while classifying', ({ thrown }) => {
		expect(() => classifySmtpFailure(thrown)).not.toThrow();
		expect(classifySmtpFailure(thrown).detail.length).toBeGreaterThan(0);
	});
});

describe('classifySmtpFailure — what may still have been delivered', () => {
	/**
	 * a timeout is not proof of non-delivery, and the detail must not claim it is: a socket that
	 * goes quiet after `DATA` was accepted leaves the message queued at the provider just as
	 * often as it leaves it nowhere, and this function cannot tell which.
	 */
	it.each([
		'Socket timeout!',
		'Timeout while waiting for smtp server response',
		'Timeout: the mail send did not finish within 15 seconds'
	])('reports %j as indeterminate', (message) => {
		const failure = classifySmtpFailure(new Error(message));
		expect(failure.indeterminate).toBe(true);
		expect(failure.detail).not.toContain('nothing was delivered');
		expect(failure.detail).not.toContain('was not sent');
	});

	/**
	 * a socket that breaks mid-session is not proof of non-delivery either, so `connect_failed`
	 * is not determinate for everything on it that is not a timeout: `socket`, `network` and
	 * `shutting down` are all on that arm, and workerd dropping the connection while the reply to
	 * the message body is being read leaves the host free to have queued it. only a failure that
	 * names the connection attempt can claim nothing went out.
	 */
	it.each([
		'Network connection lost',
		'WorkerMailer is shutting down',
		'Failed to send DATA: the socket was closed by the other end'
	])('reports %j as indeterminate', (message) => {
		const failure = classifySmtpFailure(new Error(message));
		expect(failure.indeterminate).toBe(true);
		expect(failure.detail).not.toContain('nothing was delivered');
	});

	// a connection that never opened is a different claim and is safe to make.
	it.each([
		'Failed to connect to SMTP server: proxy request failed, cannot connect to the specified address',
		'Failed to plain authentication: 535 credentials invalid',
		'Invalid MAIL FROM 550 5.7.1 Sender address not authorised'
	])('reports %j as determinate', (message) => {
		expect(classifySmtpFailure(new Error(message)).indeterminate).toBe(false);
	});

	// the honest sentence for the case it can speak to.
	it('says nothing was delivered only when the connection never opened', () => {
		expect(
			classifySmtpFailure(new Error('Failed to connect: cannot connect to the specified address'))
				.detail
		).toContain('nothing was delivered');
	});
});
