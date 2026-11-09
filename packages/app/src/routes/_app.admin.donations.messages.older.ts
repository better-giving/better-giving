import { data } from 'react-router';
import { parseModeratedCursor } from '$lib/server/pages/messages';
import { readOlderModeratedPages } from '$lib/server/pages/moderated-pages';
import { database } from '../context';
import type { Route } from './+types/_app.admin.donations.messages.older';

// Show older messages on /admin/donations/messages: the list past its first page, down through
// `?pages=` pages after `?after=`, the `next` the screen's first page ended on
// (`readOlderModeratedPages` in $lib/server/pages/moderated-pages.ts). a `loader` and no component, asked by the screen's
// fetcher, which asks for every older page it holds at once so the re-read after a press redraws
// them all (./_app.admin.donations.messages.tsx).
//
// beneath ./_app.tsx, so the session gate is that layout's; staff and members read it alike, as they
// do the screen. every failure answers rather than throws: a fetcher's thrown load is drawn by the
// screen's error boundary in place of the whole list.

/** a count of pages, as the screen writes one. */
const PAGE_COUNT = /^[1-9]\d{0,3}$/;

export async function loader({ context, request }: Route.LoaderArgs) {
	const search = new URL(request.url).searchParams;
	const after = parseModeratedCursor(search.get('after') ?? '');
	const pages = search.get('pages') ?? '';
	if (after === null || !PAGE_COUNT.test(pages)) {
		return data({ kind: 'refused' } as const, { status: 400 });
	}
	try {
		const read = await readOlderModeratedPages(context.get(database), after, Number(pages));
		return { kind: 'messages', messages: read.messages, next: read.next } as const;
	} catch (e) {
		console.error('reading older public messages failed:', e);
		return data({ kind: 'refused' } as const, { status: 500 });
	}
}
