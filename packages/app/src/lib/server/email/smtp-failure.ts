import type { SendFailureReason } from './provider';

// turning whatever came out of the SMTP client into one of the port's reasons.
//
// split from ./smtp.ts so it is testable without a server: classification is a pure
// function of a thrown value, and the cases worth pinning — an auth rejection is not a
// connect failure, a blocked port is not a network outage — are exactly the ones that are
// impossible to produce on demand from a real host.
//
// it matches on message text, which is a deliberate piece of fragility and is why the
// default is the one that matters. `worker-mailer` throws plain `Error`s with no code, no
// class and no SMTP reply code attached, and the socket errors underneath it come from
// workerd as plain `Error`s too — so there is nothing structural to read. every pattern
// below is therefore a best effort that can go stale on an upgrade, and the fallback is
// `rejected` with the original message carried through verbatim: a misclassified failure
// still tells an operator what the server said, which is the part that gets it fixed.
//
// this is the same discipline as CONTRIBUTING.md's "assert the extended result code's name,
// never the prose" — applied where there is no code to assert, so the prose is quoted rather
// than interpreted.

export interface SmtpFailure {
	readonly reason: SendFailureReason;
	readonly detail: string;
	/** see `SendResult` — whether the message may have been delivered anyway. */
	readonly indeterminate: boolean;
}

/**
 * the platform refusing the connection outright. checked first because these messages also
 * contain the words the connect patterns match, and "Cloudflare will never allow this" is a
 * different instruction from "the host was unreachable just now".
 *
 * it cannot fire today, and is kept as a backstop. Cloudflare's refusal is about port 25, and
 * `parseSmtpEndpoint` refuses port 25 before a socket exists — so nothing dials it and the platform
 * never gets to say so. this arm is what would catch it if that parser were ever loosened.
 *
 * anchored on the platform's own shape, never a bare `prohibited`: `550 5.7.1 Relaying
 * prohibited` is a host refusing a message over a connection that works, so matching that word
 * alone answers it with "use port 465" — advice the operator has already taken, pointing at the
 * one setting that is right.
 */
const NOT_CONFIGURED = /connections? to port 25|port 25 (?:is|are) prohibited/i;

/**
 * the credential was refused. checked before the connect patterns because
 * `worker-mailer` phrases these as `Failed to plain authentication: …` — the word "failed"
 * is shared with everything else it throws, and "authentication" is not.
 *
 * not a bare `/auth/`, which is the obvious shortening and is wrong: `550 5.7.1 Sender
 * address not authorised` is a rejected message with a correct credential behind it, and
 * telling the operator to check the password sends them to fix the one thing that works.
 *
 * and not a bare `/authentication/` either, which is the same mistake one step in:
 * `550 5.7.1 … DMARC authentication failure` is a message the host refused
 * over the sending domain's DNS records, with a working password on the connection that
 * carried it — so it too sends the operator to rotate the one secret that is fine. the
 * alternatives below are the phrases that mean a credential and nothing else: the four
 * `worker-mailer` throws itself, the enhanced status code RFC 4954 reserves for a bad
 * credential, and the wordings the large hosts put after the reply code. anything vaguer
 * belongs to `rejected`, whose sentence — a MAIL_FROM the host will not send as — is already
 * the right advice for a DMARC refusal.
 */
const AUTH_FAILED =
	/failed to (?:plain|login) authentication|invalid login|no supported auth method|requires authentication|authentication (?:failed|unsuccessful|rejected)|username and password not accepted|\b5\.7\.8\b/i;

/**
 * nothing to talk to, or the conversation never got started: DNS, the socket, the TLS
 * upgrade, the greeting, a timeout. all one answer to an operator — the host in SMTP_HOST did
 * not answer — and all transient, unlike the two above.
 */
const CONNECT_FAILED =
	/failed to connect|cannot connect|proxy request failed|timeout|timed out|socket|start tls|ehlo|helo|network|dns|shutting down/i;

/**
 * the failure names the connection attempt, which is the only evidence this classifier has
 * that nothing was handed over.
 *
 * a positive signal, not the absence of one — that is the whole point of a second pattern.
 * non-delivery is not everything on `CONNECT_FAILED` that is not a timeout: `socket`, `network`
 * and `shutting down` are all on that arm, and workerd dropping the connection while the reply
 * to data is being read produces one of those, with the host free to have queued the message.
 *
 * `failed to connect` belongs here even though the socket is open by then. `worker-mailer`
 * throws it out of `greet()`, when the server's opening line is not a 220 — no message has
 * been offered at that point, so "nothing was delivered" is still a claim about the session
 * rather than a guess.
 */
const NEVER_CONNECTED =
	/failed to connect|cannot connect|proxy request failed|getaddrinfo|\bdns\b/i;

/**
 * a timeout is not proof of non-delivery, which is the one thing this classifier must not
 * claim: a read that never returns can equally be a host that took the whole message, queued
 * it, and then went quiet before saying so.
 *
 * it is not the only way a failure is indeterminate. the connect arm carries every mid-session
 * socket break as well, so a failure there is indeterminate unless the text names the
 * connection attempt itself; see `NEVER_CONNECTED` for what that arm claims.
 *
 * matched across every arm rather than inside the connect arm, because which reason a timeout
 * lands under is a question about what to tell the operator, and whether the message might be
 * out there is a different question with a different consumer — `indeterminate` in
 * ./provider.ts, read by whoever decides whether a resend would duplicate.
 */
const INDETERMINATE = /timeout|timed out/i;

/**
 * maps a thrown value onto a reason and a message an operator can act on.
 *
 * total over `unknown`, because that is what a `catch` binds and because a transport can
 * throw a string, a `DOMException` or nothing recognisable at all. a value that is not an
 * `Error` is still reported with its own text rather than as `[object Object]`.
 */
export function classifySmtpFailure(error: unknown): SmtpFailure {
	const message = messageOf(error);
	const indeterminate = INDETERMINATE.test(message);

	if (NOT_CONFIGURED.test(message)) {
		return {
			reason: 'not_configured',
			detail:
				`The mail host refused the connection at the platform level: ${message}. ` +
				'Cloudflare Workers prohibit outbound port 25. Leave `SMTP_PORT` unset, which is 465.',
			indeterminate
		};
	}

	if (AUTH_FAILED.test(message)) {
		return {
			reason: 'auth_failed',
			detail:
				`The mail host refused the credential: ${message}. ` +
				'Check `SMTP_USERNAME` and `SMTP_PASSWORD` under SMTP on the console. For a provider ' +
				'whose credential is an API key, the key goes in `SMTP_PASSWORD`, and it is offered to ' +
				'the host exactly as you typed it, so nothing in it needs escaping.',
			indeterminate
		};
	}

	if (CONNECT_FAILED.test(message)) {
		// non-delivery is claimed only where the text names the connection attempt itself, and
		// everything else here is indeterminate whether it timed out or not. this function cannot
		// know that a message was not sent: a socket that breaks mid-session says nothing about
		// how far the session got, so "not a timeout" is not evidence that nothing was accepted.
		const neverOpened = !indeterminate && NEVER_CONNECTED.test(message);
		return {
			reason: 'connect_failed',
			detail:
				`Could not reach the mail host in \`SMTP_HOST\`: ${message}. ` +
				(neverOpened
					? 'The connection never opened, so nothing was delivered.'
					: 'The connection failed part-way through, so it is not possible to tell whether ' +
						'the host had already accepted the message. Assume it may have gone out before ' +
						'sending it again.'),
			indeterminate: !neverOpened
		};
	}

	return {
		reason: 'rejected',
		detail:
			`The mail host accepted the connection and refused the message: ${message}. ` +
			'The most common cause is a `MAIL_FROM` address the host is not authorised to send as.',
		indeterminate
	};
}

/**
 * the most useful string available, whatever was thrown.
 *
 * `String(error)` is itself a throw site, which is why it is wrapped. it invokes the value's
 * own `toString`, and `Object.create(null)` has none while a poisoned one can throw outright —
 * unwrapped, the totality this function advertises is a claim rather than a fact. it is called
 * from inside `send`'s `catch`, so a throw here escapes the one method in this app that promises
 * it cannot throw, on the path where a `batch()` has already committed.
 */
function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	try {
		return String(error);
	} catch {
		return 'an error that cannot be described (it has no usable string form)';
	}
}
