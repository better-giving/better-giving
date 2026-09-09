import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { Field } from '@better-giving/operator/components/forms/Field';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import type { ReactNode } from 'react';
import { Form } from 'react-router';
import { IDENTITY_BOXES, ORG_FIELDS, ORG_INTENT, carriedBoxes } from './org-fields';
import { ORG_FORM, foldErrors, seedFor, type IdentityField } from './org-form';
import { useConsoleForm } from './use-console-form';
import { OrgWriteOutcome } from './org-write';
import type { OrgWrite } from '../api/types';
import type { OrgBoxes } from './org-fields';

// the legal identity this deployment asks for gifts under, read and edited inside the first fold of
// the one page.
//
// **it is a row on the deployment and this fold names no database.** the values are read out of the
// report the deployment answers with and written back to its own endpoint over the console session
// — `packages/console/internal/deployment/org.go` is the whole of both halves. nothing here reaches
// cloudflare, so this draws with no account-scoped read at all: the session is the only door it
// uses.
//
// **nothing here states a rule of its own, and the rules it runs are the deployment's own.** what a
// profile field may hold is `ORG_PROFILE_FIELD_RULES` in
// `@better-giving/operator/console/org-rules`, stated there because two surfaces apply it to the
// same values: the worker parses every profile it is sent and this fold mounts the same eight rules
// through the seam (./org-form.ts's `ORG_FORM`, ./use-console-form.ts). a copy here would be the
// cheaper answer and is exactly how the two come to disagree — one end taking eight digits for an
// EIN and the other refusing the save is an operator told a value is fine and then told it is not,
// with nothing on either screen saying which half was right. the deployment stays the authority:
// its endpoint is reachable by anything holding a console session, so it parses whatever asked it
// to, and reading here first is a courtesy to the person typing. what this fold adds is what the
// boxes are called.
//
// **no box is marked before a press.** a box the save refuses blank carries no `(optional)` marker
// and that is the whole of what says so; the sentence about a blank one arrives at the press
// (CLAUDE.md, and the timing is the seam's for every fold at once). a warning drawn over a form
// seeded from a record is a screen reporting a refusal nobody asked for, and the same words then
// stand at the box, at the head of the panel and on the row above — one fact told three times, each
// able to drift from the other two.
//
// **at the press, every box the rules turn down is answered at the box and nothing is sent.** a
// name over its cap, a value that is not an EIN and a box the save refuses blank each earn the
// deployment's own sentence where the value is, in the words the deployment would have answered
// with — because they are the same sentences. what that saves is the state the screen is otherwise
// in for the length of a round trip: every box shut, the button reading `Saving`, and the sentences
// from the last answer still standing under boxes nobody can reach.
//
// **a sentence from the far end and one from those rules share a box, and the far end's wins.** it
// is about the value that was actually sent and the other is about a box that never went; both go
// the moment the box is edited. the composition is the seam's and no fold restates it.
//
// **the boxes are re-seeded by a save rather than emptied.** these values can be read back, unlike a
// credential: the press answers, the page's `loader` runs again, and what stands in the boxes
// afterwards is the profile the deployment now holds. the press is armed against what is stored and
// not against emptiness: these values read back, so an empty box is a value an operator can see is
// empty and meant to clear.
//
// **this press carries the boxes it does not draw, at exactly what is stored.** the deployment
// reads the profile whole, so a field left out of the body is one it stores as cleared — and one of
// the nine is drawn elsewhere, the notification address by ./notifications-fold.tsx. it rides along
// hidden and nothing about it changes here, and it is left out of the rules this form runs for the
// same reason — a sentence keyed to a box this form does not draw sends focus into a shut panel.
// the deployment stores a profile holding no notification address (`notification_email` in
// `ORG_PROFILE_FIELD_RULES`, refused blank by nothing), so an identity saved first is an identity
// saved.
//
// it is a component and not a screen: the fold is one entry of the ledger ../routes/_index.tsx
// draws, and everything about which fold this is — its label, its tone, the word beside it and what
// stands between it and its job — is decided in ./home-sections.ts with the others.

export type OrgFoldProps = {
	/** the profile as the deployment holds it, which is what the boxes are seeded and read against. */
	stored: OrgBoxes;
	/** how the last press went, or `null` where none has been made. */
	write: OrgWrite | null;
	/** something else on the page is writing, which holds every control on it closed. */
	busy: boolean;
	pending: boolean;
};

export function OrgFold({ stored, write, busy, pending }: OrgFoldProps): ReactNode {
	/** whether the last press left the deployment holding this profile, which is what a save reports. */
	const landed = write?.kind === 'saved';

	const form = useConsoleForm(ORG_FORM, {
		report: write,
		landed,
		// the deployment's own answer, cut down to the boxes this fold draws: a key for the other
		// fold's box would send focus into a shut panel (./org-form.ts's `foldErrors`).
		refused: foldErrors(write, IDENTITY_BOXES),
		/* the eight boxes at what the deployment holds, which is what the press is read against: a
		   form nobody has touched would otherwise offer to save the deployment back to itself, and a
		   form put back the way it was would go on offering it. the ninth is carried hidden and is in
		   no seed here — the form does not state it, so it counts toward nothing
		   (./use-console-form.ts). */
		defaultValue: seedFor(ORG_FORM, stored),
		/* the boxes go back on the answer itself rather than on a reading after it, which is what the
		   seed makes right: it is the profile the press stored (`storedOrg` in ./org-form.ts), so at
		   the moment the answer arrives it is already what the deployment holds. the folds seeded from
		   a reading wait for that reading instead (./reseed.ts). */
		spent: landed,
		busy,
		pending
	});

	/** one box, drawn from what this fold calls it and what the deployment holds in it. */
	const box = (field: IdentityField) => {
		const copy = ORG_FIELDS[field];
		/* the id, the name, the one message under it and the lift that ends the far end's sentence
		   when this box is typed in — one composition, in the seam, for every fold at once
		   (./use-console-form.ts). */
		const bound = form.box(form.fields[field]);
		return (
			<Field
				id={bound.id}
				name={bound.name}
				onInput={bound.onInput}
				label={copy.label}
				optional={copy.optional}
				// the example the box stands on while it is empty. a box seeded from the profile is full
				// and shows none of it, which is what makes the placeholder a reading as well as a shape:
				// what is on screen is either what the deployment holds or an example of what it takes.
				placeholder={copy.placeholder}
				// the tabular face for a value read digit by digit against the document it was copied
				// from, which is what the EIN and the postal code have in common.
				className={copy.figures ? 'adm-num' : undefined}
				as={copy.prose ? 'textarea' : 'input'}
				rows={copy.prose ? 3 : undefined}
				autoComplete={copy.autoComplete}
				/* seeded from the profile rather than from the form layer's own reading of it: conform
				   takes its default once, at the mount, and this fold's boxes are put back by its own
				   landed write — so a box seeded from that reading would be reset to the profile the
				   press replaced. what the boxes are worth comparing against is the same prop
				   (./org-form.ts's `storedOrg`). */
				defaultValue={stored[field]}
				// closed while the page is writing, like every box on this console —
				// ../closed-while-writing.spec.ts is the gate and states the whole of why.
				disabled={busy}
				// the message is handed over as a node rather than as the string, so a sentence that
				// marks a value with backticks is drawn as code rather than shown with the marks in it
				// (`@better-giving/operator/code-spans`). both surfaces draw the same sentences, which
				// are written once in `@better-giving/operator/console/org-rules`.
				error={bound.error === undefined ? undefined : <MarkedText text={bound.error} />}
			/>
		);
	};

	return (
		<Form {...form.mount} className="adm-stack" method="post" preventScrollReset>
			{/* the boxes this fold does not draw, carried at exactly what the deployment holds: the
			    profile is stored whole, so a field left out of the body is one it stores as cleared. */}
			{carriedBoxes(IDENTITY_BOXES).map((field) => (
				<input key={field} type="hidden" name={field} value={stored[field]} readOnly />
			))}
			<fieldset className="adm-fieldset">
				<legend className="adm-fieldset__legend">Who the organisation is</legend>
				<div className="adm-pair adm-pair--side">
					{box('legal_name')}
					{box('tax_id')}
				</div>
			</fieldset>

			<fieldset className="adm-fieldset">
				<legend className="adm-fieldset__legend">Address on receipts</legend>
				<div className="adm-pair adm-pair--side">
					{box('address_line1')}
					{box('address_line2')}
				</div>
				<div className="adm-pair adm-pair--side">
					{box('city')}
					{box('region')}
				</div>
				<div className="adm-pair adm-pair--side">
					{box('postal_code')}
					{box('country')}
				</div>
			</fieldset>

			<div className="adm-actions">
				<SaveButton
					name="intent"
					value={ORG_INTENT}
					state={form.state}
					label="Save details"
					doneLabel="Saved"
				/>
			</div>

			{busy ? null : <OrgWriteOutcome write={write} drawn={IDENTITY_BOXES} />}
		</Form>
	);
}
