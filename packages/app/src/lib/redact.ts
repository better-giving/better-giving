// the echo policy, in the one place a server module and a browser may both import from.
//
// not under `$lib/server/**`, for the reason `./contacts/kinds.ts` and `./forms/statuses.ts` are
// not: the messages built with it are declared in the zod schemas under
// `./contacts/input-schema.ts`, `./forms/input-schema.ts` and
// `@better-giving/operator/console/org-rules`, and those schemas run in the browser before a screen
// submits as well as on the server — so a component's
// import graph reaches this, and a component may not import from `$lib/server/**`. leaving it there
// would have meant a second copy of the cap for the client half, which is exactly what `ECHO_MAX`
// below says must not exist.
//
// the dependency runs server -> shared and never back: this imports nothing.

/**
 * how much of a rejected value an operator-facing message is allowed to echo back.
 *
 * enough to recognise a typo, not enough to carry a credential. every message in this app that
 * names an offending value goes through here, because the failure it guards against is one step of
 * a normal setup: these values are set back to back — the Stripe pair, the four mail variables —
 * and a value pasted into the wrong one is a live key quoted back in the sentence that rejects it.
 *
 * it is not a security control. every surface that renders one of these messages is behind the
 * staff gate, and react escapes what it renders; this is the difference between a secret sitting on
 * a screen and not, which is a policy this codebase keeps rather than a boundary it defends.
 *
 * one home, because the policy cannot be true of some messages only. a sentence written by
 * `./server/email/smtp-config.ts` is answered verbatim by the console's send-test
 * (`../routes/console.test-email.ts`), so a second copy of this rule anywhere is a
 * surface that quotes a credential in full while the module beside it does not. every message in
 * this app that names an offending value comes through here.
 */
export const ECHO_MAX = 12;

/** a value as it may appear in a message: recognisable, and too short to spend. */
export function redact(value: string): string {
	return value.length <= ECHO_MAX ? value : `${value.slice(0, ECHO_MAX)}…`;
}

/**
 * how much of a public id a message may echo.
 *
 * a form id is `frm_` and sixteen random characters — twenty in all, see `formId` in
 * ./server/db/schema.ts — so this is the value's own length with headroom, not a credential's. it
 * exists because the input is a URL path segment and therefore text of any length, and a
 * message is not a place to print one.
 */
export const PUBLIC_ID_ECHO_MAX = 32;

/**
 * a public id as it may appear in a message: whole.
 *
 * the one kind of value outside the policy above, and outside it by construction rather than
 * by exception. a form id sits in the org's own HTML and is quoted back by unauthenticated
 * `/api/v1` requests, so there is nobody a truncated one withholds it from — while `ECHO_MAX`
 * of 12 against a twenty-character id leaves the prefix and eight characters an operator
 * cannot tell apart from the id they meant, which is the only thing a 404 about a mistyped id
 * is for.
 *
 * it lives here rather than at the call site, because `ECHO_MAX` above says every message in
 * this app that names an offending value comes through this module. an escape written into a
 * route would make that sentence false and leave the next reader no way to find it; written
 * here it is one more line of the same policy, with its own reason attached.
 */
export function redactPublicId(value: string): string {
	return value.length <= PUBLIC_ID_ECHO_MAX ? value : `${value.slice(0, PUBLIC_ID_ECHO_MAX)}…`;
}
