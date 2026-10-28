import { Column } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import {
	DonationPageGeneralCard,
	DonationPageGivingCard,
	DonationPageSettingsCard
} from '$lib/admin/page-edit/donation-page-cards';
import { ResetCard, UnreadableDraft } from '$lib/admin/page-edit/page-presses';
import { PublishBanner } from '$lib/admin/page-edit/publish-banner';
import { screenTitle } from '$lib/admin/screen-title';
import { formPress } from '$lib/admin/unreached';
import { DONATION_PAGE_EDIT_FORM_IDS } from '$lib/page/edit-forms';
import {
	DISCARD_FORM_ID,
	PUBLISH_FORM_ID,
	RESET_FORM_ID,
	UNDO_FORM_ID
} from '$lib/page/publish-form';
import { submittedForm } from '$lib/server/conform';
import { loadFailed } from '$lib/server/db/load-failure';
import type { Page } from '$lib/server/db/schema';
import { ensureDonationPage } from '$lib/server/pages/donation-page';
import { unreadableEditor } from '$lib/server/pages/editor';
import { answerPublishPress } from '$lib/server/pages/publish';
import { answerResetPress, hasEditsToReset } from '$lib/server/pages/reset';
import { saveDonationPageSection } from '$lib/server/pages/section-saves';
import { editBanner, readDonationPageEditSeeds } from '$lib/server/pages/section-seeds';
import { loadPageView } from '$lib/server/pages/view';
import { database, platform } from '../context';
import type { Route } from './+types/_app.admin.donation-page';

// the Donation page's edit page, reached from the globe beside the organisation's name: a plain
// form of section cards — General, Donation settings, Settings — under the banner that says
// whether donors see the draft, and Reset to default at the foot while there is something to reset.
// the page is always at /donate and always public, so it has no name, no link and no Unpublish.
//
// **the loader makes the page on first need** (`ensureDonationPage` in
// $lib/server/pages/donation-page.ts), so on a fresh deployment the globe opens this page rather
// than a 404, as /donate answers before anyone has opened it.
//
// **every Save writes the draft**, a card at a time ($lib/server/pages/section-saves.ts), and
// donors see it only at Publish changes ($lib/server/pages/publish.ts). until a Publish carries
// donation settings, the program follows the active programs ($lib/server/pages/donation-page.ts).
//
// **a draft the read rule refuses** ($lib/server/pages/document.ts) opens on a notice in the cards'
// place, with Discard changes where the live page reads and Reset to default always, which
// repairs a live page the rule refuses too ($lib/server/pages/reset.ts).
//
// the action below is the one writer; `clientAction` only answers, as its form's refusal, a press
// whose request never reached it ($lib/admin/unreached.ts).

const SCREEN_TITLE = 'Donation page';

const SCREEN_FORMS = [
	...DONATION_PAGE_EDIT_FORM_IDS,
	PUBLISH_FORM_ID,
	UNDO_FORM_ID,
	DISCARD_FORM_ID,
	RESET_FORM_ID
] as const;

const NO_DONATION_PAGE = 'Nothing was saved: there is no Donation page yet. Reload the page.';

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const db = context.get(database);
	const { env } = context.get(platform);
	const url = new URL(request.url);
	const now = Date.now();
	let row: Page;
	let takingGifts: boolean;
	try {
		row = await ensureDonationPage(db);
		// the donor page's own refusal (`loadPageView` in $lib/server/pages/view.ts), on the
		// published document: a fresh page is stored live even where that read refuses it.
		const view = await loadPageView(
			db,
			env,
			{
				id: row.id,
				type: 'donation_page',
				formId: row.formId,
				name: null,
				document: row.published,
				address: '/donate'
			},
			request,
			{ now }
		);
		takingGifts = view.kind !== 'refused';
	} catch (e) {
		console.error('loading the Donation page edit page failed:', e);
		loadFailed('The Donation page');
	}
	const frame = {
		host: `${url.host}/`,
		version: row.updatedAt.getTime(),
		banner: editBanner(row, now),
		takingGifts
	};
	const unreadable = unreadableEditor(row);
	// a draft the rule refuses is itself an edit Reset puts back (`hasEditsToReset`).
	if (unreadable !== null) {
		return {
			...frame,
			unreadable: true as const,
			discardable: unreadable.discardable,
			hasEdits: true
		};
	}
	let seeds: Awaited<ReturnType<typeof readDonationPageEditSeeds>>;
	try {
		seeds = await readDonationPageEditSeeds(db, env, row, url.origin);
	} catch (e) {
		console.error('loading the Donation page edit page failed:', e);
		loadFailed('The Donation page');
	}
	return { ...frame, unreadable: false as const, seeds, hasEdits: hasEditsToReset(row) };
}

export async function action({ context, request }: Route.ActionArgs) {
	const body = await request.formData();
	const db = context.get(database);
	const target = { type: 'donation_page' } as const;
	const pressed = submittedForm(body, SCREEN_FORMS);
	switch (pressed) {
		case PUBLISH_FORM_ID:
		case UNDO_FORM_ID:
		case DISCARD_FORM_ID:
			return answerPublishPress(db, target, body, NO_DONATION_PAGE);
		case RESET_FORM_ID:
			return answerResetPress(db, body, NO_DONATION_PAGE);
		default:
			return saveDonationPageSection(db, target, pressed, body, NO_DONATION_PAGE);
	}
}

export function clientAction({ request, serverAction }: Route.ClientActionArgs) {
	return formPress(request, serverAction);
}

export default function DonationPageEditPage({ loaderData }: Route.ComponentProps) {
	const { host, version, banner, takingGifts } = loaderData;
	return (
		<Column>
			<header className="adm-pageheader">
				<div className="adm-pageheader__row">
					<h1>{SCREEN_TITLE}</h1>
				</div>
			</header>
			<PublishBanner
				state={banner.state}
				version={version}
				noun="Donation page"
				address={`${host}donate`}
				livePath="/donate"
				preview={banner.preview}
				unpublishable={false}
				undoable={banner.undoable}
			/>
			{takingGifts ? null : (
				<Banner tone="attention" word="Not taking gifts">
					Donors who open /donate are told it can’t take a gift right now.
				</Banner>
			)}
			{loaderData.unreadable ? (
				<UnreadableDraft
					version={version}
					discardable={loaderData.discardable}
					noun="Donation page"
				/>
			) : (
				<>
					<DonationPageGeneralCard seed={loaderData.seeds.general} version={version} />
					<DonationPageGivingCard seed={loaderData.seeds.giving} version={version} />
					<DonationPageSettingsCard seed={loaderData.seeds.settings} version={version} />
				</>
			)}
			{loaderData.hasEdits ? <ResetCard version={version} /> : null}
		</Column>
	);
}
