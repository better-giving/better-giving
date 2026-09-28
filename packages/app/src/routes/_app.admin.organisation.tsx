import { Button } from '@better-giving/operator/components/controls/Button';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { Column, Section } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { useSaveState } from '@better-giving/operator/save-state.react';
import { getFormProps } from '@conform-to/react';
import { useCallback, useState } from 'react';
import { data, Form, useFormAction, useNavigation } from 'react-router';
import { z } from 'zod';
import { useFocusOnRefusal } from '$lib/admin/editor/done-sheet';
import { RichTextEditor } from '$lib/admin/rich-text/rich-text-editor';
import { buttonState } from '$lib/admin/save-button-state';
import { savedSection } from '$lib/admin/saved-section';
import { screenTitle } from '$lib/admin/screen-title';
import {
	type AdminActionData,
	recordVersion,
	resultFor,
	useAdminForm,
	whichForm
} from '$lib/admin/use-admin-form';
import { defineForm, WHICH_FORM } from '$lib/forms/definition';
import { isEmptyDocument, type RichTextDocument } from '$lib/rich-text/document';
import { invalid, parseForm, submittedDigest, submittedForm, unread } from '$lib/server/conform';
import { loadFailed } from '$lib/server/db/load-failure';
import { redirectWithFlash, SAVED_FLASH, takeFlash } from '$lib/server/flash';
import { storyInput } from '$lib/server/org/presentation';
import {
	readOrgStory,
	type StoryWrite,
	updateOrgStory,
	updateOrgStoryToPrevious
} from '$lib/server/org/queries';
import { database } from '../context';
import type { Route } from './+types/_app.admin.organisation';

// what the organisation says about itself on every page it serves, written by anyone signed in.
// its legal identity is not here: that is the console's Legal details.
//
// each section is its own form with its own save; the story is the first. a save applies at once
// with no confirm, because Undo stands at its button once it lands: Undo swaps the story with the
// one the save replaced, and a second Undo swaps it back. the rule a story passes is
// `$lib/server/org/presentation.ts`'s, and the reads and writes, with the compare-and-set each
// write is, are `$lib/server/org/queries.ts`'s.
//
// the story's version is a digest of the story alone rather than the row's `updated_at`, so a
// section saved beside it does not make a story typed meanwhile stale; `$lib/server/conform.ts`'s
// header states the rule.
//
// each editor is keyed to that version, so a landed save or Undo redraws it from the fresh read and
// a refusal, which moves no version, leaves what was typed where it is.

const SCREEN_TITLE = 'Organisation';

/** the address this screen answers on, and the one every write redirects back to. */
const SCREEN = '/admin/organisation';

const STORY_FORM_ID = 'org-story';
const UNDO_FORM_ID = 'org-story-undo';

/** each box posts a document's JSON; what a document may hold is the story rule's to say. */
const STORY_EDIT = defineForm({
	id: STORY_FORM_ID,
	schema: z.object({ mission: z.string(), vision: z.string() })
});
const STORY_UNDO = defineForm({ id: UNDO_FORM_ID, schema: z.object({}) });

const SCREEN_FORMS = [STORY_FORM_ID, UNDO_FORM_ID] as const;

/** what a landing names: a save, or an Undo, of the story. */
const SAVED_SECTIONS = ['story', 'story-undone'] as const;

/** each editor's editable, which a refusal naming that box moves the focus onto. */
const EDITOR_IDS = { mission: 'story-mission', vision: 'story-vision' } as const;

const STALE_STORY =
	'Nothing was changed: the story has been saved since this page was opened. Reload the page to ' +
	'see it, then make this change again.';
const SAVE_FAILED = 'Saving the story failed and nothing was changed. Try again.';
const UNDO_FAILED = 'Undoing the last save failed and nothing was changed. Try again.';

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	let read: Awaited<ReturnType<typeof readOrgStory>>;
	try {
		read = await readOrgStory(context.get(database));
	} catch (e) {
		console.error('reading the organisation story failed:', e);
		loadFailed('The Organisation page');
	}

	// taken after the read, so a screen that could not be drawn burns no marker.
	const landed = await takeFlash(request, SAVED_FLASH);

	return data(
		{
			mission: read.story.mission,
			vision: read.story.vision,
			version: read.version,
			saved: savedSection(landed?.marker ?? null, SAVED_SECTIONS)
		},
		// a `Set-Cookie` from a loader is sent without a `headers` export
		// (react-router/docs/how-to/headers.md).
		landed === null ? {} : { headers: { 'Set-Cookie': landed.clear } }
	);
}

/**
 * every write this screen performs.
 *
 * **the request body is read exactly once, here, by the action that owns it.**
 */
export async function action(args: Route.ActionArgs) {
	const body = await args.request.formData();

	switch (submittedForm(body, SCREEN_FORMS)) {
		case STORY_FORM_ID:
			return saveStory(args, body);
		case UNDO_FORM_ID:
			return undoStory(args, body);
	}

	// declared inside the action: react router strips the `action` export from the browser bundle
	// and nothing else, so a module-scope helper reaching `$lib/server/**` would ship with the page
	// (../routes.spec.ts).

	async function saveStory({ context, request }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, STORY_EDIT);
		if (!submission.ok) return invalid(400, submission.reject());

		const parsed = storyInput(submission.value);
		if (!parsed.ok) {
			const fieldErrors = Object.fromEntries(
				Object.entries(parsed.errors).map(([part, sentence]) => [part, [sentence]])
			);
			return invalid(400, submission.reject({ fieldErrors }));
		}

		const seen = submittedDigest(body);
		let written: StoryWrite;
		try {
			written = await updateOrgStory(context.get(database), seen, parsed.story);
		} catch (e) {
			console.error('saving the organisation story failed:', e);
			return invalid(500, submission.reject({ formErrors: [SAVE_FAILED] }));
		}
		if (written === 'stale') return invalid(409, submission.reject({ formErrors: [STALE_STORY] }));

		return redirectWithFlash(request, SAVED_FLASH, SCREEN, 'story');
	}

	async function undoStory({ context, request }: Route.ActionArgs, body: FormData) {
		const seen = submittedDigest(body);
		let written: StoryWrite;
		try {
			written = await updateOrgStoryToPrevious(context.get(database), seen);
		} catch (e) {
			console.error('undoing the organisation story failed:', e);
			return invalid(500, unread(STORY_UNDO, UNDO_FAILED));
		}
		if (written === 'stale') return invalid(409, unread(STORY_UNDO, STALE_STORY));

		return redirectWithFlash(request, SAVED_FLASH, SCREEN, 'story-undone');
	}
}

export default function Organisation({ loaderData, actionData }: Route.ComponentProps) {
	return (
		<Column>
			<StorySection
				mission={loaderData.mission}
				vision={loaderData.vision}
				version={loaderData.version}
				saved={loaderData.saved}
				actionData={actionData}
			/>
		</Column>
	);
}

/** the sentence a form was refused with that belongs to no box, or nothing where there is none. */
function formRefusal(form: { readonly id: string }, actionData: AdminActionData) {
	return resultFor(form, actionData)?.error?.['']?.at(-1);
}

/** whether what an editor last reported differs from the story the page was drawn with. */
function differs(typed: RichTextDocument | undefined, drawn: RichTextDocument | null): boolean {
	if (typed === undefined) return false;
	if (drawn === null) return !isEmptyDocument(typed);
	return JSON.stringify(typed) !== JSON.stringify(drawn);
}

/** what the editors have reported since the page was drawn at `version`. */
type Typed = {
	readonly version: string;
	readonly mission?: RichTextDocument;
	readonly vision?: RichTextDocument;
};

/** the reports made at `version`, or none where they were made at an older one. */
function since(was: Typed, version: string): Typed {
	return was.version === version ? was : { version };
}

function StorySection({
	mission,
	vision,
	version,
	saved,
	actionData
}: {
	readonly mission: RichTextDocument | null;
	readonly vision: RichTextDocument | null;
	readonly version: string;
	readonly saved: (typeof SAVED_SECTIONS)[number] | null;
	readonly actionData: AdminActionData;
}) {
	const [form, fields] = useAdminForm(STORY_EDIT, actionData);

	// the whole navigation a press started, loading phase included, so the press stays held until
	// its redirect has rendered — a second press would carry the version the first one moved past.
	const navigation = useNavigation();
	const here = useFormAction();
	const pressed =
		navigation.state !== 'idle' && navigation.formAction === here
			? navigation.formData?.get(WHICH_FORM)
			: null;
	const undoing = pressed === STORY_UNDO.id;

	// the group's own reading of what changed, handed to the save state in place of conform's
	// `dirty`: the editors post through a hidden box whose value they set themselves, and conform
	// counts a change only from an input event, which no hidden box fires. a report tagged with an
	// older version is a story since replaced by a save or an Undo, and counts for nothing.
	const [typed, setTyped] = useState<Typed>({ version });
	const onMission = useCallback(
		(doc: RichTextDocument) => setTyped((was) => ({ ...since(was, version), mission: doc })),
		[version]
	);
	const onVision = useCallback(
		(doc: RichTextDocument) => setTyped((was) => ({ ...since(was, version), vision: doc })),
		[version]
	);
	const changed =
		typed.version === version && (differs(typed.mission, mission) || differs(typed.vision, vision));

	// `!actionData`: a refusal is answered in place, so the marker the last landing published is
	// still on the page under it.
	const landed = saved !== null && !actionData;
	const save = useSaveState({ landed, changed, pending: pressed === STORY_EDIT.id });

	const missionError = fields.mission.errors?.[0];
	const visionError = fields.vision.errors?.[0];
	const saveRefusal = formRefusal(STORY_EDIT, actionData);
	const undoRefusal = formRefusal(STORY_UNDO, actionData);
	// the first refused box in reading order, as a failed submit leaves the focus there.
	useFocusOnRefusal(
		missionError ?? visionError,
		missionError === undefined ? EDITOR_IDS.vision : EDITOR_IDS.mission
	);

	return (
		<Section card>
			<h2>Story</h2>
			<Form method="post" preventScrollReset {...getFormProps(form)}>
				<input {...whichForm(STORY_EDIT.id)} />
				<input {...recordVersion(version)} />
				<div className="adm-stack">
					<RichTextEditor
						key={`mission-${version}`}
						name={fields.mission.name}
						label="Mission"
						{...(mission === null ? {} : { defaultValue: mission })}
						onChange={onMission}
						id={EDITOR_IDS.mission}
						error={missionError === undefined ? null : <MarkedText text={missionError} />}
					/>
					<RichTextEditor
						key={`vision-${version}`}
						name={fields.vision.name}
						label="Vision"
						optional
						{...(vision === null ? {} : { defaultValue: vision })}
						onChange={onVision}
						id={EDITOR_IDS.vision}
						error={visionError === undefined ? null : <MarkedText text={visionError} />}
					/>
				</div>
				{saveRefusal === undefined ? null : (
					<Banner tone="blocker" word="Not saved">
						<MarkedText text={saveRefusal} />
					</Banner>
				)}
				{undoRefusal === undefined ? null : (
					<Banner tone="blocker" word="Not undone">
						<MarkedText text={undoRefusal} />
					</Banner>
				)}
				<div className="adm-actions">
					<SaveButton
						label="Save story"
						doneLabel={saved === 'story-undone' ? 'Undone' : 'Saved'}
						state={buttonState(save)}
					/>
					{/* offered while the landing stands and nothing is typed over it: an Undo under
					    fresh edits would put back a story the operator is no longer looking at. it
					    submits the form below, since a form cannot hold another. */}
					{landed && !changed ? (
						<Button
							type="submit"
							form={STORY_UNDO.id}
							variant="quiet"
							size="sm"
							mark="undo-2"
							aria-busy={undoing}
							aria-disabled={undoing || undefined}
							onClick={(event) => {
								if (undoing) event.preventDefault();
							}}
						>
							Undo
						</Button>
					) : null}
				</div>
			</Form>
			<Form method="post" preventScrollReset id={STORY_UNDO.id}>
				<input {...whichForm(STORY_UNDO.id)} />
				<input {...recordVersion(version)} />
			</Form>
		</Section>
	);
}
