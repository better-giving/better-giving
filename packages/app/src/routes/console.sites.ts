import { consoleReport } from '$lib/server/console/report';
import { consoleJson, consoleMethodNotAllowed } from '$lib/server/console/surface';
import { readSites, readSitesInUse, replaceSites } from '$lib/server/sites/queries';
import { parseSites } from '$lib/server/sites/site-input';
import { consoleSession, database } from '../context';
import type { Route } from './+types/console.sites';

// the list of sites this deployment's donation forms may be used on, written over the wire.
//
// a mutation and specified as one, on the same surface and behind the same check as the report:
// row mutation authorised by proof of account ownership. the check is the `middleware` on
// ./console.ts and this file makes no decision about who may write — see the header there, and
// $lib/server/console/surface.ts for what this surface owes.
//
// the whole list, never one row: `replaceSites` in $lib/server/sites/queries.ts stores a list, and
// the delete rides in the same `batch()` as the inserts so a removal cannot half-happen. two
// callers writing at once is therefore a lost write rather than a conflict, which is the bargain
// this repository already takes on a read-then-write — one deployment serves one organisation, and
// what settles a lost race is submitting again.
//
// what a site may be is not decided here and must not be. `parseSites` runs `readOriginList`
// (`@better-giving/operator/origins`), which is the whole of the rules — the trim, the blank skip,
// the dedupe, the count cap, the repair each row is put through and the three refusals left over.
// what is stored is what each row normalised to and never the line that was sent.
//
// nothing here asks whether the sites are on this deployment's Turnstile widget. neither the CORS
// check nor the challenge pass can read Cloudflare's copy of that list, so no code on this
// deployment can check it; the assertion is a control on the screen that adds a site, and the
// console is what asks for it.

/** what a rejected write answers with, beside the report every accepted one answers with. */
const UNTICK =
	'Untick the site on each form named, then submit the list again. An archived form never ' +
	'blocks a removal: it serves nothing and cannot be edited, so a removal it blocked would be ' +
	'blocked for good.';

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	// the request body is read exactly once, here, by the endpoint that owns it (CLAUDE.md). the
	// check in front of this route reads a header and never the body, which is what keeps that true
	// for a surface whose check runs above every route on it.
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return badBody('The request body is not JSON.');
	}

	const submitted = siteRows(body);
	if (submitted === null)
		return badBody(
			'The request body carries no `sites` array of strings. It is the whole list this ' +
				'deployment should hold afterwards, in the order it should be read in.'
		);

	const listed = parseSites(submitted);
	if (!listed.ok)
		return consoleJson(
			{
				error: 'sites_refused',
				message: listed.problem,
				fix: 'Fix the addresses in the list and submit it again.'
			},
			422
		);

	const db = context.get(database);
	const stored = await readSites(db);
	// only what is going away is asked about — a site that survives the save is not being removed,
	// so the question is about nothing. asked in front of the write rather than inside it, because
	// the refusal has to name every form: `replaceSites` deliberately does not ask, and its header
	// states why the two are separate questions.
	const removals = stored.filter((site) => !listed.value.sites.includes(site));
	const inUse = await readSitesInUse(db, removals);
	if (inUse.length > 0)
		return consoleJson(
			{
				error: 'site_in_use',
				message:
					'These sites are still listed on a live donation form, so removing them would leave ' +
					'that form pointing at a site this deployment no longer has: ' +
					inUse
						.map((entry) => `${entry.site} (${entry.forms.map((form) => form.name).join(', ')})`)
						.join('; ') +
					'.',
				fix: UNTICK,
				// the forms travel structured beside the sentence rather than as marks inside it, so
				// the console renders a control per form instead of parsing prose for an id.
				inUse
			},
			409
		);

	await replaceSites(db, listed.value);

	// the write's answer is the report, so the console never holds a second view of the deployment
	// — the saved list is a member of it, and a console reading it back separately could draw the
	// list it has just written from a stale answer.
	return consoleJson(await consoleReport(db, context.get(consoleSession)));
}

/** the read this address does not answer. `GET /console` is the report. */
export function loader({ request }: Route.LoaderArgs): Response {
	return consoleMethodNotAllowed(request.method, 'POST');
}

/** the submitted list, or `null` when the body does not carry one. */
function siteRows(body: unknown): string[] | null {
	if (typeof body !== 'object' || body === null) return null;
	const sites = (body as Record<string, unknown>).sites;
	if (!Array.isArray(sites) || !sites.every((row) => typeof row === 'string')) return null;
	return sites;
}

function badBody(message: string): Response {
	return consoleJson(
		{
			error: 'bad_body',
			message,
			fix: 'Send `{ "sites": ["https://example.org"] }` — the whole list, as JSON.'
		},
		400
	);
}
