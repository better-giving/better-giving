import { consoleReport } from '$lib/server/console/report';
import { consoleJson, consoleMethodNotAllowed } from '$lib/server/console/surface';
import { parseOrgProfile, type OrgProfileFormValues } from '$lib/server/org/org-input';
import { saveOrgProfile } from '$lib/server/org/queries';
import { consoleSession, database } from '../context';
import type { Route } from './+types/console.org';

// the organisation's legal identity, written over the wire.
//
// a mutation and specified as one, on the same surface and behind the same check as the report:
// row mutation authorised by proof of account ownership. the check is the `middleware` on
// ./console.ts and this file makes no decision about who may write — see the header there.
//
// it is a singleton about this deployment and it is not merely receipt content: two of its fields
// gate serving a donation form at all, and the rest is what a receipt is printed from. that is why
// it rides this surface — it is a row, and this is where a console writes one.
//
// the schemas and the queries do not move and are not restated here. `parseOrgProfile`
// ($lib/server/org/org-input.ts) is the whole of what a profile may be, stated once against
// `@better-giving/operator/console/org-rules` so that the boxes on a screen and this wire cannot
// come to disagree, and `saveOrgProfile` takes only a value that has been through it — the brand is
// a compile error
// otherwise. this is a JSON wire and not a form, so there is no form id and nothing to seed.
//
// the field names are the form's, which are also the error keys and also the column names — one
// vocabulary rather than three. so a refusal keyed by field is something a console can put beside
// the box that has to change.

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	// the request body is read exactly once, here, by the endpoint that owns it (CLAUDE.md).
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return badBody('The request body is not JSON.');
	}

	const submitted = orgValues(body);
	if (submitted === null)
		return badBody(
			'The request body carries no `org` object of string fields. Every field is submitted ' +
				'together, and a field left out is stored as cleared.'
		);

	const parsed = parseOrgProfile(submitted);
	if (!parsed.ok)
		return consoleJson(
			{
				error: 'org_refused',
				message:
					'This organisation profile was not stored: ' +
					Object.entries(parsed.errors)
						.map(([field, problem]) => `${field} — ${problem}`)
						.join(' '),
				fix: 'Fix the fields named in `errors` and send the profile again.',
				// keyed by field, so a console puts each sentence at the box it is about rather than
				// reading the message back apart. every offending field at once and never the first:
				// one problem per round trip is how a ten-field save takes ten submissions.
				errors: parsed.errors
			},
			422
		);

	const db = context.get(database);
	await saveOrgProfile(db, parsed.value);

	// the write's answer is the report: the saved profile is a member of it, so a console that read
	// it back separately could draw the boxes it has just filled in from a stale answer.
	return consoleJson(await consoleReport(db, context.get(consoleSession)));
}

/** the read this address does not answer. `GET /console` is the report. */
export function loader({ request }: Route.LoaderArgs): Response {
	return consoleMethodNotAllowed(request.method, 'POST');
}

/**
 * the submitted profile, or `null` when the body does not carry one.
 *
 * every field has to be a string, because that is what `OrgProfileFormValues` is: the parser's
 * whole contract is over what a form yields, and a number reaching it would be a value no box
 * could have produced and no rule there is written against.
 */
function orgValues(body: unknown): OrgProfileFormValues | null {
	if (typeof body !== 'object' || body === null) return null;
	const org = (body as Record<string, unknown>).org;
	if (typeof org !== 'object' || org === null || Array.isArray(org)) return null;
	if (!Object.values(org).every((value) => typeof value === 'string')) return null;
	return org as OrgProfileFormValues;
}

function badBody(message: string): Response {
	return consoleJson(
		{
			error: 'bad_body',
			message,
			fix: 'Send `{ "org": { "legal_name": "…", … } }` — the whole profile, as JSON.'
		},
		400
	);
}
