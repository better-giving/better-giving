import { readSamples } from '$lib/server/zapier/payload';
import { isZapierTrigger, unknownTriggerRefusal, zapierJson } from '$lib/server/zapier/surface';
import { database } from '../context';
import type { Route } from './+types/zapier.samples.$trigger';

// what the Zap editor shows for a trigger: the REST hook's `performList`. up to three of the
// latest real events, newest first, rendered by the same read a live send makes — so a field in
// the sample is a field every live event carries ($lib/server/zapier/payload.ts, `readSamples`).
//
// an envelope, `{ data }`, never a bare array: the Zapier app unwraps `data`, and an envelope can
// grow a field later where an array cannot.

export async function loader({ context, params }: Route.LoaderArgs): Promise<Response> {
	if (!isZapierTrigger(params.trigger)) return unknownTriggerRefusal(params.trigger);
	return zapierJson({ data: await readSamples(context.get(database), params.trigger) });
}
