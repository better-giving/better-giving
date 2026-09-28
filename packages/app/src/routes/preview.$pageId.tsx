import { data } from 'react-router';
import { DonateNotice } from '$lib/donate/notice';
import { PageWithCard } from '$lib/donate/page-with-card';
import { donorPageLinks, FORM_LOOK, PlainDonationPage, PlainPage } from '$lib/donate/plain-page';
import { staffGate } from '$lib/server/auth/gate';
import { readPage } from '$lib/server/pages/queries';
import { loadPageView, refusedPage } from '$lib/server/pages/view';
import { database, platform } from '../context';
import type { PreviewPolicyHandle } from '../document-policy';
import type { Route } from './+types/preview.$pageId';

// the editor's preview of a page: its draft, drawn by the renderer /donate draws with, inside the
// editor's frame ($lib/admin/editor/preview-frame.tsx) at /preview/{pageId}.
//
// **it is outside ./_app.tsx and mounts the session gate itself.** the layout draws the dashboard's
// frame around every screen beneath it, and a donor page drawn inside that frame is not what a
// donor sees; so the gate that layout mounts is mounted here too, the same `staffGate`, and
// ../routes.spec.ts holds this file to it. a signed-out request is sent to the sign-in like any
// other.
//
// **what it draws is the draft, whole**: the blocks, layout and look of the stored draft, and the
// donation settings it holds laid over the page's owned settings row as publishing would lay them
// ($lib/server/pages/view.ts). a campaign nobody has published draws its box too, though its row
// takes no gift yet.
//
// **nothing in it acts.** the renderer's preview mode reports the block a click lands in to the
// editor and lets no press through, and draws the donation box inert, so no gift can start here
// ($lib/donate/page-view.tsx). a draft the read rule refuses draws the box alone, inert here too.
// the operator's own controls are the editor's, outside the frame.
//
// it may be framed by this deployment's own pages and by nobody else's (../document-policy.ts), and
// no cache keeps it: a draft read under a session.

export const middleware: Route.MiddlewareFunction[] = [staffGate];

export async function loader({ context, params, request }: Route.LoaderArgs) {
	const db = context.get(database);
	// off the context rather than returned: a loader's value is serialized into the document.
	const { env } = context.get(platform);
	const page = await readPage(db, params.pageId);
	if (page === null) throw data(null, { status: 404 });
	const loaded = await loadPageView(
		db,
		env,
		{
			id: page.id,
			type: page.type,
			formId: page.formId,
			name: page.name,
			document: page.draft,
			// an ended campaign that gave its address up has none, so its share buttons send the
			// Donation page's.
			address: page.type === 'donation_page' || page.slug === null ? '/donate' : `/${page.slug}`
		},
		request,
		{ now: Date.now(), preview: true }
	);
	if (loaded.kind === 'refused') return refusedPage();
	return loaded;
}

export function headers(): Headers {
	return new Headers({ 'cache-control': 'no-store' });
}

export const handle: PreviewPolicyHandle = { documentPolicy: 'preview' };

export function links(): Route.LinkDescriptors {
	return donorPageLinks();
}

export default function PagePreview({ loaderData }: Route.ComponentProps) {
	switch (loaderData.kind) {
		case 'page':
			return <PageWithCard {...loaderData.view} />;
		case 'plain':
			return (
				<div inert>
					<PlainDonationPage config={loaderData.config} look={loaderData.look} />
				</div>
			);
		case 'refused':
			return (
				<PlainPage look={FORM_LOOK}>
					<DonateNotice />
				</PlainPage>
			);
	}
}
