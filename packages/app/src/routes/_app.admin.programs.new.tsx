import { BackLink } from '@better-giving/operator/components/controls/BackLink';
import { Button } from '@better-giving/operator/components/controls/Button';
import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { getFormProps } from '@conform-to/react';
import type { MouseEvent } from 'react';
import { Form, href, Link, useNavigation } from 'react-router';
import { ProgramFields } from '$lib/admin/programs/fields';
import { RouterLink } from '$lib/admin/router-link';
import { screenTitle } from '$lib/admin/screen-title';
import { useAdminForm } from '$lib/admin/use-admin-form';
import { defineForm } from '$lib/forms/definition';
import { PROGRAM_TEXT_FIELDS, type ProgramInputValues } from '$lib/programs/fields';
import { PROGRAM_INPUT_FORM } from '$lib/programs/input-schema';
import { invalid, parseForm } from '$lib/server/conform';
import { CREATED_FLASH, redirectWithFlash } from '$lib/server/flash';
import { createProgram } from '$lib/server/programs/queries';
import { parseProgramInput, programInputValues } from '$lib/server/programs/program-input';
import { database } from '../context';
import type { Route } from './+types/_app.admin.programs.new';

// making a cause: one form, one action. no client-side mutation path, per CLAUDE.md — what reaches
// the database goes through the action below and nothing else.
//
// there is no loader, and the absence is the whole shape of this screen: a cause that does not
// exist yet is two empty boxes, and nothing about this deployment gates making one. the screen that
// makes a donation form reads three things before it draws anything, because a form made on a
// deployment that cannot serve renders nothing on the org's own site; a cause is a word, and a
// deployment with no forms at all can still name what it raises for.
//
// the schema and the parser run one after the other rather than one instead of the other: the
// schema states every rule about a box, and `parseProgramInput` is the authority on what may be
// written. the one rule neither of them can state is whether another cause already carries the
// name, which is the unique index on the column and is answered by the write.

/**
 * the create form, stated once for the action that reads a body against it and the screen that
 * submits to it.
 *
 * the id is a literal and never derived — see `$lib/server/conform.ts`'s header.
 */
const PROGRAM_CREATE = defineForm({ id: 'program-create', schema: PROGRAM_INPUT_FORM });

/** what a write that failed says, keyed to no box. */
const WRITE_FAILED = 'Making this program failed and nothing was saved. Try again.';

/**
 * what a name another cause already carries says, keyed to the box holding it.
 *
 * no schema states it and none can: what names are taken is a table, and the schema runs in a
 * browser too. it is answered off the unique index rather than a read in front of the insert, for
 * the reason `createProgram` in `$lib/server/programs/queries.ts` gives.
 *
 * the same sentence the edit screen refuses a rename with, so a screen cannot word one state two
 * ways.
 */
const NAME_TAKEN = 'A program with this name already exists.';

/**
 * the values a cause is born with, which is what the boxes bind to.
 *
 * both are stated rather than left absent, because a box conform was handed no value for is a box
 * with nothing to bind to. there is nothing to invent here: a cause is what an operator types.
 */
const NEW_PROGRAM = { name: '', description: '' } as const satisfies ProgramInputValues;

/** whether a field the parser rejected is one this action keys a message by, which is both. */
function isTextField(field: string): field is (typeof PROGRAM_TEXT_FIELDS)[number] {
	return (PROGRAM_TEXT_FIELDS as readonly string[]).includes(field);
}

/** the screen's name, rendered as the document title and as the heading. */
const SCREEN_TITLE = 'Add a program';

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

/**
 * make a cause.
 *
 * **the request body is read exactly once, here, by the action that owns it** — `parseForm` is what
 * reads what it returns, and nothing above this route may.
 */
export async function action({ context, request }: Route.ActionArgs) {
	const body = await request.formData();
	const submission = parseForm(body, PROGRAM_CREATE);

	// run whether or not the schema was happy, so every offending box comes back together.
	const parsed = parseProgramInput(programInputValues(body));

	if (!parsed.ok || !submission.ok) {
		// one sentence per box. conform replaces a key rather than adding to it, so a field the
		// schema and the parser both refused carries the parser's message alone.
		const fieldErrors: Record<string, string[]> = {};
		if (!parsed.ok) {
			for (const [field, sentence] of Object.entries(parsed.errors)) {
				if (isTextField(field)) fieldErrors[field] = [sentence];
			}
		}
		return invalid(400, submission.reject({ fieldErrors }));
	}

	let record: Awaited<ReturnType<typeof createProgram>>;
	try {
		record = await createProgram(context.get(database), parsed.value);
	} catch (e) {
		// nothing here is a user error — the values have been accepted — which makes this the write
		// itself failing. the cause goes to the log; the page gets a fixed string, so no detail leaks
		// and no field is blamed for it.
		console.error('making a program failed:', e);
		return invalid(500, submission.reject({ formErrors: [WRITE_FAILED] }));
	}

	// the one refusal the write has, and it is a box the operator can retype: two causes with one
	// name are two funds nobody can tell apart on a form's picker or in a report.
	if (record === null) {
		return invalid(400, submission.reject({ fieldErrors: { name: [NAME_TAKEN] } }));
	}

	// POST-redirect-GET, to the list. a re-post of a create is not an overwrite, it is a second
	// cause — the worse half of the hazard the redirect exists for. the id travels in a one-shot
	// cookie rather than in the address: a record key in an address bar is one that gets bookmarked
	// and read back by an operator who never asked to see one.
	return redirectWithFlash(request, CREATED_FLASH, href('/admin/programs'), record.id);
}

// what this page owes is one form, and a rejected save that comes back with what was typed still in
// the boxes.
export default function NewProgram({ actionData }: Route.ComponentProps) {
	const [form, fields] = useAdminForm(PROGRAM_CREATE, actionData, { defaultValue: NEW_PROGRAM });
	const navigation = useNavigation();
	// the whole navigation this form started, and not its `submitting` half: the action answers with
	// a redirect to the list, so `submitting` ends seconds before the list renders and leaves the
	// button back at rest, unpressed-looking and pressable again, in the middle of its own write.
	// `formAction` is what makes it this form's navigation rather than any other, and it stays on the
	// navigation through the loading phase the redirect starts.
	const adding =
		navigation.state !== 'idle' && navigation.formAction === href('/admin/programs/new');

	// what a refused attempt says about the attempt as a whole. the sentences about the boxes are
	// under the boxes and are each field's own.
	const refusal = form.errors?.[0];

	return (
		// one column and the column is what spaces it: every block below carries no margin of its
		// own, so one that is not rendered leaves no space behind it.
		<Column>
			{/* the way back to the section this screen sits under, and one link rather than a trail:
			    the second half of a "Programs / Add a program" trail is the heading directly beneath
			    it. */}
			<PageHeader
				title={SCREEN_TITLE}
				back={
					<BackLink href={href('/admin/programs')} link={RouterLink}>
						Programs
					</BackLink>
				}
			/>

			{/* no `action` attribute, so this posts to the current url. conform's `getFormProps` puts
			    the form's own id on the element, which is what its focus move looks the form up by —
			    see the header of `$lib/admin/use-admin-form.ts`. */}
			<Form method="post" {...getFormProps(form)}>
				<ProgramFields boxes={{ name: fields.name, description: fields.description }} />

				{/* keyed to no field, deliberately: a write that failed is not something an operator can
				    fix by editing an input, and rendering it under one tells them the input is wrong. it
				    stands with the submit rather than at the top of the page.

				    rendered through `MarkedText` rather than printed, because a sentence written in this
				    file marks what an operator has to act on with backticks. */}
				{refusal ? (
					<Banner tone="blocker" word="Not added">
						<MarkedText text={refusal} />
					</Banner>
				) : null}

				<div className="adm-actions">
					{/* `aria-disabled` and not `disabled`: a disabled control is not focusable, so the
					    native attribute takes focus off the button an operator has this moment pressed
					    and drops it on `<body>` for the whole of the write — and the dots underneath,
					    which are what say the press was heard, are then a change nobody is standing on
					    to hear (WCAG 2.4.3).

					    the press is closed in the handler instead, which is what the attribute stops
					    doing once it is only advisory: a second press while the first navigation is
					    still going is one operator intent and two causes made. */}
					<Button
						variant="primary"
						aria-disabled={adding}
						aria-busy={adding}
						onClick={(event: MouseEvent<HTMLButtonElement>) => {
							if (adding) event.preventDefault();
						}}
					>
						Add program
					</Button>
					{/* a link rather than a button, because it writes nothing: it leaves. */}
					<Link to={href('/admin/programs')}>Cancel</Link>
				</div>
			</Form>
		</Column>
	);
}
