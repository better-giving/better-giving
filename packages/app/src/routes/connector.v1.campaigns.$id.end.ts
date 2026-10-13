import { endLiveCampaign } from '$lib/server/connector/campaigns';
import { connectorOrigin } from '$lib/server/connector/origin';
import { connectorJson, connectorProblem, unknownAction } from '$lib/server/connector/surface';
import { database, platform } from '../context';
import type { Route } from './+types/connector.v1.campaigns.$id.end';

// `campaigns.end` (POST): the dashboard's own End, which takes a live campaign off the air.

export async function action({ context, params, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST')
		return unknownAction(new URL(request.url).pathname, request.method);
	const done = await endLiveCampaign(
		context.get(database),
		connectorOrigin(new URL(request.url), context.get(platform).env),
		new Date(),
		params.id
	);
	if (!done.ok)
		return connectorProblem(done.status, done.code, 'Refused', done.detail, done.errors);
	return connectorJson(done.campaign);
}

export function loader({ request }: Route.LoaderArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
