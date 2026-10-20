import { EMAIL } from './org-rules';

// what the From address a deployment sends under may be, as one reading of it.
//
// the deployment refuses a `MAIL_FROM` it cannot send under before it opens a socket
// (`parseMailFrom` in `packages/app/src/lib/server/email/smtp-config.ts`).
//
// **what crosses is the reading and not the sentence.** the deployment's words name the variable,
// quote the value through a redaction helper and say where to set it, which is what a 5xx body's
// reader needs. so what is shared is which of the two things is wrong, and the caller says it in
// its own words.
//
// **what a mail host may be is not here and must not come here.** `parseSmtpEndpoint`, beside
// `parseMailFrom`, refuses a port and an address class rather than a value somebody typed — its
// refusals are about a transport and its sentences are written in variable names.

/**
 * the one thing wrong with a From address, where there is one.
 *
 * two arms and not a sentence, because the caller prints its own sentence from them.
 */
export type MailFromFault = 'display-name' | 'not-an-address';

/**
 * what is wrong with a candidate From address, or `null` where it is one a message can leave under.
 *
 * **a bare address, not `Name <addr>`, and the angle-bracket form is refused rather than trimmed
 * down.** the value is used twice by the SMTP exchange and the two uses want different things: the
 * `MAIL FROM:` envelope command takes the address alone, while the `From:` header takes the display
 * form. the deployment hands one string to both (`packages/app/src/lib/server/email/smtp.ts`), so a
 * value with a display name in it produces an envelope sender of `Hope Foundation <donate@…>`,
 * which a strict host rejects and a lenient one accepts before the message fails SPF at the far
 * end — a failure that lands days later in somebody else's spam folder. refusing it costs an
 * operator one edit and a sentence that says what to type.
 *
 * **the angle brackets are read first, and that order is the whole of which sentence an operator
 * gets.** `Hope Foundation <donate@example.org>` carries whitespace, so it is not an address by
 * {@link EMAIL} either — read the other way round, the value with a name on it is answered by the
 * sentence for a value that is not an address at all, which tells the operator nothing about the
 * part to delete.
 *
 * the pattern is deliberately weak and ./org-rules.ts argues why on it. the value is trimmed for
 * the reading alone: nothing here rewrites what is stored, and the trim is what the send already
 * does before it compares anything.
 */
export function mailFromFault(value: string): MailFromFault | null {
	const address = value.trim();
	if (address.includes('<') || address.includes('>')) return 'display-name';
	return EMAIL.test(address) ? null : 'not-an-address';
}
