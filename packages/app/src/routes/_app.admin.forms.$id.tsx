import { formSnippet } from '@better-giving/form/embed/snippet';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { CodeChip, CodeSlab } from '@better-giving/operator/components/data/CodeSlab';
import { DestructiveConfirm } from '@better-giving/operator/components/shell/DestructiveConfirm';
import { Column, Section } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { useSaveState } from '@better-giving/operator/save-state.react';
import { getFormProps } from '@conform-to/react';
import { useEffect, useRef } from 'react';
import { data, Form, href, Link, useNavigation } from 'react-router';
import { z } from 'zod';
import { FormGivingFields } from '$lib/admin/forms/giving-fields';
import { FormNameFields } from '$lib/admin/forms/name-fields';
import { FormOriginsFields } from '$lib/admin/forms/origins-fields';
import { FormProgramFields } from '$lib/admin/forms/program-fields';
import { FormsReadiness } from '$lib/admin/forms/readiness';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { type CrumbHandle, ScreenCrumbs } from '$lib/admin/crumbs';
import { buttonState } from '$lib/admin/save-button-state';
import { savedSection } from '$lib/admin/saved-section';
import { screenTitle } from '$lib/admin/screen-title';
import {
	type AdminActionData,
	resultFor,
	insertWhenValid,
	useAdminForm,
	whichForm
} from '$lib/admin/use-admin-form';
import { readAmount } from '$lib/forms/amounts';
import { defineForm, WHICH_FORM } from '$lib/forms/definition';
import {
	FORM_TEXT_FIELDS,
	type FormInputFieldErrors,
	type FormInputValues
} from '$lib/forms/fields';
import {
	FORM_GIVING_INPUT,
	FORM_NAME_INPUT,
	FORM_ORIGINS_INPUT,
	FORM_PROGRAM_INPUT,
	unlistedSiteProblem,
	unlistedSites
} from '$lib/forms/input-schema';
import { PROGRAM_MODE_LABELS } from '$lib/forms/program-modes';
import { anyBlocker } from '$lib/forms/readiness';
import {
	EDITABLE_FORM_STATUSES,
	type EditableFormStatus,
	FORM_STATUS_LABELS,
	FORM_STATUS_NOTES
} from '$lib/forms/statuses';
import { formatMinor } from '$lib/donations/money';
import { redactPublicId } from '$lib/redact';
import { invalid, parseForm, submittedForm, unread } from '$lib/server/conform';
import { loadFailed, notFound } from '$lib/server/db/load-failure';
import { redirectWithFlash, SAVED_FLASH, takeFlash } from '$lib/server/flash';
import {
	formInputValues,
	formInputValuesFrom,
	parseFormGiving,
	parseFormName,
	parseFormOrigins,
	parseFormProgram
} from '$lib/server/forms/form-input';
import {
	archiveForm,
	type ProgramSave,
	readForm,
	updateFormGiving,
	updateFormName,
	updateFormOrigins,
	updateFormProgram
} from '$lib/server/forms/queries';
import { formsReadiness } from '$lib/server/forms/readiness';
import { readOrgProfile } from '$lib/server/org/queries';
import { readActivePrograms, readProgram } from '$lib/server/programs/queries';
import { readSites } from '$lib/server/sites/queries';
import { database } from '../context';
import type { Route } from './+types/_app.admin.forms.$id';

// one donation form: read as a loader, written by the action below. no client-side mutation path,
// per CLAUDE.md — everything that reaches the database goes through that action and nothing else.
//
// what a form may be lives in `$lib/forms/input-schema.ts`, `@better-giving/operator/origins` and
// `$lib/server/forms/form-input.ts`, and what reaches the database lives in that folder's
// `queries.ts`; the only job here is turning a request into the first and a failure into a
// sentence.
//
// this screen saves one group at a time. four groups, four `<form>` elements, four writes that
// can each fail on their own, so a fundraiser fixing the amounts does not re-submit the sites and a
// refused save marks up only the group it came from. the screen that makes a form keeps one form
// and one submit — a form that does not exist yet cannot have a group saved against it — so
// ./_app.admin.forms.new.tsx validates `FORM_INPUT_FORM` whole.
//
// every division below the heading block is a card: each group because a card is the extent of what
// one press writes, and the snippet, the stored record and the archive so that one screen wears one
// frame throughout. `.adm-card` in packages/operator/src/styles/adm.css argues the choice. the
// banners, the readiness block and the status note stay on the page's own ground above them.
//
// **five submissions and one `action`, which is the whole of what react router gives a route.**
// what tells them apart is the box `whichForm` writes into each `<form>`, carrying the id that form
// already states; `submittedForm` reads it before anything else and the switch below is the five
// arms. the mechanism is the seam's rather than this screen's, and `$lib/server/conform.ts`'s
// header is where it is argued.
//
// a form screen carries only what that form decides. how often a gift may repeat and what a donor
// may pay by are the deployment's — neither is read here and neither is drawn — and so is the list
// of sites a form may be ticked against, which this screen reads and never writes: the console is
// where that list is typed.
//
// this screen reports the writes its own buttons performed and no others. a create is not one of
// them and this screen never takes the create's marker: ./_app.admin.forms.new.tsx redirects to the
// forms list, which names the form it made against its own rows. the two markers have separate
// cookie names for exactly that reason — the list's is sent to this address as well, because the
// cookie is written at `/` — and `$lib/server/flash.ts` is where that is stated.

/**
 * the five ids this screen's forms answer to.
 *
 * literals rather than derived, which is the rule `$lib/server/conform.ts` argues: a screen
 * carrying more than one form matches every result by id, and two structurally identical groups
 * sharing one is every save updating both.
 *
 * they are also what a body names itself with, so each one is a `const` of its own rather than only
 * a key on the form below: the switch in the action narrows on these literals, and an arm for a
 * form this screen does not state is then a type error rather than an arm nothing reaches.
 */
const NAME_FORM_ID = 'form-edit-name';
const PROGRAM_FORM_ID = 'form-edit-program';
const GIVING_FORM_ID = 'form-edit-giving';
const ORIGINS_FORM_ID = 'form-edit-origins';

/**
 * the archive, which states no box.
 *
 * a form all the same, and under one `action` that is the mechanism rather than a cost: the body
 * has to say which of this screen's five submissions it is, and a rejection has to come back under
 * an id the four groups do not answer to — otherwise a refused archive would render as a
 * complaint about a box a fundraiser filled in correctly. the schema states nothing because there
 * is nothing on this form to validate: the id it acts on comes from the route, which is what keeps
 * a stale tab from retiring a form nobody was looking at.
 */
const ARCHIVE_FORM_ID = 'form-archive';

const FORM_EDIT_NAME = defineForm({ id: NAME_FORM_ID, schema: FORM_NAME_INPUT });
const FORM_EDIT_PROGRAM = defineForm({ id: PROGRAM_FORM_ID, schema: FORM_PROGRAM_INPUT });
const FORM_EDIT_GIVING = defineForm({ id: GIVING_FORM_ID, schema: FORM_GIVING_INPUT });
const FORM_EDIT_ORIGINS = defineForm({ id: ORIGINS_FORM_ID, schema: FORM_ORIGINS_INPUT });
const FORM_ARCHIVE = defineForm({ id: ARCHIVE_FORM_ID, schema: z.object({}) });

/** every form this screen carries, which is the list a submitted body is read against. */
const SCREEN_FORMS = [
	NAME_FORM_ID,
	PROGRAM_FORM_ID,
	GIVING_FORM_ID,
	ORIGINS_FORM_ID,
	ARCHIVE_FORM_ID
] as const;

/**
 * the four groups, as a save names itself to the page it redirects back to.
 *
 * a marker per group and never one bare flag: each group is its own submission with its own button
 * at its own foot, and the confirmation is drawn on the button that did the write — so a flag all
 * four shared would report one save on four buttons. what reads it back is
 * `$lib/admin/saved-section.ts`, and what a marker no group answers to means is stated there.
 *
 * they are their own names rather than the forms' ids, because what the marker picks out is the
 * group of boxes: an id is a value a rejection is matched by, and this is a word one redirect
 * leaves for the next GET.
 */
const SAVED_SECTIONS = ['name', 'program', 'giving', 'origins'] as const;

/**
 * the marker an archive leaves, which is deliberately not one of the four above.
 *
 * one redirect leaves one outcome, so the archive and the four saves share a marker rather than
 * needing two — and the value being outside `SAVED_SECTIONS` is what keeps `savedSection` from
 * lighting a button over a form that was retired.
 */
const ARCHIVED = 'archived';

/**
 * what to say when Live was posted while a blocker stands.
 *
 * the select does not offer Live in that state, so reaching this means a stale tab, a hand-built
 * body, or a blocker that arrived between the page being drawn and the save being pressed. a
 * filtered `<option>` list is not a control, and the enum is not enough on its own here: `live` is
 * a member of `EDITABLE_FORM_STATUSES` whatever the deployment is doing.
 *
 * it names the block above rather than a variable: the block says which line stands and what it
 * costs, and a second account of it inside a field message would be one to keep in step.
 */
const LIVE_WITHHELD =
	'This form cannot be set live while a blocker above stands: nothing would be served to a ' +
	'donor. Clear it and choose Live again.';

/**
 * what a save pinned to a cause this deployment no longer offers says, keyed to the program box.
 *
 * no schema states it — what a deployment still offers is a table, and the schema runs in a
 * browser — so the write is where it is settled and this is the sentence it comes back as.
 *
 * no press an operator can make on a page drawn now reaches it. the select carries the retired
 * cause this form is already on, and a save that leaves it there is a group equal to its own seed,
 * whose button has nothing to press. what reaches it is a page whose select was drawn while the
 * cause was still offered and pinned to it since, and a body nothing on this screen drew. the guard
 * stands for both: no constraint holds a pinned id to an active cause —
 * `form_program_pinned_check` in `$lib/server/db/schema.ts` holds the pair and says nothing about
 * status — so a pin the write took is a form recording gifts against a fund the deployment stopped
 * offering, and nothing downstream asks again.
 *
 * keyed to the box the operator picks in, because that is where the answer is. the same sentence
 * ./_app.admin.forms.new.tsx refuses a create with, so a screen cannot word one state two ways.
 */
const NO_SUCH_PROGRAM = 'Choose an active program.';

/**
 * the sentence a group save answers with when the row is not there to be written.
 *
 * one string for four arms: `updateForm*` refuses an archived row as well as a missing one at its
 * `where`, and the page never offers a save for either — so this is a tab that was open when the
 * form was archived, or a bookmark to one that is gone. it is a rejected save an operator can read
 * rather than an error page, and it is answered by the update's own `returning()` rather than by a
 * select ahead of it: D1 has no transaction, so a check-then-write would be two commits with a race
 * between them, and the write already knows.
 */
const ROW_GONE =
	'Nothing was saved: this form has been archived, or it no longer exists. Reload the page to ' +
	'see how it stands.';

/**
 * the sentence a group save answers with when the write itself threw.
 *
 * nothing that reaches it is a user error — the values have been accepted — so the cause goes to
 * the log and the page gets a fixed string, with no detail leaked and no field blamed. keyed to no
 * box: a write that failed is not something an operator can fix by editing an input.
 */
const WRITE_FAILED = 'Saving this group failed and nothing was changed. Try again.';

/** what a refused archive says when the write threw. */
const ARCHIVE_FAILED = 'Archiving this form failed and nothing was changed. Try again.';

/**
 * what a refused archive says when there was nothing to archive.
 *
 * no such form, or one that already is. the second is a double click or a stale tab, and refusing
 * it is what keeps the timestamp that records when it happened from being overwritten.
 */
const ARCHIVE_GONE =
	'Nothing was archived: this form is already archived, or it no longer exists. Reload the page ' +
	'to see how it stands.';

/**
 * whether a field a parser rejected is one this action keys a message by.
 *
 * the two list fields are skipped, and with conform that is a decision rather than a limit: a
 * repeated input's message is keyed by the input's own name (`$lib/server/conform.ts`), so either
 * one *could* be keyed. what it would cost is the amounts.
 *
 * each list field's rule in the parser is the same one the schema states — `readOriginList` for the
 * sites and `readSuggestedAmounts` for the amounts — over the same rows: the parser's clean stage
 * trims and takes nothing out, so neither reader is handed a list the other did not see. the parser
 * therefore objects to a list in a subset of the cases the schema already objected to, and the
 * schema's message is already on the rejection when it does. the amounts are the one list where the schema is silent and the parser is not — zod
 * skips an object check over a value whose bound aborted, while `parseFormGiving` measures every
 * amount whatever the bounds did — and in that case the ruler is the thing that could not be read,
 * so telling an operator their amounts are out of a range nobody set is a sentence about the wrong
 * box.
 *
 * read off `FORM_TEXT_FIELDS` rather than written out, so a field added as a list in
 * `$lib/forms/fields.ts` is skipped here without anyone having to remember to. the same note sits
 * on the create screen's own copy in ./_app.admin.forms.new.tsx.
 */
function isTextField(field: string): field is (typeof FORM_TEXT_FIELDS)[number] {
	return (FORM_TEXT_FIELDS as readonly string[]).includes(field);
}

/** a parser's messages, keyed by the boxes this action may file one under. */
function keyed(errors: FormInputFieldErrors): Record<string, string[]> {
	const fieldErrors: Record<string, string[]> = {};
	for (const [field, sentence] of Object.entries(errors)) {
		if (isTextField(field)) fieldErrors[field] = [sentence];
	}
	return fieldErrors;
}

function isEditableStatus(value: string): value is EditableFormStatus {
	return (EDITABLE_FORM_STATUSES as readonly string[]).includes(value);
}

/**
 * the boxes each of the four groups is seeded with, or `null` for a form that draws no editor.
 *
 * one seed per group and never one seed for all four. each group is its own form, and what a group
 * holds to save is its own boxes against its own seed, read by the form layer (`useAdminForm` in
 * `$lib/admin/use-admin-form.ts`) — so a seed carrying keys the group does not state would report
 * every group as changed forever, and every save button on the screen would offer itself over boxes
 * nobody had touched.
 *
 * `null` where the stored status is not one of the two an operator may choose between, which is an
 * archived form and nothing else: that reading draws the record rather than the editor, so a seed
 * for it would be a status this file invented for a `<select>` nothing renders. narrowing here
 * rather than at the screen is also what lets the status box be typed as the pair rather than as
 * the column's whole union.
 *
 * the amounts open on one blank row where the form suggests none, and the blank is not a value:
 * `readSuggestedAmounts` in `$lib/forms/amounts.ts` drops a row nobody typed into. what it buys is a
 * box to type in on a form with no tiles yet, instead of a group whose only control is an Add. the
 * sites take no such padding and must not — they are tick boxes drawn from the deployment's own
 * list, so a blank entry would be a box the screen has nothing to draw for.
 */
function editorBoxes(values: FormInputValues) {
	const status = values.status;
	if (status === undefined || !isEditableStatus(status)) return null;

	const amounts = values.suggested_amounts ?? [];
	return {
		nameBoxes: { name: values.name ?? '', status },
		// both boxes, because both are submitted: the program box is in the tree in every mode and
		// hidden in two of them (`$lib/admin/forms/program-fields.tsx`), so a seed missing it is a
		// box with nothing to bind to and a group that reads as changed forever.
		programBoxes: {
			program_mode: values.program_mode ?? 'none',
			program_id: values.program_id ?? ''
		},
		givingBoxes: {
			min_minor: values.min_minor ?? '',
			max_minor: values.max_minor ?? '',
			suggested_amounts: amounts.length > 0 ? [...amounts] : ['']
		},
		originsBoxes: { allowed_origins: [...(values.allowed_origins ?? [])] }
	};
}

/**
 * the program group's two boxes as they compare, which is the id read off the mode.
 *
 * the select is in the tree in every mode and hidden in two of them
 * (`$lib/admin/forms/program-fields.tsx`), so a group taken off a pin still submits the id it was
 * pinned to — and `parseFormProgram` in `$lib/server/forms/form-input.ts` drops that id rather than
 * refusing it. compared raw against what this group was seeded with, the id left in the select is a
 * change nobody made: the save lands, `Saved` never draws, and the button goes on offering itself
 * over a group holding nothing.
 */
function programComparison(boxes: unknown): { program_mode: string; program_id: string } {
	const held = (typeof boxes === 'object' && boxes !== null ? boxes : {}) as Record<
		string,
		unknown
	>;
	const mode = String(held.program_mode ?? '');
	return { program_mode: mode, program_id: mode === 'pinned' ? String(held.program_id ?? '') : '' };
}

/**
 * whether the program group holds anything to save — the one group on either operator surface whose
 * button is not armed by the form layer's own reading.
 *
 * **it is not "anything differs from the seed", and the hidden select is why.** conform reads every
 * control the form states, so a group moved off a pin is dirty over an id the deployment will drop
 * — and moved back to the mode it was seeded in, it stays dirty over that same id forever: the save
 * lands, the record does not move, so nothing re-seeds the form and the tick never draws. what
 * decides this group is what the write would store, which is {@link programComparison} over each
 * side.
 *
 * both sides go through that reading rather than the seam learning about this group: what a box is
 * worth to a comparison is the screen's own, and `useAdminForm` in `$lib/admin/use-admin-form.ts`
 * stays one reading for every group on every screen.
 */
export function programChanged(seed: unknown, held: unknown): boolean {
	const was = programComparison(seed);
	const now = programComparison(held);
	return was.program_mode !== now.program_mode || was.program_id !== now.program_id;
}

/** the section this screen sits under, named first in the trail and in the tab. */
const SECTION = 'Donation forms';

export const handle = {
	crumbs: ({ loaderData, pathname }) => [
		{ href: href('/admin/forms'), label: SECTION },
		{ href: pathname, label: loaderData?.name ?? SECTION }
	]
} satisfies CrumbHandle<Route.ComponentProps['loaderData']>;

export function meta({ loaderData, matches }: Route.MetaArgs): Route.MetaDescriptors {
	// the form's own name, and the section's word where there is no form to name — a mistyped id,
	// a read that failed. the fallback is what keeps a tab saying something on every reading of
	// this address.
	return [{ title: screenTitle(loaderData?.name ?? SECTION, matches) }];
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
	const db = context.get(database);
	const url = new URL(request.url);

	let record: Awaited<ReturnType<typeof readForm>>;
	let profile: Awaited<ReturnType<typeof readOrgProfile>>;
	let sites: string[];
	let programs: Awaited<ReturnType<typeof readActivePrograms>>;

	try {
		// four independent reads, so they go together: none is an input to another, and awaiting them
		// in turn pays four round trips for one screen. every one of them is this deployment's own
		// database — nothing on this screen leaves the deployment, because neither of the two values
		// that would need the processor is a form's to answer and both are the console's.
		//
		// archived rows come back, deliberately. "this form was retired" and "there is no such form"
		// are different sentences on a screen, and a lookup that hid the first would collapse them
		// into a 404 an operator cannot act on.
		//
		// the second is the organisation's own identity, which is not this form's row and is not fixed
		// on this screen — it is read because this is where a form is set live, and publishing one
		// while those columns are blank produces a form that serves nothing.
		//
		// the third is the deployment's own list of sites, which the tick boxes are drawn from. it
		// is read for an archived form too, which that reading of the screen does not draw: whether
		// this form is archived is `record`'s to say and `record` is one of the three, so the only way
		// to skip it would be to await the row first and the list after — a second round trip on
		// every reading of the page that is not archived.
		[record, profile, sites, programs] = await Promise.all([
			readForm(db, params.id),
			readOrgProfile(db),
			readSites(db),
			readActivePrograms(db)
		]);
	} catch (e) {
		console.error('reading a donation form failed:', e);
		loadFailed('This donation form');
	}

	if (record === null) {
		// the id is in the address bar, so a wrong one is a typo or a stale bookmark rather than a
		// broken deployment. echoed whole, through the public-id arm of `$lib/redact.ts` — the app's
		// one echo policy, and a form id is the carve-out in it: it is public by construction, so
		// cutting it withholds nothing from anyone while costing the operator the half that tells a
		// mistyped id from the one they meant. the cap that survives is the one against a path
		// segment being text of any length.
		notFound(
			`No donation form has the id \`${redactPublicId(params.id)}\`. Check the address, or open /admin/forms for the forms this deployment has.`
		);
	}

	const archived = record.status === 'archived';

	// the cause this form names, where it names one the active list no longer holds — a cause
	// retired after this form was pinned to it. a fifth read rather than a fourth, because it takes
	// the row's own `program_id` and there is nothing to read until the first four have landed; it
	// is skipped on every form that is not in that state, which is every form on a deployment that
	// has retired nothing.
	//
	// it is read rather than left out because the select has to carry it: a form already pinned to a
	// retired cause has to keep the pin while its other groups are saved, and a picker drawn without
	// it would show a blank where the operator's own answer is.
	let retired: Awaited<ReturnType<typeof readProgram>> = null;
	if (record.programId !== null && !programs.some((cause) => cause.id === record.programId)) {
		try {
			retired = await readProgram(db, record.programId);
		} catch (e) {
			console.error('reading the cause a donation form is pinned to failed:', e);
			loadFailed('This donation form');
		}
	}

	// the cause the record names, whichever of the two lists it came out of. `null` on a form that
	// pins none, which is what the read-only record renders the mode's own word for.
	const pinned =
		record.programId === null
			? null
			: (programs.find((cause) => cause.id === record.programId) ?? retired);

	// read once and used twice, in two shapes: as the editor's seed, and as the record an archived
	// form renders. `formInputValuesFrom` is what owns the amounts grammar both readings depend on.
	const values = formInputValuesFrom(record);

	// everything that stops this form serving, and the reason it is on this screen at all: this is
	// where a form is set live, and every line in the block is true of the deployment rather than of
	// this row — a config missing any of the three identity fields is refused by `readFormConfig`
	// (packages/form/src/config.ts) for every form at once, silently, so an operator who publishes
	// here would watch a Live form show nothing on their own site with no screen anywhere saying
	// why. `$lib/server/forms/readiness.ts` is shared with ./_app.admin.forms.new.tsx so neither
	// screen can say a different thing about one deployment.
	//
	// nothing to say for an archived form: it cannot be published from here whatever those values
	// hold, and a block about a state nobody reading this page can act on is the same question with
	// one wrong answer that the archive confirmation below is kept from asking.
	const readiness = archived ? null : formsReadiness(profile);

	// the outcome of whichever write on this screen just redirected here, taken: read and cleared on
	// this one response, so a reload reports nothing. `$lib/server/flash.ts` owns that.
	//
	// taken once into a name rather than asked for twice below, and taken here, after every read and
	// every refusal above, so a screen that could not be drawn burns no marker.
	const landed = await takeFlash(request, SAVED_FLASH);

	return data(
		{
			id: record.id,
			name: record.name,
			status: record.status,
			// displayed and never editable. v0 is USD-only by decision, and an operator who cannot see
			// the currency cannot tell what their form charges in.
			currency: record.currency,
			archived,
			editor: archived ? null : editorBoxes(values),
			// the same stored form as plain values, which is what the read-only record an archived form
			// renders is built from. deliberately not the editor's seed: those are the boxes and hold
			// only what an editor may hold, while this is the row — including the `archived` status the
			// editor's own schemas have no value for.
			values,
			// every form gets one, whatever this deployment can charge: what stands behind the key is
			// read at the console when the keys are pasted, and ./_app.admin.forms._index.tsx's header
			// states that in full.
			snippet: formSnippet(url.origin, record.id),
			readiness,
			// every site this deployment has listed, in the operator's own order — one tick box each,
			// with this form's own set ticked. the values and not row ids, because
			// `form.allowed_origins` holds the addresses themselves and there is deliberately no
			// foreign key between the two (see the header on `site` in `$lib/server/db/schema.ts`).
			//
			// the whole list rather than the ticked ones: an operator adding a site to this form has to
			// see the ones it is not on, and the empty list is a state the screen says something about.
			sites,
			// every cause this deployment still offers, as the two values the picker draws. the
			// archived ones are out — nothing newly pins to a retired cause, and `updateFormProgram`
			// refuses one anyway.
			programs: programs.map((cause) => ({ value: cause.id, label: cause.name })),
			// the retired cause this form is still pinned to, and `null` for every other form. it is
			// not in the list above and may not be added to it: a retired cause is not offered to a
			// form that is not already on it, and the select appends this one as the answer the form
			// holds until another is made.
			retiredProgram: retired && { value: retired.id, label: retired.name },
			// the two values the read-only record an archived form renders reads: the mode's own word,
			// and the cause a pinned form names. off the row rather than out of `values`, because
			// `PROGRAM_MODE_LABELS` is keyed by the mode and a box holds a string.
			programMode: record.programMode,
			pinnedProgram: pinned?.name ?? null,
			// where this deployment's own donation page answers, which the sites group states above the
			// boxes: this form loads on that page whatever is ticked, and the page is on no `site` row.
			//
			// the request rather than a stored value: the host this request arrived on is one this
			// worker answers on, which is the same reading `corsHeaders` in `$lib/server/api/cors.ts`
			// makes.
			donatePageOrigin: url.origin,
			// whether the status box may offer Live at all. a blocker means `publishedConfig` serves
			// nothing, so publishing here would produce a form that renders nothing on the org's own
			// site — the name group's save re-checks this, because a filtered `<option>` list is not a
			// control.
			liveOffered: !archived && !anyBlocker(readiness),
			// which group's save just landed here, so the confirmation is drawn on the button that did
			// it rather than in a banner four buttons would share. `null` for a marker no group
			// answers to; `$lib/admin/saved-section.ts` states why.
			saved: savedSection(landed?.marker ?? null, SAVED_SECTIONS),
			// whether an archive just landed here. it rides in the same marker as the four saves
			// rather than a second one, because one redirect leaves one outcome and `archived` is a
			// value no group answers to — so a save never reads as an archive and an archive never
			// lights a button.
			archivedJustNow: landed?.marker === ARCHIVED,
			// whether the operator has asked to archive and is being asked again.
			//
			// archiving cannot be undone here — there is no screen that brings a form back — so the
			// button is two steps, and the first step is a link. the state lives in the URL because
			// that is where a confirmation an operator can share, reload and back out of lives, and
			// because nothing on this screen has to hold it between two requests.
			//
			// never offered for a form that is already archived: the action would refuse it, so a panel
			// asking about it is a question with one wrong answer.
			confirmArchive: !archived && url.searchParams.get('confirm') === 'archive'
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
 *
 * one `action` and five submissions, told apart by the box `whichForm` writes into each `<form>`.
 * the archive is read the same way as the four saves, which is a change from the retired screen
 * and not a loosening of it: its body still carries no value this route reads, and the id it acts
 * on is still the route's, so there is still nothing on it a stale tab could aim elsewhere.
 */
export async function action(args: Route.ActionArgs) {
	const body = await args.request.formData();

	switch (submittedForm(body, SCREEN_FORMS)) {
		case NAME_FORM_ID:
			return saveName(args, body);
		case PROGRAM_FORM_ID:
			return saveProgram(args, body);
		case GIVING_FORM_ID:
			return saveGiving(args, body);
		case ORIGINS_FORM_ID:
			return saveOrigins(args, body);
		case ARCHIVE_FORM_ID:
			return archive(args);
	}

	// the four arms are declared inside the action rather than beside it, and it is not a style
	// choice: react router strips a route's `action` from the bundle it ships and strips nothing
	// else, so a module-scope helper reaching `$lib/server/**` puts D1 and this deployment's secrets
	// into the browser — with the export that used it dropped and the helper still there.
	// ../routes.spec.ts is what holds that, over the module graph rather than over a rule.
	//
	// each still states what it takes rather than closing over it, so an arm reads as the write it
	// is: the request it answers, and the body that was read exactly once above.

	/**
	 * save the name and the status.
	 *
	 * the id comes from the route rather than from a field, so there is nothing here for a stale tab to
	 * aim at a different form. this is the only group that can be refused for a reason no box states,
	 * which is Live while a blocker stands.
	 */
	async function saveName({ context, params, request }: Route.ActionArgs, body: FormData) {
		const id = params.id;
		// every box this form states has to arrive, and the sharp one here is `status`: absent, the
		// schema would stand it in as its first member — `draft` — so a body that never mentioned the
		// status would quietly unpublish a live form. `$lib/server/conform.ts`'s header argues it.
		const submission = parseForm(body, FORM_EDIT_NAME);

		// run whether or not the schema was happy, so every offending box comes back together.
		const parsed = parseFormName(formInputValues(body));

		// `!submission.ok` is half of this condition and it is not redundant: the parser reads a blank
		// box and an absent one alike, so a body carrying no `status` at all reaches it as nothing to
		// refuse and is refused only because the schema already refused it.
		if (!parsed.ok || !submission.ok) {
			return invalid(
				400,
				submission.reject({ fieldErrors: parsed.ok ? {} : keyed(parsed.errors) })
			);
		}

		const db = context.get(database);

		if (parsed.value.status === 'live') {
			// one thing stands between a form and Live, and it is read here rather than carried from the
			// loader: what a page was drawn against is not what is true when the button is pressed. the
			// select does not offer Live while a blocker stands, but a filtered `<option>` list is markup
			// and markup is not what stops a POST.
			//
			// a form on no site is not the second thing. it loads on the donation page this deployment
			// serves on its own address whatever is ticked, so an empty list publishes.
			const profile = await readOrgProfile(db);

			if (anyBlocker(formsReadiness(profile))) {
				return invalid(400, submission.reject({ fieldErrors: { status: [LIVE_WITHHELD] } }));
			}
		}

		let saved: boolean;
		try {
			saved = await updateFormName(db, id, parsed.value);
		} catch (e) {
			console.error('saving a donation form’s name and status failed:', e);
			return invalid(500, submission.reject({ formErrors: [WRITE_FAILED] }));
		}

		if (!saved) return invalid(400, submission.reject({ formErrors: [ROW_GONE] }));

		// POST-redirect-GET, so a reload does not re-post: this write replaces every column the group
		// owns, so a stale body sitting in the browser's reload buffer would silently undo a later save.
		return redirectWithFlash(request, SAVED_FLASH, screen(id), 'name');
	}

	/**
	 * save which cause this form's gifts are recorded against.
	 *
	 * the id comes from the route rather than from a field, so there is nothing here for a stale tab
	 * to aim at a different form. the one refusal no box states is the cause itself: what this
	 * deployment still offers is a table, and the schema that runs in the browser cannot read one.
	 */
	async function saveProgram({ context, params, request }: Route.ActionArgs, body: FormData) {
		const id = params.id;
		// every box this form states has to arrive, and the sharp one here is `program_mode`: absent,
		// the schema would stand it in as its first member — `none` — so a body that never mentioned
		// the mode would quietly unpin a form from the cause it was recording against.
		const submission = parseForm(body, FORM_EDIT_PROGRAM);
		const parsed = parseFormProgram(formInputValues(body));

		if (!parsed.ok || !submission.ok) {
			return invalid(
				400,
				submission.reject({ fieldErrors: parsed.ok ? {} : keyed(parsed.errors) })
			);
		}

		let saved: ProgramSave;
		try {
			saved = await updateFormProgram(context.get(database), id, parsed.value);
		} catch (e) {
			console.error('saving which cause a donation form records against failed:', e);
			return invalid(500, submission.reject({ formErrors: [WRITE_FAILED] }));
		}

		// three answers and three sentences. the cause is the one an operator can fix without
		// leaving the page, so it is keyed to the box they pick in rather than banner-ed.
		if (saved === 'unknown_program') {
			return invalid(400, submission.reject({ fieldErrors: { program_id: [NO_SUCH_PROGRAM] } }));
		}
		if (saved === 'gone') return invalid(400, submission.reject({ formErrors: [ROW_GONE] }));
		return redirectWithFlash(request, SAVED_FLASH, screen(id), 'program');
	}

	/**
	 * save the two bounds and the suggested tiles, which are one decision and so one write.
	 *
	 * the amounts' message comes out of the schema and never from here. `suggested_amounts` is a
	 * repeating row editor, so its rule is checked at the object level — every amount is measured
	 * against what the two bound boxes parsed to, which a rule on the key cannot see — and
	 * `suggestedAmountsRule` in `$lib/forms/input-schema.ts` pushes its own issue at that path, where
	 * it lands under the group's own input name.
	 */
	async function saveGiving({ context, params, request }: Route.ActionArgs, body: FormData) {
		const id = params.id;
		const submission = parseForm(body, FORM_EDIT_GIVING);
		const parsed = parseFormGiving(formInputValues(body));

		if (!parsed.ok || !submission.ok) {
			return invalid(
				400,
				submission.reject({ fieldErrors: parsed.ok ? {} : keyed(parsed.errors) })
			);
		}

		let saved: boolean;
		try {
			saved = await updateFormGiving(context.get(database), id, parsed.value);
		} catch (e) {
			console.error('saving what a donation form may take failed:', e);
			return invalid(500, submission.reject({ formErrors: [WRITE_FAILED] }));
		}

		if (!saved) return invalid(400, submission.reject({ formErrors: [ROW_GONE] }));
		return redirectWithFlash(request, SAVED_FLASH, screen(id), 'giving');
	}

	/**
	 * save the sites this form may be loaded from, out of the deployment's own list.
	 *
	 * every rule the schema can state comes out of the schema and never from here — both of the sites'
	 * rules push their own issue from inside `FORM_FIELD_RULES`, keyed by the group's own input name.
	 *
	 * the one rule that cannot be the schema's is which sites this deployment has listed, because that
	 * is a table and the schema runs in a browser too. the list is re-read here rather than carried
	 * from the loader for the reason the Live check above states — a filtered set of tick boxes is
	 * markup, and a site can leave the list between a page being drawn and its save being pressed.
	 */
	async function saveOrigins({ context, params, request }: Route.ActionArgs, body: FormData) {
		const id = params.id;
		const submission = parseForm(body, FORM_EDIT_ORIGINS);
		const parsed = parseFormOrigins(formInputValues(body));

		if (!parsed.ok || !submission.ok) {
			// the parser's arm is unreachable: the schema above ran the same `readOriginList` and refused
			// anything this could refuse. answered rather than asserted away, because the alternative is a
			// non-null claim about two call sites staying in step.
			return invalid(400, submission.reject());
		}

		const db = context.get(database);

		let listed: string[];
		try {
			listed = await readSites(db);
		} catch (e) {
			// the same banner a failed write gets, and it is the truthful one: nothing was saved and
			// nothing an operator can do to a box would change that.
			console.error('reading the sites this deployment has listed failed:', e);
			return invalid(500, submission.reject({ formErrors: [WRITE_FAILED] }));
		}

		// a site the deployment has stopped listing, still ticked on this form. the group is drawn with
		// it ticked and noted, and refused here until it is unticked or listed again — the screen cannot
		// be the control, because a set of tick boxes is markup.
		//
		// keyed by the group's own input name, which is where a repeated input's message goes: the box
		// to untick is on the screen, so it is not a banner.
		const unlisted = unlistedSiteProblem(unlistedSites(parsed.value.allowedOrigins, listed));
		if (unlisted !== null) {
			return invalid(400, submission.reject({ fieldErrors: { allowed_origins: [unlisted] } }));
		}

		let saved: boolean;
		try {
			saved = await updateFormOrigins(db, id, parsed.value);
		} catch (e) {
			console.error('saving where a donation form may be used failed:', e);
			return invalid(500, submission.reject({ formErrors: [WRITE_FAILED] }));
		}

		if (!saved) return invalid(400, submission.reject({ formErrors: [ROW_GONE] }));
		return redirectWithFlash(request, SAVED_FLASH, screen(id), 'origins');
	}

	/**
	 * retire this form.
	 *
	 * its own submission rather than a status a `<select>` could write, because `FORM_STATUSES` and
	 * `archived_at` are two representations of one fact and a form holding one without the other reads
	 * archived on a screen and live to the forms list. `archiveForm` sets both in one statement.
	 *
	 * the form is not deleted and there is no undo here: a pasted snippet outlives the row, sitting in
	 * someone else's HTML on a site we cannot reach.
	 *
	 * it rejects through `unread`, which is what a refusal with no submission behind it looks like: the
	 * body carried no value to reply from, so nothing comes back in it and there is no box for a
	 * message to sit under. the rejection carries this form's own id, which is what keeps a refused
	 * archive off the four save buttons.
	 */
	async function archive({ context, params, request }: Route.ActionArgs) {
		const id = params.id;
		let archived: boolean;
		try {
			archived = await archiveForm(context.get(database), id);
		} catch (e) {
			console.error('archiving a donation form failed:', e);
			return invalid(500, unread(FORM_ARCHIVE, ARCHIVE_FAILED));
		}

		if (!archived) return invalid(400, unread(FORM_ARCHIVE, ARCHIVE_GONE));

		return redirectWithFlash(request, SAVED_FLASH, screen(id), ARCHIVED);
	}
}

/** where every write on this screen sends the browser back to. */
function screen(id: string): string {
	return href('/admin/forms/:id', { id });
}

// what this page owes is four groups that each save on their own, a rejected save that comes back
// with what was typed still in the boxes of the group it came from, and an archived form that
// renders as a record rather than as an editable screen.

export default function DonationForm({ loaderData, actionData }: Route.ComponentProps) {
	const { archived, archivedJustNow, editor, id, name, readiness, snippet, status } = loaderData;

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
	// gone. read off whichever of the four groups was submitted, because only one of them can have
	// an outcome to report: an action answers one request.
	const saveRefusal = [FORM_EDIT_NAME, FORM_EDIT_PROGRAM, FORM_EDIT_GIVING, FORM_EDIT_ORIGINS]
		.map((form) => formRefusal(form, actionData))
		.find((sentence) => sentence !== undefined);

	// what a refused archive said, which travels under its own form's id rather than a group's: the
	// button submits no values, so there is no box for a message to sit under and a page reading one
	// channel for both would render a refused archive as a complaint about an input a fundraiser
	// filled in correctly.
	const archiveRefusal = formRefusal(FORM_ARCHIVE, actionData);

	const note = FORM_STATUS_NOTES[status];

	return (
		// one column and the column is what spaces it: every block below carries no margin of its
		// own, so one that is not rendered leaves no space behind it.
		<Column>
			{/* the outcomes that belong to the page as a whole, above everything. dropped the moment a
			    later attempt comes back rejected: a confirmation sitting above a failure reads as one
			    confused sentence.

			    a save is not one of them and must not become one: the four groups below save on their
			    own, so a line up here saying a write happened cannot say which button did it. what is
			    left is the one outcome with no button on this page to report on — an archive, after
			    which there is no editor left at all. */}
			{announcing ? (
				<div ref={notice} tabIndex={-1}>
					<Banner tone="note" word="Archived">
						{name} is off the donation forms list.
					</Banner>
				</div>
			) : null}

			{/* both keyed to no field, deliberately: a write that failed is not something an operator
			    can fix by editing an input, and rendering it under one tells them the input is wrong.
			    a save's arrives on its own group's rejection and the archive's on the archive form's,
			    which is the whole reason they are two conditions rather than one.

			    rendered through `MarkedText` rather than printed, because a sentence written in this
			    file marks what an operator has to act on with backticks. */}
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

			{/* the trail to the section this screen sits under, stated by this module's `handle`.

			    the status qualifies the form this whole page is about, so it stands on the heading's
			    own row rather than in the page under it. the header is written out of the classes
			    packages/operator/src/styles/adm.css already draws rather than mounted from the
			    library's `PageHeader`, which is the gap this route was reported against: that
			    component has one trailing slot and it is documented as the page's own action — and a
			    route exporting an `action` cannot pass a prop of that name at all, because
			    ../routes.spec.ts's bundle sweep reads the attribute as a reference to the export.
			    nothing new is drawn and no value is stated.

			    an archived form's word is the quiet one: `secondary` is for a status that has run its
			    course, which is exactly what archived is. */}
			<header className="adm-pageheader">
				<ScreenCrumbs />
				<div className="adm-pageheader__row">
					<h1>{name}</h1>
					<StatusWord secondary={archived}>{FORM_STATUS_LABELS[status]}</StatusWord>
				</div>
			</header>

			{/* what stands between this form and a donor giving through it, and it is here because
			    this is the screen that sets one live: the status box below would take Live and save
			    it, and the form would show nothing on the org's own site — or charge nothing — with
			    nothing on the donor's screen saying why. the same block the screen that makes a form
			    renders, so an operator meets one account of this and not two.

			    below the heading and below the write banners: it is a standing condition rather than
			    the outcome of anything just submitted. */}
			<FormsReadiness lines={readiness} />

			{/* the sentence under the heading block, which the header row itself has no room for: what
			    the status word beside the title costs. what a blocker costs this form is said at the
			    status box itself, which is where somebody tries to choose Live. */}
			{note ? <p className="adm-hint">{note}</p> : null}

			{editor === null ? (
				<StoredRecord data={loaderData} />
			) : (
				<Editor data={loaderData} editor={editor} actionData={actionData} />
			)}

			{/* a section with no form of its own: what an operator takes away from this screen. */}
			<Section card>
				<h2>Snippet</h2>
				<p className="adm-prose">Paste this into any page on one of the sites ticked above.</p>
				{/* captioned because this screen's slab stands under a heading naming the record and
				    not the thing in the box, and `record` beside it is what tells one form's snippet
				    from another's at the copy control. */}
				<CodeSlab label="snippet" record={name} content={snippet} copyable />
			</Section>

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
 * the four groups, each its own `<form>` with its own save at its own foot.
 *
 * a component of its own because the boxes are: an archived form has no editor, so there is no seed
 * for one, and the four `useAdminForm` calls have nothing to mount. it is what lets the seeds be
 * typed as the pair of statuses an operator may choose between rather than as the column's whole
 * union — and what keeps this file from inventing a status for a form nobody may edit.
 */
function Editor({
	data,
	editor,
	actionData
}: {
	readonly data: Route.ComponentProps['loaderData'];
	readonly editor: NonNullable<Route.ComponentProps['loaderData']['editor']>;
	readonly actionData: AdminActionData;
}) {
	const [nameForm, nameFields] = useAdminForm(FORM_EDIT_NAME, actionData, {
		defaultValue: editor.nameBoxes
	});
	const [programForm, programFields] = useAdminForm(FORM_EDIT_PROGRAM, actionData, {
		defaultValue: editor.programBoxes
	});
	const [givingForm, givingFields] = useAdminForm(FORM_EDIT_GIVING, actionData, {
		defaultValue: editor.givingBoxes
	});
	const [originsForm, originsFields] = useAdminForm(FORM_EDIT_ORIGINS, actionData, {
		defaultValue: editor.originsBoxes
	});

	// which group is being submitted right now, read off the body the router is carrying rather than
	// off the navigation state alone: four forms post to one address, and a bare `submitting` would
	// put the dots on all four at once.
	const navigation = useNavigation();
	const submitting =
		navigation.state === 'submitting' ? navigation.formData?.get(WHICH_FORM) : null;

	// `!actionData` on each, and the reason is the same for all four: a refused write is answered
	// with a rejection rather than a redirect, so the marker the last landing published may still be
	// on the page — and a group that saved beside a later group that was refused would be two
	// answers to one request. the whole screen reports the last request.
	//
	// the group's own submission goes in as a fact rather than being read beside what comes back:
	// the button draws it before anything else and the confirmation's four seconds are counted from
	// the button drawing the tick instead, which is a redirect and the reads after it away
	// (packages/operator/src/save-state.ts).
	const nameSave = useSaveState({
		landed: data.saved === 'name' && !actionData,
		// conform's own reading of this group's values against the boxes it was seeded with
		// ($lib/admin/use-admin-form.ts).
		changed: nameForm.dirty,
		pending: submitting === FORM_EDIT_NAME.id
	});
	const programSave = useSaveState({
		landed: data.saved === 'program' && !actionData,
		// the one group with a reading of its own, and {@link programChanged} is why.
		changed: programChanged(editor.programBoxes, programForm.value),
		pending: submitting === FORM_EDIT_PROGRAM.id
	});
	const givingSave = useSaveState({
		landed: data.saved === 'giving' && !actionData,
		changed: givingForm.dirty,
		pending: submitting === FORM_EDIT_GIVING.id
	});
	const originsSave = useSaveState({
		landed: data.saved === 'origins' && !actionData,
		changed: originsForm.dirty,
		pending: submitting === FORM_EDIT_ORIGINS.id
	});

	const amountRows = givingFields.suggested_amounts.getFieldList();

	return (
		<>
			{/* four groups, four `<form>` elements, one action. each one's submit is at the foot of
			    the group it submits, which is the rule a page-level "Save this form" breaks: an
			    operator who fixed one amount would re-submit the sites as well, and a refusal keyed to
			    any box would mark up the whole screen.

			    each card is inside its own form and around the group alone, so the box a reader sees
			    is the extent of what the submit at its foot writes. the hidden box naming the form
			    stays outside it and draws nothing either way.

			    no `action` attribute, so each posts to the address the operator is standing on and
			    leaves whatever is in its query alone. `getFormProps` puts the form's own id on the
			    element, which is what conform's focus move looks the form up by — see the header of
			    `$lib/admin/use-admin-form.ts`. the hidden box beside it is what the *action* looks the
			    form up by. */}
			<Form method="post" {...getFormProps(nameForm)}>
				<input {...whichForm(FORM_EDIT_NAME.id)} />
				<Section card>
					<FormNameFields
						boxes={{ name: nameFields.name, status: nameFields.status }}
						liveOffered={data.liveOffered}
						footer={<SaveButton label="Save name and status" state={buttonState(nameSave)} />}
					/>
				</Section>
			</Form>

			{/* between the name and what a donor may give, in the order the create screen draws them:
			    which cause a gift is recorded against is a fact about the form rather than about a
			    gift. */}
			<Form method="post" {...getFormProps(programForm)}>
				<input {...whichForm(FORM_EDIT_PROGRAM.id)} />
				<Section card>
					<FormProgramFields
						boxes={{
							program_mode: programFields.program_mode,
							program_id: programFields.program_id
						}}
						programs={data.programs}
						retired={data.retiredProgram}
						footer={<SaveButton label="Save program" state={buttonState(programSave)} />}
					/>
				</Section>
			</Form>

			<Form method="post" {...getFormProps(givingForm)}>
				<input {...whichForm(FORM_EDIT_GIVING.id)} />
				<Section card>
					<FormGivingFields
						boxes={{ min_minor: givingFields.min_minor, max_minor: givingFields.max_minor }}
						amounts={{
							id: givingFields.suggested_amounts.id,
							errors: givingFields.suggested_amounts.errors,
							rows: amountRows,
							add: insertWhenValid(
								givingForm,
								FORM_EDIT_GIVING,
								givingFields.suggested_amounts.name
							),
							remove: (index) =>
								givingForm.remove.getButtonProps({
									name: givingFields.suggested_amounts.name,
									index
								})
						}}
						currency={data.currency}
						footer={
							<SaveButton label="Save what a donor may give" state={buttonState(givingSave)} />
						}
					/>
				</Section>
			</Form>

			<Form method="post" {...getFormProps(originsForm)}>
				<input {...whichForm(FORM_EDIT_ORIGINS.id)} />
				<Section card>
					<FormOriginsFields
						box={{
							id: originsFields.allowed_origins.id,
							name: originsFields.allowed_origins.name,
							errors: originsFields.allowed_origins.errors,
							// a repeated input's value arrives as a list, and as the bare string where exactly
							// one box was ticked — so it is read back as a list either way rather than
							// asserted to be one.
							ticked: tickedSites(originsFields.allowed_origins.initialValue)
						}}
						sites={data.sites}
						donatePageOrigin={data.donatePageOrigin}
						footer={
							<SaveButton label="Save where it may be used" state={buttonState(originsSave)} />
						}
					/>
				</Section>
			</Form>
		</>
	);
}

/**
 * the ticked sites, as conform holds them after a submission.
 *
 * a group of one ticked box arrives as the bare string rather than as a list of one, and a group
 * with none arrives absent — so both are read back as the list the boxes are drawn from.
 */
function tickedSites(value: string | (string | undefined)[] | undefined): string[] {
	if (value === undefined) return [];
	if (typeof value === 'string') return [value];
	return value.filter((site): site is string => typeof site === 'string');
}

/**
 * an archived form, read-only, with no save to be found.
 *
 * `updateForm*` refuses an archived row at the `where`, so a box on this screen would be one whose
 * button never works — and there is no un-archive: it is not a screen this version has.
 *
 * it reads the row rather than a form's boxes, which is the whole point of there being two: this is
 * a record of what is stored, and a form object would carry values the database refused.
 *
 * the record vocabulary and deliberately not `FORM_FIELD_LABELS`: those are the questions the
 * editor's boxes ask, and these are the answers stated flat in a column two words wide — the same
 * reading the donation forms list gives a record. the name and the status are the heading above
 * rather than rows in here.
 *
 * what a donor may pay by and how often a gift may repeat are not in here and are not facts about a
 * form: both are the deployment's, and a retired form was served whatever the deployment offered on
 * the day it was asked for.
 */
function StoredRecord({ data }: { readonly data: Route.ComponentProps['loaderData'] }) {
	const { currency, id, values } = data;

	/**
	 * one of the record's amounts, as money rather than as the boxes hold it.
	 *
	 * every amount on this row arrives as the text an editor box takes — `formInputValuesFrom` writes
	 * those boxes and this record reads that same object — so it is major units with no grouping and
	 * no symbol, which is text for a parser rather than a figure for a person. `readAmount` is the
	 * same rule a save is parsed by, and `$lib/donations/money.ts` is the one place the integer it
	 * hands back becomes a shown figure.
	 *
	 * a value that rule cannot read is printed as it is stored. it is unreachable — this text was
	 * written by the inverse of that parser — and is answered rather than asserted away, because a
	 * record of a retired form is the last screen anyone can check it against.
	 */
	const money = (major: string) => {
		const { minor } = readAmount(major, currency);
		return minor === null ? major : formatMinor(minor, currency);
	};

	// the empty string is a column that is null, which is a bound this form never had: it takes the
	// dash below rather than a figure. it is the only falsy value these keys hold —
	// `form_min_minor_check` in `$lib/server/db/schema.ts` allows `0`, and a bound of zero is one
	// somebody set, so it arrives as `'0'` and is drawn as a figure like any other.
	const min = values.min_minor ? money(values.min_minor) : null;
	const max = values.max_minor ? money(values.max_minor) : null;
	const amounts = (values.suggested_amounts ?? []).map(money);
	const origins = values.allowed_origins ?? [];

	return (
		<Section card>
			<h2>How this form was configured</h2>
			<dl>
				<div className="adm-setting">
					<dt className="adm-setting__label">Form id</dt>
					<dd className="adm-setting__value">
						<CodeChip>{id}</CodeChip>
					</dd>
				</div>

				<div className="adm-setting">
					<dt className="adm-setting__label">Currency</dt>
					<dd className="adm-setting__value">{currency}</dd>
				</div>

				{/* the mode's own word where the form asked about no cause or left it to the donor,
				    and the cause's name where it named one. a retired form is the one screen that
				    still says which cause its gifts went to, so the name is read rather than the id
				    it is stored as. */}
				<div className="adm-setting">
					<dt className="adm-setting__label">Program</dt>
					<dd className="adm-setting__value">
						{data.programMode === 'pinned'
							? (data.pinnedProgram ?? 'None')
							: PROGRAM_MODE_LABELS[data.programMode]}
					</dd>
				</div>

				{/* the dash rather than a sentence, and only here: nothing follows from a bound this form
				    never had, and it is now history. `.adm-num` is what compares a figure down its own
				    column. */}
				<div className="adm-setting">
					<dt className="adm-setting__label">Smallest gift</dt>
					<dd className="adm-setting__value adm-num">{min ?? 'None'}</dd>
				</div>

				<div className="adm-setting">
					<dt className="adm-setting__label">Largest gift</dt>
					<dd className="adm-setting__value adm-num">{max ?? 'None'}</dd>
				</div>

				<div className="adm-setting">
					<dt className="adm-setting__label">Suggested amounts</dt>
					{amounts.length === 0 ? (
						<dd className="adm-setting__value">None</dd>
					) : amounts.length === 1 ? (
						<dd className="adm-setting__value adm-num">{amounts[0]}</dd>
					) : (
						<dd className="adm-setting__value adm-num">
							<ul>
								{amounts.map((amount) => (
									<li key={amount}>{amount}</li>
								))}
							</ul>
						</dd>
					)}
				</div>

				<div className="adm-setting">
					<dt className="adm-setting__label">Sites</dt>
					{/* the one row that reads as a sentence rather than a dash, because a form with no
					    site is the reason this record is worth reading at all — and one with nothing
					    ticked is still served on this deployment's own donation page, which is on no
					    `site` row and is accepted off the request instead (./$formId.tsx). */}
					{origins.length === 0 ? (
						<dd className="adm-setting__value">Your donation page only.</dd>
					) : (
						// a list and never the joined text, however few there are: an origin is an
						// identifier, and a comma between two of them reads as part of one.
						<dd className="adm-setting__value">
							<ul>
								{origins.map((origin) => (
									<li key={origin}>
										<CodeChip>{origin}</CodeChip>
									</li>
								))}
							</ul>
						</dd>
					)}
				</div>
			</dl>
		</Section>
	);
}

/**
 * retiring a form, in two steps.
 *
 * archiving cannot be undone from here, so the first step is a link and the state it puts the
 * screen into is a state of the URL — which is what makes it shareable, reloadable and reachable
 * with the browser's own Back.
 *
 * it stays in the page, and that is the ordinary case rather than a difference from anything:
 * /admin spends the top layer only where an act reachable from the surface destroys something that
 * already exists, which `.adm-dialog` in packages/operator/src/styles/adm.css states. archiving is
 * permanent and destroys nothing — every gift the form took is still in the books, the record is
 * still readable, and what changed is that no new gift can be made through it — so the question
 * stays where the record it is about is.
 *
 * the `<form>` stands around the whole confirmation rather than around the control that submits it,
 * which is the rule `DestructiveConfirm` states: its actions row holds controls, and a submit
 * belongs to the form enclosing it whether that form is a wrapper of its own or the one around
 * everything.
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
		<Section card>
			<h2>Archive</h2>
			<p className="adm-prose">
				Archiving takes this form off the donation forms list. The gifts it has taken stay in the
				books, and its snippet keeps working wherever it was already pasted.
			</p>
			{confirming ? (
				<Form method="post">
					<input {...whichForm(FORM_ARCHIVE.id)} />
					{/* the way out is a `Link` rather than an anchor, so leaving this panel is a
					    navigation the router handles rather than a full document load. it takes the
					    secondary rank the library pairs a danger control with, and states no `variant`
					    of its own to get it.

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
						confirm="Yes, archive this form"
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
						Archive this form
					</Link>
				</div>
			)}
		</Section>
	);
}
