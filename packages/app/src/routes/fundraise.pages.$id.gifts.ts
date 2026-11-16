import { data } from 'react-router';
import { parseKeysetCursor } from '$lib/server/db/keyset-cursor';
import { signedInSupporter } from '$lib/server/supporters/area';
import { readMoreOwnGifts, servedGift } from '$lib/server/supporters/pages';
import { database } from '../context';
import type { Route } from './+types/fundraise.pages.$id.gifts';

// Show more gifts on a supporter's manage screen (./fundraise.pages.$id._index.tsx): the batch of
// the page's gifts after `?after=`, the `giftNext` that screen's loader handed out or the `next`
// of the batch before. a `loader` and no component, read under the supporter's session as the
// screen is, so another supporter's page is the same 404 as an unknown one
// ($lib/server/supporters/pages.ts), and `no-store` for the screen's reason.
//
// every refusal answers rather than throws, for ./_app.admin.donations.messages.older.ts's reason:
// a fetcher's thrown load is drawn by the screen's error boundary in place of the whole screen. a
// caller with no session is the exception: the gate's redirect to sign in, which the screen's
// reader ($lib/next-batch.ts) answers by reloading the screen, whose own loader then redirects.

const NO_STORE = { 'cache-control': 'no-store' };

export async function loader({ context, params, request }: Route.LoaderArgs) {
	const db = context.get(database);
	const signedIn = await signedInSupporter(db, request);
	const after = parseKeysetCursor(new URL(request.url).searchParams.get('after') ?? '');
	if (after === null) return data({ kind: 'refused' } as const, { status: 400, headers: NO_STORE });
	let batch: Awaited<ReturnType<typeof readMoreOwnGifts>>;
	try {
		batch = await readMoreOwnGifts(db, signedIn.supporterId, params.id, after);
	} catch (e) {
		console.error(`reading more gifts of fundraiser ${params.id} failed:`, e);
		return data({ kind: 'refused' } as const, { status: 500, headers: NO_STORE });
	}
	if (batch === null) {
		return data({ kind: 'refused' } as const, { status: 404, headers: NO_STORE });
	}
	return data(
		{
			kind: 'gifts',
			gifts: batch.gifts.map(servedGift),
			total: batch.total,
			next: batch.next
		} as const,
		{ headers: NO_STORE }
	);
}
