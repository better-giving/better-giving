import { useState } from 'react';
import { useFetcher } from 'react-router';
import { z } from 'zod';
import { MissionAsk } from '$lib/admin/editor/confirms';
import { DonationSettingsSheet } from '$lib/admin/editor/donation-settings';
import { EditorEntries, EditorShell } from '$lib/admin/editor/editor-shell';
import { PreviewFrame } from '$lib/admin/editor/preview-frame';
import { PublishBar } from '$lib/admin/editor/publish-bar';
import { usePublishPresses } from '$lib/admin/editor/publish-wiring';
import { SettingsSheet } from '$lib/admin/editor/settings-sheet';
import { screenTitle } from '$lib/admin/screen-title';
import { resultFor } from '$lib/admin/use-admin-form';
import { defineForm, RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import {
	DISCARD_FORM_ID,
	FIRST_PUBLISH_FORM_ID,
	PUBLISH_FORM_ID,
	PUBLISH_FORMS,
	UNDO_FORM_ID
} from '$lib/page/publish-form';
import { PAGE_SETTINGS_FORM_ID, type SettingsSeed } from '$lib/page/settings-form';
import { parseRichText, textDocument } from '$lib/rich-text/document';
import { invalid, parseForm, submittedDigest, submittedForm } from '$lib/server/conform';
import { loadFailed } from '$lib/server/db/load-failure';
import type { Page } from '$lib/server/db/schema';
import type { Story } from '$lib/server/org/presentation';
import { readOrgStory, type StoryWrite, updateOrgStory } from '$lib/server/org/queries';
import { ensureDonationPage, markDonationEditorVisited } from '$lib/server/pages/donation-page';
import { editorPage, readEditorSettings, saveDraftSettings } from '$lib/server/pages/editor';
import { answerPublishPress } from '$lib/server/pages/publish';
import { database } from '../context';
import type { BareHandle } from './_app';
import type { Route } from './+types/_app.admin.donation-page';

// the Donation page's editor, reached from the globe beside the organisation's name: its draft
// framed across the window by the preview route, the publish bar over it, and the Settings sheet.
// the parts are $lib/admin/editor/'s. the Donation page has no name to edit and no address of its
// own: the bar calls it "Donation page", and it is always at /donate.
//
// **the loader makes the page on first need** (`ensureDonationPage` in
// $lib/server/pages/donation-page.ts), so on a fresh deployment the globe opens an editor rather
// than a 404, as /donate answers before anyone has opened it.
//
// **the donation settings** are the draft's, saved by their sheet's one Done and reaching donors
// only at Publish, as a campaign's are ($lib/server/pages/editor.ts).
//
// **Publish, Undo and Discard changes** are $lib/server/pages/publish.ts's, the presses and their
// confirms mounted through $lib/admin/editor/publish-wiring.tsx.
//
// **the mission ask.** while the Organisation's mission is empty and this editor has never been
// answered, it asks for the mission once, optionally. a Save writes what was typed to the
// Organisation's story as it stands, against the story's digest (`submittedDigest`), keeping its
// vision; Skip, Escape, or a Save on an empty box writes nothing there. every answer marks the page
// visited, so it is not asked again. a refused Save leaves the ask up with what was typed.

export const handle: BareHandle = { frame: 'bare' };

const SCREEN_TITLE = 'Donation page';

const SAVE_FORM_ID = 'mission-save';
const SKIP_FORM_ID = 'mission-skip';

/** the mission ask's Save: what was typed, blank where nothing was. */
const MISSION_SAVE = defineForm({
	id: SAVE_FORM_ID,
	schema: z.object({ mission: z.string().optional() })
});

/** the mission ask's Skip, and every other way out of it. */
const MISSION_SKIP = defineForm({ id: SKIP_FORM_ID, schema: z.object({}) });

const SCREEN_FORMS = [SAVE_FORM_ID, SKIP_FORM_ID, PAGE_SETTINGS_FORM_ID, ...PUBLISH_FORMS] as const;

const STALE_STORY =
	'Nothing was saved: the Organisation page’s story has been saved since this editor was opened. ' +
	'Reload the editor to see it.';
const MISSION_FAILED = 'Saving the mission failed and nothing was changed. Try again.';
const SKIP_FAILED = 'Skipping failed, so this will be asked again. Try again.';
const NO_DONATION_PAGE = 'Nothing was saved: there is no Donation page yet. Reload the editor.';

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context }: Route.LoaderArgs) {
	const db = context.get(database);
	let row: Page;
	let story: { story: Story; version: string };
	let settings: SettingsSeed;
	try {
		row = await ensureDonationPage(db);
		[story, settings] = await Promise.all([readOrgStory(db), readEditorSettings(db, row)]);
	} catch (e) {
		console.error('loading the Donation page editor failed:', e);
		loadFailed('The Donation page');
	}
	return {
		...editorPage(row),
		settings,
		askMission: story.story.mission === null && row.editorVisitedAt === null,
		storyVersion: story.version
	};
}

export async function action({ context, request }: Route.ActionArgs) {
	const body = await request.formData();
	const db = context.get(database);

	switch (submittedForm(body, SCREEN_FORMS)) {
		case SAVE_FORM_ID: {
			const submission = parseForm(body, MISSION_SAVE);
			if (!submission.ok) return invalid(400, submission.reject());
			const seen = submittedDigest(body);
			const typed = submission.value.mission?.trim() ?? '';
			try {
				if (typed !== '') {
					const mission = parseRichText(textDocument(typed));
					if (!mission.ok) {
						return invalid(400, submission.reject({ fieldErrors: { mission: [mission.message] } }));
					}
					const { story } = await readOrgStory(db);
					const written: StoryWrite = await updateOrgStory(db, seen, {
						mission: mission.doc,
						vision: story.vision
					});
					if (written === 'stale') {
						return invalid(409, submission.reject({ formErrors: [STALE_STORY] }));
					}
				}
				await markDonationEditorVisited(db);
			} catch (e) {
				console.error('saving the mission from the Donation page editor failed:', e);
				return invalid(500, submission.reject({ formErrors: [MISSION_FAILED] }));
			}
			return { saved: 'mission' as const };
		}
		case SKIP_FORM_ID: {
			const submission = parseForm(body, MISSION_SKIP);
			try {
				await markDonationEditorVisited(db);
			} catch (e) {
				console.error('skipping the mission ask failed:', e);
				return invalid(500, submission.reject({ formErrors: [SKIP_FAILED] }));
			}
			return { saved: 'mission-skipped' as const };
		}
		case PAGE_SETTINGS_FORM_ID:
			return saveDraftSettings(db, { type: 'donation_page' }, body, NO_DONATION_PAGE);
		case PUBLISH_FORM_ID:
		case FIRST_PUBLISH_FORM_ID:
		case UNDO_FORM_ID:
		case DISCARD_FORM_ID:
			return answerPublishPress(db, { type: 'donation_page' }, body, NO_DONATION_PAGE);
	}
}

type Answer = Route.ComponentProps['actionData'];

/** the first message the last answer refused `form` with under `box` — `''` is the form's own. */
function refusal(answer: Answer | undefined, form: { id: string }, box: string): string | null {
	return resultFor(form, answer)?.error?.[box]?.[0] ?? null;
}

/** a press whose write belongs to a later part of the editor. */
function noPress() {}

export default function DonationPageEditor({ loaderData }: Route.ComponentProps) {
	const { state, version, preview, askMission, storyVersion } = loaderData;
	const [settings, setSettings] = useState(false);
	const [donationSettings, setDonationSettings] = useState(false);
	const presses = usePublishPresses({ version, state });

	const mission = useFetcher<Answer>({ key: 'mission-ask' });
	const busy = mission.state !== 'idle';
	const sent = busy ? mission.formData?.get(WHICH_FORM) : null;
	const answer = busy ? undefined : mission.data;

	const answerAsk = (form: string, typed?: string) => {
		const body = new FormData();
		body.set(WHICH_FORM, form);
		if (typed !== undefined) {
			body.set(RECORD_VERSION, storyVersion);
			body.set('mission', typed);
		}
		mission.submit(body, { method: 'post' });
	};

	return (
		<EditorShell
			bar={
				<PublishBar
					closeHref="/admin"
					page={{ kind: 'donation' }}
					state={state}
					livePath="/donate"
					{...presses.bar}
				/>
			}
			preview={
				<PreviewFrame
					key={version}
					src={preview}
					title="Preview of the Donation page"
					onBlockClick={noPress}
				/>
			}
			entries={<EditorEntries onChat={noPress} onSettings={() => setSettings(true)} />}
		>
			{settings ? (
				<SettingsSheet
					onDismiss={() => setSettings(false)}
					blocks={[]}
					onOpenBlock={noPress}
					layouts={[]}
					layout=""
					onLayout={noPress}
					look={null}
					shareMessage={loaderData.shareMessage}
					donationSettings={loaderData.settings.summary}
					onOpen={(row) => {
						if (row === 'donation-settings') setDonationSettings(true);
					}}
				/>
			) : null}
			{donationSettings ? (
				<DonationSettingsSheet
					seed={loaderData.settings}
					version={version}
					onDismiss={() => setDonationSettings(false)}
					onSaved={() => setDonationSettings(false)}
				/>
			) : null}
			{presses.confirm}
			{/* a Skip is taken down as it is pressed; one that failed puts the ask back, saying so. */}
			{askMission && sent !== SKIP_FORM_ID ? (
				<MissionAsk
					saving={sent === SAVE_FORM_ID}
					onSave={(typed) => answerAsk(SAVE_FORM_ID, typed)}
					onSkip={() => answerAsk(SKIP_FORM_ID)}
					refusal={
						refusal(answer, MISSION_SAVE, 'mission') ??
						refusal(answer, MISSION_SAVE, '') ??
						refusal(answer, MISSION_SKIP, '')
					}
				/>
			) : null}
		</EditorShell>
	);
}
