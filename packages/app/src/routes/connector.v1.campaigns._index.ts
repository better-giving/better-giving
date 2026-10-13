import {
	type CampaignStatus,
	createFromTitle,
	listCampaigns
} from '$lib/server/connector/campaigns';
import { connectorOrigin, jsonBody } from '$lib/server/connector/origin';
import { connectorJson, connectorProblem, unknownAction } from '$lib/server/connector/surface';
import { database, platform } from '../context';
import type { Route } from './+types/connector.v1.campaigns._index';

// `campaigns.list` (GET) and `campaigns.create` (POST).

const STATUSES: readonly CampaignStatus[] = ['draft', 'published', 'ended'];
const LIMIT_DEFAULT = 25;
const LIMIT_MAX = 100;

export async function loader({ context, request }: Route.LoaderArgs): Promise<Response> {
	const url = new URL(request.url);
	const status = url.searchParams.get('status');
	if (status !== null && !STATUSES.includes(status as CampaignStatus)) {
		return connectorProblem(
			422,
			'invalid',
			'Invalid status',
			`status is one of ${STATUSES.join(', ')}, or left out for every campaign.`,
			[{ path: 'status', message: `${JSON.stringify(status)} is not a status` }]
		);
	}
	const limit = Math.min(
		Math.max(Number(url.searchParams.get('limit') ?? LIMIT_DEFAULT) || LIMIT_DEFAULT, 1),
		LIMIT_MAX
	);
	const from = Math.max(Number(url.searchParams.get('cursor') ?? 0) || 0, 0);
	const all = await listCampaigns(
		context.get(database),
		connectorOrigin(url, context.get(platform).env),
		new Date(),
		status as CampaignStatus | null
	);
	const data = all.slice(from, from + limit);
	return connectorJson({
		data,
		next_cursor: from + limit < all.length ? String(from + limit) : null
	});
}

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST')
		return unknownAction(new URL(request.url).pathname, request.method);
	const made = await createFromTitle(
		context.get(database),
		connectorOrigin(new URL(request.url), context.get(platform).env),
		new Date(),
		await jsonBody(request)
	);
	if (!made.ok)
		return connectorProblem(made.status, made.code, 'Refused', made.detail, made.errors);
	return connectorJson(made.campaign, 201);
}
