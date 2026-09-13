import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { DestructiveConfirm } from '@better-giving/operator/components/shell/DestructiveConfirm';
import { Column, Section } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { useSaveState } from '@better-giving/operator/save-state.react';
import { getFormProps } from '@conform-to/react';
import { useEffect, useRef } from 'react';
import { data, Form, href, Link, useNavigation } from 'react-router';
import { z } from 'zod';
import { ProgramFields } from '$lib/admin/programs/fields';
import { type CrumbHandle, ScreenCrumbs } from '$lib/admin/crumbs';
import { buttonState } from '$lib/admin/save-button-state';
import { savedSection } from '$lib/admin/saved-section';
import { screenTitle } from '$lib/admin/screen-title';
import {
	type AdminActionData,
	resultFor,
	useAdminForm,
	whichForm
} from '$lib/admin/use-admin-form';
import { defineForm, WHICH_FORM } from '$lib/forms/definition';
import { PROGRAM_TEXT_FIELDS, type ProgramInputValues } from '$lib/programs/fields';
import { PROGRAM_INPUT_FORM } from '$lib/programs/input-schema';
import { PROGRAM_STATUS_LABELS } from '$lib/programs/statuses';
import { redactPublicId } from '$lib/redact';
import { invalid, parseForm, submittedForm, unread } from '$lib/server/conform';
import { loadFailed, notFound } from '$lib/server/db/load-failure';
import { redirectWithFlash, SAVED_FLASH, takeFlash } from '$lib/server/flash';
import {
	archiveProgram,
	type ProgramSave,
	readProgram,
	updateProgram
} from '$lib/server/programs/queries';
import {
	parseProgramInput,
	programInputValues,
	programInputValuesFrom
} from '$lib/server/programs/program-input';
import { database } from '../context';
import type { Route } from './+types/_app.admin.programs.$id';

// one cause: read as a loader, written by the action below. no client-side mutation path, per
// CLAUDE.md — everything that reaches the database goes through that action and nothing else.
//
// two submissions and one `action`, told apart by the box `whichForm` writes into each `<form>`.
// the mechanism is the seam's rather than this screen's, and `$lib/server/conform.ts`'s header is
// where it is argued.
//
// one group and not four, unlike ./_app.admin.forms.$id.tsx: a cause is a name and a sentence, so
// there is nothing to split and one save covers the whole of what an operator typed.
//
// an archived cause draws a record rather than an editor, exactly as an archived form does — and
// for a stronger reason than that screen has: a retired cause is what the gifts already recorded
// against it still name, so the row is what a report reads and nothing here may move it.

/**
 * the two ids this screen's forms answer to, literals rather than derived.
 *
 * the archive states no box and is a form all the same: the body has to say which of this screen's
 * submissions it is, and a rejection has to come back under an id the group does not answer to —
 * otherwise a refused archive would render as a complaint about a box a fundraiser filled in
 * correctly. its schema states nothing because there is nothing on that form to validate: the id it
 * acts on comes from the route, which is what keeps a stale tab from retiring a cause nobody was
 * looking at.
 */
const DETAILS_FORM_ID = 'program-edit';
const ARCHIVE_FORM_ID = 'program-archive';

const PROGRAM_EDIT = defineForm({ id: DETAILS_FORM_ID, schema: PROGRAM_INPUT_FORM });
const PROGRAM_ARCHIVE = defineForm({ id: ARCHIVE_FORM_ID, schema: z.object({}) });

/** every form this screen carries, which is the list a submitted body is read against. */
const SCREEN_FORMS = [DETAILS_FORM_ID, ARCHIVE_FORM_ID] as const;

/**
 * the one group, as a save names itself to the page it redirects back to.
 *
 * a marker naming the section rather than a bare flag even with one button, for the reason
 * `$lib/admin/saved-section.ts` states: what counts as a section is the screen's to say, and a
 * marker no section answers to reports nothing.
 */
const SAVED_SECTIONS = ['details'] as const;

/** the marker an archive leaves, which is deliberately not one of the sections above. */
const ARCHIVED = 'archived';

/** what a name another cause already carries says, keyed to the box holding it. */
const NAME_TAKEN = 'A program with this name already exists.';

/**
 * the sentence a save answers with when the row is not there to be written.
 *
 * `updateProgram` refuses an archived row as well as a missing one at its `where`, and the page
 * offers no save for either — so this is a tab that was open when the cause was archived, or a
 * bookmark to one that is gone.
 */
const ROW_GONE =
	'Nothing was saved: this program has been archived, or it no longer exists. Reload the page to ' +
	'see how it stands.';

/** what a save says when the write itself threw. */
const WRITE_FAILED = 'Saving this program failed and nothing was changed. Try again.';

/** what a refused archive says when the write threw. */
const ARCHIVE_FAILED = 'Archiving this program failed and nothing was changed. Try again.';

/** what a refused archive says when there was nothing to archive. */
const ARCHIVE_GONE =
	'Nothing was archived: this program is already archived, or it no longer exists. Reload the ' +
	'page to see how it stands.';

/** whether a field the parser rejected is one this action keys a message by, which is both. */
function isTextField(field: string): field is (typeof PROGRAM_TEXT_FIELDS)[number] {
	return (PROGRAM_TEXT_FIELDS as readonly string[]).includes(field);
}

/** the section this screen sits under, named first in the trail and in the tab. */
const SECTION = 'Programs';

export const handle = {
	crumbs: ({ loaderData, pathname }) => [
		{ href: href('/admin/programs'), label: SECTION },
		{ href: pathname, label: loaderData?.name ?? SECTION }
	]
} satisfies CrumbHandle<Route.ComponentProps['loaderData']>;

export function meta({ loaderData, matches }: Route.MetaArgs): Route.MetaDescriptors {
	// the cause's own name, and the section's word where there is none to name — a mistyped id, a
	// read that failed.
	return [{ title: screenTitle(loaderData?.name ?? SECTION, matches) }];
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
	const db = context.get(database);

	let record: Awaited<ReturnType<typeof readProgram>>;
	try {
		// an archived row comes back, deliberately. "this cause was retired" and "there is no such
		// cause" are different sentences on a screen, and a lookup that hid the first would collapse
		// them into a 404 an operator cannot act on.
		record = await readProgram(db, params.id);
	} catch (e) {
		console.error('reading a program failed:', e);
		loadFailed('This program');
	}

	if (record === null) {
		// the id is in the address bar, so a wrong one is a typo or a stale bookmark rather than a
		// broken deployment. echoed through the public-id arm of `$lib/redact.ts`, which is the cap
		// against a path segment being text of any length.
		notFound(
			`No program has the id \`${redactPublicId(params.id)}\`. Check the address, or open /admin/programs for the programs this deployment has.`
		);
	}

	const archived = record.status === 'archived';

	// the outcome of whichever write on this screen just redirected here, taken: read and cleared on
	// this one response, so a reload reports nothing. taken after every read and every refusal above,
	// so a screen that could not be drawn burns no marker.
	const landed = await takeFlash(request, SAVED_FLASH);

	return data(
		{
			id: record.id,
			name: record.name,
			description: record.description,
			status: record.status,
			archived,
			// the boxes, or nothing for a cause nobody may edit: an archived one draws a record, so a
			// seed for it would be values for a form nothing renders.
			editor: archived ? null : programInputValuesFrom(record),
			// which group's save just landed here, so the confirmation is drawn on the button that did
			// it. `null` for a marker no section answers to.
			saved: savedSection(landed?.marker ?? null, SAVED_SECTIONS),
			archivedJustNow: landed?.marker === ARCHIVED,
			// whether the operator has asked to archive and is being asked again. the state lives in
			// the URL because that is where a confirmation an operator can share, reload and back out
			// of lives. never offered for a cause that is already archived: the action would refuse
			// it, so a panel asking about it is a question with one wrong answer.
			confirmArchive: !archived && new URL(request.url).searchParams.get('confirm') === 'archive'
		},
		// the header that burns the marker rides on the response that publishes it, so a reload of
		// this screen reports nothing. a `Set-Cookie` from a loader is sent without this route
		// exporting `headers` — react router preserves that one header on its own
		// (react-router/docs/how-to/headers.md).
		landed === null ? {} : { headers: { 'Set-Cookie': landed.clear } }
	);
}

/**
 * every write this screen performs.
 *
 * **the request body is read exactly once, here, by the action that owns it** — `parseForm` reads
 * what it returns and nothing above this route may.
 */
export async function action(args: Route.ActionArgs) {
	const body = await args.request.formData();

	switch (submittedForm(body, SCREEN_FORMS)) {
		case DETAILS_FORM_ID:
			return saveDetails(args, body);
		case ARCHIVE_FORM_ID:
			return archive(args);
	}

	// the two arms are declared inside the action rather than beside it, and it is not a style
	// choice: react router strips a route's `action` from the bundle it ships and strips nothing
	// else, so a module-scope helper reaching `$lib/server/**` puts D1 and this deployment's secrets
	// into the browser — with the export that used it dropped and the helper still there.
	// ../routes.spec.ts is what holds that, over the module graph rather than over a rule.

	/** save the name and the description, which are one decision and so one write. */
	async function saveDetails({ context, params, request }: Route.ActionArgs, body: FormData) {
		const id = params.id;
		const submission = parseForm(body, PROGRAM_EDIT);
		const parsed = parseProgramInput(programInputValues(body));

		if (!parsed.ok || !submission.ok) {
			const fieldErrors: Record<string, string[]> = {};
			if (!parsed.ok) {
				for (const [field, sentence] of Object.entries(parsed.errors)) {
					if (isTextField(field)) fieldErrors[field] = [sentence];
				}
			}
			return invalid(400, submission.reject({ fieldErrors }));
		}

		let saved: ProgramSave;
		try {
			saved = await updateProgram(context.get(database), id, parsed.value);
		} catch (e) {
			console.error('saving a program failed:', e);
			return invalid(500, submission.reject({ formErrors: [WRITE_FAILED] }));
		}

		// three answers and three sentences. the name is the one an operator can fix without leaving
		// the page, so it is keyed to the box they retype rather than banner-ed.
		if (saved === 'duplicate_name') {
			return invalid(400, submission.reject({ fieldErrors: { name: [NAME_TAKEN] } }));
		}
		if (saved === 'gone') return invalid(400, submission.reject({ formErrors: [ROW_GONE] }));

		// POST-redirect-GET, so a reload does not re-post: this write replaces both columns, so a
		// stale body sitting in the browser's reload buffer would silently undo a later save.
		return redirectWithFlash(request, SAVED_FLASH, screen(id), 'details');
	}

	/**
	 * retire this cause.
	 *
	 * its own submission rather than a status a `<select>` could write, because `PROGRAM_STATUSES`
	 * and `archived_at` are two representations of one fact and a cause holding one without the
	 * other reads retired on a screen and active to every form's picker. `archiveProgram` sets both
	 * in one statement.
	 *
	 * the cause is not deleted and there is no undo here: `donation.program_id` and `form.program_id`
	 * both name the row, and a report that stopped being able to say where last quarter's money went
	 * is a loss nobody would notice.
	 */
	async function archive({ context, params, request }: Route.ActionArgs) {
		const id = params.id;
		let archived: boolean;
		try {
			archived = await archiveProgram(context.get(database), id);
		} catch (e) {
			console.error('archiving a program failed:', e);
			return invalid(500, unread(PROGRAM_ARCHIVE, ARCHIVE_FAILED));
		}

		if (!archived) return invalid(400, unread(PROGRAM_ARCHIVE, ARCHIVE_GONE));

		return redirectWithFlash(request, SAVED_FLASH, screen(id), ARCHIVED);
	}
}

/** where every write on this screen sends the browser back to. */
function screen(id: string): string {
	return href('/admin/programs/:id', { id });
}

// what this page owes is one group that saves on its own, a rejected save that comes back with what
// was typed still in the boxes, and an archived cause that renders as a record rather than as an
// editable screen.
export default function Program({ loaderData, actionData }: Route.ComponentProps) {
	const { archived, archivedJustNow, description, editor, id, name, status } = loaderData;

	// whether the archive's own outcome is on the screen. the banner reporting it is the only thing
	// the archive leaves behind — there is no control left for it to report on — so it is where focus
	// has to go.
	const announcing = archivedJustNow && !actionData;

	// the notice arrives already holding its text, and a live region that arrives carrying its own
	// text is one insertion rather than a change: no reader announces it, and focus is still on
	// `<body>` after a press made at the foot of the page. so a reader is moved to it instead, which
	// reads it out on arrival and puts them at the top of the record they just changed (WCAG 4.1.3).
	//
	// the attributes are on a block around the banner because `Banner` states its own role from its
	// tone and takes neither a ref nor a `tabIndex`. the block is what focus lands on and the
	// `role="status"` it wraps is what is read from it.
	//
	// keyed to the flag rather than to mount: the archive redirects to this same address, so this
	// component is never unmounted and a mount-only effect would run on the visit before the press.
	const notice = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (announcing) notice.current?.focus();
	}, [announcing]);

	// what a refused save said about the submission as a whole — a write that threw, a row that has
	// gone.
	const saveRefusal = formRefusal(PROGRAM_EDIT, actionData);

	// what a refused archive said, which travels under its own form's id: the button submits no
	// values, so there is no box for a message to sit under and a page reading one channel for both
	// would render a refused archive as a complaint about an input a fundraiser filled in correctly.
	const archiveRefusal = formRefusal(PROGRAM_ARCHIVE, actionData);

	return (
		// one column and the column is what spaces it: every block below carries no margin of its
		// own, so one that is not rendered leaves no space behind it.
		<Column>
			{/* the outcome that belongs to the page as a whole, above everything. dropped the moment a
			    later attempt comes back rejected: a confirmation sitting above a failure reads as one
			    confused sentence.

			    a save is not one of them: the group below reports on its own button, and a line up
			    here would be a second telling. what is left is the one outcome with no button on this
			    page to report on — an archive, after which there is no editor left at all. */}
			{announcing ? (
				<div ref={notice} tabIndex={-1}>
					<Banner tone="note" word="Archived">
						{name} is no longer offered on a donation form.
					</Banner>
				</div>
			) : null}

			{saveRefusal ? (
				<Banner tone="blocker" word="Not saved">
					<MarkedText text={saveRefusal} />
				</Banner>
			) : null}
			{archiveRefusal ? (
				<Banner tone="blocker" word="Not archived">
					<MarkedText text={archiveRefusal} />
				</Banner>
			) : null}

			{/* the header is written out of the classes packages/operator/src/styles/adm.css already
			    draws rather than mounted from the library's `PageHeader`: that component's trailing
			    slot is documented as the page's own action, and a route exporting an `action` cannot
			    pass a prop of that name at all, because ../routes.spec.ts's bundle sweep reads the
			    attribute as a reference to the export.

			    an archived cause's word is the quiet one: `secondary` is for a status that has run its
			    course. */}
			<header className="adm-pageheader">
				<ScreenCrumbs />
				<div className="adm-pageheader__row">
					<h1>{name}</h1>
					<StatusWord secondary={archived}>{PROGRAM_STATUS_LABELS[status]}</StatusWord>
				</div>
			</header>

			{editor === null ? (
				<StoredRecord description={description} />
			) : (
				<Editor boxes={editor} saved={loaderData.saved} actionData={actionData} />
			)}

			{archived ? null : (
				<ArchiveSection id={id} name={name} confirming={loaderData.confirmArchive} />
			)}
		</Column>
	);
}

/** the sentence a form was refused with that belongs to no box, or nothing where there is none. */
function formRefusal(
	form: { readonly id: string },
	actionData: AdminActionData
): string | undefined {
	return resultFor(form, actionData)?.error?.['']?.at(-1);
}

/**
 * the one group, its own `<form>` with its own save at its own foot.
 *
 * a component of its own because the boxes are: an archived cause has no editor, so there is no
 * seed for one and the `useAdminForm` call has nothing to mount.
 */
function Editor({
	boxes,
	saved,
	actionData
}: {
	readonly boxes: ProgramInputValues;
	readonly saved: 'details' | null;
	readonly actionData: AdminActionData;
}) {
	const [form, fields] = useAdminForm(PROGRAM_EDIT, actionData, { defaultValue: boxes });

	// which form is being submitted right now, read off the body the router is carrying rather than
	// off the navigation state alone: two forms post to one address, and a bare `submitting` would
	// put the dots on the archive as well.
	const navigation = useNavigation();
	const submitting =
		navigation.state === 'submitting' ? navigation.formData?.get(WHICH_FORM) : null;

	// `!actionData`, because a refused write is answered with a rejection rather than a redirect, so
	// the marker the last landing published may still be on the page.
	const save = useSaveState({
		landed: saved === 'details' && !actionData,
		// conform's own reading of its values against the record the boxes were seeded from
		// ($lib/admin/use-admin-form.ts).
		changed: form.dirty,
		pending: submitting === PROGRAM_EDIT.id
	});

	return (
		// no `action` attribute, so this posts to the address the operator is standing on and leaves
		// whatever is in its query alone — which on this screen is the archive confirmation.
		// `getFormProps` puts the form's own id on the element, which is what conform's focus move
		// looks the form up by; the hidden box beside it is what the *action* looks the form up by.
		<Form method="post" {...getFormProps(form)}>
			<input {...whichForm(PROGRAM_EDIT.id)} />
			<ProgramFields
				boxes={{ name: fields.name, description: fields.description }}
				footer={<SaveButton label="Save program" state={buttonState(save)} />}
			/>
		</Form>
	);
}

/**
 * an archived cause, read-only, with no save to be found.
 *
 * `updateProgram` refuses an archived row at the `where`, so a box here would be one whose button
 * never works — and there is no un-archive: it is not a screen this version has.
 *
 * the name and the status are the heading above rather than rows in here, so what is left is the
 * one thing an archived cause still says about itself.
 */
function StoredRecord({ description }: { readonly description: string | null }) {
	return (
		<Section>
			<h2>How this program was described</h2>
			<p className="adm-prose">
				Nothing on an archived program can be changed. The gifts recorded against it still name it.
			</p>
			<dl>
				<div className="adm-setting">
					<dt className="adm-setting__label">Description</dt>
					{/* the word rather than a blank, because a blank value beside a label reads as a
					    screen that failed to load one. */}
					<dd className="adm-setting__value">{description ?? 'None'}</dd>
				</div>
			</dl>
		</Section>
	);
}

/**
 * retiring a cause, in two steps.
 *
 * archiving cannot be undone from here, so the first step is a link and the state it puts the
 * screen into is a state of the URL — which is what makes it shareable, reloadable and reachable
 * with the browser's own Back.
 *
 * it stays in the page, which is the ordinary case: /admin spends the top layer only where an act
 * reachable from the surface destroys something that already exists, which `.adm-dialog` in
 * packages/operator/src/styles/adm.css states. archiving destroys nothing — every gift recorded
 * against the cause still names it — so the question stays where the record it is about is.
 */
function ArchiveSection({
	id,
	name,
	confirming
}: {
	readonly id: string;
	readonly name: string;
	readonly confirming: boolean;
}) {
	// the question in the words it is asked in, stated once and read twice: it is the banner's own
	// word and it is the name of the group holding the banner and the two controls. one expression
	// rather than two strings, so the name a voice user says cannot drift from what is on the screen
	// (WCAG 2.5.3).
	const question = `Archive ${name}?`;

	// where the answer lands on the two navigations that open and leave the question. both are links
	// to this same address, and a navigation carrying nothing puts focus back at the top of the
	// document — while the question, its two controls and the link that opens them are all at the
	// foot of the page. `preventScrollReset` on each link keeps the page where it is; this is the
	// other half, and without it a reader being read to is returned to the masthead by a press they
	// made at the bottom of the page (WCAG 2.4.3).
	//
	// the confirmation itself takes the focus rather than the button inside it: the question is what
	// has to be read before either control means anything, and the two are one Tab away. it is a
	// named group, so what a reader is moved to announces itself as the question rather than as an
	// unnamed box.
	//
	// the third navigation is not this effect's and cannot be: an archive that lands redirects onto a
	// record with no question and no archive section left on it, and the banner reporting it takes
	// focus in the screen component above.
	//
	// only when the state changes, so a page opened straight at `?confirm=archive` — a reload, an
	// address somebody pasted — lands where the browser puts it rather than being moved by a press
	// nobody made.
	const confirmation = useRef<HTMLDivElement>(null);
	const ask = useRef<HTMLAnchorElement>(null);
	const wasConfirming = useRef(confirming);
	useEffect(() => {
		if (confirming === wasConfirming.current) return;
		wasConfirming.current = confirming;
		(confirming ? confirmation.current : ask.current)?.focus();
	}, [confirming]);

	return (
		<Section>
			<h2>Archive</h2>
			<p className="adm-prose">
				Archiving takes this program off every donation form that offers a choice. Forms already
				pinned to it stay on it, and the gifts it has taken keep naming it.
			</p>
			{confirming ? (
				<Form method="post">
					<input {...whichForm(PROGRAM_ARCHIVE.id)} />
					{/* the way out is a `Link` rather than an anchor, so leaving this panel is a
					    navigation the router handles rather than a full document load.

					    the block carries the `tabIndex` that makes it a place focus can land and the
					    role and name that make what a reader lands on announce itself. the name is
					    stated rather than read off the banner's word: a word is a node, and the string
					    a voice user says has to be one this screen wrote. */}
					<DestructiveConfirm
						ref={confirmation}
						role="group"
						aria-label={question}
						tabIndex={-1}
						tone="attention"
						word={question}
						confirm="Yes, archive this program"
						cancel="Cancel"
						cancelProps={{ as: Link, to: screen(id), preventScrollReset: true }}
					>
						This cannot be undone from here.
					</DestructiveConfirm>
				</Form>
			) : (
				// a link dressed as a button, because it writes nothing: it asks.
				<div className="adm-actions">
					<Link
						className="adm-btn"
						preventScrollReset
						ref={ask}
						to={`${screen(id)}?confirm=archive`}
					>
						Archive this program
					</Link>
				</div>
			)}
		</Section>
	);
}
