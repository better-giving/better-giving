import {
	imageRateLimitKey,
	imageRateLimitRefusal,
	isRateLimited
} from '$lib/server/api/rate-limit';
import { d1BytesPort } from '$lib/server/images/bytes';
import { servedImage } from '$lib/server/images/served';
import { database, platform } from '../context';
import type { Route } from './+types/image.$id';

// only a view the edge does not hold is charged: the meter protects D1, and a view answered from the
// edge cache never reaches it. so a caller over the limit is still drawn every photo already kept in
// their data centre, and is refused only the read.
export async function loader({ context, params, request }: Route.LoaderArgs): Promise<Response> {
	const { env, ctx } = context.get(platform);
	return servedImage(
		d1BytesPort(context.get(database)),
		ctx,
		{ origin: new URL(request.url).origin, id: params.id },
		{
			beforeRead: async () =>
				(await isRateLimited(env.API_RATE_LIMITER, imageRateLimitKey(request)))
					? imageRateLimitRefusal()
					: null
		}
	);
}
