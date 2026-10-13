import type { ConnectorKey } from '../db/schema';
import { parseBearer } from '../integrations/keys';
import type { Db } from '../db/client';
import { findLiveKey } from './keys';

// `/connector/v1`, the surface Better Giving's central Claude and ChatGPT connector speaks to this
// deployment on. this file is the deployment's side of that wire contract: the base path, the one
// return address the Allow screen sends a browser to, the actions this release serves, and the
// problem bodies every refusal answers with. the connector reads any 404 that is not `not_found` as
// "update Better Giving", so an action is added to `CONNECTOR_ACTIONS` in the commit that serves it.
//
// beside `/integrations/v1`, never under `/api/v1`; no CORS, no OPTIONS. a key is a connector key
// (`bgc_`) and nothing else — an `api` or `zapier` key is refused here as an unknown one, and a
// connector key is refused on every other surface because no other surface reads its table.

export const CONNECTOR_BASE_PATH = '/connector/v1';

/** the contract version `hello` answers, which the connector checks before anything else. */
export const CONNECTOR_CONTRACT = 1;

/**
 * where the Allow screen sends the browser back to: the central connector's return, and nowhere
 * else. written in code rather than configuration, so no setting on a deployment can point a code
 * at another site.
 */
export const CONNECTOR_RETURN = 'https://app.connect.better.giving/connect/return';

/** the actions this release serves, as `hello` lists them; the connector reads any other as absent. */
export const CONNECTOR_ACTIONS = [
	'campaigns.list',
	'campaigns.get',
	'campaigns.create',
	'campaigns.update_blocks',
	'campaigns.update_settings',
	'photos.upload_link'
] as const;

/** the release `hello` answers: this build's, or `0.0.0` for a build that named none. */
export function connectorRelease(): string {
	return typeof __BETTER_GIVING_VERSION__ === 'string' ? __BETTER_GIVING_VERSION__ : '0.0.0';
}

/** a JSON answer, never cached: every body here is one organisation's. */
export function connectorJson(body: unknown, status = 200): Response {
	return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * an RFC 9457 problem with the contract's stable `code`, written for the chat model to act on:
 * `detail` says what was refused and what to change.
 */
export function connectorProblem(
	status: number,
	code: string,
	title: string,
	detail: string,
	errors?: readonly { readonly path: string; readonly message: string }[]
): Response {
	return Response.json(
		{
			type: `https://better.giving/connector/problems/${code}`,
			title,
			status,
			detail,
			code,
			...(errors === undefined ? {} : { errors })
		},
		{
			status,
			headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' }
		}
	);
}

/** the 401 the connector drops a connection on: no key, an unknown one, a revoked one. */
export function keyRefused(): Response {
	const refused = connectorProblem(
		401,
		'key_refused',
		'This connection is no longer allowed',
		'This deployment does not accept the key presented: it was disconnected from the dashboard, or is not one this deployment issued. Connect again from Claude or ChatGPT.'
	);
	refused.headers.set('www-authenticate', 'Bearer');
	return refused;
}

/** a 404 for an address under the surface that no action of this release serves. */
export function unknownAction(pathname: string, method: string): Response {
	return connectorProblem(
		404,
		'unknown_action',
		'No such action',
		`This deployment serves no action at ${method} ${pathname}. Its release is ${connectorRelease()}; an older release lacks newer actions, and updating Better Giving adds them.`
	);
}

/** a 404 for a campaign, form or donor that is not there. */
export function notFound(what: string): Response {
	return connectorProblem(
		404,
		'not_found',
		'Not found',
		`${what} does not exist on this deployment.`
	);
}

/** the key a request presents, admitted, or the refusal to answer it with. */
export async function admitConnectorKey(
	db: Db,
	authorization: string | null
): Promise<ConnectorKey | Response> {
	const presented = authorization === null ? null : parseBearer(authorization);
	if (presented === null) return keyRefused();
	return (await findLiveKey(db, presented)) ?? keyRefused();
}

/** the paths under the surface that answer without a key. */
export const UNKEYED = new Set([`${CONNECTOR_BASE_PATH}/hello`, `${CONNECTOR_BASE_PATH}/exchange`]);
