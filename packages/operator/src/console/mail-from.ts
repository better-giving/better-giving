import { EMAIL } from './org-rules';

// what the From address a deployment sends under may be, as the one reading both ends take of it.
//
// **the rule is here because two surfaces apply it to the same value.** the deployment refuses a
// `MAIL_FROM` it cannot send under before it opens a socket (`parseMailFrom` in
// `packages/app/src/lib/server/email/smtp-config.ts`), and the console refuses it at the box the
// operator types it into (`mailForm` in `packages/console-ui/src/lib/smtp-fold-state.ts`). a copy
// in the console is the cheaper answer and is exactly how the two come to disagree: the press
// stores a value the send then refuses, the fold goes on reporting mail as set up, and nothing on
// either screen says which half was right.
//
// **what crosses is the reading and not the sentence.** the deployment's words name the variable,
// quote the value through a redaction helper and say where to set it, which is what a 5xx body's
// reader needs (CLAUDE.md); the console's are for somebody standing at a labelled box, who is not
// being told about an environment variable. so what is shared is which of the two things is wrong,
// and each end says it in its own words.
//
// **what a mail host may be is not here and must not come here.** `parseSmtpEndpoint`, beside
// `parseMailFrom`, refuses a port and an address class rather than a value somebody typed — its
// refusals are about a transport, its sentences are written in variable names, and the port it
// argues about is a value the console's fold states rather than asks for. the host box checks
// nothing, and the deployment's own answer to the test send reports what it could not reach.

/**
 * the one thing wrong with a From address, where there is one.
 *
 * two arms and not a sentence, because the two ends print two different sentences from them and
 * only one of the two is written for a person at a box.
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
