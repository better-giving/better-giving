// the email port: the one interface every caller in this app sends through, and the one
// thing a transport has to implement.
//
// SMTP is the interface (CLAUDE.md). there is no `EmailProvider` per vendor — Resend,
// SendGrid, Mailgun, Amazon SES and a self-hosted Postfix are all reached over SMTP with the
// credential as the SMTP password, so there is one transport and nothing selects it. a vendor
// SDK would be a second delivery path with its own error vocabulary, its own retry semantics
// and its own outage; the port exists so there is exactly one of each.
//
// this port is deep, not shallow. four fields and one method sit in front of an SMTP session,
// a TLS handshake, an AUTH exchange, MIME assembly and a whole taxonomy of host refusals —
// roughly eight hundred lines of `worker-mailer` plus the classification around it. that ratio
// is the argument for the port, not a reason to call it thin. what is true is that the seam is
// hypothetical: one transport has ever been written against it, so nothing has yet pulled on
// the interface.
//
// nothing here imports a transport, a binding or a template. `./factory.ts` is what turns
// a deployment's config into one of these, per request.

/** subject line and both body arms — what a template produces, before it has a recipient. */
export interface RenderedEmail {
	readonly subject: string;
	/**
	 * both arms are required, neither is optional. the message goes out as
	 * multipart/alternative, and the text arm is not a courtesy: a receipt is a tax record
	 * that gets forwarded to an accountant, printed, and read in clients that never render
	 * HTML.
	 *
	 * it arrives either written by the template or derived from its markup by
	 * packages/emails/src/render.ts, under that package's own tests —
	 * packages/emails/src/template.ts holds which messages claim which. never by the transport,
	 * whose stripper is whatever it does that week.
	 */
	readonly text: string;
	readonly html: string;
}

/** a rendered message with somewhere to go. */
export interface EmailMessage extends RenderedEmail {
	/** one recipient. a receipt has one donor and an alert has one operator; there is no bulk send here. */
	readonly to: string;
}

/**
 * why a send did not happen, as a closed set.
 *
 * a `const` array plus a derived union rather than a TS `enum`, the way `RAIL_CAPABILITY_STATES`
 * in ../payments/provider.ts does it — the values are what a caller switches on and what a test
 * names, and the array is what makes "did we cover all of them" checkable.
 *
 * no reason may mean "this deployment chose not to send", and the absence is a decision.
 * mail is a requirement, so a deployment that cannot send is `not_configured` — a hole the
 * console's mail fold reports. a reason meaning "working as configured" is an invitation to a
 * caller to stay quiet about receipts that never leave, which is the one failure nobody would
 * notice.
 *
 *   not_configured     — the mail settings are missing or unusable (no SMTP_HOST, no
 *                        credential, no MAIL_FROM, a port that is not 465). fix the
 *                        deployment, not the send.
 *   invalid_message    — the message itself cannot be handed to an SMTP session: a recipient
 *                        that is not a bare address, or a CR/LF in a value that becomes a
 *                        header. not a transport failure and not the operator's settings —
 *                        it is caller data, and it is refused before a socket is opened
 *                        because the SMTP client would otherwise write it into the envelope
 *                        verbatim.
 *   connect_failed     — the SMTP host could not be reached, or the TLS handshake failed.
 *   auth_failed        — the host answered and refused the credential.
 *   rejected           — the host accepted the credential and refused this message.
 *   internal_error     — a provider threw where its contract says it must not. this is a bug
 *                        in an adapter rather than anything about mail, and it exists so that
 *                        `sealed` below has somewhere honest to put one: reporting it as
 *                        `connect_failed` would tell an operator to wait for a network that
 *                        is fine.
 */
export const SEND_FAILURE_REASONS = [
	'not_configured',
	'invalid_message',
	'connect_failed',
	'auth_failed',
	'rejected',
	'internal_error'
] as const;
export type SendFailureReason = (typeof SEND_FAILURE_REASONS)[number];

/**
 * a discriminated union, so a caller cannot read `reason` without having checked `ok` and
 * cannot treat "we did not send" as "we sent".
 *
 * it is almost binary, and that is affordable here because the message is email. the cost of
 * getting "did it send?" wrong in this direction is a donor receiving a receipt twice, which
 * is a mildly awkward email and nothing else — so a single `indeterminate` flag is enough,
 * rather than a third state every caller has to branch on.
 *
 * do not copy that trade into `PaymentProvider`. there, the indeterminate case is the central
 * design problem rather than a footnote: a charge whose outcome is unknown is money that may
 * or may not have moved, and the answer is idempotency keys and a reconciliation read against
 * the provider, not a boolean. ../payments/provider.ts states that difference from its own
 * side, at `PaymentFailure`.
 */
export type SendResult =
	| { readonly ok: true }
	| {
			readonly ok: false;
			readonly reason: SendFailureReason;
			/** what went wrong, naming the value to fix. read by an operator and by an agent. */
			readonly detail: string;
			/**
			 * whether the message may have gone out anyway. `false` means nothing was handed to a
			 * host — a refused config, a refused message, a connection that never opened.
			 *
			 * `true` is the honest answer to a timeout, and it is not pedantry: a socket that goes
			 * quiet after `DATA` was accepted leaves the message queued at the provider just as
			 * often as it leaves it nowhere, and the classifier cannot tell which. a caller that
			 * retries on this may duplicate a receipt; a caller that reports it must not say "the
			 * message was not sent".
			 */
			readonly indeterminate: boolean;
	  };

export interface EmailProvider {
	/**
	 * send never throws for a delivery failure — it returns `{ ok: false }`, always.
	 *
	 * this is load-bearing and it is about the ledger, not about tidiness. the caller that
	 * sends a receipt has already committed a `batch()` — the gift is posted, the books
	 * balance, and D1 has no interactive transaction to take that back (CLAUDE.md). if this
	 * method threw, the natural shape of that caller becomes one `try` around the posting and
	 * the send, and then an SMTP host being down is an exception on the write path of the
	 * books: at best the gift is reported as failed after it landed, at worst somebody adds a
	 * compensating write to "undo" it. mail I/O must not be able to steer the ledger, and the
	 * cheapest way to guarantee that is to give it no channel that can.
	 *
	 * so every implementation catches its own transport's exceptions and maps them onto a
	 * `SendFailureReason`. the caller's whole error handling is an `if (!result.ok)`, and the
	 * consequence of a failure is that `donation.receipt_sent_at` stays null — which is the
	 * backlog query, not an error state.
	 *
	 * the prose above is not the enforcement — `sealed` below is. every provider this app
	 * hands out goes through it, so an adapter that breaks the promise costs a log line and a
	 * `SendResult` rather than an exception on the ledger's write path.
	 */
	send(message: EmailMessage): Promise<SendResult>;
}

/**
 * the contract, enforced rather than documented. wraps any provider so that a throw escaping
 * its `send` — a rejected dynamic import, a `DOMException` out of the socket layer, a bug in
 * an adapter nobody has written yet — leaves as a `SendResult` like everything else.
 *
 * `./factory.ts` is the only place a provider is handed out and it seals every arm, so this
 * is not defence in depth over a promise already kept: it is the promise. the rule above
 * explains why mail I/O must have no channel into a caller that has committed a
 * `batch()`, and a comment cannot close that channel.
 *
 * it logs, and that is not optional. a seal that swallowed the error would turn an adapter
 * bug into a deployment that quietly sends no mail and reports a tidy reason for it — the
 * failure mode is worse than the throw. the operator gets a `SendResult`; the log gets the
 * stack.
 *
 * `indeterminate: true`, because an escaped throw says nothing about how far the session got:
 * a transport that dies after `DATA` was accepted throws exactly like one that dies before
 * the connection opens.
 */
export function sealed(provider: EmailProvider): EmailProvider {
	return {
		async send(message: EmailMessage): Promise<SendResult> {
			try {
				return await provider.send(message);
			} catch (error) {
				logProviderFault('an email provider threw, which its contract forbids:', error);
				return {
					ok: false,
					reason: 'internal_error',
					detail:
						'The email transport failed in a way it is not supposed to be able to: it threw ' +
						'instead of reporting. Nothing about the deployment fixes this. It is a bug in ' +
						'this app, and the cause is in this deployment’s logs (the Cloudflare dashboard, or `pnpm run logs` from a checkout). Whether the ' +
						'message went out is unknown.',
					indeterminate: true
				};
			}
		}
	};
}

/**
 * writes a fault to the log without becoming one.
 *
 * `console.error(…, error)` is itself a throw site, which is why it is inside the `try` rather
 * than bare in a `catch`. it serialises the value it is given, which runs whatever getter or
 * `toString` the thrower supplied — so an unguarded log puts a throw in the one function in
 * this app whose entire job is to have none, on the path where a `batch()` has already
 * committed. `messageOf` in ./smtp-failure.ts is hardened against exactly this.
 *
 * swallowing the second failure is the right trade here and nowhere else. the caller is
 * already returning a `SendResult` that names the fault and points at the logs; a log sink
 * that cannot take it is not something the send can do anything about, and re-throwing would
 * defeat the seal it is called from.
 *
 * shared with ./factory.ts, which needs the same guarantee around a provider that fails to
 * build, so the reasoning above lives in one place rather than in two catches.
 */
export function logProviderFault(context: string, error: unknown): void {
	try {
		console.error(context, error);
	} catch {
		// nothing to report it to, and nothing this function may throw.
	}
}

/**
 * a provider that sends nothing and says why — mail variables that are not set, a value that
 * cannot be dialled, a transport that could not be built at all.
 *
 * one of these rather than a hand-rolled object per case, because a second copy in a second
 * file is how the arms drift: a field added to the failure arm of `SendResult` has to reach
 * every one of them, and the compiler only catches that at the last one somebody remembers.
 *
 * `indeterminate` is `false` and is not a parameter: nothing here opens a socket, so there is
 * never a message that might have gone out.
 */
export function refusing(reason: SendFailureReason, detail: string): EmailProvider {
	return {
		async send(): Promise<SendResult> {
			return { ok: false, reason, detail, indeterminate: false };
		}
	};
}
