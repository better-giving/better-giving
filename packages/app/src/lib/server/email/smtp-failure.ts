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
	/** see `SendResult` — the host refused the recipient's mailbox itself. */
	readonly addressRefused?: true;
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
 * alternatives below are the phrases that mean a credential and nothing else: the five
 * `worker-mailer` throws itself, the enhanced status code RFC 4954 reserves for a bad
 * credential, and the wordings the large hosts put after the reply code. anything vaguer
 * belongs to `rejected`, whose sentence — a MAIL_FROM the host will not send as — is already
 * the right advice for a DMARC refusal.
 *
 * read off `ownWords`, never the host's quoted reply: a greeting or `HELO` refused with
 * "authentication failed" in its prose is a session that never reached `AUTH`. so the enhanced
 * code and the large hosts' wordings match only a message that is a bare reply, with no
 * `worker-mailer` prefix in front of it.
 */
const AUTH_FAILED =
	/failed to (?:plain|login) authentication|invalid login|no supported auth method|requires authentication|authentication (?:failed|unsuccessful|rejected)|username and password not accepted|\b5\.7\.8\b/i;

/**
 * the TLS session never came up: the host's certificate was not trusted, or the handshake broke.
 * a connect failure with its own sentence, because the fix is on the mail host rather than in
 * the network, and a determinate one, because nothing is offered before the handshake finishes.
 * read after the host-refusal arms, whose quoted reply may mention a certificate of its own.
 * `TLS peer's certificate is not trusted; reason = …` is workerd's wording.
 */
const TLS_FAILED = /certificate|\b(?:tls|ssl) handshake/i;

/**
 * the host answered a command after the greeting and refused it, which is proof both that the
 * connection worked and that this message was not taken. `worker-mailer` throws these after
 * writing `MAIL FROM`, `RCPT TO`, `DATA` or the message body and reading a reply it does not
 * accept, and appends that reply verbatim — the host's own prose, free to say `authentication`,
 * `dns`, `network` or `timeout`. so these are read before `AUTH_FAILED` and every connect pattern,
 * and never as either.
 */
const SENDER_REFUSED = /^Invalid MAIL FROM\b/i;
const RECIPIENT_REFUSED = /^Invalid RCPT TO\b:?\s*<([^>]*)>/i;
const DATA_REFUSED = /^Failed to send DATA:/i;
const BODY_REFUSED = /^Failed send email body:/i;

/**
 * which recipient refusals are about the address. `worker-mailer` writes
 * `Invalid RCPT TO: <addr>[ NOTIFY=…] <reply>`, and the reply's code is the only thing that tells
 * a mailbox the host does not have (5.1.x, 553, and 5.6.7 for a non-ASCII local part) from a host
 * declining to carry mail for this connection at all (5.7.x — relay denied, authentication
 * required), whose fix is in the settings and never in the address.
 * a 5.7.x code is read ahead of a 553 basic code, which some hosts put in front of a relay refusal.
 */
const RECIPIENT_REPLY =
	/^Invalid RCPT TO\b:?\s*<[^>]*>(?:\s+NOTIFY=\S+)?\s+(\d{3})(?:[ -](\d\.\d{1,3}\.\d{1,3})\b)?/i;
const MAILBOX_STATUS = /^(?:5\.1\.\d+|5\.6\.7)$/;
const POLICY_STATUS = /^5\.7\.\d+$/;

/**
 * `worker-mailer`'s own prefix on a message that goes on to quote the host's reply. `TLS_FAILED`,
 * the connect patterns and `INDETERMINATE` read only the prefix of such a message — the words are
 * evidence when the client or the socket wrote them, and are the host's prose after a reply code.
 */
const QUOTED_REPLY = /^(.*?[:.]) [2-5]\d\d[ -]/;

/**
 * nothing to talk to, or the conversation never got started: DNS, the socket, a STARTTLS the
 * host would not begin, the greeting, a timeout. all one answer to an operator — the host in
 * SMTP_HOST did not answer — and all transient, unlike `NOT_CONFIGURED` and `AUTH_FAILED`. a
 * certificate or handshake failure is `TLS_FAILED`'s, read ahead of this one.
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
 * rather than a guess. a refused `EHLO`, `HELO` or `STARTTLS` is the same claim one command
 * later: each comes before `MAIL FROM`.
 */
const NEVER_CONNECTED =
	/failed to connect|cannot connect|proxy request failed|getaddrinfo|\bdns\b|failed to (?:ehlo|helo)\.|failed to start tls:/i;

/**
 * a timeout is not proof of non-delivery, which is the one thing this classifier must not
 * claim: a read that never returns can equally be a host that took the whole message, queued
 * it, and then went quiet before saying so.
 *
 * it is not the only way a failure is indeterminate. the connect arm carries every mid-session
 * socket break as well, so a failure there is indeterminate unless the text names the
 * connection attempt itself; see `NEVER_CONNECTED` for what that arm claims.
 *
 * read off `ownWords` alone, so a host's reply that mentions a timeout claims nothing, and carried
 * by the platform, credential and connect arms. the host-refusal and TLS arms state
 * `indeterminate: false` outright: a host that answered with a refusal took nothing, and nothing
 * is offered before a handshake finishes. whether the message might be out there is a different
 * question from which reason it lands under, with a different consumer — `indeterminate` in
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
	const ownWords = QUOTED_REPLY.exec(message)?.[1] ?? message;
	const indeterminate = INDETERMINATE.test(ownWords);

	if (NOT_CONFIGURED.test(message)) {
		return {
			reason: 'not_configured',
			detail:
				`The mail host refused the connection at the platform level: ${message}. ` +
				'Cloudflare Workers prohibit outbound port 25. Leave `SMTP_PORT` unset, which is 465.',
			indeterminate
		};
	}

	const recipient = RECIPIENT_REFUSED.exec(message)?.[1];
	if (recipient !== undefined)
		return { reason: 'rejected', ...recipientRefusal(recipient, message) };

	if (SENDER_REFUSED.test(message)) {
		return {
			reason: 'rejected',
			detail:
				`The mail host refused the sender address: ${message}. ` +
				'The most common cause is a `MAIL_FROM` address the host is not authorised to send as.',
			indeterminate: false
		};
	}

	if (DATA_REFUSED.test(message)) {
		return {
			reason: 'rejected',
			detail:
				`The mail host refused to take the message before any of it was sent, so nothing was delivered: ${message}. ` +
				"The host's reply says why.",
			indeterminate: false
		};
	}

	if (BODY_REFUSED.test(message)) {
		return {
			reason: 'rejected',
			detail:
				`The mail host received the message and refused it, so nothing was delivered: ${message}. ` +
				"The host's reply says why. A refusal over SPF, DKIM or DMARC is fixed in the DNS " +
				'records of the domain in `MAIL_FROM`.',
			indeterminate: false
		};
	}

	if (AUTH_FAILED.test(ownWords)) {
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

	if (TLS_FAILED.test(ownWords)) {
		return {
			reason: 'connect_failed',
			detail:
				`Could not open a secure connection to the mail host in \`SMTP_HOST\`: ${message}. ` +
				'The connection never opened, so nothing was delivered. The certificate the host ' +
				'presents must be in date, issued for the name in `SMTP_HOST` and signed by a public ' +
				'authority; a self-signed certificate is refused.',
			indeterminate: false
		};
	}

	if (CONNECT_FAILED.test(ownWords)) {
		// non-delivery is claimed only where the text names the connection attempt itself, and
		// everything else here is indeterminate whether it timed out or not. this function cannot
		// know that a message was not sent: a socket that breaks mid-session says nothing about
		// how far the session got, so "not a timeout" is not evidence that nothing was accepted.
		const neverOpened = !indeterminate && NEVER_CONNECTED.test(ownWords);
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

function recipientRefusal(
	recipient: string,
	message: string
): Pick<SmtpFailure, 'detail' | 'indeterminate' | 'addressRefused'> {
	const refused = `The mail host refused the recipient ${recipient}: ${message}. `;
	const [, basic, enhanced] = RECIPIENT_REPLY.exec(message) ?? [];
	if (enhanced !== undefined && POLICY_STATUS.test(enhanced)) {
		return {
			detail:
				refused +
				'The host will not carry mail to this address for this connection, so the address is ' +
				'not what is wrong. Check that `SMTP_USERNAME` and `SMTP_PASSWORD` are set under SMTP on ' +
				'the console, and that `MAIL_FROM` is an address that login may send as.',
			indeterminate: false
		};
	}
	if ((enhanced !== undefined && MAILBOX_STATUS.test(enhanced)) || basic === '553') {
		return {
			detail:
				refused +
				'Check that the address is spelled right and still exists. Many hosts refuse an address ' +
				'with accented or non-Latin letters before the @ when this deployment sends to it. ' +
				'Nothing in the mail settings needs changing for this.',
			indeterminate: false,
			addressRefused: true
		};
	}
	return { detail: `${refused}The host's reply says why.`, indeterminate: false };
}

/**
 * the most useful string available, whatever was thrown.
 *
 * `String(error)` is itself a throw site, which is why it is wrapped. it invokes the value's
 * own `toString`, and `Object.create(null)` has none while a poisoned one can throw outright —
 * unwrapped, the totality this function advertises is a claim rather than a fact. it is called
 * from inside `send`'s `catch`, so a throw here escapes the one method in this app that promises
 * it cannot throw, on the path where a `batch()` has already committed.
 *
 * trimmed at the end because `worker-mailer` quotes a host's reply with the CRLF that ended it,
 * which would otherwise land between the quote and the sentence after it.
 */
function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message.trimEnd();
	if (typeof error === 'string') return error.trimEnd();
	try {
		return String(error);
	} catch {
		return 'an error that cannot be described (it has no usable string form)';
	}
}
