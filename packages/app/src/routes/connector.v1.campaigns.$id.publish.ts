import { publishCampaign } from '$lib/server/connector/campaigns';
import { connectorOrigin } from '$lib/server/connector/origin';
import { connectorJson, connectorProblem, unknownAction } from '$lib/server/connector/surface';
import { database, platform } from '../context';
import type { Route } from './+types/connector.v1.campaigns.$id.publish';

// `campaigns.publish` (POST): the dashboard's own Publish, so what goes live meets the same rules.

export async function action({ context, params, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST')
		return unknownAction(new URL(request.url).pathname, request.method);
	const done = await publishCampaign(
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
