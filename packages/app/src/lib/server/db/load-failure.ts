import { data } from 'react-router';
import { LOGS_SAY_WHY } from '$lib/deployment-logs';

/**
 * what a `load` that could not read the database tells an operator, in the one place every
 * /admin screen reads it from.
 *
 * it was eight independent copies of one sentence before this module: a screen's own subject,
 * then an errand identical on all of them. the errand is what has to stay identical — the migrate
 * command is the fix for a site just set up or just updated whose `migrate` step was skipped
 * (DEPLOY.md → Upgrading), and a copy that drifted would send one screen's reader somewhere the
 * others do not.
 *
 * the subject is the caller's because it is the one part that is not shared: a reader who landed
 * on a 500 is told which screen failed rather than that "a page" did.
 *
 * the fix is on the server, so the sentence names whoever runs the server and gives them the command
 * (AGENTS.md → Boundaries): the compose form migrates the `data` volume's file, and a checkout's
 * dev server reads `packages/app/.env`'s `DATABASE_URL`, which only `pnpm db:migrate` reaches.
 */
export function loadFailure(subject: string): string {
	return (
		`${subject} could not be loaded. If this site was just set up or updated, its database may ` +
		'be behind: whoever runs the server updates it with `docker compose run --rm migrate`, or ' +
		'`pnpm db:migrate` from a checkout. ' +
		LOGS_SAY_WHY
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
