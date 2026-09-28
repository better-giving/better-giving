import { admitKey, integrationsRefusal, readOnlyRefusal } from '$lib/server/integrations/surface';
import { database } from '../context';
import type { Route } from './+types/integrations.v1';

// the layout every route of the read API sits under, and the one place the method and the key are
// checked.
//
// a route file named `integrations.v1.<anything>` nests beneath it and inherits both checks by
// existing, the mounting ./zapier.ts and ./console.ts make for their own credentials and for the
// same reason: a check each route called leaves the next route open the day it is written.
// ../routes.spec.ts holds that every route served under `/integrations/v1` is under this file.
//
// what the surface is and what every answer on it carries is $lib/server/integrations/surface.ts's
// header. neither check reads the body.

/**
 * GET and HEAD, and nothing else. react router hands OPTIONS to a loader and every other method to
 * an action, so without this a route with no action would answer a write with the framework's own
 * 405 and no `Allow`, and a keyed OPTIONS would read the loader.
 */
const readOnly: Route.MiddlewareFunction = ({ request }, next) =>
	request.method === 'GET' || request.method === 'HEAD' ? next() : readOnlyRefusal(request.method);

const keyGate: Route.MiddlewareFunction = async ({ context, request }, next) => {
	const admitted = await admitKey(context.get(database), request.headers.get('authorization'));
	if (admitted instanceof Response) return admitted;
	return next();
};

export const middleware: Route.MiddlewareFunction[] = [readOnly, keyGate];

/**
 * the bare surface address, which react router matches as this layout with no child beneath it —
 * and without a loader answers 400 with its own internal message. a 404 naming the surface
 * instead, for a caller who trimmed a URL to see what is here.
 */
export function loader(_: Route.LoaderArgs): Response {
	return integrationsRefusal(
		404,
		'not_found',
		'There is nothing served at /integrations/v1 itself. It is the prefix every endpoint of this deployment’s read API sits under.',
		'Call an endpoint on it, such as GET /integrations/v1/gifts.'
	);
}
