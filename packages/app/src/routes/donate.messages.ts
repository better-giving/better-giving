import { data } from 'react-router';
import { donorPageRateLimitRefusal } from '$lib/server/api/rate-limit';
import { parseMessageCursor, readShownMessages } from '$lib/server/pages/messages';
import { database, overDonorPageLimit } from '../context';
import type { Route } from './+types/donate.messages';

// Show more messages on /donate: the next six donors' messages after `?after=`, the `next` the page
// or the last press was handed (`DonateProfile.messages` in $lib/donate/profile.ts). a `loader` and
// no component, asked by a fetcher.
//
// nested under ./donate.tsx by its name, so that page's `meterDonorPage` charges every press to the
// same bucket a view of the page spends. `no-store` like the page: a list a hide or a refund changes
// is no capability and no immutable bytes ($lib/server/runtime/response-cache.ts).

const NO_STORE = { 'cache-control': 'no-store' };

export async function loader({ context, request }: Route.LoaderArgs) {
	if (context.get(overDonorPageLimit)) return donorPageRateLimitRefusal();
	const after = new URL(request.url).searchParams.get('after');
	const cursor = after === null ? null : parseMessageCursor(after);
	if (after !== null && cursor === null) {
		return data({ kind: 'refused' } as const, { status: 400, headers: NO_STORE });
	}
	// a failed read answers as a refusal rather than a throw: a fetcher's thrown load is drawn by the
	// page's error boundary in place of the whole page, a gift in progress with it.
	let page: Awaited<ReturnType<typeof readShownMessages>>;
	try {
		page = await readShownMessages(context.get(database), cursor);
	} catch (e) {
		console.error('reading donor messages for show more failed:', e);
		return data({ kind: 'refused' } as const, { status: 500, headers: NO_STORE });
	}
	return data({ kind: 'messages', ...page } as const, { headers: NO_STORE });
}
