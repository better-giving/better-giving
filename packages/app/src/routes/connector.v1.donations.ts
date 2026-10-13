import { jsonBody } from '$lib/server/connector/origin';
import { listDonations } from '$lib/server/connector/reads';
import { recordConnectorGift } from '$lib/server/connector/record';
import { connectorJson, connectorProblem, unknownAction } from '$lib/server/connector/surface';
import { connection, database } from '../context';
import type { Route } from './+types/connector.v1.donations';

// `donations.list` (GET) and `donations.record` (POST).

export async function loader({ context, request }: Route.LoaderArgs): Promise<Response> {
	const listed = await listDonations(context.get(database), new URL(request.url));
	if (!listed.ok)
		return connectorProblem(listed.status, listed.code, 'Refused', listed.detail, listed.errors);
	return connectorJson(listed.list);
}

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST')
		return unknownAction(new URL(request.url).pathname, request.method);
	const recorded = await recordConnectorGift(
		context.get(database),
		context.get(connection).id,
		request.headers.get('idempotency-key'),
		await jsonBody(request)
	);
	if (!recorded.ok)
		return connectorProblem(
			recorded.status,
			recorded.code,
			recorded.status === 500 ? 'Not recorded' : 'Refused',
			recorded.detail,
			recorded.errors
		);
	return connectorJson(recorded.gift, recorded.status);
}
