import { createTransport, type SendMailOptions, type SMTPTransportOptions } from 'nodemailer';
import type { EmailMessage, EmailProvider, SendResult } from './provider';
import { classifySmtpFailure } from './smtp-failure';
import {
	parseHeaderValue,
	parseMailFrom,
	parseRecipient,
	parseSmtpEndpoint,
	type SmtpEndpoint,
	type SmtpFields
} from './smtp-config';

// the SMTP transport — the only one this app has, and the only place a socket is opened.
//
// why nodemailer and not a vendor SDK. CLAUDE.md's boundary is that email goes through this port
// and SMTP is the interface — never a vendor SDK. nodemailer's SMTP transport is a protocol client,
// not a vendor: it speaks RFC 5321 to whatever host `SMTP_HOST` names, so Resend, SES, Mailgun, a
// university's Exchange server and a self-hosted Postfix are one code path with one credential
// shape.
//
// one connection per send, torn down after: a request sends one receipt, so there is nothing to
// hold a pooled session open for.
//
// the transport is injectable. `connect` below defaults to nodemailer's `createTransport` and is
// never passed in production. it exists because this app's most load-bearing promise — `send`
// never throws — is only assertable against a transport that throws. see ./smtp.spec.ts.
//
// nodemailer's errors carry a `code` and the SMTP `command` that failed rather than the prose
// ./smtp-failure.ts reads, so `describeFailure` below renders each into that vocabulary before it
// is classified.

/**
 * what a send needs: the raw `SMTP_*` variables and `MAIL_FROM`, all validated per send rather
 * than per construction — see below.
 */
export interface SmtpProviderConfig extends SmtpFields {
	/** the raw `MAIL_FROM` secret. */
	readonly from: string;
}

/** what a send needs of a transport: one message out, then the connection shut. */
export interface MailTransport {
	sendMail(mail: SendMailOptions): Promise<unknown>;
	close(): void;
}

/** how long opening the connection, the greeting and each idle stretch may take, in ms. */
const RESPONSE_TIMEOUT_MS = 5_000;

/**
 * how long the whole send may take, in ms — the thing the value above does not bound.
 *
 * this is not a duplicate of `RESPONSE_TIMEOUT_MS` and the distinction is the point. that one
 * bounds each wait, and a full session is roughly ten of them (greeting, EHLO, AUTH, mail, RCPT,
 * data, the body, QUIT) — so a host that answers every prompt one millisecond inside the deadline
 * holds the request open for ten times the number that looks like the timeout. this app sends
 * from inside a webhook and from inside an admin action, both of which somebody is waiting on, so
 * the send gets one wall-clock budget and the per-wait value only decides how fast an idle host is
 * given up on.
 */
const SEND_DEADLINE_MS = 15_000;

/**
 * builds the SMTP provider. constructed per request from `platform.env`, never a
 * module-scope singleton (CLAUDE.md) — nothing is dialled here, so this is cheap, and the
 * socket belongs to a single `send()` call rather than to the process.
 *
 * the config is validated inside `send`, not here, and that is the point of the port. a
 * constructor that could fail would make every call site handle two kinds of failure — a
 * throw and a `SendResult` — and the whole contract of `EmailProvider.send` is that mail
 * has exactly one failure channel and it cannot reach the ledger. so a bad `SMTP_HOST` is a
 * `not_configured` result from the first send, in the same shape as a host that refuses the
 * password.
 *
 * `connect` is a test seam and nothing else — production never passes it. it is the only way to
 * make a transport that throws, and the promise this file makes is precisely about what happens
 * when one does.
 */
export function createSmtpProvider(
	config: SmtpProviderConfig,
	connect: (options: SMTPTransportOptions) => MailTransport = createTransport
): EmailProvider {
	return {
		async send(message: EmailMessage): Promise<SendResult> {
			const endpoint = parseSmtpEndpoint(config);
			if (!endpoint.ok) {
				return {
					ok: false,
					reason: 'not_configured',
					detail: endpoint.detail,
					indeterminate: false
				};
			}

			const from = parseMailFrom(config.from);
			if (!from.ok) {
				return { ok: false, reason: 'not_configured', detail: from.detail, indeterminate: false };
			}

			// the message is checked before the socket is opened: a CR/LF that reaches the SMTP
			// exchange is a command or a header the caller did not write. see ./smtp-config.ts.
			const to = parseRecipient(message.to);
			if (!to.ok) {
				return { ok: false, reason: 'invalid_message', detail: to.detail, indeterminate: false };
			}

			const subject = parseHeaderValue('subject line', message.subject);
			if (!subject.ok) {
				return {
					ok: false,
					reason: 'invalid_message',
					detail: subject.detail,
					indeterminate: false
				};
			}

			let transport: MailTransport | undefined;
			try {
				// inside the `try` deliberately: a transport that cannot be built is a failure like
				// any other and must leave as a value, not as an exception on the caller's path.
				const opened = connect(connectionOptions(endpoint.value));
				transport = opened;
				await withDeadline(() =>
					opened.sendMail({
						from: from.value,
						to: to.value,
						subject: subject.value,
						// both arms, always: multipart/alternative, and the port's type makes having
						// only one impossible.
						text: message.text,
						html: message.html
					})
				);
			} catch (error) {
				// the catch the whole port exists for. every failure below this line — DNS, TLS,
				// AUTH, a rejected recipient, a timeout — leaves as a value. nothing thrown by a
				// mail host may propagate into a caller that has already committed a `batch()`.
				return { ok: false, ...classifySmtpFailure(describeFailure(error)) };
			} finally {
				transport?.close();
			}

			return { ok: true };
		}
	};
}

/**
 * one wall-clock budget over the whole send.
 *
 * it does not cancel the send itself; the `close()` in the caller's `finally` drops the connection
 * once the caller stops waiting. what this bounds is how long the caller waits, which is the thing
 * a webhook and an admin action care about. the rejection carries the word "timeout" so
 * `classifySmtpFailure` reads it as one — including the `indeterminate` flag, which is the honest
 * answer here: the deadline can expire after data was accepted just as easily as before the
 * connection opened.
 */
async function withDeadline<T>(work: () => Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new Error(
						`Timeout: the mail send did not finish within ${SEND_DEADLINE_MS / 1000} seconds`
					)
				),
			SEND_DEADLINE_MS
		);
	});

	try {
		return await Promise.race([work(), deadline]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * the endpoint, as the transport is opened with it.
 *
 * implicit TLS, always: `secure: true` opens TLS before the first byte, with node's own
 * certificate check, so the credential never crosses a plaintext socket. `parseSmtpEndpoint`
 * refuses every port but 465, so nothing reaches here that could want anything else.
 *
 * `logger` and `debug` are off. the debug stream logs the SMTP conversation in both directions,
 * and the AUTH exchange is in that conversation — base64 is not encryption, so a debug-level send
 * writes the mail password into the server's logs.
 *
 * not exported, and ./smtp.spec.ts asserts on the object `connect` is actually handed: a test
 * that reads named keys off a helper can only pin the keys already in it.
 */
function connectionOptions(endpoint: SmtpEndpoint): SMTPTransportOptions {
	return {
		host: endpoint.host,
		port: endpoint.port,
		secure: true,
		auth: { user: endpoint.username, pass: endpoint.password },
		logger: false,
		debug: false,
		connectionTimeout: RESPONSE_TIMEOUT_MS,
		greetingTimeout: RESPONSE_TIMEOUT_MS,
		socketTimeout: RESPONSE_TIMEOUT_MS
	};
}

/** the fields of a nodemailer error `describeFailure` reads. */
interface TransportError {
	readonly message?: unknown;
	readonly code?: unknown;
	readonly command?: unknown;
	readonly response?: unknown;
	readonly recipient?: unknown;
	readonly rejected?: unknown;
}

/** what a socket error says when the connection never opened. */
const NEVER_OPENED = /\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH)\b/;

/**
 * a nodemailer failure in the words ./smtp-failure.ts classifies.
 *
 * the refusal of one SMTP command is named by the command, with the host's reply quoted after it;
 * a connection that never opened says `Failed to connect`; any other socket fault says `Socket`,
 * which reads as part-way. anything else already carries the words the classifier reads — an auth
 * refusal says "Invalid login", a TLS fault names the certificate, a timeout says "timeout" — and
 * passes through as it is.
 */
function describeFailure(error: unknown): unknown {
	if (typeof error !== 'object' || error === null) return error;
	const { message, code, command, response, recipient, rejected } = error as TransportError;
	const reply = typeof response === 'string' ? response.trim() : '';
	const said = typeof message === 'string' ? message : '';

	if (code === 'EENVELOPE' && command === 'RCPT TO') {
		const to =
			typeof recipient === 'string' ? recipient : Array.isArray(rejected) ? rejected[0] : '';
		return new Error(`Invalid RCPT TO: <${String(to ?? '')}> ${reply}`);
	}
	if (code === 'EENVELOPE' && command === 'MAIL FROM') {
		return new Error(`Invalid MAIL FROM: ${reply}`);
	}
	if (code === 'EENVELOPE' && command === 'DATA') return new Error(`Failed to send DATA: ${reply}`);
	if (code === 'EMESSAGE' && command === 'DATA') {
		return new Error(`Failed send email body: ${reply}`);
	}
	if (code === 'EDNS' || (code !== 'ETIMEDOUT' && NEVER_OPENED.test(said))) {
		return new Error(`Failed to connect: ${said}`);
	}
	if (code === 'ESOCKET' || code === 'ECONNECTION') return new Error(`Socket error: ${said}`);
	return error;
}
