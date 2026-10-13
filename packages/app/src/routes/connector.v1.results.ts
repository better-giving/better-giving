import { readResults } from '$lib/server/connector/reads';
import { connectorJson, connectorProblem, unknownAction } from '$lib/server/connector/surface';
import { database } from '../context';
import type { Route } from './+types/connector.v1.results';

// `results.summary` (GET).

export async function loader({ context, request }: Route.LoaderArgs): Promise<Response> {
	const read = await readResults(context.get(database), new URL(request.url), new Date());
	if (!read.ok)
		return connectorProblem(read.status, read.code, 'Refused', read.detail, read.errors);
	return connectorJson(read.results);
}

export function action({ request }: Route.ActionArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
