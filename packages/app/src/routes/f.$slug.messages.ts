import { data } from 'react-router';
import { donorPageRateLimitRefusal } from '$lib/server/api/rate-limit';
import { parseMessageCursor, readShownMessages } from '$lib/server/pages/messages';
import { readPublicFundraiser } from '$lib/server/supporters/view';
import { database, overDonorPageLimit } from '../context';
import type { Route } from './+types/f.$slug.messages';

// Show more messages on a supporter's fundraiser: the next six of its own gifts' messages after
// `?after=`, asked by a plain `fetch` ($lib/donate/show-more.ts). ./donate.messages.ts in every
// way but the list it reads: nested under ./f.$slug.tsx by its name, so that page's meter charges
// every press, and `no-store` for the same reason.
//
// it lists nothing where the page lists nothing: a fundraiser the public cannot see, or one that
// has ended, draws no messages.

const NO_STORE = { 'cache-control': 'no-store' };

const NOTHING_LISTED = { messages: [], total: 0, next: null } as const;

export async function loader({ context, params, request }: Route.LoaderArgs) {
	if (context.get(overDonorPageLimit)) return donorPageRateLimitRefusal();
	const after = new URL(request.url).searchParams.get('after');
	const cursor = after === null ? null : parseMessageCursor(after);
	if (after !== null && cursor === null) {
		return data({ kind: 'refused' } as const, { status: 400, headers: NO_STORE });
	}
	const db = context.get(database);
	let page: Awaited<ReturnType<typeof readShownMessages>>;
	try {
		const fundraiser = await readPublicFundraiser(db, params.slug);
		page =
			fundraiser.kind === 'live'
				? await readShownMessages(db, cursor, fundraiser.id)
				: NOTHING_LISTED;
	} catch (e) {
		console.error('reading a fundraiser’s messages for show more failed:', e);
		return data({ kind: 'refused' } as const, { status: 500, headers: NO_STORE });
	}
	return data({ kind: 'messages', ...page } as const, { headers: NO_STORE });
}
