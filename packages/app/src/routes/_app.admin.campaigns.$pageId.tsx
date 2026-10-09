import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { useCallback, useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { z } from 'zod';
import { AddressSheet } from '$lib/admin/editor/address-sheet';
import { BlockEditSheet, isDonationBox, useLayoutPick } from '$lib/admin/editor/block-edit';
import { useEditorChat } from '$lib/admin/editor/chat-wiring';
import { DonationSettingsSheet } from '$lib/admin/editor/donation-settings';
import { EditorShell } from '$lib/admin/editor/editor-shell';
import { suggestUrl } from '$lib/admin/editor/suggest';
import { NameSheet } from '$lib/admin/editor/name-sheet';
import { EndDateSettingsSheet, GoalSettingsSheet } from '$lib/admin/editor/page-settings';
import { PreviewFrame } from '$lib/admin/editor/preview-frame';
import { PublishBar } from '$lib/admin/editor/publish-bar';
import { type FirstPublish, usePublishPresses } from '$lib/admin/editor/publish-wiring';
import { SettingsSheet, type SettingsRow } from '$lib/admin/editor/settings-sheet';
import { screenTitle } from '$lib/admin/screen-title';
import { resultFor } from '$lib/admin/use-admin-form';
import { defineForm, RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { PROGRAM_MODE_LABELS } from '$lib/forms/program-modes';
import { BLOCK_FORM_IDS } from '$lib/page/block-edit';
import { HEADING_MAX } from '$lib/page/catalog';
import {
	PAGE_END_DATE_FORM_ID,
	PAGE_GOAL_FORM_ID,
	PAGE_SETTING_FORM_IDS
} from '$lib/page/page-settings-form';
import {
	DISCARD_FORM_ID,
	FIRST_PUBLISH_FORM_ID,
	PUBLISH_FORM_ID,
	PUBLISH_FORMS,
	UNDO_FORM_ID
} from '$lib/page/publish-form';
import { PAGE_SETTINGS_FORM_ID, type SettingsSeed } from '$lib/page/settings-form';
import { checkSlug, type SlugCheck } from '$lib/page/slug';
import { invalid, parseForm, submittedForm, submittedVersion } from '$lib/server/conform';
import { loadFailed, notFound } from '$lib/server/db/load-failure';
import type { Page } from '$lib/server/db/schema';
import { draftIllustrations, editorDraft, saveBlockForm } from '$lib/server/pages/blocks';
import {
	type EditorPage,
	editorPage,
	readEditorSettings,
	saveDraftSettings,
	unreadableEditor
} from '$lib/server/pages/editor';
import { answerPublishPress } from '$lib/server/pages/publish';
import { savePageSetting } from '$lib/server/pages/page-settings';
import {
	addressAsked,
	type NameWrite,
	readPage,
	type SlugWrite,
	updateCampaignName,
	updateCampaignSlug
} from '$lib/server/pages/queries';
import { database, platform } from '../context';
import type { BareHandle } from './_app';
import type { Route } from './+types/_app.admin.campaigns.$pageId';

// a campaign's editor, reached from the Campaigns list: its draft framed by the preview route, the
// publish bar over it, the AI panel beside it ($lib/admin/editor/chat-wiring.tsx, which asks an
// empty chat its opening questions), and the Settings sheet behind the bar's Settings, while Edit
// is on. the parts are $lib/admin/editor/'s; what they read and the writes behind them are here and
// in $lib/server/pages/queries.ts.
//
// **the name** is edited in place in the bar and as Settings' Name row, one write: the row's `name`,
// which the dashboard shows, its settings row's, which a gift's notices carry, and the draft's,
// which donors see from the next Publish — the same write a chat turn's rename makes
// ($lib/server/pages/queries.ts, `renaming`). until the first Publish an address not set by hand
// follows it, to the next free one where another page holds the one the name suggests, and the
// first Publish's confirm names the one it did not get (`addressAsked`).
//
// **a draft the read rule refuses** ($lib/server/pages/document.ts) opens the editor on a notice
// in the preview's place, with Discard changes where the live page reads: the one screen that can
// repair the page opens whatever the rule now says.
//
// **the address** takes effect when it is saved, not at Publish. a save the address rule refuses is
// answered naming the clash; one that would stop a published campaign's address working, or take
// the address an ended campaign holds, is answered with the question instead of a write, and the
// save goes again with that question answered yes. the same body posted without the answer is
// asked again, so no caller moves either address unasked.
//
// **the donation settings** are the draft's, saved by their sheet's one Done and reaching donors
// only at Publish; the Donation page's editor saves them the same way ($lib/server/pages/editor.ts).
// so are the goal and the end date ($lib/server/pages/page-settings.ts). the shade, corners and
// share message are set only through the chat ($lib/page/accept-reply.ts).
//
// **Publish, Undo and Discard changes** are $lib/server/pages/publish.ts's, the presses and their
// confirms mounted through $lib/admin/editor/publish-wiring.tsx.
//
// **a block's words and pictures** are edited in its sheet, opened by a click on the block in the
// preview while Edit is on and by its row in Settings' block list alike, and the layout by
// Settings' pictures; each writes the draft ($lib/server/pages/blocks.ts), as the Donation page's
// editor does.
// the donation box opens Donation settings, which are what it draws.
//
// every press is written against the version the editor was drawn at (`submittedVersion`), and the
// preview is keyed on it, so the frame reloads on the render a landed write's revalidation brings.

export const handle: BareHandle = { frame: 'bare' };

const NAME_FORM_ID = 'campaign-name';
const ADDRESS_FORM_ID = 'campaign-address';

/** a campaign's name, as the dashboard shows it and as its title draws it from the next publish. */
const NAME_EDIT = defineForm({
	id: NAME_FORM_ID,
	schema: z.object({
		name: z
			.string('required')
			.trim()
			.min(1, 'required')
			.max(HEADING_MAX, `at most ${HEADING_MAX} characters`)
	})
});

/**
 * the address, and the two questions a move may have been answered yes to. the case is repaired
 * rather than refused: the router matches an address in any case.
 */
const ADDRESS_EDIT = defineForm({
	id: ADDRESS_FORM_ID,
	schema: z.object({
		slug: z.string('required').trim().toLowerCase(),
		move: z.boolean().optional(),
		takeover: z.boolean().optional()
	})
});

const SCREEN_FORMS = [
	NAME_FORM_ID,
	ADDRESS_FORM_ID,
	PAGE_SETTINGS_FORM_ID,
	...PUBLISH_FORMS,
	FIRST_PUBLISH_FORM_ID,
	...PAGE_SETTING_FORM_IDS,
	...BLOCK_FORM_IDS
] as const;

const DONATION_PAGE_PATH = '/donate';

const STALE =
	'Nothing was changed: this campaign has been saved since the editor was opened. Reload it, then make this change again.';
const NAME_FAILED = 'Renaming this campaign failed and nothing was changed. Try again.';
const ADDRESS_FAILED = 'Saving the address failed and nothing was changed. Try again.';

/** what the bar and the notice call a draft the read rule refuses. */
const UNREADABLE_WORD = 'This draft can’t be read';

/** what a press on a page that is not a campaign, or no page at all, is told. */
const gone = (pageId: string) =>
	`no campaign has the id "${pageId}"; open it again from the Campaigns list.`;

export function meta({ loaderData, matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(loaderData?.name ?? 'Campaign', matches) }];
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
	const db = context.get(database);
	let row: Page | null;
	let settings: SettingsSeed;
	let asked: string | null;
	let illustrations: ReadonlySet<string>;
	let framed: EditorPage;
	try {
		row = await readPage(db, params.pageId);
	} catch (e) {
		console.error(`loading campaign ${params.pageId}'s editor failed:`, e);
		loadFailed('This campaign');
	}
	if (row === null || row.type !== 'campaign' || row.name === null) notFound(gone(params.pageId));
	const now = Date.now();
	const named = {
		name: row.name,
		address: row.slug === null ? null : `/${row.slug}`,
		host: `${new URL(request.url).host}/`
	};
	const unreadable = unreadableEditor(row, now);
	if (unreadable !== null) return { ...unreadable, ...named };
	try {
		[framed, settings, asked, illustrations] = await Promise.all([
			editorPage(db, row, now),
			readEditorSettings(db, context.get(platform).env, row, new URL(request.url).origin),
			addressAsked(db, row),
			draftIllustrations(db, row)
		]);
	} catch (e) {
		console.error(`loading campaign ${params.pageId}'s editor failed:`, e);
		loadFailed('This campaign');
	}
	return {
		...framed,
		...editorDraft(row, settings.currency, illustrations),
		...named,
		settings,
		asked: asked === null ? null : `/${asked}`
	};
}

/** the address rule's refusal as the predicate under the box. */
function slugPredicate(refused: Exclude<SlugCheck, { ok: true }>): string {
	switch (refused.reason) {
		case 'empty':
			return 'required';
		case 'length':
			return `at most ${refused.max} characters`;
		case 'character':
			return `lowercase letters, numbers and single hyphens between words, not “${refused.character}”`;
		case 'reserved':
			return refused.clashesWith === DONATION_PAGE_PATH
				? 'taken by the Donation page'
				: `clashes with ${refused.clashesWith}`;
	}
}

export async function action({ context, params, request }: Route.ActionArgs) {
	const body = await request.formData();

	const pressed = submittedForm(body, SCREEN_FORMS);
	switch (pressed) {
		case NAME_FORM_ID:
			return saveName();
		case ADDRESS_FORM_ID:
			return saveAddress();
		case PAGE_SETTINGS_FORM_ID:
			return saveDraftSettings(
				context.get(database),
				{ id: params.pageId, type: 'campaign' },
				body,
				gone(params.pageId)
			);
		case PUBLISH_FORM_ID:
		case FIRST_PUBLISH_FORM_ID:
		case UNDO_FORM_ID:
		case DISCARD_FORM_ID:
			return answerPublishPress(
				context.get(database),
				{ id: params.pageId, type: 'campaign' },
				body,
				gone(params.pageId)
			);
		case PAGE_GOAL_FORM_ID:
		case PAGE_END_DATE_FORM_ID:
			return savePageSetting(
				context.get(database),
				{ id: params.pageId, type: 'campaign' },
				pressed,
				body,
				gone(params.pageId)
			);
		default:
			return saveBlockForm(
				context.get(database),
				{ id: params.pageId, type: 'campaign' },
				pressed,
				body,
				gone(params.pageId)
			);
	}

	// declared inside the action: react router strips the `action` export from the browser bundle
	// and nothing else, so a module-scope helper reaching `$lib/server/**` would ship with the page
	// (../routes.spec.ts).

	async function saveName() {
		const submission = parseForm(body, NAME_EDIT);
		if (!submission.ok) return invalid(400, submission.reject());
		const seen = submittedVersion(body);
		let written: NameWrite;
		try {
			written = await updateCampaignName(
				context.get(database),
				params.pageId,
				seen,
				submission.value.name
			);
		} catch (e) {
			console.error(`renaming campaign ${params.pageId} failed:`, e);
			return invalid(500, submission.reject({ formErrors: [NAME_FAILED] }));
		}
		switch (written) {
			case 'written':
				return { saved: 'name' as const };
			case 'stale':
				return invalid(409, submission.reject({ formErrors: [STALE] }));
			case 'gone':
				return invalid(404, submission.reject({ formErrors: [gone(params.pageId)] }));
		}
	}

	async function saveAddress() {
		const submission = parseForm(body, ADDRESS_EDIT);
		if (!submission.ok) return invalid(400, submission.reject());
		const checked = checkSlug(submission.value.slug);
		if (!checked.ok) {
			return invalid(400, submission.reject({ fieldErrors: { slug: [slugPredicate(checked)] } }));
		}
		const seen = submittedVersion(body);
		let written: SlugWrite;
		try {
			written = await updateCampaignSlug(
				context.get(database),
				params.pageId,
				seen,
				checked.slug,
				{ move: submission.value.move === true, takeover: submission.value.takeover === true },
				Date.now()
			);
		} catch (e) {
			console.error(`moving campaign ${params.pageId}'s address failed:`, e);
			return invalid(500, submission.reject({ fieldErrors: { slug: [ADDRESS_FAILED] } }));
		}
		const to = `/${checked.slug}`;
		switch (written.kind) {
			case 'written':
				return { saved: 'address' as const };
			case 'ask':
				return {
					ask:
						written.ask === 'move'
							? { kind: written.ask, from: `/${written.from}`, to }
							: { kind: written.ask, holder: written.holder, to }
				};
			case 'taken':
				return invalid(
					409,
					submission.reject({ fieldErrors: { slug: [`taken by ${written.by}`] } })
				);
			case 'stale':
				return invalid(409, submission.reject({ fieldErrors: { slug: [STALE] } }));
			case 'gone':
				return invalid(404, submission.reject({ fieldErrors: { slug: [gone(params.pageId)] } }));
		}
	}
}

type Answer = Route.ComponentProps['actionData'];

/** the first message the last answer refused `form` with under `box` — `''` is the form's own. */
function refusal(answer: Answer | undefined, form: { id: string }, box: string): string | null {
	return resultFor(form, answer)?.error?.[box]?.[0] ?? null;
}

/** the question an address save came back with. */
type Question = Extract<NonNullable<Answer>, { ask: unknown }>['ask'];

/** the questions a move has been answered yes to, as the boxes post them. */
type Confirmed = { readonly move: boolean; readonly takeover: boolean };

/**
 * the first Publish's "Gifts go to": the active programs, the retired one the draft still pins, and
 * the draft's own mode where it pins none, on what the draft holds now.
 */
function giftsGoTo(settings: SettingsSeed): Pick<FirstPublish, 'programs' | 'program'> {
	const mode = settings.boxes.program_mode;
	const pinned = mode === 'pinned';
	return {
		programs: [
			...(pinned ? [] : [{ value: mode, label: PROGRAM_MODE_LABELS[mode] }]),
			...(settings.retired ? [settings.retired] : []),
			...settings.programs
		],
		program: pinned ? settings.boxes.program_id : mode
	};
}

type Loaded = Route.ComponentProps['loaderData'];

export default function CampaignEditor({ loaderData, params }: Route.ComponentProps) {
	return loaderData.unreadable ? (
		<UnreadableDraftEditor loaderData={loaderData} />
	) : (
		<DraftEditor loaderData={loaderData} suggest={suggestUrl(params.pageId)} />
	);
}

/** the name's in-place and Settings edits, on one fetcher, and where the last one was made. */
function useRename(version: number) {
	const fetcher = useFetcher<Answer>({ key: NAME_EDIT.id });
	/** where the last rename was made, so its refusal is said there. */
	const [renamedIn, setRenamedIn] = useState<'bar' | 'sheet'>('bar');
	const renaming = fetcher.state !== 'idle';
	const answer = renaming ? undefined : fetcher.data;
	const rename = (next: string, from: 'bar' | 'sheet') => {
		setRenamedIn(from);
		const body = new FormData();
		body.set(WHICH_FORM, NAME_EDIT.id);
		body.set(RECORD_VERSION, String(version));
		body.set('name', next);
		fetcher.submit(body, { method: 'post' });
	};
	const barError = renamedIn === 'bar' ? nameRefusal(answer) : null;
	return {
		rename,
		renaming,
		renamedIn,
		answer,
		renamed: answer != null && 'saved' in answer && answer.saved === 'name',
		barReport: barError === null ? null : { press: 'name' as const, text: barError }
	};
}

function nameRefusal(answer: Answer | undefined): string | null {
	return refusal(answer, NAME_EDIT, 'name') ?? refusal(answer, NAME_EDIT, '');
}

/**
 * the editor over a draft the read rule refuses: the bar, with Discard changes where the live page
 * reads, and a notice in the preview's place. the name still renames.
 */
function UnreadableDraftEditor({
	loaderData
}: {
	readonly loaderData: Extract<Loaded, { unreadable: true }>;
}) {
	const { name, address, state, version, discardable } = loaderData;
	const presses = usePublishPresses({ version, state });
	const naming = useRename(version);
	return (
		<EditorShell
			bar={
				<PublishBar
					closeHref="/admin/campaigns"
					page={{ kind: 'campaign', name, onRename: (next) => naming.rename(next, 'bar') }}
					state={state}
					livePath={address ?? undefined}
					{...presses.bar}
					onPublish={undefined}
					publishHeld={UNREADABLE_WORD}
					onDiscard={discardable ? presses.bar.onDiscard : undefined}
					report={presses.bar.report ?? naming.barReport}
				/>
			}
			preview={
				<div className="adm-main">
					<Banner tone="attention" word={UNREADABLE_WORD}>
						{discardable
							? 'It holds something a campaign can no longer hold. Discard changes to go back to the live page.'
							: 'It holds something a campaign can no longer hold, and there is no live page to go back to.'}
					</Banner>
				</div>
			}
		>
			{presses.confirm}
		</EditorShell>
	);
}

function DraftEditor({
	loaderData,
	suggest
}: {
	readonly loaderData: Extract<Loaded, { unreadable: false }>;
	readonly suggest: string;
}) {
	const { name, address, state, version, preview, host, settings: donationSettings } = loaderData;

	const presses = usePublishPresses({
		version,
		state,
		first:
			state === 'unpublished'
				? {
						name,
						address: address ?? '',
						asked: loaderData.asked ?? undefined,
						...giftsGoTo(donationSettings)
					}
				: undefined
	});
	const naming = useRename(version);
	const chat = useEditorChat(loaderData.chat, loaderData.drafted);
	const addressFetcher = useFetcher<Answer>({ key: ADDRESS_EDIT.id });

	const [settings, setSettings] = useState(false);
	const [opened, setOpened] = useState<SettingsRow | null>(null);
	/** the address last saved, and the questions answered yes so far on the way to it. */
	const [moving, setMoving] = useState<{ slug: string; confirmed: Confirmed } | null>(null);
	/** the question up, held while the save answering it is in flight. */
	const [question, setQuestion] = useState<Question | null>(null);
	const [blockId, setBlockId] = useState<string | null>(null);
	const openBlock = loaderData.blocks.find((block) => block.id === blockId) ?? null;
	const closeBlock = useCallback(() => setBlockId(null), []);
	const openBlockSheet = (id: string) =>
		isDonationBox(loaderData.blocks, id) ? setOpened('donation-settings') : setBlockId(id);
	const layoutPick = useLayoutPick(loaderData.layout, version);

	const { renamed, renaming, renamedIn } = naming;
	const nameAnswer = naming.answer;

	const saving = addressFetcher.state !== 'idle';
	const addressAnswer = saving ? undefined : addressFetcher.data;
	const addressSaved =
		addressAnswer != null && 'saved' in addressAnswer && addressAnswer.saved === 'address';

	// a Done that landed closes the Name sheet, back onto Settings.
	useEffect(() => {
		if (renamed) setOpened((was) => (was === 'name' ? null : was));
	}, [renamed]);

	// each answer puts up the question it asks, or takes the last one down.
	useEffect(() => {
		if (addressAnswer === undefined) return;
		setQuestion(addressAnswer != null && 'ask' in addressAnswer ? addressAnswer.ask : null);
	}, [addressAnswer]);

	const { rename } = naming;

	const saveAddress = (slug: string, confirmed: Confirmed) => {
		setMoving({ slug, confirmed });
		const body = new FormData();
		body.set(WHICH_FORM, ADDRESS_EDIT.id);
		body.set(RECORD_VERSION, String(version));
		body.set('slug', slug);
		if (confirmed.move) body.set('move', 'on');
		if (confirmed.takeover) body.set('takeover', 'on');
		addressFetcher.submit(body, { method: 'post' });
	};

	const answerYes = (kind: keyof Confirmed) => {
		if (moving !== null) saveAddress(moving.slug, { ...moving.confirmed, [kind]: true });
	};
	const answerNo = () => setQuestion(null);

	return (
		<EditorShell
			undrafted={chat.undrafted}
			bar={
				<PublishBar
					closeHref="/admin/campaigns"
					page={{ kind: 'campaign', name, onRename: (next) => rename(next, 'bar') }}
					state={state}
					livePath={address ?? undefined}
					{...presses.bar}
					onSettings={() => {
						layoutPick.startClean();
						setSettings(true);
					}}
					onAi={chat.open}
					report={presses.bar.report ?? naming.barReport}
				/>
			}
			preview={
				<PreviewFrame
					key={version}
					src={preview}
					title={`Preview of ${name}`}
					onBlockClick={openBlockSheet}
				/>
			}
			panel={chat.panel}
		>
			{chat.sheet}
			{settings && opened !== 'address' ? (
				<SettingsSheet
					onDismiss={() => setSettings(false)}
					campaign={{
						name,
						address: address ?? '',
						goalMinor: loaderData.goalMinor,
						currency: donationSettings.currency,
						endDate: loaderData.endDate
					}}
					blocks={loaderData.blocks}
					onOpenBlock={openBlockSheet}
					layouts={loaderData.layouts}
					{...layoutPick.sheet}
					donationSettings={donationSettings.summary}
					onOpen={setOpened}
				/>
			) : null}
			{openBlock === null ? null : (
				<BlockEditSheet
					key={openBlock.id}
					block={openBlock}
					version={version}
					suggestUrl={suggest}
					onDismiss={closeBlock}
					onSaved={closeBlock}
					stacked={settings}
				/>
			)}
			{opened === 'name' ? (
				<NameSheet
					name={name}
					onDone={(next) => (next === name ? setOpened(null) : rename(next, 'sheet'))}
					applying={renaming && renamedIn === 'sheet'}
					error={renamedIn === 'sheet' ? refusal(nameAnswer, NAME_EDIT, 'name') : null}
					refusal={renamedIn === 'sheet' ? refusal(nameAnswer, NAME_EDIT, '') : null}
					onDismiss={() => setOpened(null)}
					suggestUrl={suggest}
				/>
			) : null}
			{opened === 'goal' ? (
				<GoalSettingsSheet
					goalMinor={loaderData.goalMinor}
					currency={donationSettings.currency}
					version={version}
					onDismiss={() => setOpened(null)}
					onSaved={() => setOpened(null)}
				/>
			) : null}
			{opened === 'end-date' ? (
				<EndDateSettingsSheet
					endDate={loaderData.endDate}
					version={version}
					onDismiss={() => setOpened(null)}
					onSaved={() => setOpened(null)}
				/>
			) : null}
			{opened === 'donation-settings' ? (
				<DonationSettingsSheet
					seed={donationSettings}
					version={version}
					onDismiss={() => setOpened(null)}
					onSaved={() => setOpened(null)}
					stacked={settings}
				/>
			) : null}
			{opened === 'address' ? (
				<AddressSheet
					host={host}
					slug={address?.slice(1) ?? ''}
					onSave={(slug) => saveAddress(slug, { move: false, takeover: false })}
					saving={saving}
					saved={addressSaved}
					error={refusal(addressAnswer, ADDRESS_EDIT, 'slug')}
					onDismiss={() => setOpened(null)}
				/>
			) : null}
			{presses.confirm}
			{question?.kind === 'move' ? (
				<Modal
					title={`Change the address to ${question.to}?`}
					danger="Change address"
					dangerProps={held(saving, () => answerYes('move'))}
					cancel="Cancel"
					cancelProps={{ type: 'button', onClick: answerNo }}
					onDismiss={answerNo}
				>
					<p>
						<code className="adm-chip">{question.from}</code> stops working at once, and links
						already shared to it will find nothing.
					</p>
				</Modal>
			) : null}
			{question?.kind === 'takeover' ? (
				<Modal
					title={`Use ${question.to} here?`}
					commit="Use it here"
					commitProps={held(saving, () => answerYes('takeover'))}
					cancel="Cancel"
					cancelProps={{ type: 'button', onClick: answerNo }}
					onDismiss={answerNo}
				>
					<p>
						It shows the ended screen of {question.holder}. Taking it leaves that campaign with no
						address.
					</p>
				</Modal>
			) : null}
		</EditorShell>
	);
}

/** a confirm's act, holding its focus while the save it answered is in flight. */
function held(busy: boolean, act: () => void) {
	return {
		type: 'button' as const,
		'aria-busy': busy,
		'aria-disabled': busy || undefined,
		onClick: () => {
			if (!busy) act();
		}
	};
}
