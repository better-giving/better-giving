// the token check `/api/v1` owes every submission that initiates a payment, and the only module
// that calls Cloudflare's siteverify endpoint.
//
// it lands beside ./cors.ts because the charter of this folder is what the public surface needs,
// which is what that file already was. nothing else in this app does more than read the two
// Turnstile variables — Cloudflare publishes no format for a real key, and the widget is only
// exercised when a donation is submitted. this is where it is exercised.
//
// nothing here is built at module scope. the secret arrives on the check, per request, off
// `platform.env` (CLAUDE.md), so there is no client to construct and no state to hold between
// requests.
//
// the endpoint that takes a token is where this belongs, and it is deliberately not on the config
// endpoint one route over — that one initiates no payment and reads nothing a donor typed, so
// there is no submission for a token to accompany (see the header of
// src/routes/api.v1.forms.$id.config.ts).
//
// ---------------------------------------------------------------------------
// no idempotency key is sent, and that is the one deliberate omission worth stating.
//
// siteverify accepts an `idempotency_key`, documented as a UUID you generate so a validation can
// be safely retried
// (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). it is not
// sent, and the reason is that the only key this app could derive is one derived from the token —
// nothing else about a submission is stable across a donor pressing the button twice. a key
// derived from the token makes siteverify replay its first answer for that token, which is
// precisely the single-use property being bought: a token is valid once, a replay is refused as
// `timeout-or-duplicate`, and a cached success handed back for the same token within the
// idempotency window is a bot minting payment intents off one solved challenge.
//
// what falls out of that, and what a caller has to know: no failure here is answered by making
// the identical call again. `unavailable` means the token may already be spent, so the answer is
// a fresh challenge and a fresh token, never a retry of this call — which is why the reason is
// named for the service's state rather than for a retry policy.
//
// ---------------------------------------------------------------------------
// what a refusal is on the wire is the caller's decision, and one is not decided here.
//
// `API_ERROR_CODES` in `packages/form/src/v1.ts` has no member for a challenge that did not clear, and
// this module does not add one: those codes are part of `v1`, which is add-never-rename
// (CLAUDE.md), so minting one is a permanent contract rather than a detail of this check. the
// endpoint that takes a token inherits that decision, and it is worth deciding rather than
// defaulting — `rejected` is the ordinary outcome here, not the exceptional one. a donor who
// filled the form slowly hands over a token past its five minutes, and whatever code answers that
// is the code the most common non-success on the whole surface will carry.
// ---------------------------------------------------------------------------

import { setCommand } from '@better-giving/operator/deploy-split';

/** the endpoint, exported so a spec can assert the call went to it rather than restate it. */
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * how an operator gets the pair this check cannot work without.
 *
 * for the logs, and only for them: the two `operatorFix` sentences below are read by whoever is
 * looking at a live deployment refusing donations, with no screen in front of them and no row to
 * read a command off. so this states both commands as well as where the pair is minted.
 *
 * it names the dashboard rather than a `pnpm` script for the first half because minting the pair is
 * the step no command in this repository can do — the widget is created in the operator's own
 * Cloudflare account, and the two calls after it are the part a script owns. they are two different
 * commands and `setCommand` in `@better-giving/operator/deploy-split` is what decides which: the
 * sitekey is rendered into every donor's page, so it is a var an operator can read back, and the
 * secret key is a credential.
 *
 * the console says the same things and no longer says them from here. that screen draws a box per
 * key with the command beside it (`packages/console-ui/src/lib/secret-groups.ts`). the overlap is
 * deliberate: a log line and a box are read by the same person at different moments, and neither
 * can point at the other.
 */
export const TURNSTILE_FIX =
	'Create a widget at dash.cloudflare.com > Turnstile, then run ' +
	`\`${setCommand('TURNSTILE_SITE_KEY')}\` and \`${setCommand('TURNSTILE_SECRET_KEY')}\`.`;

/**
 * how long siteverify may take before it is reported as unanswered.
 *
 * shorter than the 12 seconds ../payments/stripe.ts allows itself, and the reason is that the two
 * are on one donor's request and they add: this check runs first and the intent is minted after
 * it, so a budget copied from there makes a form that can sit silent for the better part of half a
 * minute. siteverify is a single call to Cloudflare's own edge and answers in milliseconds, so
 * five seconds is ample headroom rather than a tight bound, and a donor who does hit it is told to
 * try again while they are still on the page.
 */
const TIMEOUT_MS = 5_000;

/**
 * the longest token siteverify will accept, per its own documentation.
 *
 * checked here so that a field a stranger controls cannot make this app POST an unbounded body to
 * Cloudflare on an unauthenticated path. it is a refusal and not a truncation — a shortened token
 * is a different token, and it would be reported as the donor's challenge failing.
 */
const MAX_TOKEN_LENGTH = 2048;

/**
 * why a submission did not clear, as a closed set.
 *
 * a `const` array plus a derived union rather than a TS `enum`, the way `SEND_FAILURE_REASONS` in
 * ../email/provider.ts and `PAYMENT_FAILURE_REASONS` in ../payments/provider.ts do it — the values
 * are what a caller switches on and what a test names.
 *
 * the axis is who can act, and there are exactly three answers:
 *
 *   rejected      — the token is not one this app will honour: absent, malformed, expired past its
 *                   five minutes, already spent, or solved on a site this form is not served from.
 *                   the visitor solves a fresh challenge. this is the ordinary case rather than the
 *                   exceptional one — an expired token is what a donor who filled the form slowly
 *                   produces.
 *   misconfigured — the deployment cannot verify anything: `TURNSTILE_SECRET_KEY` is absent or not
 *                   one Cloudflare knows, or no site is listed as allowed to submit. no token fixes
 *                   any of it, and reporting it as `rejected` would put a donor in a loop of
 *                   challenges they solve correctly and are refused for, with nothing telling the
 *                   operator.
 *   unavailable   — siteverify produced no usable answer: nothing came back, it timed out, it
 *                   answered a status other than 2xx, or it answered something this app cannot
 *                   read. `internal-error` and `bad-request` land here too.
 *
 * this is deliberately not the shape ../payments/provider.ts carries, and the difference is one
 * mechanism rather than taste. that port exports a retryable/terminal partition because two routes
 * have to agree about it — a webhook answers a retryable failure with a 5xx so the processor
 * redelivers, and a terminal one with a 2xx so it stops. nothing consumes an answer here that way:
 * a Turnstile token is single-use, so repeating the identical call is refused as a duplicate no
 * matter which failure preceded it. a partition named `isRetryable` over these three would name a
 * property none of them has.
 *
 * there is no generic result carrying a value either, for the same kind of reason. that port is
 * generic because `sealed` and `refusing` have to produce a failure for every arm of a
 * three-method interface; this is one function whose success carries nothing — see
 * `TurnstileResult`.
 */
export const TURNSTILE_FAILURE_REASONS = ['rejected', 'misconfigured', 'unavailable'] as const;
export type TurnstileFailureReason = (typeof TURNSTILE_FAILURE_REASONS)[number];

/**
 * a discriminated union, so a caller cannot read `reason` without having checked `ok`.
 *
 * the success arm carries nothing, and the omission is a decision. a token that verifies comes back
 * with `hostname`, `action` and `cdata`; the first is compared here rather than handed over (see
 * `verifyTurnstile`), and this app decides nothing with the other two.
 *
 * `detail` and `operatorFix` are two fields because they have two readers, and one field would
 * publish the wrong one. `detail` is the sentence an endpoint may answer with — CLAUDE.md's rule
 * for a 4xx body, which is read by an agent rather than by a person at a terminal — so it names what
 * the submission has to do differently and never a deploy-time variable. `operatorFix` is the
 * sentence for the deployment's own log: it names the variable and the command, and it is `null`
 * wherever no operator can act. sharing one field would make `json({ error: result.detail })` — the
 * shortest line an endpoint can write — publish an env-var name and the fact that bot protection on
 * a payment-initiating endpoint is currently unenforced.
 *
 * neither ever carries the secret, in any form: the value is not echoed, not truncated and not
 * compared against in a message, so there is nothing here for `redact` in ../../redact.ts to do.
 * what `detail` does carry is siteverify's own error codes, which are a closed vocabulary
 * Cloudflare publishes.
 */
export type TurnstileResult =
	| { readonly ok: true }
	| {
			readonly ok: false;
			readonly reason: TurnstileFailureReason;
			readonly detail: string;
			readonly operatorFix: string | null;
	  };

/**
 * one submission's claim to have solved a challenge.
 *
 * `secretKey`, `siteKey` and `token` are typed as their sources rather than tidied up on the way
 * in, so no call site writes a coalesce this function would only have to repeat: the first two are
 * `platform.env`'s, optional because a fresh fork has not set them (see `ConfigEnv` in
 * ../config/env.ts); the third is `QuoteRequest.turnstileToken` in packages/form/src/v1.ts, optional on
 * the wire.
 */
export type TurnstileCheck = {
	/** `TURNSTILE_SECRET_KEY`, read per request off `platform.env`. server-only, never echoed. */
	readonly secretKey: string | undefined;
	/**
	 * `TURNSTILE_SITE_KEY`, the public half of the same pair, read off `platform.env` per request.
	 *
	 * it is here because it decides whether a submission could have carried a token at all. the
	 * donation form renders the widget from whatever `turnstileSiteKey` the served config carries
	 * (`readFormConfig` in packages/form/src/config.ts), and that field is omitted entirely when this
	 * variable is unset (`../forms/published-config.ts`) — so on a deployment holding no sitekey
	 * there is no widget on the page, no token to send, and nothing a donor can do about it. see
	 * `verifyTurnstile` for the refusal that follows from it.
	 *
	 * it is never sent to siteverify, which takes the secret alone.
	 */
	readonly siteKey: string | undefined;
	/** whatever the submission presented as a token, trusted for nothing until siteverify says so. */
	readonly token: string | undefined;
	/**
	 * the hostnames a challenge for this form may have been solved on.
	 *
	 * bare hostnames — `example.org`, no scheme and no port — because that is what siteverify
	 * reports and the only thing there is to compare against. the caller derives them from the
	 * sites the form is allowed to be embedded on and from the deployment's own host
	 * (`acceptableHostnames` in ../donations/quote.ts), all of which are held as full origins: an
	 * origin that does not parse to a hostname, the literal `null` an opaque origin sends included,
	 * contributes nothing to this list rather than being passed through, since no hostname
	 * Cloudflare reports can equal it.
	 *
	 * the deployment's own host is always a member, so the list names at least one site and a
	 * hostname nothing matches is the caller's `rejected` rather than the deployment's fault.
	 */
	readonly allowedHostnames: readonly string[];
	/**
	 * the submission itself, for the visitor's address.
	 *
	 * the request rather than an address, so that `CF-Connecting-IP` is spelled in this folder and
	 * not again in the route — `apiRateLimitKey` in ./rate-limit.ts reads the same header and argues
	 * at length about which headers may stand in for it and which may not. asking a caller for the
	 * address would put that decision one file away from its reasoning.
	 *
	 * the address is a signal Cloudflare scores the challenge against, never something this app
	 * decides on. the header is set by the edge in front of the Worker; treating any address as an
	 * authorization input would be the same mistake CLAUDE.md names for `Origin`.
	 */
	readonly request: Request;
};

/**
 * checks one token against Cloudflare, and never throws.
 *
 * a throw here would be a 500 on a public endpoint in place of a body naming what to fix, so every
 * outcome — including a `fetch` that rejects and a body that will not parse — leaves as a
 * `TurnstileResult`. that is the same promise ../payments/provider.ts makes with `sealed`, kept
 * inline because there is one function to keep it for.
 *
 * three refusals never reach the network, and all three save a round trip on a public path: a
 * deployment with no secret cannot verify anything, a deployment with no sitekey served a page that
 * could render no widget, and a token that is absent or over the documented length cannot verify
 * either. the last is the one that matters most — it is a stranger's field, so answering it from
 * here means an unauthenticated caller cannot make this Worker open a connection at all.
 *
 * ---------------------------------------------------------------------------
 * the two keys are checked before the token, and the order is the whole point of the sitekey being
 * here at all.
 *
 * the token is required on every submission, unconditionally: this endpoint is public,
 * unauthenticated and payment-initiating, and a check a deployment can switch off by leaving a
 * variable unset is a hole rather than a default (CLAUDE.md). what the sitekey decides is not
 * whether to check but *whose fault it is* when there is nothing to check — an absent token on a
 * deployment that served no widget is the operator's, and answering it `rejected` would tell a
 * donor to reset a widget that was never on their page and put them in a loop. so it is
 * `misconfigured`, which the caller answers 503 with an operator's sentence in the log rather than
 * 403 with a donor's on the card (`challenge_unavailable` in ../donations/quote.ts).
 * ---------------------------------------------------------------------------
 * where the challenge was solved is checked here rather than handed to the caller.
 *
 * the sitekey ships inside the embed and is public by construction, so anyone can render this
 * deployment's widget on a page of their own, solve it honestly, and POST a valid token. the
 * widget's own domain allowlist stops that, and it is configuration in the operator's Cloudflare
 * dashboard which this repository cannot see, cannot ship and cannot check. `hostname` is the one
 * server-side signal for it, and it is not client-forgeable: it is Cloudflare's own report of the
 * page the challenge was served on.
 *
 * it is compared in this module rather than returned for a caller to compare, because the two
 * shapes fail differently. handed over, the check is a line an endpoint can omit and still look
 * correct; done here, the list is a required field and there is no way to call this function
 * without deciding what it holds.
 *
 * an empty list is never read as "accept any site", and there is no arm for it: the caller always
 * puts the deployment's own host in, so the list names at least one site and the comparison below
 * is the whole of the check. a list holding nothing but blanks reaches that comparison and refuses
 * the submission as `rejected`, which is the honest answer for a hostname nothing matches.
 *
 * it is not the same check `corsHeaders` in ./cors.ts makes, and neither replaces the other. that
 * one decides whether a browser may read the answer and refuses nothing — it says so itself, and
 * CLAUDE.md is explicit that `Origin` is an attribution signal and never an authorization control.
 * this one is a claim by Cloudflare rather than by the caller, which is what makes it worth acting
 * on.
 * ---------------------------------------------------------------------------
 */
export async function verifyTurnstile(check: TurnstileCheck): Promise<TurnstileResult> {
	const secret = check.secretKey?.trim() ?? '';
	if (secret.length === 0) {
		return {
			ok: false,
			reason: 'misconfigured',
			detail: CANNOT_VERIFY,
			operatorFix: `\`TURNSTILE_SECRET_KEY\` is not set, so no submission can be verified. ${TURNSTILE_FIX}`
		};
	}

	if ((check.siteKey?.trim() ?? '').length === 0) {
		return {
			ok: false,
			reason: 'misconfigured',
			detail: CANNOT_VERIFY,
			operatorFix:
				'`TURNSTILE_SITE_KEY` is not set, so the donation form renders no widget and no ' +
				`submission can carry a token to verify. ${TURNSTILE_FIX}`
		};
	}

	const hostnames = check.allowedHostnames
		.map((hostname) => hostname.trim().toLowerCase())
		.filter((hostname) => hostname.length > 0);

	const token = check.token?.trim() ?? '';
	if (token.length === 0) {
		return rejected(
			'No Turnstile token accompanied this submission. The page must render the Turnstile ' +
				'widget and send the token it produces as `turnstileToken`.'
		);
	}
	if (token.length > MAX_TOKEN_LENGTH) {
		return rejected(
			`The Turnstile token is ${token.length} characters, over the ${MAX_TOKEN_LENGTH}-character ` +
				'maximum Cloudflare accepts. Send the token the widget produced, unmodified, as ' +
				'`turnstileToken`.'
		);
	}

	const body = new URLSearchParams({ secret, response: token });
	// `Headers.get` answers `''` rather than `null` for a header that is present and empty, and
	// `remoteip=` is a parameter this app sent with nothing in it.
	const address = check.request.headers.get('cf-connecting-ip')?.trim() ?? '';
	if (address.length > 0) body.set('remoteip', address);

	let response: Response;
	try {
		response = await fetch(SITEVERIFY_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body,
			// a `TimeoutError` out of `fetch` rather than a hung request. see `TIMEOUT_MS`.
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (error) {
		return unavailable(`The Turnstile check could not reach Cloudflare (${describeThrow(error)}).`);
	}

	if (!response.ok) {
		return unavailable(`Cloudflare's Turnstile siteverify answered HTTP ${response.status}.`);
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		return unavailable("Cloudflare's Turnstile siteverify answered something that is not JSON.");
	}

	return classify(payload, hostnames);
}

/**
 * what a donor is told when the deployment itself is the problem.
 *
 * one sentence for both `misconfigured` cases, and it names nothing: which variable is unset, and
 * whether bot protection is currently enforced at all, are facts about the deployment that a
 * public endpoint has no business publishing. the `operatorFix` beside it is where they go.
 */
const CANNOT_VERIFY = 'This deployment cannot verify a challenge, so no donation can be accepted.';

/**
 * siteverify's answer, read for the fields that decide anything.
 *
 * the response is treated as unknown JSON rather than as a declared shape, because it arrives over
 * the network: a body missing `success` entirely is a real possibility and reading it as `false`
 * would report a stranger's forged token and a Cloudflare incident as the same thing. only a
 * literal `true` passes, and only a literal `false` is classified — the string `'true'` is neither,
 * and it is the one case where being generous would let a submission through.
 */
function classify(payload: unknown, hostnames: readonly string[]): TurnstileResult {
	if (typeof payload !== 'object' || payload === null) {
		return unavailable("Cloudflare's Turnstile siteverify answered a body that is not an object.");
	}

	const answer = payload as { success?: unknown; hostname?: unknown; 'error-codes'?: unknown };

	if (answer.success === true) {
		if (typeof answer.hostname !== 'string') {
			// nothing to compare against is not the same as a comparison that passed.
			return unavailable(
				"Cloudflare's Turnstile siteverify verified the token without reporting the site it was " +
					'solved on, so where it came from could not be checked.'
			);
		}
		if (!hostnames.includes(answer.hostname.trim().toLowerCase())) {
			// the acceptable sites are not repeated back. whoever is asking is either an integrator
			// who can read the form's own settings or somebody probing a payment endpoint, and only
			// one of them learns anything from the list.
			return rejected(
				'This Turnstile challenge was solved on a site this form is not served from, so the ' +
					'submission was not accepted.'
			);
		}
		return { ok: true };
	}

	if (answer.success !== false) {
		return unavailable(
			"Cloudflare's Turnstile siteverify answered a body with no `success` field."
		);
	}

	const codes = Array.isArray(answer['error-codes'])
		? answer['error-codes'].filter((code): code is string => typeof code === 'string')
		: [];
	const listed = codes.length > 0 ? codes.join(', ') : 'no error code';

	// the secret is checked before the token, because a deployment that cannot verify anything is
	// the state worth reporting: a body carrying both codes would otherwise tell a visitor to solve
	// another challenge they are going to be refused for.
	if (codes.some((code) => SECRET_CODES.includes(code))) {
		return {
			ok: false,
			reason: 'misconfigured',
			detail: CANNOT_VERIFY,
			operatorFix: `Cloudflare refused this deployment's Turnstile secret (${listed}). ${TURNSTILE_FIX}`
		};
	}

	if (codes.some((code) => TOKEN_CODES.includes(code))) {
		return rejected(
			`Cloudflare did not accept this Turnstile token (${listed}). A token is valid once and for ` +
				'five minutes, so the page must reset the widget and send the new token as ' +
				'`turnstileToken`.'
		);
	}

	return unavailable(
		`Cloudflare's Turnstile siteverify refused the check without naming a cause this app handles ` +
			`(${listed}).`
	);
}

/** the codes that are about this deployment's own key. */
const SECRET_CODES: readonly string[] = ['missing-input-secret', 'invalid-input-secret'];

/**
 * the codes that are about the token the submission presented.
 *
 * `timeout-or-duplicate` is one of them, and it is the member worth naming: it means the token was
 * already validated or has aged past its five minutes, which is a fact about that token and not
 * about this app or about Cloudflare. the answer is a fresh challenge either way.
 */
const TOKEN_CODES: readonly string[] = [
	'missing-input-response',
	'invalid-input-response',
	'timeout-or-duplicate'
];

/**
 * the arm the visitor can act on. no operator fix, because there is nothing for one to fix.
 *
 * spelled once so that the reason and the shape cannot drift apart, the way `refusing` in
 * ../payments/provider.ts is one function rather than a hand-rolled object per case.
 */
function rejected(detail: string): TurnstileResult {
	return { ok: false, reason: 'rejected', detail, operatorFix: null };
}

/**
 * the arm nobody can act on, which is what makes its `operatorFix` null.
 *
 * every detail here ends with the same warning, and it is load-bearing rather than decoration: the
 * call may well have spent the token before it failed, so the submission cannot simply be repeated.
 */
function unavailable(detail: string): TurnstileResult {
	return {
		ok: false,
		reason: 'unavailable',
		detail: `${detail} The token may already be spent, so the visitor needs a fresh challenge.`,
		operatorFix: null
	};
}

/**
 * a thrown value as one short phrase, for a `detail` that has to say what happened.
 *
 * it reads `name` rather than the message, because the two cases worth telling apart are a
 * `TimeoutError` from the abort signal and a `TypeError` from a connection that failed, and a
 * message is whatever the runtime happens to say that week. an unrecognised throw is described by
 * its constructor rather than quoted, so nothing a network stack decided to put in a string is
 * copied into a response body.
 */
function describeThrow(error: unknown): string {
	if (error instanceof Error && error.name === 'TimeoutError') {
		return `no answer within ${TIMEOUT_MS / 1000} seconds`;
	}
	return error instanceof Error ? error.name : 'the request failed';
}
