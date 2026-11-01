import { updateContent } from '$lib/server/connector/campaigns';
import { connectorOrigin, jsonBody } from '$lib/server/connector/origin';
import { connectorJson, connectorProblem, unknownAction } from '$lib/server/connector/surface';
import { database, platform } from '../context';
import type { Route } from './+types/connector.v1.campaigns.$id.content';

// `campaigns.update_content` (PATCH): the campaign's draft only, through the dashboard's own guarded writer.

export async function action({ context, params, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'PATCH')
		return unknownAction(new URL(request.url).pathname, request.method);
	const done = await updateContent(
		context.get(database),
		connectorOrigin(new URL(request.url), context.get(platform).env),
		new Date(),
		params.id,
		await jsonBody(request)
	);
	if (!done.ok)
		return connectorProblem(done.status, done.code, 'Refused', done.detail, done.errors);
	return connectorJson(done.campaign);
}

export function loader({ request }: Route.LoaderArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
