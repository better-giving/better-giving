import { part, partWhen } from '@better-giving/form/parts';
import type { PayerField } from '@better-giving/form/value';
import type { FormConfig } from '@better-giving/form/v1';
import type { ReactNode, RefObject } from 'react';
import { ChallengeBox } from '../challenge';
import * as copy from '../copy';
import type { FieldProps, ReactApi } from '../normalize';

// the second numbered step: who the receipt is for.
//
// three boxes and a tick, and nothing here is a marketing field. which of them a press was refused
// for is the flow's answer — `state.missing` — and never the control's: the flow's rule and the
// platform's are not the same rule, so a field marked by the engine on a press the flow refused for
// something else would take the caret off whatever actually blocked it.
//
// the platform's rule is still written onto every box, from the projection rather than typed in
// here: `required` and `pattern` come off the getters, so constraint validation applies and a donor
// gets the browser's own affordances. what is not taken from the engine is the verdict.
//
// the step says nothing until a press has asked. blur is not the moment — a donor tabbing past an
// empty field on the way to the next one has not finished with it.

export type DetailsRefs = Readonly<Record<PayerField, RefObject<HTMLInputElement | null>>>;

export type DetailsStepProps = {
	readonly api: ReactApi;
	readonly config: FormConfig;
	readonly head: ReactNode;
	readonly hidden: boolean;
	/** the fields this step is reporting, empty until a press has asked for one. */
	readonly missing: readonly PayerField[];
	readonly onConsent: () => void;
	readonly onContinue: () => void;
	readonly submits: boolean;
	readonly refs: DetailsRefs;
	/** the node the anti-abuse challenge is drawn in. */
	readonly challengeMount: RefObject<HTMLDivElement | null>;
};

/**
 * the sentence one refused field shows, chosen off the value it is holding.
 *
 * two rules and two sentences on the address, one sentence for both rules a name can break: an empty
 * box and a box holding a space are the same thing to the donor looking at it.
 *
 * chosen off the value rather than off the control's `validity` because a react view renders from
 * state, and the two answers are the same answer read from the same string: an `<input type="email">`
 * sanitizes whitespace away before reporting, so an address that trims to nothing is what the engine
 * calls missing and everything else is what it calls malformed.
 */
export function fieldProblem(key: PayerField, value: string): string {
	if (key !== 'email') return copy.NAME_PROBLEM;
	return value.trim() === '' ? copy.EMAIL_MISSING : copy.EMAIL_MALFORMED;
}

/** every typed field on this step, in the order a refused press walks them. */
export const DETAILS_FIELDS = ['email', 'firstName', 'lastName'] as const;

export function DetailsStep({
	api,
	config,
	head,
	hidden,
	missing,
	onConsent,
	onContinue,
	submits,
	refs,
	challengeMount
}: DetailsStepProps) {
	const busy = api.continueButton['aria-busy'];

	return (
		<section className="step step-details" hidden={hidden}>
			{head}

			<TextField
				id="email"
				label={copy.EMAIL}
				autoComplete="email"
				field={api.emailField}
				wrong={missing.includes('email')}
				problem={fieldProblem('email', api.emailField.box.value)}
				inputRef={refs.email}
			/>

			<div className="names">
				<TextField
					id="first-name"
					label={copy.FIRST_NAME}
					autoComplete="given-name"
					field={api.firstNameField}
					wrong={missing.includes('firstName')}
					problem={copy.NAME_PROBLEM}
					inputRef={refs.firstName}
				/>
				<TextField
					id="last-name"
					label={copy.LAST_NAME}
					autoComplete="family-name"
					field={api.lastNameField}
					wrong={missing.includes('lastName')}
					problem={copy.NAME_PROBLEM}
					inputRef={refs.lastName}
				/>
			</div>

			{/*
			 * unticked until the donor ticks it. pre-ticked consent is not consent under GDPR/UK GDPR,
			 * and the liability lands on the deploying organisation — the same rule the flow keeps at
			 * the point the payer is assembled.
			 */}
			<label className="check-row">
				<input
					part={part('checkbox')}
					type="checkbox"
					checked={api.consentToggle.pressed === true}
					onChange={onConsent}
				/>
				<span>{copy.consentLabel(config.orgLegalName)}</span>
			</label>

			<button
				part={partWhen('action', { busy })}
				type={submits ? 'submit' : 'button'}
				aria-busy={busy}
				onClick={onContinue}
			>
				<span className="action-label">{copy.CONTINUE}</span>
				<span className="spinner" aria-hidden="true" />
			</button>

			<ChallengeBox mount={challengeMount} />
		</section>
	);
}

/**
 * one labelled text field, with the sentence that says what is wrong with it under the control.
 *
 * the sentence is tied to the field by `aria-describedby` while it is shown, so it is read out with
 * the field rather than found by looking for it. it carries no part name, for the reason the form
 * package's parts.ts gives for every error surface: a host who could restyle it could restyle it
 * into nothing.
 */
function TextField({
	id,
	label,
	autoComplete,
	field,
	wrong,
	problem,
	inputRef
}: {
	readonly id: string;
	readonly label: string;
	readonly autoComplete: string;
	readonly field: FieldProps;
	readonly wrong: boolean;
	readonly problem: string;
	readonly inputRef: RefObject<HTMLInputElement | null>;
}) {
	const problemId = `${id}-problem`;
	return (
		<div className="field-row">
			<label part={part('label')} htmlFor={id}>
				{label}
			</label>
			<input
				{...field.box}
				id={id}
				ref={inputRef}
				autoComplete={autoComplete}
				part={partWhen('field', { invalid: wrong })}
				aria-invalid={wrong ? true : undefined}
				aria-describedby={wrong ? problemId : undefined}
			/>
			<p className="message" id={problemId} hidden={!wrong}>
				{wrong ? problem : ''}
			</p>
		</div>
	);
}
