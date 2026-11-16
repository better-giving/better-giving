import { data } from 'react-router';
import { parseKeysetCursor } from '$lib/server/db/keyset-cursor';
import { listAllFundraisers, listedRow } from '$lib/server/supporters/admin';
import { database } from '../context';
import type { Route } from './+types/_app.admin.supporter-pages.more';

// Show more on /admin/supporter-pages: the batch of fundraisers after `?after=`, the `next` the
// screen's loader or the batch before handed out, each row mapped as the screen's own loader maps
// it (`listedRow` in $lib/server/supporters/admin.ts). a `loader` and no component, asked by the
// screen's fetcher (./_app.admin.supporter-pages.tsx).
//
// beneath ./_app.tsx, so the session gate is that layout's; staff and members read it alike, as they
// do the screen. every failure answers rather than throws, for
// ./_app.admin.donations.messages.older.ts's reason.

export async function loader({ context, request }: Route.LoaderArgs) {
	const after = parseKeysetCursor(new URL(request.url).searchParams.get('after') ?? '');
	if (after === null) return data({ kind: 'refused' } as const, { status: 400 });
	try {
		const batch = await listAllFundraisers(context.get(database), after);
		return {
			kind: 'pages',
			pages: batch.pages.map(listedRow),
			total: batch.total,
			next: batch.next
		} as const;
	} catch (e) {
		console.error('reading more supporter pages failed:', e);
		return data({ kind: 'refused' } as const, { status: 500 });
	}
}
