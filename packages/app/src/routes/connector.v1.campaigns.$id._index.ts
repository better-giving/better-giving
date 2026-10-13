import { readCampaign } from '$lib/server/connector/campaigns';
import { connectorOrigin } from '$lib/server/connector/origin';
import { connectorJson, notFound, unknownAction } from '$lib/server/connector/surface';
import { database, platform } from '../context';
import type { Route } from './+types/connector.v1.campaigns.$id._index';

// `campaigns.get`.

export async function loader({ context, params, request }: Route.LoaderArgs): Promise<Response> {
	const campaign = await readCampaign(
		context.get(database),
		connectorOrigin(new URL(request.url), context.get(platform).env),
		new Date(),
		params.id
	);
	return campaign === null ? notFound(`Campaign ${params.id}`) : connectorJson(campaign);
}

export function action({ request }: Route.ActionArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
