import { updateDonationContent } from '$lib/server/connector/donation-page';
import { connectorOrigin, jsonBody } from '$lib/server/connector/origin';
import { connectorJson, connectorProblem, unknownAction } from '$lib/server/connector/surface';
import { database, platform } from '../context';
import type { Route } from './+types/connector.v1.donation-page.content';

// `donation_page.update_content` (PATCH): the donation page's draft only, through the dashboard's own guarded writer.

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'PATCH')
		return unknownAction(new URL(request.url).pathname, request.method);
	const done = await updateDonationContent(
		context.get(database),
		connectorOrigin(new URL(request.url), context.get(platform).env),
		new Date(),
		await jsonBody(request)
	);
	if (!done.ok)
		return connectorProblem(done.status, done.code, 'Refused', done.detail, done.errors);
	return connectorJson(done.page);
}

export function loader({ request }: Route.LoaderArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
