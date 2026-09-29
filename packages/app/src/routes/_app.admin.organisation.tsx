import { Button } from '@better-giving/operator/components/controls/Button';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Column, Section } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { useSaveState } from '@better-giving/operator/save-state.react';
import { getFormProps } from '@conform-to/react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { data, Form, useFetcher, useFormAction, useNavigation } from 'react-router';
import { z } from 'zod';
import { useFocusOnRefusal } from '$lib/admin/editor/done-sheet';
import { postPhoto, type UploadAnswer } from '$lib/admin/editor/photo-upload';
import { replaceRefusal } from '$lib/admin/editor/replace-photo';
import { type LogoControlProps, LogoControl } from '$lib/admin/look/logo-control';
import { RichTextEditor } from '$lib/admin/rich-text/rich-text-editor';
import { type Look, LookControl } from '$lib/admin/look/look-control';
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
import { defineForm, RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { CORNERS, type Corner, SHADES, type Shade } from '$lib/page/keys';
import {
	SHARE_CHANNEL_LABELS,
	SHARE_CHANNELS,
	SHARE_CHANNELS_DEFAULT,
	type ShareChannel,
	SOCIAL_LINKS_MAX
} from '$lib/page/share';
import { isEmptyDocument, type RichTextDocument } from '$lib/rich-text/document';
import { invalid, parseForm, submittedDigest, submittedForm, unread } from '$lib/server/conform';
import { loadFailed } from '$lib/server/db/load-failure';
import { redirectWithFlash, SAVED_FLASH, takeFlash } from '$lib/server/flash';
import { lookInput, sharingInput, storyInput } from '$lib/server/org/presentation';
import {
	type LogoUndo,
	type LogoWrite,
	type LookWrite,
	readOrgLogo,
	readOrgLook,
	readOrgSharing,
	readOrgStory,
	type SharingWrite,
	type StoryWrite,
	updateOrgLogo,
	updateOrgLogoToPrevious,
	updateOrgLook,
	updateOrgLookToPrevious,
	updateOrgSharing,
	updateOrgSharingToPrevious,
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
// one the save replaced, and the same press, reading Redo once an Undo lands, swaps it back. every
// section's press reads so, from its own undone marker. the rule a story passes is
// `$lib/server/org/presentation.ts`'s, and the reads and writes, with the compare-and-set each
// write is, are `$lib/server/org/queries.ts`'s.
//
// the story's version is a digest of the story alone rather than the row's `updated_at`, so a
// section saved beside it does not make a story typed meanwhile stale; `$lib/server/conform.ts`'s
// header states the rule.
//
// each section's boxes are redrawn from the fresh read at every landing of its own save or Undo, and
// wherever its version moves without one; a refusal moves neither, so what was typed stays where it
// is. a landing is told by the id the loader mints as it takes the flash, never by the version: an
// Undo brings back the version from before the save, and edits tagged with it would come back too.
//
// the look is the second section, and its control has no Save: every pick posts the whole look
// through the section's fetcher and answers in place rather than by a redirect, with the version it
// wrote. its version is a digest of the look column alone, on the story's rule, and its Undo swaps
// the look with the one the save replaced as the story's does.
//
// the logo stands first in the look, and applies as a look pick does, answering in place: an upload
// posts its write the moment the photo is stored, and Remove posts no photo. its version is a digest
// of the logo column alone, and its Undo swaps the logo with the one the write replaced — offered
// only while the two differ, which the loader reads.
//
// the sharing is the third, a text form saved and undone as the story is, against a digest of the
// sharing column alone; its landing is its own marker, so a sharing save lights no story button.
// the channels reorder by Move up and Move down, and what a page's share buttons draw is the ticked
// ones in that order (`$lib/server/pages/view.ts`). the rule a sharing passes is
// `$lib/server/org/presentation.ts`'s.

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

const LOOK_FORM_ID = 'org-look';
const LOOK_UNDO_FORM_ID = 'org-look-undo';

/** a pick posts the whole look; each box's rule, and a blank colour's meaning, is the look rule's. */
const LOOK_EDIT = defineForm({
	id: LOOK_FORM_ID,
	schema: z.object({
		shade: z.string().optional(),
		corner: z.string().optional(),
		brandColour: z.string().optional()
	})
});
const LOOK_UNDO = defineForm({ id: LOOK_UNDO_FORM_ID, schema: z.object({}) });

const LOGO_FORM_ID = 'org-logo';
const LOGO_UNDO_FORM_ID = 'org-logo-undo';

/** the stored photo the logo becomes; blank is Remove. */
const LOGO_EDIT = defineForm({
	id: LOGO_FORM_ID,
	schema: z.object({ imageId: z.string().optional() })
});
const LOGO_UNDO = defineForm({ id: LOGO_UNDO_FORM_ID, schema: z.object({}) });

const SHARING_FORM_ID = 'org-sharing';
const SHARING_UNDO_FORM_ID = 'org-sharing-undo';

/**
 * the ticked channels in the order they are drawn, the message, and each social link a row of two
 * boxes; what each may hold is the sharing rule's to say.
 */
const SHARING_EDIT = defineForm({
	id: SHARING_FORM_ID,
	schema: z.object({
		channels: z.array(z.string()),
		message: z.string().optional(),
		linkLabel: z.array(z.string().optional()),
		linkUrl: z.array(z.string().optional())
	})
});
const SHARING_UNDO = defineForm({ id: SHARING_UNDO_FORM_ID, schema: z.object({}) });

const SCREEN_FORMS = [
	STORY_FORM_ID,
	UNDO_FORM_ID,
	LOOK_FORM_ID,
	LOOK_UNDO_FORM_ID,
	LOGO_FORM_ID,
	LOGO_UNDO_FORM_ID,
	SHARING_FORM_ID,
	SHARING_UNDO_FORM_ID
] as const;

/** what a landing names: a save, or an Undo, of the story. */
const SAVED_SECTIONS = ['story', 'story-undone'] as const;

/** what a landing names: a save, or an Undo, of the sharing. */
const SHARING_SAVED = ['sharing', 'sharing-undone'] as const;

/** each editor's editable, which a refusal naming that box moves the focus onto. */
const EDITOR_IDS = { mission: 'story-mission', vision: 'story-vision' } as const;

const STALE_STORY =
	'Nothing was changed: the story has been saved since this page was opened. Reload the page to ' +
	'see it, then make this change again.';
const SAVE_FAILED = 'Saving the story failed and nothing was changed. Try again.';
const UNDO_FAILED = 'Undoing the last save failed and nothing was changed. Try again.';

const STALE_LOOK =
	'Nothing was changed: the look has been saved since this page was opened. Reload the page to ' +
	'see it, then make this change again.';
const LOOK_SAVE_FAILED = 'Saving the look failed and nothing was changed. Try again.';

const STALE_LOGO =
	'Nothing was changed: the logo has been changed since this page was opened. Reload the page to ' +
	'see it, then make this change again.';
const LOGO_SAVE_FAILED = 'Saving the logo failed and nothing was changed. Try again.';
const NOTHING_TO_UNDO_LOGO =
	'Nothing was changed: the logo is the same as the one before it, so there is nothing to undo.';

const STALE_SHARING =
	'Nothing was changed: the sharing has been saved since this page was opened. Reload the page ' +
	'to see it, then make this change again.';
const SHARING_SAVE_FAILED = 'Saving the sharing failed and nothing was changed. Try again.';

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	let read: Awaited<ReturnType<typeof readOrgStory>>;
	let look: Awaited<ReturnType<typeof readOrgLook>>;
	let sharing: Awaited<ReturnType<typeof readOrgSharing>>;
	let logo: Awaited<ReturnType<typeof readOrgLogo>>;
	try {
		const db = context.get(database);
		[read, look, sharing, logo] = await Promise.all([
			readOrgStory(db),
			readOrgLook(db),
			readOrgSharing(db),
			readOrgLogo(db)
		]);
	} catch (e) {
		console.error('reading the organisation story, look, sharing and logo failed:', e);
		loadFailed('The Organisation page');
	}

	// taken after the read, so a screen that could not be drawn burns no marker.
	const landed = await takeFlash(request, SAVED_FLASH);

	return data(
		{
			mission: read.story.mission,
			vision: read.story.vision,
			version: read.version,
			saved: savedSection(landed?.marker ?? null, SAVED_SECTIONS),
			landing: landed === null ? null : crypto.randomUUID(),
			look: look.look,
			lookVersion: look.version,
			logo: logo.logo,
			logoVersion: logo.version,
			logoUndoable: logo.undoable,
			sharing: {
				channels: sharing.sharing.channels ?? SHARE_CHANNELS_DEFAULT,
				message: sharing.sharing.message,
				links: sharing.sharing.links
			},
			sharingVersion: sharing.version,
			sharingSaved: savedSection(landed?.marker ?? null, SHARING_SAVED)
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
		case LOOK_FORM_ID:
			return saveLook(args, body);
		case LOOK_UNDO_FORM_ID:
			return undoLook(args, body);
		case LOGO_FORM_ID:
			return saveLogo(args, body);
		case LOGO_UNDO_FORM_ID:
			return undoLogo(args, body);
		case SHARING_FORM_ID:
			return saveSharing(args, body);
		case SHARING_UNDO_FORM_ID:
			return undoSharing(args, body);
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

	// a look press answers in place rather than by a redirect: the section's fetcher posts it, and
	// the version it answers with is what its landing is read against.
	async function saveLook({ context }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, LOOK_EDIT);
		if (!submission.ok) return invalid(400, submission.reject());

		const parsed = lookInput(submission.value);
		if (!parsed.ok) {
			const fieldErrors = Object.fromEntries(
				Object.entries(parsed.errors).map(([box, sentence]) => [box, [sentence]])
			);
			return invalid(400, submission.reject({ fieldErrors }));
		}

		const seen = submittedDigest(body);
		let written: LookWrite;
		try {
			written = await updateOrgLook(context.get(database), seen, parsed.look);
		} catch (e) {
			console.error('saving the organisation look failed:', e);
			return invalid(500, submission.reject({ formErrors: [LOOK_SAVE_FAILED] }));
		}
		if (written === 'stale') return invalid(409, submission.reject({ formErrors: [STALE_LOOK] }));

		return { saved: 'look' as const, version: written.version };
	}

	async function undoLook({ context }: Route.ActionArgs, body: FormData) {
		const seen = submittedDigest(body);
		let written: LookWrite;
		try {
			written = await updateOrgLookToPrevious(context.get(database), seen);
		} catch (e) {
			console.error('undoing the organisation look failed:', e);
			return invalid(500, unread(LOOK_UNDO, UNDO_FAILED));
		}
		if (written === 'stale') return invalid(409, unread(LOOK_UNDO, STALE_LOOK));

		return { saved: 'look-undone' as const, version: written.version };
	}

	// a logo write answers in place as a look press does, whether it set, removed or undid: the
	// section's words are read off the logo it lands on, not off which press it was.
	async function saveLogo({ context }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, LOGO_EDIT);
		if (!submission.ok) return invalid(400, submission.reject());
		const imageId = submission.value.imageId ?? null;

		const seen = submittedDigest(body);
		let written: LogoWrite;
		try {
			written = await updateOrgLogo(context.get(database), seen, imageId);
		} catch (e) {
			console.error('saving the organisation logo failed:', e);
			return invalid(500, submission.reject({ formErrors: [LOGO_SAVE_FAILED] }));
		}
		if (written === 'stale') return invalid(409, submission.reject({ formErrors: [STALE_LOGO] }));
		if (written === 'unknown') {
			const refused = `"${imageId}" names no stored image; a logo is a photo uploaded here`;
			return invalid(400, submission.reject({ fieldErrors: { imageId: [refused] } }));
		}
		if (written === 'illustration') {
			const refused = `"${imageId}" is an illustration; a logo is a photo uploaded here`;
			return invalid(400, submission.reject({ fieldErrors: { imageId: [refused] } }));
		}
		return { saved: 'logo' as const, version: written.version };
	}

	async function undoLogo({ context }: Route.ActionArgs, body: FormData) {
		const seen = submittedDigest(body);
		let written: LogoUndo;
		try {
			written = await updateOrgLogoToPrevious(context.get(database), seen);
		} catch (e) {
			console.error('undoing the organisation logo failed:', e);
			return invalid(500, unread(LOGO_UNDO, UNDO_FAILED));
		}
		if (written === 'stale') return invalid(409, unread(LOGO_UNDO, STALE_LOGO));
		if (written === 'nothing') return invalid(409, unread(LOGO_UNDO, NOTHING_TO_UNDO_LOGO));
		return { saved: 'logo-undone' as const, version: written.version };
	}

	async function saveSharing({ context, request }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, SHARING_EDIT);
		if (!submission.ok) return invalid(400, submission.reject());

		const parsed = sharingInput(submission.value);
		if (!parsed.ok) {
			const fieldErrors = Object.fromEntries(
				Object.entries(parsed.errors).map(([box, sentence]) => [box, [sentence]])
			);
			return invalid(400, submission.reject({ fieldErrors }));
		}

		const seen = submittedDigest(body);
		let written: SharingWrite;
		try {
			written = await updateOrgSharing(context.get(database), seen, parsed.sharing);
		} catch (e) {
			console.error('saving the organisation sharing failed:', e);
			return invalid(500, submission.reject({ formErrors: [SHARING_SAVE_FAILED] }));
		}
		if (written === 'stale') {
			return invalid(409, submission.reject({ formErrors: [STALE_SHARING] }));
		}

		return redirectWithFlash(request, SAVED_FLASH, SCREEN, 'sharing');
	}

	async function undoSharing({ context, request }: Route.ActionArgs, body: FormData) {
		const seen = submittedDigest(body);
		let written: SharingWrite;
		try {
			written = await updateOrgSharingToPrevious(context.get(database), seen);
		} catch (e) {
			console.error('undoing the organisation sharing failed:', e);
			return invalid(500, unread(SHARING_UNDO, UNDO_FAILED));
		}
		if (written === 'stale') return invalid(409, unread(SHARING_UNDO, STALE_SHARING));

		return redirectWithFlash(request, SAVED_FLASH, SCREEN, 'sharing-undone');
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
				landing={loaderData.saved === null ? null : loaderData.landing}
				actionData={actionData}
			/>
			<LookSection
				look={loaderData.look}
				version={loaderData.lookVersion}
				logo={
					<LogoPart
						logo={loaderData.logo}
						version={loaderData.logoVersion}
						undoable={loaderData.logoUndoable}
					/>
				}
			/>
			<SharingSection
				sharing={loaderData.sharing}
				version={loaderData.sharingVersion}
				saved={loaderData.sharingSaved}
				landing={loaderData.sharingSaved === null ? null : loaderData.landing}
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

/**
 * how many times a section's boxes have been drawn afresh from the read: once more at each landing
 * of its own save or Undo (`landing`, null on every other load), and wherever `version` moves
 * without one. it only ever counts up, so edits tagged with an older count never come back.
 */
function useRedraws(version: string, landing: string | null): number {
	const [seen, setSeen] = useState({ version, landing, count: 0 });
	if (seen.version === version && (landing === null || landing === seen.landing)) return seen.count;
	const next = { version, landing: landing ?? seen.landing, count: seen.count + 1 };
	setSeen(next);
	return next.count;
}

/** what the editors have reported since the story was last drawn afresh. */
type Typed = {
	readonly drawn: number;
	readonly mission?: RichTextDocument;
	readonly vision?: RichTextDocument;
};

/** the reports made since drawing `drawn`, or none where they were made before it. */
function since(was: Typed, drawn: number): Typed {
	return was.drawn === drawn ? was : { drawn };
}

function StorySection({
	mission,
	vision,
	version,
	saved,
	landing,
	actionData
}: {
	readonly mission: RichTextDocument | null;
	readonly vision: RichTextDocument | null;
	readonly version: string;
	readonly saved: (typeof SAVED_SECTIONS)[number] | null;
	readonly landing: string | null;
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
	// counts a change only from an input event, which no hidden box fires. a report made before the
	// story was last drawn afresh is one a save or an Undo has since replaced, and counts for nothing.
	const drawn = useRedraws(version, landing);
	const [typed, setTyped] = useState<Typed>({ drawn });
	const onMission = useCallback(
		(doc: RichTextDocument) => setTyped((was) => ({ ...since(was, drawn), mission: doc })),
		[drawn]
	);
	const onVision = useCallback(
		(doc: RichTextDocument) => setTyped((was) => ({ ...since(was, drawn), vision: doc })),
		[drawn]
	);
	const changed =
		typed.drawn === drawn && (differs(typed.mission, mission) || differs(typed.vision, vision));

	// `!actionData`: a refusal is answered in place, so the marker the last landing published is
	// still on the page under it.
	const landed = saved !== null && !actionData;
	const redo = saved === 'story-undone';
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
					<div className="adm-stack">
						<RichTextEditor
							key={`mission-${drawn}`}
							name={fields.mission.name}
							label="Mission"
							{...(mission === null ? {} : { defaultValue: mission })}
							onChange={onMission}
							id={EDITOR_IDS.mission}
							error={missionError === undefined ? null : <MarkedText text={missionError} />}
						/>
						<RichTextEditor
							key={`vision-${drawn}`}
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
								mark={redo ? 'redo-2' : 'undo-2'}
								aria-busy={undoing}
								aria-disabled={undoing || undefined}
								onClick={(event) => {
									if (undoing) event.preventDefault();
								}}
							>
								{redo ? 'Redo' : 'Undo'}
							</Button>
						) : null}
					</div>
				</div>
			</Form>
			<Form method="post" preventScrollReset id={STORY_UNDO.id}>
				<input {...whichForm(STORY_UNDO.id)} />
				<input {...recordVersion(version)} />
			</Form>
		</Section>
	);
}

/** the look a body carries, where its shade and corner are ones the control can draw. */
function lookIn(read: (box: string) => unknown): Look | null {
	const shade = read('shade');
	const corner = read('corner');
	const colour = read('brandColour');
	if (!SHADES.includes(shade as Shade) || !CORNERS.includes(corner as Corner)) return null;
	return {
		shade: shade as Shade,
		corner: corner as Corner,
		brandColour: typeof colour === 'string' && colour !== '' ? colour : null
	};
}

/** what a look press was refused with: the sentence for the whole press, else a box's. */
function lookRefusal(answer: AdminActionData): string | undefined {
	const form = formRefusal(LOOK_EDIT, answer) ?? formRefusal(LOOK_UNDO, answer);
	if (form !== undefined) return form;
	const boxes = Object.values(resultFor(LOOK_EDIT, answer)?.error ?? {});
	return boxes.flatMap((sentences) => sentences ?? []).at(0);
}

/**
 * the organisation's look, saved at every pick.
 *
 * a landing stands while the look the page holds is the version it wrote. a pick made while one is
 * in flight waits for its answer and goes with the version that answer revalidated, so quick picks
 * land in turn rather than the second one reading as stale; only the latest waiting pick is sent.
 *
 * a refusal leaves the refused pick drawn, the way a refused form keeps what was typed, and a 4xx
 * revalidates nothing, so a stale page stays stale until it is reloaded, as the refusal says.
 */
function LookSection({
	look,
	version,
	logo
}: {
	readonly look: Look;
	readonly version: string;
	readonly logo: ReactNode;
}) {
	const fetcher = useFetcher<Route.ComponentProps['actionData']>({ key: LOOK_FORM_ID });
	const [waiting, setWaiting] = useState<Look | null>(null);

	const busy = fetcher.state !== 'idle';
	const sent = busy ? fetcher.formData?.get(WHICH_FORM) : null;
	const answer = busy ? undefined : fetcher.data;

	const post = useCallback(
		(form: string, at: string, next?: Look) => {
			const body = new FormData();
			body.set(WHICH_FORM, form);
			body.set(RECORD_VERSION, at);
			if (next !== undefined) {
				body.set('shade', next.shade);
				body.set('corner', next.corner);
				body.set('brandColour', next.brandColour ?? '');
			}
			fetcher.submit(body, { method: 'post' });
		},
		[fetcher.submit]
	);

	useEffect(() => {
		if (busy || waiting === null) return;
		setWaiting(null);
		post(LOOK_EDIT.id, version, waiting);
	}, [busy, waiting, version, post]);

	const refusedPick =
		answer !== undefined && 'form' in answer && answer.form?.id === LOOK_EDIT.id
			? lookIn((box) => answer.form?.result.initialValue?.[box])
			: null;
	const inFlight =
		sent === LOOK_EDIT.id && fetcher.formData ? lookIn((box) => fetcher.formData?.get(box)) : null;
	const shown = waiting ?? inFlight ?? refusedPick ?? look;

	const onChange = (next: Look) => {
		if (busy) setWaiting(next);
		else post(LOOK_EDIT.id, version, next);
	};

	const undoing = sent === LOOK_UNDO.id;
	const landed =
		answer !== undefined && 'saved' in answer && answer.version === version ? answer.saved : null;
	const refusal = answer === undefined ? undefined : lookRefusal(answer);
	// read off the answer the press stands on even while its own post is in flight, so the word under
	// the focus does not change mid-press.
	const redo =
		fetcher.data !== undefined && 'saved' in fetcher.data && fetcher.data.saved === 'look-undone';

	return (
		<Section card>
			<h2>Look</h2>
			<div className="adm-stack">
				{logo}
				<LookControl mode="organisation" value={shown} onChange={onChange} />
			</div>
			<div className="adm-actions">
				{/* mounted empty, so the answer arriving in it is announced. */}
				<span role="status">
					{busy || waiting !== null ? (
						<StatusWord register="momentary" neutral>
							{undoing ? 'Undoing…' : 'Saving…'}
						</StatusWord>
					) : refusal !== undefined ? (
						<StatusWord register="momentary" blocked mark="circle-alert">
							<MarkedText text={refusal} />
						</StatusWord>
					) : landed === 'look' ? (
						<StatusWord register="momentary">
							Saved to every page using the organisation’s look.
						</StatusWord>
					) : landed === 'look-undone' ? (
						<StatusWord register="momentary">
							Undone on every page using the organisation’s look.
						</StatusWord>
					) : null}
				</span>
				{/* kept while its own press is in flight, so the focus it holds is not dropped. */}
				{landed !== null || undoing ? (
					<Button
						type="button"
						variant="quiet"
						size="sm"
						mark={redo ? 'redo-2' : 'undo-2'}
						aria-busy={undoing}
						aria-disabled={undoing || undefined}
						onClick={() => {
							if (!undoing) post(LOOK_UNDO.id, version);
						}}
					>
						{redo ? 'Redo' : 'Undo'}
					</Button>
				) : null}
			</div>
		</Section>
	);
}

/** what a logo write or Undo was refused with: the sentence for the whole press, else its id's. */
function logoRefusal(answer: AdminActionData): string | null {
	return (
		formRefusal(LOGO_EDIT, answer) ??
		formRefusal(LOGO_UNDO, answer) ??
		resultFor(LOGO_EDIT, answer)?.error?.imageId?.at(0) ??
		null
	);
}

/**
 * the organisation's logo, written the moment it changes: an upload posts its write once the photo
 * is stored, and Remove posts none. a write asked for while another is in flight waits for its
 * answer and goes with the version it revalidated, as a look pick does.
 *
 * while a write is in flight the control draws what it writes, so a removed logo takes its Remove
 * with it at once. every refusal, of the resize, the upload or the write, stands at the press until
 * the next pick or Remove.
 */
function LogoPart({
	logo,
	version,
	undoable
}: {
	readonly logo: { readonly imageId: string } | null;
	readonly version: string;
	readonly undoable: boolean;
}) {
	const upload = useFetcher<UploadAnswer>();
	const fetcher = useFetcher<Route.ComponentProps['actionData']>();
	const [waiting, setWaiting] = useState<{ readonly imageId: string | null } | null>(null);
	const [refused, setRefused] = useState<string | null>(null);

	// each answer is taken once, in the render it arrives in.
	const [uploaded, setUploaded] = useState(upload.data);
	if (upload.data !== uploaded) {
		setUploaded(upload.data);
		if (upload.data !== undefined && 'error' in upload.data) {
			setRefused(
				upload.data.reason === 'failed'
					? 'That didn’t go through. Choose the logo again.'
					: upload.data.error
			);
		} else if (upload.data !== undefined) {
			setWaiting({ imageId: upload.data.id });
		}
	}
	const [written, setWritten] = useState(fetcher.data);
	if (fetcher.data !== written) {
		setWritten(fetcher.data);
		setRefused(logoRefusal(fetcher.data));
	}

	const busy = fetcher.state !== 'idle';
	const sent = busy ? fetcher.formData?.get(WHICH_FORM) : null;

	const post = useCallback(
		(form: string, at: string, imageId?: string | null) => {
			const body = new FormData();
			body.set(WHICH_FORM, form);
			body.set(RECORD_VERSION, at);
			if (imageId !== undefined) body.set('imageId', imageId ?? '');
			fetcher.submit(body, { method: 'post' });
		},
		[fetcher.submit]
	);

	useEffect(() => {
		if (busy || waiting === null) return;
		setWaiting(null);
		post(LOGO_EDIT.id, version, waiting.imageId);
	}, [busy, waiting, version, post]);

	const sentId = sent === LOGO_EDIT.id ? fetcher.formData?.get('imageId') : undefined;
	const writing =
		waiting ?? (typeof sentId === 'string' ? { imageId: sentId === '' ? null : sentId } : null);
	const shown = writing === null ? (logo?.imageId ?? null) : writing.imageId;

	const state: LogoControlProps['state'] =
		upload.state !== 'idle' || (writing !== null && writing.imageId !== null)
			? 'uploading'
			: refused === null
				? undefined
				: { refused };

	const answer = busy ? undefined : fetcher.data;
	const landed =
		answer !== undefined &&
		'saved' in answer &&
		(answer.saved === 'logo' || answer.saved === 'logo-undone') &&
		answer.version === version;
	const undoing = sent === LOGO_UNDO.id;
	// read off the answer the press stands on even while its own post is in flight, as the look's is.
	const redo =
		fetcher.data !== undefined && 'saved' in fetcher.data && fetcher.data.saved === 'logo-undone';

	return (
		<LogoControl
			imageId={shown}
			onResized={(result) => {
				if (!result.ok) {
					setRefused(replaceRefusal(result.reason));
					return;
				}
				setRefused(null);
				postPhoto(upload, result.blob);
			}}
			state={state}
			onRemove={() => {
				setRefused(null);
				if (busy) setWaiting({ imageId: null });
				else post(LOGO_EDIT.id, version, null);
			}}
			report={
				// kept while its own press is in flight, so the focus it holds is not dropped.
				(landed && undoable) || undoing
					? {
							landed: logo === null ? 'removed' : 'saved',
							onUndo: () => post(LOGO_UNDO.id, version),
							undoing,
							redo
						}
					: null
			}
		/>
	);
}

/** the sharing as the loader publishes it, the default channels standing where none are chosen. */
type SharingDrawn = {
	readonly channels: readonly ShareChannel[];
	readonly message: string | null;
	readonly links: readonly { readonly label: string; readonly href: string }[];
};

/** a link row; `key` is the row's own identity, and its position is only where it stands now. */
type LinkRow = { readonly key: number; readonly label: string; readonly url: string };

/** the section's boxes since they were last drawn afresh, the `drawn`th time. */
type SharingEdit = {
	readonly drawn: number;
	/** every channel on the list, in the order drawn: the chosen first, then the rest. */
	readonly order: readonly ShareChannel[];
	readonly chosen: ReadonlySet<ShareChannel>;
	readonly message: string;
	readonly rows: readonly LinkRow[];
};

function freshEdit(sharing: SharingDrawn, drawn: number): SharingEdit {
	return {
		drawn,
		order: [...sharing.channels, ...SHARE_CHANNELS.filter((c) => !sharing.channels.includes(c))],
		chosen: new Set(sharing.channels),
		message: sharing.message ?? '',
		rows: sharing.links.map((link, key) => ({ key, label: link.label, url: link.href }))
	};
}

/** what a save of these boxes would write, in terms two readings can be compared by. */
function sharingText(edit: SharingEdit): string {
	return JSON.stringify({
		channels: edit.order.filter((channel) => edit.chosen.has(channel)),
		message: edit.message.trim(),
		links: edit.rows
			.map((row) => [row.label.trim(), row.url.trim()])
			.filter(([label, url]) => label !== '' || url !== '')
	});
}

/** the id of each box and press the section moves the focus onto. */
const sharingIds = {
	channel: (channel: ShareChannel) => `sharing-channel-${channel}`,
	move: (channel: ShareChannel, way: 'up' | 'down') => `sharing-move-${channel}-${way}`,
	channels: 'sharing-channels',
	message: 'sharing-message',
	linkLabel: (key: number) => `sharing-link-${key}-label`,
	linkUrl: (key: number) => `sharing-link-${key}-url`,
	links: 'sharing-links',
	add: 'sharing-link-add'
};

/**
 * the channels a page's share buttons offer and their order, the organisation's share message, and
 * its social links: one text form with one Save, answered by a redirect as the story is.
 *
 * the boxes are held in state rather than read off the form, because the order is what a move
 * changes and no box records it: the ticked channels post in the order they are drawn. that state
 * is tagged with the redraw it was made after, so a landed save or Undo draws the fresh read, and a
 * refusal, which lands nothing, leaves what was typed.
 *
 * a move keeps the focus on the pressed button, which a reorder of keyed rows would otherwise drop,
 * and says where the channel now stands.
 */
function SharingSection({
	sharing,
	version,
	saved,
	landing,
	actionData
}: {
	readonly sharing: SharingDrawn;
	readonly version: string;
	readonly saved: (typeof SHARING_SAVED)[number] | null;
	readonly landing: string | null;
	readonly actionData: AdminActionData;
}) {
	const [form, fields] = useAdminForm(SHARING_EDIT, actionData);

	const navigation = useNavigation();
	const here = useFormAction();
	const pressed =
		navigation.state !== 'idle' && navigation.formAction === here
			? navigation.formData?.get(WHICH_FORM)
			: null;
	const undoing = pressed === SHARING_UNDO.id;

	const drawn = useRedraws(version, landing);
	const [held, setEdit] = useState<SharingEdit>(() => freshEdit(sharing, drawn));
	const edit = held.drawn === drawn ? held : freshEdit(sharing, drawn);
	const change = (next: (was: SharingEdit) => Partial<SharingEdit>) =>
		setEdit((was) => {
			const current = was.drawn === drawn ? was : freshEdit(sharing, drawn);
			return { ...current, ...next(current) };
		});
	const changed = sharingText(edit) !== sharingText(freshEdit(sharing, drawn));

	const landed = saved !== null && !actionData;
	const redo = saved === 'sharing-undone';
	const save = useSaveState({ landed, changed, pending: pressed === SHARING_EDIT.id });

	// the box or press a move, an Add or a Remove leaves the focus on, taken after the render that
	// drew it.
	const focusNext = useRef<string | null>(null);
	useEffect(() => {
		if (focusNext.current === null) return;
		document.getElementById(focusNext.current)?.focus();
		focusNext.current = null;
	});
	const [moved, setMoved] = useState('');

	const move = (channel: ShareChannel, way: 'up' | 'down') => {
		const at = edit.order.indexOf(channel);
		const to = way === 'up' ? at - 1 : at + 1;
		if (to < 0 || to >= edit.order.length) return;
		const order = [...edit.order];
		order.splice(at, 1);
		order.splice(to, 0, channel);
		change(() => ({ order }));
		focusNext.current = sharingIds.move(channel, way);
		setMoved(`${SHARE_CHANNEL_LABELS[channel]}, ${to + 1} of ${order.length}`);
	};

	const errors = form.allErrors;
	const channelsError = fields.channels.errors?.[0];
	const messageError = fields.message.errors?.[0];
	const linksError = fields.linkUrl.errors?.[0];
	const rowError = (box: 'linkLabel' | 'linkUrl', at: number) => errors[`${box}[${at}]`]?.[0];
	const saveRefusal = formRefusal(SHARING_EDIT, actionData);
	const undoRefusal = formRefusal(SHARING_UNDO, actionData);

	// the first refused box in reading order, as a failed submit leaves the focus there.
	const refused: [string | undefined, string][] = [
		[channelsError, sharingIds.channel(edit.order[0] ?? SHARE_CHANNELS[0])],
		[messageError, sharingIds.message],
		...edit.rows.flatMap((row, at): [string | undefined, string][] => [
			[rowError('linkLabel', at), sharingIds.linkLabel(row.key)],
			[rowError('linkUrl', at), sharingIds.linkUrl(row.key)]
		]),
		[linksError, sharingIds.add]
	];
	const firstRefused = refused.find(([message]) => message !== undefined);
	useFocusOnRefusal(firstRefused?.[0], firstRefused?.[1] ?? sharingIds.message);

	const addRow = () => {
		const key = Math.max(-1, ...edit.rows.map((row) => row.key)) + 1;
		change((was) => ({ rows: [...was.rows, { key, label: '', url: '' }] }));
		focusNext.current = sharingIds.linkLabel(key);
	};
	const editRow = (key: number, box: 'label' | 'url', value: string) =>
		change((was) => ({
			rows: was.rows.map((row) => (row.key === key ? { ...row, [box]: value } : row))
		}));
	const removeRow = (key: number) => {
		change((was) => ({ rows: was.rows.filter((row) => row.key !== key) }));
		focusNext.current = sharingIds.add;
	};

	return (
		<Section card>
			<h2>Sharing</h2>
			<Form method="post" preventScrollReset {...getFormProps(form)}>
				<input {...whichForm(SHARING_EDIT.id)} />
				<input {...recordVersion(version)} />
				<div className="adm-stack">
					<div className="adm-stack">
						<fieldset
							className="adm-fieldset"
							aria-describedby={
								channelsError === undefined ? undefined : `${sharingIds.channels}-err`
							}
						>
							<legend className="adm-fieldset__legend">Share buttons, in order</legend>
							<div className="adm-orderlist">
								{edit.order.map((channel, at) => {
									const label = SHARE_CHANNEL_LABELS[channel];
									const first = at === 0;
									const last = at === edit.order.length - 1;
									return (
										<div className="adm-orderrow" key={channel}>
											<label className="adm-check">
												<input
													type="checkbox"
													id={sharingIds.channel(channel)}
													name={fields.channels.name}
													value={channel}
													checked={edit.chosen.has(channel)}
													onChange={(event) => {
														const on = event.currentTarget.checked;
														change((was) => {
															const chosen = new Set(was.chosen);
															if (on) chosen.add(channel);
															else chosen.delete(channel);
															return { chosen };
														});
													}}
												/>
												<span className="adm-check__text">{label}</span>
											</label>
											<Button
												type="button"
												variant="quiet"
												size="sm"
												mark="chevron-up"
												id={sharingIds.move(channel, 'up')}
												aria-label={`Move ${label} up`}
												aria-disabled={first || undefined}
												onClick={() => move(channel, 'up')}
											/>
											<Button
												type="button"
												variant="quiet"
												size="sm"
												mark="chevron-down"
												id={sharingIds.move(channel, 'down')}
												aria-label={`Move ${label} down`}
												aria-disabled={last || undefined}
												onClick={() => move(channel, 'down')}
											/>
										</div>
									);
								})}
							</div>
							{channelsError === undefined ? null : (
								<FieldMessage id={`${sharingIds.channels}-err`}>
									<MarkedText text={channelsError} />
								</FieldMessage>
							)}
							{/* mounted empty, so each move is announced. */}
							<span role="status" className="adm-vh">
								{moved}
							</span>
						</fieldset>
						<Field
							id={sharingIds.message}
							name={fields.message.name}
							label="Share message"
							optional
							as="textarea"
							rows={3}
							hint="Pages use it unless they have their own."
							value={edit.message}
							onChange={(event) => {
								const message = event.currentTarget.value;
								change(() => ({ message }));
							}}
							error={messageError === undefined ? null : <MarkedText text={messageError} />}
						/>
						<fieldset
							className="adm-fieldset"
							aria-describedby={linksError === undefined ? undefined : `${sharingIds.links}-err`}
						>
							<legend className="adm-fieldset__legend">Social links</legend>
							{edit.rows.map((row, at) => {
								const labelError = rowError('linkLabel', at);
								const urlError = rowError('linkUrl', at);
								return (
									<div className="adm-pair adm-pair--side" key={row.key}>
										<Field
											id={sharingIds.linkLabel(row.key)}
											name={`${fields.linkLabel.name}[${at}]`}
											label={`Link ${at + 1} name`}
											placeholder="Instagram"
											value={row.label}
											onChange={(event) => editRow(row.key, 'label', event.currentTarget.value)}
											error={labelError === undefined ? null : <MarkedText text={labelError} />}
										/>
										<Field
											id={sharingIds.linkUrl(row.key)}
											name={`${fields.linkUrl.name}[${at}]`}
											label={`Link ${at + 1} web address`}
											type="url"
											placeholder="https://"
											value={row.url}
											onChange={(event) => editRow(row.key, 'url', event.currentTarget.value)}
											error={urlError === undefined ? null : <MarkedText text={urlError} />}
											beside={
												<Button
													type="button"
													variant="quiet"
													size="sm"
													mark="trash-2"
													aria-label={`Remove link ${at + 1}`}
													onClick={() => removeRow(row.key)}
												>
													Remove
												</Button>
											}
										/>
									</div>
								);
							})}
							{edit.rows.length < SOCIAL_LINKS_MAX ? (
								<div>
									<Button type="button" size="sm" mark="plus" id={sharingIds.add} onClick={addRow}>
										Add a link
									</Button>
								</div>
							) : null}
							{linksError === undefined ? null : (
								<FieldMessage id={`${sharingIds.links}-err`}>
									<MarkedText text={linksError} />
								</FieldMessage>
							)}
						</fieldset>
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
							label="Save sharing"
							doneLabel={saved === 'sharing-undone' ? 'Undone' : 'Saved'}
							state={buttonState(save)}
						/>
						{/* offered while the landing stands and nothing is changed over it, as the story's. */}
						{landed && !changed ? (
							<Button
								type="submit"
								form={SHARING_UNDO.id}
								variant="quiet"
								size="sm"
								mark={redo ? 'redo-2' : 'undo-2'}
								aria-busy={undoing}
								aria-disabled={undoing || undefined}
								onClick={(event) => {
									if (undoing) event.preventDefault();
								}}
							>
								{redo ? 'Redo' : 'Undo'}
							</Button>
						) : null}
					</div>
				</div>
			</Form>
			<Form method="post" preventScrollReset id={SHARING_UNDO.id}>
				<input {...whichForm(SHARING_UNDO.id)} />
				<input {...recordVersion(version)} />
			</Form>
		</Section>
	);
}
