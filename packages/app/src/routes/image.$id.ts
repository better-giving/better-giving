import {
	imageRateLimitKey,
	imageRateLimitRefusal,
	isRateLimited
} from '$lib/server/api/rate-limit';
import { d1BytesPort } from '$lib/server/images/bytes';
import { servedImage } from '$lib/server/images/served';
import { database, platform } from '../context';
import type { Route } from './+types/image.$id';

// every view is charged, a view the edge already holds included: `servedImage` answers a hit and a
// miss alike, so which one this was is not known until the bytes are already being sent.
export async function loader({ context, params, request }: Route.LoaderArgs): Promise<Response> {
	const { env, ctx } = context.get(platform);
	if (await isRateLimited(env.API_RATE_LIMITER, imageRateLimitKey(request))) {
		return imageRateLimitRefusal();
	}
	return servedImage(d1BytesPort(context.get(database)), ctx, {
		origin: new URL(request.url).origin,
		id: params.id
	});
}
