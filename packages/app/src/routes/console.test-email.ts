import { consoleJson, consoleMethodNotAllowed } from '$lib/server/console/surface';
import { createEmailProvider } from '$lib/server/email/factory';
import { sendTestEmail, testSendStatus } from '$lib/server/email/test-send';
import { EMAIL, MAX_EMAIL } from '@better-giving/operator/console/org-rules';
import { platform } from '../context';
import type { Route } from './+types/console.test-email';

// the one way an operator finds out their mail settings actually work, pressed over the wire.
//
// a mutation and specified as one, on the same surface and behind the same check as the report: the
// check is the `middleware` on ./console.ts and this file makes no decision about who may press —
// see the header there, and $lib/server/console/surface.ts for what this surface owes.
//
// **it is here rather than in the console because only this deployment can do it.** the message
// goes out over this deployment's own transport with this deployment's own SMTP credentials, which
// live under `$lib/server/**` and are deploy-time (CLAUDE.md). a console that could send would be a
// console holding a credential, which is the thing this arrangement exists to avoid.
//
// **it takes the destination from the caller, and that is not a relay.** whoever holds the
// credential this surface checks can deploy code to this worker, so an address in the body is a
// shortcut to something they already have rather than a capability they gain — and a send that
// could only reach the organisation's own row cannot check a mail host against the inbox somebody
// is watching, which is the reading the press exists for. no bucket, no allowlist and no other
// mitigation stands here for that reason.
//
// **what is checked is that the value is an address, which is input validation.** the rule is
// `EMAIL` in `@better-giving/operator/console/org-rules`, where the operator surfaces' addresses
// are measured, and it is applied rather than restated. a refusal names the value and where to fix
// it, as a 4xx on this surface owes.
//
// the act does not live here. `sendTestEmail` in $lib/server/email/test-send.ts is the message and
// the reading of what the transport said, stated once because the console presses the same act — a
// second copy would be two documents able to disagree about what this deployment sends. what is
// here is the wiring: the destination, a transport built per request from this request's own env
// (CLAUDE.md), and the status the outcome is answered under.
//
// nothing is written. no row, no send log — so unlike the two writes beside it this answers with a
// report of the press rather than with the deployment's own report: there is no row a send could
// have moved, and re-reading the tables would be two queries spent to say nothing changed.

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	// the request body is read exactly once, here, by the endpoint that owns it (CLAUDE.md).
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return badBody('The request body is not JSON.');
	}

	const submitted = destination(body);
	if (submitted === null) return badBody('The request body carries no `to` string.');

	// trimmed before it is measured, because an address arrives pasted: the space either side of it
	// is not what a caller meant and refusing it would be a refusal with nothing to act on.
	const to = submitted.trim();
	if (to.length > MAX_EMAIL || !EMAIL.test(to))
		return consoleJson(
			{
				error: 'bad_to',
				message:
					'The `to` value is not an address this deployment can send to. It has to be one ' +
					`address — something, an @, something, no spaces — of at most ${MAX_EMAIL} characters.`,
				fix: 'Put a single address in the To box beside Send test email, or send `{ "to": "you@example.org" }`.'
			},
			400
		);

	const mail = createEmailProvider(context.get(platform).env);
	const report = await sendTestEmail({ to, send: (message) => mail.send(message) });

	return consoleJson(report, testSendStatus(report.outcome));
}

/** the read this address does not answer. a GET that sent a message would send one on a reload. */
export function loader({ request }: Route.LoaderArgs): Response {
	return consoleMethodNotAllowed(request.method, 'POST');
}

/**
 * the submitted destination, or `null` where the body carries none.
 *
 * a string and nothing else: a number or a list here is a value no box could have produced and no
 * rule below is written against.
 */
function destination(body: unknown): string | null {
	if (typeof body !== 'object' || body === null) return null;
	const to = (body as Record<string, unknown>).to;
	return typeof to === 'string' ? to : null;
}

function badBody(message: string): Response {
	return consoleJson(
		{
			error: 'bad_body',
			message,
			fix: 'Send `{ "to": "you@example.org" }` — one address, as JSON.'
		},
		400
	);
}
