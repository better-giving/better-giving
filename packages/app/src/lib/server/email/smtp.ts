// type-only, and that is why it is allowed to be static — it is erased at compile time and
// loads nothing. the value side of this package is imported dynamically, inside `send`; see
// the note below.
import type { AuthType, LogLevel } from 'worker-mailer';
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
// ---------------------------------------------------------------------------
// `worker-mailer` is imported dynamically, inside `send`, and a static import breaks the
// build. do not hoist it.
//
// it imports `cloudflare:sockets` at module scope, and that module exists only inside
// workerd. `vite build` renders chunks by loading every route module in node to read its
// `prerender`/`ssr` exports — so a static import here reaches a route, reaches node, and the
// build dies with `Cannot find module 'cloudflare:sockets'` (node resolves the package's CJS
// `main`, which `require`s it). nothing at commit time builds, so a hoisted import passes
// `lint`, `check` and the suite untouched and is not found until `deploy` runs — its first
// step, so nothing irreversible has happened, but the person holding it is the one deploying
// rather than the one who wrote it.
//
// the dynamic form costs nothing and buys two things beyond the build: the socket module is
// never loaded on a deployment that has not configured mail, or on any request that does not
// send one; and this file and ./factory.ts stay importable under plain node, so their specs run
// in the fast pool like everything else that is not a database test.
//
// the import is also injectable, and the two choices are independent. `load` below defaults
// to that dynamic import and is never passed in production. it exists because a transport
// constructed inside its own `send` cannot be handed a failing one, and this app's most
// load-bearing promise — `send` never throws — is only assertable against a client that
// throws. see ./smtp.spec.ts.
// ---------------------------------------------------------------------------
//
// why `worker-mailer` and not a vendor SDK. CLAUDE.md's boundary is that email goes through
// this port and SMTP is the interface — never a vendor SDK. `worker-mailer` is a protocol
// client, not a vendor: it speaks RFC 5321 to whatever host `SMTP_HOST` names, so Resend,
// SES, Mailgun, a university's Exchange server and a self-hosted Postfix are one code path
// with one credential shape. it is also the only shape that can work here: `cloudflare:sockets`
// is the only outbound TCP a Worker has, so the client has to be one built against it.
//
// one connection per send, torn down after. `WorkerMailer.connect()` would hold a session
// open for several messages, and there is nothing here to hold it for: a Worker isolate is
// not a place to keep state between requests (CLAUDE.md), and a request sends one receipt.
//
// known defect in `worker-mailer@1.2.1`, re-check it on any upgrade: its `static send` is
// `const m = await connect(o); await m.send(t); await m.close()` — so when the send rejects,
// `close()` never runs and the session is left half-open at the provider until that side
// times it out. there is nothing to do about it from here short of driving `connect`/`close`
// by hand, and the blast radius is one abandoned connection per failed send on a path that
// sends one message per request. if this app ever sends in a loop, that changes.

/**
 * what a send needs: the raw `SMTP_*` variables and `MAIL_FROM`, all validated per send rather
 * than per construction — see below.
 */
export interface SmtpProviderConfig extends SmtpFields {
	/** the raw `MAIL_FROM` secret. */
	readonly from: string;
}

/** the value half of `worker-mailer`, however it is obtained. */
export type MailerModule = typeof import('worker-mailer');

/**
 * how long one read from the server may take, in ms.
 *
 * `worker-mailer@1.2.1` declares a `responseTimeoutMs` option and never reads it — it assigns
 * `this.responseTimeoutMs = options.socketTimeoutMs || 30_000`, so the per-response deadline
 * is derived from `socketTimeoutMs` too. passing `responseTimeoutMs` would look like it
 * configured something and would not. re-check on any upgrade.
 */
const RESPONSE_TIMEOUT_MS = 5_000;

/**
 * how long the whole send may take, in ms — the thing the value above does not bound.
 *
 * this is not a duplicate of `RESPONSE_TIMEOUT_MS` and the distinction is the point. that one
 * races each individual read, and a full session is roughly ten of them (greeting, EHLO, AUTH,
 * mail, RCPT, data, the body, QUIT) — so a host that answers every prompt one millisecond
 * inside the deadline holds the request open for ten times the number that looks like the
 * timeout. `await import(...)` has no deadline of its own either. this app sends from inside a
 * webhook and from inside an admin action, both of which somebody is waiting on, so the send
 * gets one wall-clock budget and the per-read value only decides how fast an idle host is
 * given up on.
 */
const SEND_DEADLINE_MS = 15_000;

/**
 * builds the SMTP provider. constructed per request from `platform.env`, never a
 * module-scope singleton (CLAUDE.md) — nothing is dialled here, so this is cheap, and the
 * socket belongs to a single `send()` call rather than to an isolate.
 *
 * the config is validated inside `send`, not here, and that is the point of the port. a
 * constructor that could fail would make every call site handle two kinds of failure — a
 * throw and a `SendResult` — and the whole contract of `EmailProvider.send` is that mail
 * has exactly one failure channel and it cannot reach the ledger. so a bad `SMTP_HOST` is a
 * `not_configured` result from the first send, in the same shape as a host that refuses the
 * password.
 *
 * `load` is a test seam and nothing else — production never passes it. it is the only way to
 * make a client that throws, and the promise this file makes is precisely about what happens
 * when one does.
 */
export function createSmtpProvider(
	config: SmtpProviderConfig,
	load: () => Promise<MailerModule> = () => import('worker-mailer')
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

			// the message is checked before the socket is opened. `worker-mailer` writes
			// `RCPT TO: <…>` and the `To:`/`Subject:` headers verbatim, so a CR/LF that reaches it
			// is a command or a header the caller did not write. see ./smtp-config.ts.
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

			try {
				// inside the `try` deliberately: a chunk that fails to load is a failure like any
				// other and must leave as a value, not as an exception on the caller's path.
				await withDeadline(async () => {
					const { LogLevel, WorkerMailer } = await load();
					await WorkerMailer.send(connectionOptions(endpoint.value, LogLevel.WARN), {
						from: from.value,
						to: to.value,
						subject: subject.value,
						// both arms, always: `worker-mailer` builds multipart/alternative when it has
						// the pair and a bare text or html part when it has one, and the port's type
						// makes having only one impossible.
						text: message.text,
						html: message.html
					});
				});
			} catch (error) {
				// the catch the whole port exists for. every failure below this line — DNS, TLS,
				// AUTH, a rejected recipient, a timeout — leaves as a value. nothing thrown by a
				// mail host may propagate into a caller that has already committed a `batch()`.
				const failure = classifySmtpFailure(error);
				return {
					ok: false,
					reason: failure.reason,
					detail: failure.detail,
					indeterminate: failure.indeterminate
				};
			}

			return { ok: true };
		}
	};
}

/**
 * one wall-clock budget over the whole send.
 *
 * it does not cancel anything, and cannot. there is no abort signal to hand `WorkerMailer`,
 * so the losing promise runs on until the isolate is torn down; what this bounds is how long
 * the caller waits, which is the thing a webhook and an admin action care about. the rejection
 * carries the word "timeout" so `classifySmtpFailure` reads it as one — including the
 * `indeterminate` flag, which is the honest answer here: the deadline can expire after data
 * was accepted just as easily as before the connection opened.
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
 * the endpoint, in `worker-mailer`'s vocabulary.
 *
 * implicit TLS, always. `secure: true` opens TLS immediately (`secureTransport: 'on'`) and the
 * library ignores `startTls` entirely in that case — which is why `startTls` is not passed at
 * all rather than pinned to `false`: passing it would read as though this call selected between
 * two modes it can safely offer, and it does not. `parseSmtpEndpoint` refuses every port but
 * 465, so nothing reaches here that could want anything else.
 *
 * `worker-mailer@1.2.1` does have a STARTTLS path, so the reason 465 is the only port is not
 * that the library cannot do 587. what it cannot do is make the upgrade mandatory:
 * `initializeSmtpSession` upgrades only
 * when `startTls && !secure && supportsStartTls`, and `supportsStartTls` is regexed out of the
 * server's plaintext EHLO reply. delete that line in flight and the condition is false, no
 * upgrade happens, and `auth()` runs anyway and puts `AUTH PLAIN <base64(user\0password)>` on
 * an unencrypted socket — a send that reports success with the credential already spent. there
 * is no option that says "STARTTLS or fail", so opportunistic is the only STARTTLS on offer,
 * and opportunistic encryption for a live provider API key is not a mode this app has. see
 * `parseSmtpEndpoint` for what refusing 587 costs (Postmark, and nothing else).
 *
 * `authType` is required and its absence is silent — without it nothing sends, on any host.
 * `worker-mailer` keeps two lists: the methods the server advertised in its EHLO reply, and
 * the ones this option names. `auth()` picks the first method present in both, and an absent
 * option is normalised to `[]` rather than to a default — so the intersection is empty and
 * every send throws `No supported auth method found.` the trigger is only that the server
 * offered AUTH at all, which every submission host on 465 does. re-check on any upgrade.
 *
 * `cram-md5` is left out on purpose, and it is not an oversight to be tidied up. the library
 * reaches it only where neither plain nor login is mutually supported, and its implementation
 * asks WebCrypto for an HMAC key with `hash: 'MD5'` — a digest workerd does not offer — so
 * naming it would not buy a host, it would only turn `No supported auth method found.` into a
 * crypto error on the same dead end.
 *
 * not exported, and ./smtp.spec.ts asserts on the object `WorkerMailer.send` is actually
 * handed. exporting it so a spec can pin `secure` and `logLevel` directly is what hides an
 * option like `authType` above: a test that reads named keys off a helper can only pin the keys
 * already in it, so the one option whose absence breaks every send is the one nothing sees.
 *
 * `logLevel` is passed in rather than read here because the enum is a runtime value and this
 * module may not load `worker-mailer` at module scope (see the top of the file). the caller
 * hands it `WARN`, and never `DEBUG`: the debug stream logs the SMTP conversation in both
 * directions, and the AUTH exchange is in that conversation — base64 is not encryption, so a
 * debug-level send writes the mail password into `wrangler tail` and into the observability
 * logs this Worker has enabled. `WARN` keeps the failures that matter and drops the
 * transcript.
 */
function connectionOptions(endpoint: SmtpEndpoint, logLevel: LogLevel) {
	return {
		host: endpoint.host,
		port: endpoint.port,
		secure: true,
		credentials: { username: endpoint.username, password: endpoint.password },
		authType: ['plain', 'login'] as AuthType[],
		logLevel,
		socketTimeoutMs: RESPONSE_TIMEOUT_MS
	};
}
