import { redeemCode } from '$lib/server/connector/keys';
import { connectorJson, connectorProblem, unknownAction } from '$lib/server/connector/surface';
import { readOrgProfile } from '$lib/server/org/queries';
import { database } from '../context';
import type { Route } from './+types/connector.v1.exchange';

// the connector redeeming, server to server, the code the Allow screen handed it through the
// browser (./_app.admin.connector.allow.tsx). the key is minted here and nowhere else, so an Allow
// nobody finished left nothing that admits a request; a code redeems once, within ten minutes.

const CODE_INVALID = () =>
	connectorProblem(
		400,
		'code_invalid',
		'This code cannot be used',
		'The code was used already, has expired, or was not issued by this deployment. Start connecting again from Claude or ChatGPT.'
	);

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST')
		return unknownAction(new URL(request.url).pathname, request.method);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return CODE_INVALID();
	}
	const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : null;
	if (typeof code !== 'string') return CODE_INVALID();
	const db = context.get(database);
	const minted = await redeemCode(db, code);
	if (minted === null) return CODE_INVALID();
	const profile = await readOrgProfile(db);
	return connectorJson({ key: minted.key, name: profile?.legalName ?? '' });
}

export function loader({ request }: Route.LoaderArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
