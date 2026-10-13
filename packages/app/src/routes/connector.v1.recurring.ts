import { listRecurring } from '$lib/server/connector/reads';
import { connectorJson, connectorProblem, unknownAction } from '$lib/server/connector/surface';
import { database } from '../context';
import type { Route } from './+types/connector.v1.recurring';

// `recurring.list` (GET). no recurring gift is changed from this surface, so it takes no write.

export async function loader({ context, request }: Route.LoaderArgs): Promise<Response> {
	const listed = await listRecurring(context.get(database), new URL(request.url));
	if (!listed.ok)
		return connectorProblem(listed.status, listed.code, 'Refused', listed.detail, listed.errors);
	return connectorJson(listed.list);
}

export function action({ request }: Route.ActionArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
