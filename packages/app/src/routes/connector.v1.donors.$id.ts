import { readDonor } from '$lib/server/connector/reads';
import {
	connectorJson,
	connectorProblem,
	notFound,
	unknownAction
} from '$lib/server/connector/surface';
import { database } from '../context';
import type { Route } from './+types/connector.v1.donors.$id';

// `donors.get` (GET).

export async function loader({ context, params, request }: Route.LoaderArgs): Promise<Response> {
	const read = await readDonor(context.get(database), params.id, new URL(request.url));
	if (read === null) return notFound(`Donor ${params.id}`);
	if (!read.ok)
		return connectorProblem(read.status, read.code, 'Refused', read.detail, read.errors);
	return connectorJson(read.donor);
}

export function action({ request }: Route.ActionArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
