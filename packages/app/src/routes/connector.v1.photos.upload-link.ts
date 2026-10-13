import { connectorOrigin, jsonBody } from '$lib/server/connector/origin';
import { makePhotoLink } from '$lib/server/connector/photos';
import { connectorJson, connectorProblem, unknownAction } from '$lib/server/connector/surface';
import { connection, database, platform } from '../context';
import type { Route } from './+types/connector.v1.photos.upload-link';

// `photos.upload_link` (POST): a single-use link the chat hands the operator to add one photo.

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST')
		return unknownAction(new URL(request.url).pathname, request.method);
	const made = await makePhotoLink(
		context.get(database),
		connectorOrigin(new URL(request.url), context.get(platform).env),
		context.get(connection).id,
		await jsonBody(request)
	);
	if (!made.ok) return connectorProblem(made.status, made.code, 'Refused', made.detail);
	return connectorJson({ url: made.url, expires_at: made.expiresAt.toISOString() }, 201);
}

export function loader({ request }: Route.LoaderArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
