import { unsubscribe } from '$lib/server/zapier/subscriptions';
import { database } from '../context';
import type { Route } from './+types/zapier.hooks.$id';

// Zapier unsubscribing a Zap: the REST hook's `performUnsubscribe`, `DELETE` with the id
// ./zapier.hooks.ts answered. the subscription ends as `unsubscribed` and what it was still owed
// is dropped ($lib/server/zapier/subscriptions.ts).
//
// 204 for an unknown or already-ended id too: Zapier reads any other answer to an unsubscribe as
// a failure, and there is nothing left to stop. one key per deployment is the only account there
// is, so the id alone scopes the delete.

export async function action({ context, params }: Route.ActionArgs): Promise<Response> {
	await unsubscribe(context.get(database), params.id);
	return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
