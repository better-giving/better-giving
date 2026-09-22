import { isRateLimited, rateLimitRefusal, zapierRateLimitKey } from '$lib/server/api/rate-limit';
import { verifyZapierKey } from '$lib/server/zapier/key';
import { ZAPIER_RATE_LIMIT_FIX, zapierKeyRefusal } from '$lib/server/zapier/surface';
import { database, platform, zapierKeyHash } from '../context';
import type { Route } from './+types/zapier';

// the layout every route Zapier's servers call sits under, and the one place the key is checked.
//
// a route file named `zapier.<anything>` nests beneath it and inherits the check by existing, the
// same mounting src/routes/console.ts makes for the console's credential and for the same reason:
// a check each route called leaves the next route open the day it is written. ../routes.spec.ts
// holds that every route served under `/zapier` is under this file.
//
// only a failed check is charged. Zapier's egress addresses are shared by every Zapier user, so
// charging every request would let a stranger's keyless loop spend this organisation's own calls;
// a caller holding the key is never refused for its address. what a keyless caller costs is one
// point read at most — a value in no key format is turned away before any — and the 256-bit key
// is what bounds guessing ($lib/server/api/rate-limit.ts, `zapierRateLimitKey`).
//
// the matched hash goes down on the context (`zapierKeyHash` in ../context.ts) for the write that
// must only land while the key is still current.
//
// neither step touches `request.body` — the endpoint beneath reads it, once (CLAUDE.md).
//
// a resource layout: no default export and no loader, so `/zapier` itself answers nothing.

const zapierGate: Route.MiddlewareFunction = async ({ context, request }, next) => {
	const keyHash = await verifyZapierKey(
		context.get(database),
		request.headers.get('authorization')
	);
	if (keyHash === null) {
		const { env } = context.get(platform);
		return (await isRateLimited(env.API_RATE_LIMITER, zapierRateLimitKey(request)))
			? rateLimitRefusal(ZAPIER_RATE_LIMIT_FIX)
			: zapierKeyRefusal();
	}
	context.set(zapierKeyHash, keyHash);
	return next();
};

export const middleware: Route.MiddlewareFunction[] = [zapierGate];
