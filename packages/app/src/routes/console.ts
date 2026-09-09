import { consoleGate } from '$lib/server/console/gate';
import { consoleReport } from '$lib/server/console/report';
import { consoleJson } from '$lib/server/console/surface';
import { consoleSession, database } from '../context';
import type { Route } from './+types/console';

// the layout every route on the operator console's surface sits under, and the one place the
// credential is checked — and it is the surface's own address as well, which the two layouts
// beside it are not.
//
// it is served at `/console`, so a route file named `console.<anything>` nests beneath it and
// inherits the check below by existing. **that is what makes the credential a property of the
// surface rather than of the routes somebody remembered** — a check each route called leaves the
// next route open the day it is written, with nothing reporting it. $lib/server/console/gate.ts
// argues the mounting and ../routes.spec.ts is what holds it: every route served under `/console`
// is under this file, and none of them checks a credential of its own.
//
// this surface is neither of the other two categories, and that is why it is a category. it may
// not sit under the protected layout, where the gate answers an anonymous caller with a 303 to an
// HTML login — on a JSON wire that is a console reporting the login page as the deployment's
// answer — and it may not be listed as public, which would be a lie ../routes.spec.ts then
// blesses.
//
// no `OPTIONS` handler and no CORS headers anywhere beneath here, deliberately — see
// $lib/server/console/surface.ts, which is also where the absent rate limiter is argued and what
// that absence is contingent on. a browser's preflight carries no `Authorization` header by
// construction, so the check above answers it 401 with nothing granted, which is the answer this
// surface wants a page in a browser to get.
//
// a resource route: no default export, so react router answers with what the loader returns
// instead of rendering anything.

export const middleware: Route.MiddlewareFunction[] = [consoleGate];

/**
 * what this deployment answers about itself to a caller holding a console session.
 *
 * the deployment answers rather than the console, and that is structural rather than a
 * convenience: the rows are its own. one deployment, one assembly, so two surfaces cannot come to
 * disagree about what it is holding; only the renderer lives elsewhere.
 *
 * the envelope is $lib/server/console/report.ts's and is the same one both writes answer with.
 * nothing is assembled here.
 *
 * this loader reads no `platform.env` and neither does the assembly under it: the report is
 * serialized to a caller and an env in scope is the Stripe secret one spread away from being a
 * member, and every configuration value the console wants it reads off the Cloudflare account.
 */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
	return consoleJson(await consoleReport(context.get(database), context.get(consoleSession)));
}
