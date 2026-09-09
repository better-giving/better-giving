import { testSend } from '@better-giving/emails';
import { renderEmail } from '@better-giving/emails/render';
import type { TestSendOutcome, TestSendReport } from '@better-giving/operator/console/test-send';
import type { RejectionStatus } from '../../forms/definition';
import type { EmailMessage, SendResult } from './provider';

// the message that answers whether mail leaves this deployment at all, as one act the console
// presses.
//
// **what it says is packages/emails/src/templates/test-send.tsx's** — a plain test carrying
// nothing else, and it argues why. the question here is whether this deployment can hand a message
// to a mail host and whether that host delivers it.
//
// **the destination arrives with the press.** it is the caller's and is used verbatim, so a mail
// host can be checked against an inbox somebody is watching. what an address may be is settled
// once, at the endpoint that takes the press (../../../routes/console.test-email.ts), and what
// reaches here has already been through it.
//
// **nothing is persisted.** no row, no send log — the message is built here and dies with the
// request.
//
// a module rather than lines in a route, for the reason ../payments/recurring-provision.ts is one:
// what lives here is the message and the reading of what the transport said, and both are testable
// as values. the send is an argument, so ./test-send.spec.ts covers both arms with no SMTP host and
// no platform to stand in for. each surface builds its own provider per request from its own env
// (CLAUDE.md) and hands it in.
//
// it holds no credential and answers with none. the SMTP password reaches ./smtp.ts and nothing
// here; what a failure carries is the port's own sentence, which names the variable to set.

/** the message, with somewhere to go. the destination is the caller's and nothing else is. */
async function testMessage(to: string): Promise<EmailMessage> {
	return { to, ...(await renderEmail(testSend.template())) };
}

/**
 * sends the test, or says the transport would not take it.
 *
 * never throws and never rejects: a host that refused arrives as an outcome, because the surface
 * that presses this draws a state rather than an error page.
 */
export async function sendTestEmail(inputs: {
	/** where it goes. already read as an address by the endpoint that took the press. */
	to: string;
	/** this request's own transport. built per request from the request's own env (CLAUDE.md). */
	send: (message: EmailMessage) => Promise<SendResult>;
}): Promise<TestSendReport> {
	const result = await inputs.send(await testMessage(inputs.to));

	// every way this does not send is a failure, and none of them is "mail is off" — no such result
	// exists (see the reason set in ./provider.ts). a deployment with no mail settings is incomplete
	// rather than configured, so pressing this on one is worth a red answer naming the variables to
	// set.
	return result.ok
		? { outcome: 'sent', detail: null, to: inputs.to }
		: { outcome: 'failed', detail: result.detail, to: inputs.to };
}

/**
 * the status one of these reports is answered under, stated once for every surface that answers.
 *
 * a refusal from the mail host is a 500 rather than a 4xx: no box on any screen fixes it. the one
 * thing a caller can get wrong is the destination, and that is refused before a send is attempted
 * (../../../routes/console.test-email.ts) rather than reported as an outcome here.
 */
export function testSendStatus(outcome: TestSendOutcome): 200 | RejectionStatus {
	switch (outcome) {
		case 'sent':
			return 200;
		case 'failed':
			return 500;
	}
}
