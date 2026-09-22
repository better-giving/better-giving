import { subscribe, type SubscribeRequest } from '$lib/server/zapier/subscriptions';
import {
	isZapierTrigger,
	unknownTriggerRefusal,
	zapierJson,
	zapierKeyRefusal
} from '$lib/server/zapier/surface';
import { database, zapierKeyHash } from '../context';
import type { Route } from './+types/zapier.hooks';

// Zapier subscribing a Zap: the REST hook's `performSubscribe`, `{ trigger, hook_url }`. the id
// answered is what Zapier stores as `subscribeData.id` and sends back to ./zapier.hooks.$id.ts.
//
// **a hook is accepted at `https://hooks.zapier.com` and nowhere else**, with no user and no port
// of its own, and stored as parsed. what that bounds is where this worker posts: every event goes
// unsigned to the address stored here, and never to a host that is not Zapier's. it does not keep
// a leaked key's holder from the feed — any Zapier account can take a hook on that host. the path
// is left open: Zapier's docs describe `bundle.targetUrl` without stating its shape. a move by
// Zapier to another host surfaces as the 422 below naming it.

const ZAPIER_HOOK_HOST = 'hooks.zapier.com';

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	const asked = await readSubscribe(request);
	if (!asked.ok) return asked.refusal;
	const subscribed = await subscribe(
		context.get(database),
		asked.value,
		context.get(zapierKeyHash)
	);
	// the key was replaced after this request's check: the same answer as arriving with it.
	if (subscribed === null) return zapierKeyRefusal();
	// 200 on a repeat: Zapier retries a subscribe it never heard back from.
	return zapierJson({ id: subscribed.id }, subscribed.created ? 201 : 200);
}

type Read = { ok: true; value: SubscribeRequest } | { ok: false; refusal: Response };

async function readSubscribe(request: Request): Promise<Read> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return refuse(
			400,
			'The body of this request is not JSON.',
			'Send `{ "trigger": "new_gift", "hook_url": "<bundle.targetUrl>" }` as `application/json`.'
		);
	}
	const { trigger, hook_url: hookUrl } = (body ?? {}) as Record<string, unknown>;
	if (!isZapierTrigger(trigger)) return { ok: false, refusal: unknownTriggerRefusal(trigger) };
	const hook = zapierHook(hookUrl);
	if (hook === null)
		return refuse(
			422,
			`\`hook_url\` is ${JSON.stringify(hookUrl)}, which is not a Zapier hook address.`,
			`Send the \`bundle.targetUrl\` Zapier gave the subscribe — an \`https://${ZAPIER_HOOK_HOST}/\` address.`
		);
	return { ok: true, value: { trigger, hookUrl: hook } };
}

/** `value` as the address this deployment stores and posts to, or `null` if it is not a Zapier hook. */
function zapierHook(value: unknown): string | null {
	if (typeof value !== 'string' || !URL.canParse(value)) return null;
	const url = new URL(value);
	const isZapier =
		url.protocol === 'https:' &&
		url.hostname === ZAPIER_HOOK_HOST &&
		url.port === '' &&
		url.username === '' &&
		url.password === '';
	return isZapier ? url.href : null;
}

function refuse(status: 400 | 422, message: string, fix: string): Read {
	return { ok: false, refusal: zapierJson({ message, fix }, status) };
}
