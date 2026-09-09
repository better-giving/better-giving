import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { Field } from '@better-giving/operator/components/forms/Field';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import type { ReactNode } from 'react';
import { Form } from 'react-router';
import { NOTIFICATIONS_INTENT, NOTIFICATION_BOXES, ORG_FIELDS, carriedBoxes } from './org-fields';
import { NOTIFICATIONS_FORM, foldErrors, seedFor } from './org-form';
import { useConsoleForm } from './use-console-form';
import { OrgWriteOutcome } from './org-write';
import type { OrgWrite } from '../api/types';
import type { OrgBoxes } from './org-fields';

// where this deployment reaches the operator, which is one address and one press.
//
// **it is a row of its own because it is neither of the two rows it sits between.** the mail fold
// is the transport — the credentials a message leaves over — and the organisation fold is the
// identity a gift is asked for under. an address the deployment writes *to* is a third thing, and a
// screen that files it under either one asks an operator to look for it where it is not.
//
// **it is a column of the organisation's profile and is stored the way the other eight are.** the
// deployment reads a profile whole, so this form carries those eight hidden at exactly what is held
// (./org-fields.ts's `carriedBoxes`) and posts an intent of its own — which is what draws the
// answer under this button rather than under the identity fold's (../routes/_index.tsx).
//
// **the identity has to be stored before anything here can be**: the profile is stored whole, so a
// press made over a deployment holding no identity is refused over boxes that are not on this
// screen. the row says nothing about that (./home-sections.ts), and {@link OrgWriteOutcome} is what
// sends the operator to the fold that draws them, at the press.
//
// **the box takes no `(optional)` marker and the save still takes it blank.** the column is
// nullable and clearing it is something an operator may want; what a blank one costs is that a
// receipt that failed and a payment with no gift recorded against it are seen by nobody, which is a
// deployment left unfinished rather than one set up a different way. ./org-fields.ts's header holds
// the whole of that reading and ./home-sections.ts is what draws it on the row.
//
// **so the one thing this press answers before it goes is a value that is not an address, or one
// over the length the deployment stores.** the rule is the deployment's own
// (`notification_email` in `@better-giving/operator/console/org-rules`, mounted by
// ./org-form.ts's `NOTIFICATIONS_FORM`), earning the sentence the deployment would have answered
// with, at the box, with nothing sent. an empty box raises none of it and its press is not held
// back — what a deployment left that way costs is the row's to say and not this box's.
//
// **a sentence from the far end and one from that rule share the box, and the far end's wins.** it
// is about the value that was actually sent and the other is about a box that never went; both go
// the moment the box is edited. the composition is the seam's and no fold restates it
// (./use-console-form.ts).
//
// it is a component and not a screen: the fold is one entry of the ledger ../routes/_index.tsx
// draws, and everything about which fold this is — its label, its tone, the word beside it and what
// stands between it and its job — is decided in ./home-sections.ts with the others.

export type NotificationsFoldProps = {
	/** the profile as the deployment holds it, which is what the box is seeded and read against. */
	stored: OrgBoxes;
	/** how the last press in this fold went, or `null` where none has been made. */
	write: OrgWrite | null;
	/** something else on the page is writing, which holds every control on it closed. */
	busy: boolean;
	pending: boolean;
};

export function NotificationsFold({
	stored,
	write,
	busy,
	pending
}: NotificationsFoldProps): ReactNode {
	const copy = ORG_FIELDS.notification_email;

	/** whether the last press left the deployment holding this address, which is what a save reports. */
	const landed = write?.kind === 'saved';

	const form = useConsoleForm(NOTIFICATIONS_FORM, {
		report: write,
		landed,
		// the deployment's own answer, cut down to the box this fold draws: a key for the identity
		// fold's boxes would send focus into a shut panel (./org-form.ts's `foldErrors`).
		refused: foldErrors(write, NOTIFICATION_BOXES),
		/* the one box this form states, at what the deployment holds: only a typed address is a change
		   and a form nobody has touched has nothing to send. the eight the press carries hidden are in
		   no seed here — this form states none of them, so they count toward nothing
		   (./use-console-form.ts) — and they arrive at what is stored anyway. */
		defaultValue: seedFor(NOTIFICATIONS_FORM, stored),
		/* the boxes go back on the answer itself rather than on a reading after it, which is what the
		   seed makes right: it is the profile the press stored (`storedOrg` in ./org-form.ts), so at
		   the moment the answer arrives it is already what the deployment holds. the folds seeded from
		   a reading wait for that reading instead (./reseed.ts). */
		spent: landed,
		busy,
		pending
	});

	/* the id, the name, the one message under it and the lift that ends the far end's sentence when
	   this box is typed in — one composition, in the seam, for every fold at once
	   (./use-console-form.ts). */
	const bound = form.box(form.fields.notification_email);

	return (
		<Form {...form.mount} className="adm-stack" method="post" preventScrollReset>
			{/* the eight boxes the identity fold draws, carried at what the deployment holds: the
			    profile is stored whole, so a field left out of the body is one it stores as cleared. */}
			{carriedBoxes(NOTIFICATION_BOXES).map((field) => (
				<input key={field} type="hidden" name={field} value={stored[field]} readOnly />
			))}

			<Field
				id={bound.id}
				name={bound.name}
				onInput={bound.onInput}
				label={copy.label}
				optional={copy.optional}
				// the example, shown only while the box is empty — a box seeded from the stored address
				// is full and shows none of it.
				placeholder={copy.placeholder}
				/* seeded from the profile rather than from conform's own default: conform takes that
				   once, at the mount, and this box is put back by its own landed write — so a box seeded
				   from it would be reset to the address the press replaced (./org-form.ts's
				   `storedOrg`). */
				defaultValue={stored.notification_email}
				// closed while the page is writing, like every box on this console —
				// ../closed-while-writing.spec.ts is the gate and states the whole of why.
				disabled={busy}
				// the message is handed over as a node rather than as the string, so a sentence that marks
				// a value with backticks is drawn as code rather than shown with the marks in it
				// (`@better-giving/operator/code-spans`).
				error={bound.error === undefined ? undefined : <MarkedText text={bound.error} />}
			/>

			<div className="adm-actions">
				<SaveButton
					name="intent"
					value={NOTIFICATIONS_INTENT}
					state={form.state}
					label="Save address"
					doneLabel="Saved"
				/>
			</div>

			{busy ? null : <OrgWriteOutcome write={write} drawn={NOTIFICATION_BOXES} />}
		</Form>
	);
}
