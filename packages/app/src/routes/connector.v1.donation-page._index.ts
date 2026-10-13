import { readDonationPage } from '$lib/server/connector/donation-page';
import { connectorOrigin } from '$lib/server/connector/origin';
import { connectorJson, connectorProblem, unknownAction } from '$lib/server/connector/surface';
import { database, platform } from '../context';
import type { Route } from './+types/connector.v1.donation-page._index';

// `donation_page.get`.

export async function loader({ context, request }: Route.LoaderArgs): Promise<Response> {
	const read = await readDonationPage(
		context.get(database),
		connectorOrigin(new URL(request.url), context.get(platform).env),
		new Date()
	);
	if (!read.ok) return connectorProblem(read.status, read.code, 'Refused', read.detail);
	return connectorJson(read.page);
}

export function action({ request }: Route.ActionArgs): Response {
	return unknownAction(new URL(request.url).pathname, request.method);
}
