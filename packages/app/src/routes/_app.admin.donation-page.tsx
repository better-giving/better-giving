import { Banner } from '@better-giving/operator/components/status/Banner';
import { useCallback, useState } from 'react';
import { BlockEditSheet, isDonationBox } from '$lib/admin/editor/block-edit';
import { DonationSettingsSheet } from '$lib/admin/editor/donation-settings';
import { EditorShell } from '$lib/admin/editor/editor-shell';
import { ShareMessageSettingsSheet } from '$lib/admin/editor/page-settings';
import { PreviewFrame } from '$lib/admin/editor/preview-frame';
import { PublishBar } from '$lib/admin/editor/publish-bar';
import { useSettingsPresses } from '$lib/admin/editor/settings-presses';
import { usePublishPresses } from '$lib/admin/editor/publish-wiring';
import { SettingsSheet } from '$lib/admin/editor/settings-sheet';
import { screenTitle } from '$lib/admin/screen-title';
import { formPress } from '$lib/admin/unreached';
import { BLOCK_FORM_IDS } from '$lib/page/block-edit';
import {
	PAGE_END_DATE_FORM_ID,
	PAGE_GOAL_FORM_ID,
	PAGE_SETTING_FORM_IDS
} from '$lib/page/page-settings-form';
import {
	DISCARD_FORM_ID,
	PUBLISH_FORM_ID,
	PUBLISH_FORMS,
	RESET_FORM_ID,
	UNDO_FORM_ID
} from '$lib/page/publish-form';
import { PAGE_SETTINGS_FORM_ID, type SettingsSeed } from '$lib/page/settings-form';
import { submittedForm } from '$lib/server/conform';
import { loadFailed } from '$lib/server/db/load-failure';
import type { Page } from '$lib/server/db/schema';
import { editorDraft, saveBlockForm } from '$lib/server/pages/blocks';
import { ensureDonationPage } from '$lib/server/pages/donation-page';
import {
	editorPage,
	readEditorSettings,
	saveDraftSettings,
	unreadableEditor
} from '$lib/server/pages/editor';
import { answerPublishPress } from '$lib/server/pages/publish';
import { savePageSetting } from '$lib/server/pages/page-settings';
import { answerResetPress, hasEditsToReset } from '$lib/server/pages/reset';
import { database, platform } from '../context';
import type { BareHandle } from './_app';
import type { Route } from './+types/_app.admin.donation-page';

// the Donation page's editor, reached from the globe beside the organisation's name: its draft
// framed by the preview route, the publish bar over it, and the Settings sheet behind the bar's
// Settings, beside Done while Edit is on. the parts are $lib/admin/editor/'s. the Donation page
// has no name to edit and no address of its own: the bar calls it "Donation page", and it is
// always at /donate.
//
// **the loader makes the page on first need** (`ensureDonationPage` in
// $lib/server/pages/donation-page.ts), so on a fresh deployment the globe opens an editor rather
// than a 404, as /donate answers before anyone has opened it.
//
// **the donation settings** are the draft's, saved by their sheet's one Done and reaching donors
// only at Publish, as a campaign's are ($lib/server/pages/editor.ts). a goal and an end date are a
// campaign's alone, and this action refuses them ($lib/server/pages/page-settings.ts). until a
// Publish carries donation settings, the program follows the active programs
// ($lib/server/pages/donation-page.ts).
//
// **a draft the read rule refuses** ($lib/server/pages/document.ts) opens the editor on a notice
// in the preview's place, with Discard changes where the live page reads and Reset to default
// always, which repairs a live page the rule refuses too.
//
// **Publish, Undo and Discard changes** are $lib/server/pages/publish.ts's, and **Reset to default**
// $lib/server/pages/reset.ts's, which also says when the page has edits to reset; the presses and
// their confirms are mounted through $lib/admin/editor/publish-wiring.tsx.
//
// **a block's words and pictures** are edited in its sheet, opened by a click on the block in the
// preview while Edit is on and by its row in Settings' block list alike, and the layout by
// Settings' pictures; each writes the draft ($lib/server/pages/blocks.ts), as a campaign's editor
// does. the look, the sharing and a block added, removed or moved are presses there too.
// the donation box opens Donation settings, which are what it draws.
//
// the action below is the one writer; `clientAction` only answers, as its form's refusal, a press
// whose request never reached it ($lib/admin/unreached.ts).

export const handle: BareHandle = { frame: 'bare' };

const SCREEN_TITLE = 'Donation page';

const SCREEN_FORMS = [
	PAGE_SETTINGS_FORM_ID,
	...PAGE_SETTING_FORM_IDS,
	...BLOCK_FORM_IDS,
	...PUBLISH_FORMS,
	RESET_FORM_ID
] as const;

const NO_DONATION_PAGE = 'Nothing was saved: there is no Donation page yet. Reload the editor.';

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const db = context.get(database);
	const { env } = context.get(platform);
	let row: Page;
	let settings: SettingsSeed;
	const now = Date.now();
	try {
		row = await ensureDonationPage(db);
		const unreadable = unreadableEditor(row, now);
		// a draft the rule refuses is itself an edit Reset puts back (`hasEditsToReset`).
		if (unreadable !== null) return { ...unreadable, hasEdits: true };
		settings = await readEditorSettings(db, env, row, new URL(request.url).origin);
	} catch (e) {
		console.error('loading the Donation page editor failed:', e);
		loadFailed('The Donation page');
	}
	return {
		...editorPage(row, now),
		...editorDraft(row, settings.currency),
		settings,
		hasEdits: hasEditsToReset(row)
	};
}

export async function action({ context, request }: Route.ActionArgs) {
	const body = await request.formData();
	const db = context.get(database);

	const pressed = submittedForm(body, SCREEN_FORMS);
	switch (pressed) {
		case PAGE_SETTINGS_FORM_ID:
			return saveDraftSettings(db, { type: 'donation_page' }, body, NO_DONATION_PAGE);
		case PUBLISH_FORM_ID:
		case UNDO_FORM_ID:
		case DISCARD_FORM_ID:
			return answerPublishPress(db, { type: 'donation_page' }, body, NO_DONATION_PAGE);
		case RESET_FORM_ID:
			return answerResetPress(db, body, NO_DONATION_PAGE);
		case PAGE_GOAL_FORM_ID:
		case PAGE_END_DATE_FORM_ID:
			return savePageSetting(db, { type: 'donation_page' }, pressed, body, NO_DONATION_PAGE);
		default:
			return saveBlockForm(db, { type: 'donation_page' }, pressed, body, NO_DONATION_PAGE);
	}
}

export function clientAction({ request, serverAction }: Route.ClientActionArgs) {
	return formPress(request, serverAction);
}

type Loaded = Route.ComponentProps['loaderData'];

export default function DonationPageEditor({ loaderData }: Route.ComponentProps) {
	return loaderData.unreadable ? (
		<UnreadableDraftEditor loaderData={loaderData} />
	) : (
		<DraftEditor loaderData={loaderData} />
	);
}

/** what the bar and the notice call a draft the read rule refuses. */
const UNREADABLE_WORD = 'This draft can’t be read';

/**
 * the editor over a draft the read rule refuses: the bar, with Discard changes where the live page
 * reads and Reset to default always, and a notice in the preview's place.
 */
function UnreadableDraftEditor({
	loaderData
}: {
	readonly loaderData: Extract<Loaded, { unreadable: true }>;
}) {
	const { state, version, discardable, hasEdits } = loaderData;
	const presses = usePublishPresses({ version, state, reset: { hasEdits } });
	return (
		<EditorShell
			bar={
				<PublishBar
					closeHref="/admin"
					page={{ kind: 'donation' }}
					state={state}
					livePath="/donate"
					{...presses.bar}
					onPublish={undefined}
					publishHeld={UNREADABLE_WORD}
					onDiscard={discardable ? presses.bar.onDiscard : undefined}
				/>
			}
			preview={
				<div className="adm-main">
					<Banner tone="attention" word={UNREADABLE_WORD}>
						{discardable
							? 'It holds something the Donation page can no longer hold. Discard changes to go back to the live page, or reset the page to the default.'
							: 'It holds something the Donation page can no longer hold. Reset the page to the default to repair it.'}
					</Banner>
				</div>
			}
		>
			{presses.confirm}
		</EditorShell>
	);
}

function DraftEditor({
	loaderData
}: {
	readonly loaderData: Extract<Loaded, { unreadable: false }>;
}) {
	const { state, version, preview, hasEdits } = loaderData;
	const [settings, setSettings] = useState(false);
	const [donationSettings, setDonationSettings] = useState(false);
	const [shareMessage, setShareMessage] = useState(false);
	const presses = usePublishPresses({ version, state, reset: { hasEdits } });
	const [blockId, setBlockId] = useState<string | null>(null);
	const openBlock = loaderData.blocks.find((block) => block.id === blockId) ?? null;
	const closeBlock = useCallback(() => setBlockId(null), []);
	const openBlockSheet = (id: string) =>
		isDonationBox(loaderData.blocks, id) ? setDonationSettings(true) : setBlockId(id);
	const settingsPresses = useSettingsPresses({
		version,
		layout: loaderData.layout,
		look: loaderData.look,
		share: loaderData.share,
		addable: loaderData.addable,
		onAdded: openBlockSheet
	});

	return (
		<EditorShell
			bar={
				<PublishBar
					closeHref="/admin"
					page={{ kind: 'donation' }}
					state={state}
					livePath="/donate"
					{...presses.bar}
					onSettings={() => {
						settingsPresses.startClean();
						setSettings(true);
					}}
				/>
			}
			preview={
				<PreviewFrame
					key={version}
					src={preview}
					title="Preview of the Donation page"
					onBlockClick={openBlockSheet}
				/>
			}
		>
			{settings ? (
				<SettingsSheet
					onDismiss={() => setSettings(false)}
					blocks={loaderData.blocks}
					onOpenBlock={openBlockSheet}
					layouts={loaderData.layouts}
					lookPictures={loaderData.lookPictures}
					shareChannels={loaderData.shareChannels}
					{...settingsPresses.sheet}
					onShareMessage={() => setShareMessage(true)}
					donationSettings={loaderData.settings.summary}
					onOpen={(row) => {
						if (row === 'donation-settings') setDonationSettings(true);
					}}
				/>
			) : null}
			{openBlock === null ? null : (
				<BlockEditSheet
					key={openBlock.id}
					block={openBlock}
					version={version}
					onDismiss={closeBlock}
					onSaved={closeBlock}
					stacked={settings}
				/>
			)}
			{shareMessage ? (
				<ShareMessageSettingsSheet
					message={loaderData.share.message}
					version={version}
					onDismiss={() => setShareMessage(false)}
					onSaved={() => setShareMessage(false)}
				/>
			) : null}
			{donationSettings ? (
				<DonationSettingsSheet
					seed={loaderData.settings}
					version={version}
					onDismiss={() => setDonationSettings(false)}
					onSaved={() => setDonationSettings(false)}
					stacked={settings}
				/>
			) : null}
			{presses.confirm}
		</EditorShell>
	);
}
