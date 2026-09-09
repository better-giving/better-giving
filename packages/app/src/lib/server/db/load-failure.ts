import { data } from 'react-router';

/**
 * what a `load` that could not read the database tells an operator, in the one place every
 * /admin screen reads it from.
 *
 * it was eight independent copies of one sentence before this module: a screen's own subject,
 * then an errand identical on all of them. the errand is what has to stay identical — two of the
 * three commands are the fix for a state a fresh deployment is in, and a copy that drifted would
 * send one screen's reader to a command the others do not name.
 *
 * the subject is the caller's because it is the one part that is not shared: a reader who landed
 * on a 500 is told which screen failed rather than that "a page" did.
 *
 * the console's update press and not a wrangler invocation for the deployed database: the console
 * applies migrations as it deploys, and a wrangler invocation against a deployed D1 is a one-way
 * door taken outside the press that reports it.
 */
export function loadFailure(subject: string): string {
	return (
		`${subject} could not be loaded. If this deployment is new, check that migrations have been ` +
		'applied to its database: the console (`better-giving open`) applies them to the deployed D1 ' +
		'when it updates this deployment, and `pnpm wrangler d1 migrations apply DB --local` applies ' +
		'them to a local one. Then check this deployment’s logs (the Cloudflare dashboard, or ' +
		'`pnpm run logs` from a checkout).'
	);
}

/**
 * refuse a loader that could not read the database, in the one shape every /admin screen uses.
 *
 * a thrown rejection rather than a returned one: it short-circuits the loader and lands on the
 * error boundary, which is where a screen that could not be drawn belongs. it is stated here rather
 * than at each loader because a route that also carries a form may not write a bare
 * `data(…, { status })` of its own — `packages/app/form-rules.ts` refuses one, since a returned
 * rejection with a 4xx or 5xx on it is how a screen ends up rendering a clean form over a refusal —
 * and a route with a loader that can fail and a form on it is both of the donation-form screens.
 *
 * the return type is `never` so a caller may write `throw loadFailed(…)` and have the compiler
 * follow it, which keeps the throw visible at the call site rather than hidden in here.
 */
export function loadFailed(subject: string): never {
	throw data(loadFailure(subject), { status: 500 });
}

/**
 * refuse a loader whose record is not there, in the one shape every /admin screen uses.
 *
 * here rather than at the screen for the reason `loadFailed` above is, and it is the same reason
 * exactly: a route that also carries a form may not spell a rejection of its own —
 * `packages/app/form-rules.ts` refuses a bare `data(…, { status })` there — and a screen that
 * reads one record by an id in its address is a screen with a form on it.
 *
 * the sentence is the caller's whole, rather than a subject the way the failure above takes one:
 * a 4xx names the offending value and where to fix it (CLAUDE.md), and both halves are the
 * screen's — which id it was and which list to go and look at.
 */
export function notFound(sentence: string): never {
	throw data(sentence, { status: 404 });
}
