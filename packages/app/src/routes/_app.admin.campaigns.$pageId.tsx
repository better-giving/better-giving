import { Button } from '@better-giving/operator/components/controls/Button';
import { Column, Section } from '@better-giving/operator/components/shell/Layout';
import { href, Link } from 'react-router';
import type { CrumbHandle } from '$lib/admin/crumbs';
import {
	GeneralCard,
	GoalCard,
	MediaCard,
	SettingsCard
} from '$lib/admin/page-edit/campaign-cards';
import { PublishBanner } from '$lib/admin/page-edit/publish-banner';
import { UnreadableDraft } from '$lib/admin/page-edit/page-presses';
import { screenTitle } from '$lib/admin/screen-title';
import { formPress } from '$lib/admin/unreached';
import { CAMPAIGN_EDIT_FORM_IDS } from '$lib/page/edit-forms';
import { DISCARD_FORM_ID, PUBLISH_FORM_ID, UNPUBLISH_FORM_ID } from '$lib/page/publish-form';
import { submittedForm } from '$lib/server/conform';
import { loadFailed, notFound } from '$lib/server/db/load-failure';
import type { Page } from '$lib/server/db/schema';
import { unreadableEditor } from '$lib/server/pages/editor';
import { answerPublishPress } from '$lib/server/pages/publish';
import { readPage } from '$lib/server/pages/queries';
import { saveCampaignSection } from '$lib/server/pages/section-saves';
import { editBanner, readCampaignEditSeeds } from '$lib/server/pages/section-seeds';
import { database, platform } from '../context';
import type { Route } from './+types/_app.admin.campaigns.$pageId';

// a campaign's edit page, reached from its card on the Campaigns list: a plain form of section
// cards — General, Media, Goal and amounts, Settings — under the banner that says where the
// campaign stands against what donors see, and End campaign at the foot. no preview is drawn; the
// banner's Preview page opens the draft in a tab of its own.
//
// **every Save writes the draft**, a card at a time ($lib/server/pages/section-saves.ts), and
// donors see it only at Publish or Publish changes ($lib/server/pages/publish.ts). the name and the
// campaign link are the exception and move at once: the name is the dashboard's, and the link is
// where donors reach the campaign. a link that would stop a published campaign's address working,
// or take an ended campaign's, is asked about before anything moves.
//
// **Unpublish** takes a public campaign down: its address answers nothing and it takes no gifts
// until it is published again ($lib/server/pages/publish.ts, `unpublishCampaign`). **End campaign**
// is the Campaigns list's own confirmation (./_app.admin.campaigns._index.tsx, `?end=`).
//
// **a draft the read rule refuses** ($lib/server/pages/document.ts) opens on a notice in the cards'
// place, with Discard changes where the live page reads: the one screen that can repair the page
// opens whatever the rule now says.
//
// every press is written against the version the page was drawn at. the action below is the one
// writer; `clientAction` only answers, as its form's refusal, a press whose request never reached
// it ($lib/admin/unreached.ts).

const SECTION = 'Campaigns';

const SCREEN_FORMS = [
	...CAMPAIGN_EDIT_FORM_IDS,
	PUBLISH_FORM_ID,
	UNPUBLISH_FORM_ID,
	DISCARD_FORM_ID
] as const;

/** what a press on a page that is not a campaign, or no page at all, is told. */
const gone = (pageId: string) =>
	`no campaign has the id "${pageId}"; open it again from the Campaigns list.`;

export const handle = {
	crumbs: ({ loaderData, pathname }) => [
		{ href: href('/admin/campaigns'), label: SECTION },
		{ href: pathname, label: loaderData?.name ?? SECTION }
	]
} satisfies CrumbHandle<Route.ComponentProps['loaderData']>;

export function meta({ loaderData, matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(loaderData?.name ?? 'Campaign', matches) }];
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
	const db = context.get(database);
	let row: Page | null;
	try {
		row = await readPage(db, params.pageId);
	} catch (e) {
		console.error(`loading campaign ${params.pageId}'s edit page failed:`, e);
		loadFailed('This campaign');
	}
	if (row === null || row.type !== 'campaign' || row.name === null) notFound(gone(params.pageId));
	const now = Date.now();
	const url = new URL(request.url);
	const named = {
		id: row.id,
		name: row.name,
		host: `${url.host}/`,
		version: row.updatedAt.getTime(),
		banner: editBanner(row, now)
	};
	const unreadable = unreadableEditor(row);
	if (unreadable !== null) {
		return { ...named, unreadable: true as const, discardable: unreadable.discardable };
	}
	let seeds: Awaited<ReturnType<typeof readCampaignEditSeeds>>;
	try {
		seeds = await readCampaignEditSeeds(db, context.get(platform).env, row, url.origin);
	} catch (e) {
		console.error(`loading campaign ${params.pageId}'s edit page failed:`, e);
		loadFailed('This campaign');
	}
	return { ...named, unreadable: false as const, seeds };
}

export async function action({ context, params, request }: Route.ActionArgs) {
	const body = await request.formData();
	const db = context.get(database);
	const target = { id: params.pageId, type: 'campaign' } as const;
	const pressed = submittedForm(body, SCREEN_FORMS);
	switch (pressed) {
		case PUBLISH_FORM_ID:
		case UNPUBLISH_FORM_ID:
		case DISCARD_FORM_ID:
			return answerPublishPress(db, target, body, gone(params.pageId));
		default:
			return saveCampaignSection(db, target, pressed, body, gone(params.pageId));
	}
}

export function clientAction({ request, serverAction }: Route.ClientActionArgs) {
	return formPress(request, serverAction);
}

export default function CampaignEditPage({ loaderData }: Route.ComponentProps) {
	const { id, name, host, version, banner } = loaderData;
	return (
		<Column>
			<header className="adm-pageheader">
				<div className="adm-pageheader__row">
					<h1>{name}</h1>
				</div>
			</header>
			<PublishBanner
				state={banner.state}
				version={version}
				noun="campaign"
				address={banner.address === null ? null : `${host}${banner.address.slice(1)}`}
				livePath={banner.address}
				preview={banner.preview}
				unpublishable={banner.unpublishable}
			/>
			{loaderData.unreadable ? (
				<UnreadableDraft version={version} discardable={loaderData.discardable} noun="a campaign" />
			) : (
				<>
					<GeneralCard seed={loaderData.seeds.general} version={version} host={host} />
					<MediaCard seed={loaderData.seeds.media} version={version} />
					<GoalCard seed={loaderData.seeds.goal} version={version} />
					<SettingsCard seed={loaderData.seeds.settings} version={version} />
				</>
			)}
			{banner.endable ? <EndCampaign id={id} /> : null}
		</Column>
	);
}

/** End campaign, which opens the Campaigns list's confirmation for this campaign. */
function EndCampaign({ id }: { readonly id: string }) {
	return (
		<Section card>
			<h2>End campaign</h2>
			<p className="adm-prose">
				Its page shows that it has ended and takes no more gifts. Its gifts and its page are kept.
			</p>
			<div className="adm-actions">
				<Button as={Link} to={`${href('/admin/campaigns')}?end=${encodeURIComponent(id)}`}>
					End campaign
				</Button>
			</div>
		</Section>
	);
}
