import { Button } from '@better-giving/operator/components/controls/Button';
import { Column, Section } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { getFormProps } from '@conform-to/react';
import type { MouseEvent } from 'react';
import { Form, href, Link, useNavigation } from 'react-router';
import { FormGivingFields } from '$lib/admin/forms/giving-fields';
import { FormNameFields } from '$lib/admin/forms/name-fields';
import { FormOriginsFields } from '$lib/admin/forms/origins-fields';
import { FormProgramFields } from '$lib/admin/forms/program-fields';
import { FormsReadiness } from '$lib/admin/forms/readiness';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { type CrumbHandle, ScreenCrumbs } from '$lib/admin/crumbs';
import { screenTitle } from '$lib/admin/screen-title';
import { insertWhenValid, useAdminForm } from '$lib/admin/use-admin-form';
import { FORM_CURRENCY } from '$lib/forms/amounts';
import { defineForm } from '$lib/forms/definition';
import { FORM_TEXT_FIELDS, type FormInputValues } from '$lib/forms/fields';
import { FORM_INPUT_FORM, unlistedSiteProblem, unlistedSites } from '$lib/forms/input-schema';
import { anyBlocker } from '$lib/forms/readiness';
import { invalid, parseForm } from '$lib/server/conform';
import { loadFailed } from '$lib/server/db/load-failure';
import { CREATED_FLASH, redirectWithFlash } from '$lib/server/flash';
import { formInputValues, parseFormInput } from '$lib/server/forms/form-input';
import { createForm } from '$lib/server/forms/queries';
import { formsReadiness } from '$lib/server/forms/readiness';
import { readOrgProfile } from '$lib/server/org/queries';
import { readActivePrograms } from '$lib/server/programs/queries';
import { readSites } from '$lib/server/sites/queries';
import { database } from '../context';
import type { Route } from './+types/_app.admin.forms.new';

// making a donation form: read as a loader, written by an action. no client-side mutation path,
// per CLAUDE.md — what reaches the database goes through the action below and nothing else.
//
// this file and the screen that edits a form are the same screen read in two directions, and both
// are deliberately thin. what a form may be lives in `$lib/forms/input-schema.ts` and
// `$lib/server/forms/form-input.ts`, and what reaches the database lives in that folder's
// `queries.ts`; the only job here is turning a request into the first and a failure into a
// sentence.
//
// the schema and the parser run one after the other rather than one instead of the other, and the
// order is not interchangeable. the schema states every rule about a box that can be keyed to a box
// — every field rule, plus the two cross-field rules checked at the object level because each reads
// more than one box: the giving group's three, and the program group's pair;
// `parseFormInput` is the authority on what may be written and
// owns the rules that are left, which are the floor under the smallest gift and the two bounds being
// the right way round. its messages are merged onto the same rejection, so an operator meets every
// offending box in one pass whichever of the two refused it.

/**
 * the create form, stated once for the action that reads a body against it and the screen that
 * submits to it.
 *
 * the id is a literal and never derived — see `$lib/server/conform.ts`'s header. it matters here
 * rather than in principle: the screen that edits a form validates the same rules in four groups,
 * and an id derived from a schema's shape would make two structurally identical forms one form.
 */
const FORM_CREATE = defineForm({ id: 'form-create', schema: FORM_INPUT_FORM });

/** what a write that failed says, keyed to no box. */
const WRITE_FAILED = 'Making this form failed and nothing was saved. Try again.';

/**
 * what a create pinned to a cause this deployment no longer offers says, keyed to the program box.
 *
 * no schema states it — what a deployment still offers is a table, and the schema runs in a
 * browser — so the write is where it is settled and this is the sentence it comes back as. on this
 * screen it is only ever a stale tab or a hand-built body: the select is drawn from the active
 * list, and a form that does not exist yet cannot already be pinned to a retired cause.
 *
 * keyed to the box the operator picks in, because that is where the answer is. it is the same
 * sentence the editor's own refusal carries (./_app.admin.forms.$id.tsx), so a screen cannot word
 * one state two ways.
 */
const NO_SUCH_PROGRAM = 'Choose an active program.';

/** what a create refused by the ledger says, keyed to no box. */
const BLOCKED =
	'No form was made. Something above has to be cleared first: while it stands, a form ' +
	'made here would serve nothing to a donor.';

/**
 * the values a form is born with, which is what the boxes bind to.
 *
 * `draft` matches the column default, and it is the only status a form should be made in: a form
 * that goes live in the same click that creates it has never been looked at. the amount bounds open
 * on figures rather than blank, the way the suggestions below do: both are starting figures the
 * operator edits, not bounds this file decides. `1.00` is set low enough to block nothing — the
 * floor a save actually enforces is `MIN_AMOUNT_MINOR` in `$lib/server/forms/form-input.ts`, which
 * is a different thing and argues itself there. `10000.00` is a rail against a mistyped amount and
 * a card that is not the donor's; no rule outside this repo puts it at that figure.
 *
 * how often a gift may repeat and what a donor may pay by are not here and are not values a new form
 * is born with: both are the deployment's, and neither is read on this screen at all.
 *
 * no sites either, and the empty list is the value rather than the absence of one: the tick boxes
 * are drawn from the deployment's own list and a new form is on none of them. it is a form a
 * deployment can serve rather than a state to be corrected — a form on no site loads on this
 * deployment's own donation page — so nothing on this screen opens asking for a tick.
 *
 * every box is stated rather than left absent, because a box conform was handed no value for is a
 * box with nothing to bind to — and the two the screen would otherwise be silent about are the
 * status, whose select must open on `draft`, and the amount rows, which open on the three below.
 */
const NEW_FORM = {
	name: '',
	status: 'draft',
	// a form asks about no cause until somebody says otherwise, which is what the column defaults
	// to as well. the program box is blank rather than absent: it is in the tree in every mode and
	// hidden in two of them, so it has to have something to bind to
	// (`$lib/admin/forms/program-fields.tsx`).
	program_mode: 'none',
	program_id: '',
	min_minor: '1.00',
	max_minor: '10000.00',
	// three suggestions rather than none, which is what a new form's tray shows before anyone
	// thinks about it; the operator edits or clears them in the row editor.
	suggested_amounts: ['25', '50', '100'],
	allowed_origins: [] as string[]
} as const satisfies FormInputValues;

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
 * whether a field the parser rejected is one this action keys a message by.
 *
 * the two list fields are skipped, and with conform that is a decision rather than a limit: a
 * repeated input's message is keyed by the input's own name (`$lib/server/conform.ts`), so either
 * one *could* be keyed. what it would cost is the amounts.
 *
 * each list field's rule in the parser is the same one the schema states — `readOriginList` for the
 * sites and `readSuggestedAmounts` for the amounts — over the same rows: the parser's clean stage
 * trims and takes nothing out, so neither reader is handed a list the other did not see. the parser
 * therefore objects to a list in a subset of the cases the schema already objected to, and the
 * schema's message is already on the rejection when it does.
 * the amounts are the one list where the schema is silent and the parser is not — zod skips an
 * object check over a value whose bound aborted, while `parseFormGiving` measures every amount
 * whatever the bounds did — and in that case the ruler is the thing that could not be read, so
 * telling an operator their amounts are out of a range nobody set is a sentence about the wrong box.
 *
 * read off `FORM_TEXT_FIELDS` rather than written out, so a field added as a list in
 * `$lib/forms/fields.ts` is skipped here without anyone having to remember to.
 */
function isTextField(field: string): field is (typeof FORM_TEXT_FIELDS)[number] {
	return (FORM_TEXT_FIELDS as readonly string[]).includes(field);
}

/** the screen's name, rendered as the document title and as the heading. */
const SCREEN_TITLE = 'Add a donation form';

export const handle = {
	crumbs: ({ pathname }) => [
		{ href: href('/admin/forms'), label: 'Donation forms' },
		{ href: pathname, label: SCREEN_TITLE }
	]
} satisfies CrumbHandle;

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const db = context.get(database);

	let profile: Awaited<ReturnType<typeof readOrgProfile>>;
	let sites: string[];
	let programs: Awaited<ReturnType<typeof readActivePrograms>>;

	try {
		// three independent reads, so they go together: none is an input to another, and awaiting
		// them in turn pays three round trips for one screen. both are this deployment's own database —
		// nothing on this screen leaves the deployment, because neither of the two values that would
		// need the processor is a form's to answer and both are the console's.
		//
		// the second is the deployment's own list of sites, which the tick boxes are drawn from. an
		// empty one gates nothing: a form on no site loads on the donation page this deployment serves
		// on its own address.
		[profile, sites, programs] = await Promise.all([
			readOrgProfile(db),
			readSites(db),
			readActivePrograms(db)
		]);
	} catch (e) {
		// the diagnostic lives on the loader rather than the save: this runs before the form is ever
		// drawn, so a save that tried to say "check your migrations" could never be the thing anyone
		// read.
		//
		// one catch over both, so the message names neither: `Promise.all` rejects with whichever
		// failed, and a line blaming the sites for an `org_profile` failure sends whoever reads the
		// log to the wrong table.
		console.error('loading the screen that makes a donation form failed:', e);
		loadFailed('This page');
	}

	return {
		// what stops the form about to be made from serving, in the same block the screen that edits
		// one carries. the forms list carries none — it writes nothing, so it gates nothing.
		//
		// on this screen the block is the gate rather than a heads-up: a blocker means the boxes are
		// not drawn at all and the write is refused, because a form made on a deployment missing any
		// of these renders nothing on the org's own site with no screen saying why.
		//
		// `null` when there is nothing to say, which is what keeps the condition in one place rather
		// than in each page's markup.
		readiness: formsReadiness(profile),
		// every site this deployment has listed, in the operator's own order — one tick box each,
		// with none of them ticked on a form that does not exist yet. the values and not row ids,
		// because `form.allowed_origins` holds the addresses themselves and there is deliberately no
		// foreign key between the two.
		//
		// an empty list is a complete state rather than a fault: a form on a deployment that lists no
		// site still loads on the donation page below, so the group warns about nothing and the submit
		// stays on.
		sites,
		// every cause this deployment still offers, as the two values the picker draws: the id a
		// gift is recorded against and the name a fundraiser gave it. the archived ones are out —
		// nothing newly pins to a retired cause, and `createForm` refuses one anyway.
		//
		// an empty list is an ordinary state and not a fault: a deployment that has made no cause
		// has none, and the group says where one is made rather than refusing anything.
		programs: programs.map((cause) => ({ value: cause.id, label: cause.name })),
		// where this deployment's own donation page answers, which the sites group states above the
		// boxes: every form served here loads on that page whatever is ticked, and it is on no `site`
		// row.
		//
		// the request rather than a stored value: the host this request arrived on is one this worker
		// answers on, which is the same reading `corsHeaders` in `$lib/server/api/cors.ts` makes.
		donatePageOrigin: new URL(request.url).origin,
		// what a new form starts as, handed over like any other value this screen is drawn from:
		// conform seeds the boxes from it and reports nothing about it until a submit, so a create
		// screen never opens telling an operator to fill in a box they have not touched
		// (`$lib/admin/use-admin-form.ts`).
		values: NEW_FORM,
		// stated rather than left off the screen. it is not an input — v0 is USD-only by decision —
		// and an operator who cannot see the currency cannot tell what their form charges in.
		currency: FORM_CURRENCY
	};
}

/**
 * make a form.
 *
 * **the request body is read exactly once, here, by the action that owns it** — `parseForm` is what
 * reads what it returns, and nothing above this route may.
 */
export async function action({ context, request }: Route.ActionArgs) {
	const body = await request.formData();

	// every box this form states has to arrive, and the sharp one is `status`: absent, the schema
	// would stand it in as its first member — `draft` — so a bare `curl -X POST` would arrive as a
	// draft form nobody chose the status of rather than as a refusal. `$lib/server/conform.ts`'s
	// header is where that rule is argued.
	const submission = parseForm(body, FORM_CREATE);

	// run whether or not the schema was happy, so that a box the schema refused and an origin the
	// parser refuses come back together.
	const values = formInputValues(body);
	const parsed = parseFormInput(values);

	// `!submission.ok` is half of this condition and it is not redundant, which is the trap worth
	// naming: the parser reads a blank box and an absent one alike, so a body carrying no `status` at
	// all reaches it as nothing to refuse only because the schema has already refused it. testing the
	// parser alone would let a submission through that never carried the form.
	if (!parsed.ok || !submission.ok) {
		// one sentence per box. conform replaces a key rather than adding to it, so a field the
		// schema and the parser both refused carries the parser's message alone — one thing to fix
		// per input is the rule both of them already keep on their own.
		const fieldErrors: Record<string, string[]> = {};
		if (!parsed.ok) {
			for (const [field, sentence] of Object.entries(parsed.errors)) {
				if (isTextField(field)) fieldErrors[field] = [sentence];
			}
		}
		// what was typed goes back inside the rejection, so the boxes re-render rather than clearing
		// — the seam carries it without this route having to.
		return invalid(400, submission.reject({ fieldErrors }));
	}

	const db = context.get(database);

	// the ledger gates this screen, and this is the control behind the gate: the page draws no boxes
	// and a disabled button while a blocker stands, and markup is not what stops a POST. read here
	// rather than carried from the loader, because what a page was drawn against is not what is true
	// when the button is pressed — a row can be emptied in between.
	const [profile, listed] = await Promise.all([readOrgProfile(db), readSites(db)]);

	if (anyBlocker(formsReadiness(profile))) {
		// keyed to no box, deliberately: no box on this form is what went wrong, and the block above
		// the form is where the offending line is already named.
		return invalid(400, submission.reject({ formErrors: [BLOCKED] }));
	}

	// a site this deployment does not list, which on this screen is only ever a stale tab or a
	// hand-built body: the boxes carry the listed values, and a form that does not exist yet cannot
	// be holding one that has left. it is read here rather than carried from the loader because a set
	// of tick boxes is markup, and markup is not what stops a POST.
	//
	// keyed by the group's own input name, which is where a repeated input's message goes: the box to
	// untick is on the screen, so it is not a banner.
	const unlisted = unlistedSiteProblem(unlistedSites(parsed.value.allowedOrigins, listed));
	if (unlisted !== null) {
		return invalid(400, submission.reject({ fieldErrors: { allowed_origins: [unlisted] } }));
	}

	let record: Awaited<ReturnType<typeof createForm>>;
	try {
		record = await createForm(db, parsed.value);
	} catch (e) {
		// nothing here is a user error — `parseFormInput` has accepted the values — which makes this
		// the write itself failing. the cause goes to the log; the page gets a fixed string, so no
		// detail leaks and no field is blamed for it. keyed to no box, deliberately: a write that
		// failed is not something an operator can fix by editing an input, and rendering it under one
		// tells them the field is wrong.
		console.error('making a donation form failed:', e);
		return invalid(500, submission.reject({ formErrors: [WRITE_FAILED] }));
	}

	// a pin to a cause this deployment no longer offers, which is the one refusal `createForm` has:
	// the write reads the cause before it pins to one, because the foreign key answers only half of
	// it — a retired cause is still a row.
	if (record === null) {
		return invalid(400, submission.reject({ fieldErrors: { program_id: [NO_SUCH_PROGRAM] } }));
	}

	// POST-redirect-GET, to the list. a re-post of a create is not an overwrite, it is a second form
	// — the worse half of the hazard the redirect exists for.
	//
	// the list rather than the new form's own editor: an operator who has just filled this screen in
	// has said everything they have to say about the form, and the screen that answers "did that
	// work" is the one showing every form this deployment has, with the new one's snippet on it.
	//
	// the id travels in a one-shot cookie rather than in the address: a record key in an address bar
	// is one that gets bookmarked, shared and read back by an operator who never asked to see one,
	// and the banner would re-announce itself on every reload. `$lib/server/flash.ts` is what makes
	// it reach exactly the GET that lands.
	return redirectWithFlash(request, CREATED_FLASH, href('/admin/forms'), record.id);
}

// what this page owes is one form, and a rejected save that comes back with what was typed still in
// the boxes.
//
// one form and one submit, which is the whole of what makes this screen different from the one that
// edits a form: that screen saves a group at a time, and a form that does not exist yet cannot have
// a group saved against it. so the four group components are mounted inside one `<Form>` here and
// none of them is given a footer — the single submit sits at the foot of all four, which is still
// the foot of the form it submits.
export default function NewDonationForm({ loaderData, actionData }: Route.ComponentProps) {
	const { readiness, sites, donatePageOrigin, programs, values, currency } = loaderData;
	const [form, fields] = useAdminForm(FORM_CREATE, actionData, { defaultValue: values });
	const navigation = useNavigation();
	// the whole navigation this form started, and not its `submitting` half: the action answers with
	// a redirect to the list, so `submitting` ends seconds before the list renders and leaves the
	// button back at rest, unpressed-looking and pressable again, in the middle of its own write.
	// `formAction` is what makes it this form's navigation rather than any other, and it stays on the
	// navigation through the loading phase the redirect starts.
	const adding = navigation.state !== 'idle' && navigation.formAction === href('/admin/forms/new');

	// the ledger is the gate on this screen and not a heads-up, which is the one place in /admin
	// where that block stops a write. a blocker means `publishedConfig` serves nothing, so a form
	// made here would be one that renders nothing on the org's own site from the moment it is
	// published — and unlike the screen that edits a form, there is nothing on this one worth keeping
	// while that stands: no row exists yet. so the boxes are not drawn at all and the write is a
	// disabled button, with the ledger above saying which line to clear.
	//
	// the action re-checks the same condition. a page drawn without a submit is markup, and markup is
	// not what stops a POST.
	const blocked = anyBlocker(readiness);

	// the amount boxes as conform holds them: one field per row, each with a name of its own, and the
	// two intents that add and drop one. adding a row is form state rather than a write, so it is the
	// form's own control and reaches no action — which is why this screen has one action where the
	// retired one had three.
	const amountRows = fields.suggested_amounts.getFieldList();

	// what a refused attempt says about the attempt as a whole. the sentences about the boxes are
	// under the boxes and are each field's own.
	const refusal = form.errors?.[0];

	return (
		// one column and the column is what spaces it: every block below carries no margin of its
		// own, so one that is not rendered leaves no space behind it.
		<Column>
			{/* the trail to the section this screen sits under, stated by this module's `handle`. it
			    stays on the page in every state, including the one where no form is drawn. */}
			<PageHeader title={SCREEN_TITLE} crumbs={<ScreenCrumbs />} />

			{/* first thing under the heading, because the status box on this screen offers Live: a form
			    published in the click that creates it, while any line in this block is unresolved, is
			    a form that renders nothing on the org's own site or takes money that is not real.
			    below the heading and not above it, so the h1 is the first heading on the page and a
			    reader who jumps to it lands in front of this block rather than past it. */}
			<FormsReadiness lines={readiness} />

			{blocked ? (
				// the write, drawn and switched off. a disabled button rather than no button at all,
				// because what an operator came here to do is the thing this page has to keep naming: a
				// screen carrying a ledger and nothing else does not say that clearing it is what makes
				// a form possible.
				//
				// the same label the enabled one carries below, and it has to be: two branches of one
				// screen are one button an operator meets in two states, and a second wording for it
				// reads as a second thing to press.
				<div className="adm-actions">
					<Button variant="primary" disabled>
						Add donation form
					</Button>
				</div>
			) : (
				// no `action` attribute, so this posts to the current url. conform's `getFormProps` puts
				// the form's own id on the element, which is what its focus move looks the form up by —
				// see the header of `$lib/admin/use-admin-form.ts`.
				<Form method="post" {...getFormProps(form)}>
					{/* a plain section around each group, because a group draws its heading, its boxes
					    and its footer and nothing around them: the frame is the mounting screen's, and
					    this screen's four divisions are one form read down. */}
					<Section>
						{/* no `liveOffered` prop, and its default is the honest value here: this branch is
						    only reached with no blocker standing, so Live is always one of the two. */}
						<FormNameFields boxes={{ name: fields.name, status: fields.status }} />
					</Section>
					<Section>
						{/* between the name and what a donor may give, because it is a fact about the form
						    rather than about a gift: it is the second thing an operator decides and the
						    first thing that is not the form's own name. no `retired` prop — a form that
						    does not exist yet is pinned to nothing, so there is no retired cause it could
						    be holding. */}
						<FormProgramFields
							boxes={{ program_mode: fields.program_mode, program_id: fields.program_id }}
							programs={programs}
						/>
					</Section>
					<Section>
						<FormGivingFields
							boxes={{ min_minor: fields.min_minor, max_minor: fields.max_minor }}
							amounts={{
								id: fields.suggested_amounts.id,
								errors: fields.suggested_amounts.errors,
								rows: amountRows,
								add: insertWhenValid(form, FORM_CREATE, fields.suggested_amounts.name),
								remove: (index) =>
									form.remove.getButtonProps({ name: fields.suggested_amounts.name, index })
							}}
							currency={currency}
						/>
					</Section>
					<Section>
						<FormOriginsFields
							box={{
								id: fields.allowed_origins.id,
								name: fields.allowed_origins.name,
								errors: fields.allowed_origins.errors,
								// a repeated input's value arrives as a list, and as the bare string where exactly
								// one box was ticked — so it is read back as a list either way rather than
								// asserted to be one.
								ticked: tickedSites(fields.allowed_origins.initialValue)
							}}
							sites={sites}
							donatePageOrigin={donatePageOrigin}
						/>
					</Section>

					{/* keyed to no field, deliberately: a write that failed is not something an operator
					    can fix by editing an input, and rendering it under one tells them the input is
					    wrong. it stands with the submit rather than at the top of the page: four
					    groups' worth of boxes lie between the two, so a refusal up there is a page that
					    looks unchanged from where the operator is standing and a button that went
					    quiet.

					    rendered through `MarkedText` rather than printed, because a sentence written in
					    this file marks what an operator has to act on with backticks. */}
					{refusal ? (
						<Banner tone="blocker" word="Not added">
							<MarkedText text={refusal} />
						</Banner>
					) : null}

					{/* the same label whether or not it can be pressed, and it has to be: two branches of
					    one screen are one button an operator meets in two states, and a second wording
					    reads as a second thing to press. no hint under it either — the readiness block
					    above names the blocker where the operator can act.

					    the row takes no step of its own: each group is a `.adm-section`, whose own block
					    padding is what sets the submit off the last question above it. */}
					<div className="adm-actions">
						{/* the write being in flight is not a gate, and `disabled` for it would be wrong:
						    a disabled control is not focusable, so the attribute takes focus off the
						    button an operator has this moment pressed and drops it on `<body>` for the
						    whole of the write — and the dots underneath, which are what say the press
						    was heard, are then a change nobody is standing on to hear
						    (WCAG 2.4.3).

						    the press is closed in the handler instead, which is what `aria-disabled`
						    stops doing once it is only advisory: a second press while the first
						    navigation is still going is one operator intent and two donation forms
						    made. */}
						<Button
							variant="primary"
							aria-disabled={adding}
							aria-busy={adding}
							onClick={(event: MouseEvent<HTMLButtonElement>) => {
								if (adding) event.preventDefault();
							}}
						>
							Add donation form
						</Button>
						{/* a link rather than a button, because it writes nothing: it leaves. */}
						<Link to={href('/admin/forms')}>Cancel</Link>
					</div>
				</Form>
			)}
		</Column>
	);
}
