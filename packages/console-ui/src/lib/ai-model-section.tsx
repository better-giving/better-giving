import { Button } from '@better-giving/operator/components/controls/Button';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { CheckboxGroup } from '@better-giving/operator/components/forms/CheckboxGroup';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { useSavedFormState } from '@better-giving/operator/saved-form-state.react';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { Form } from 'react-router';
import type {
	AddressRead,
	DeployVarName,
	DeployedVar,
	ModelCredits,
	VarsWritten
} from '../api/types';
import {
	MODEL_FIELD,
	MODEL_INTENT,
	chosenModel,
	creditsLine,
	modelOptions,
	modelPhase,
	pressSays,
	settles
} from './ai-model';
import { useReseeded } from './reseed';
import { Said } from './said';
import { refusalIn, secretTrouble } from './secret-trouble';
import { FREE_INTENT, WithheldValues } from './withheld-values';

// the model the donation page's chat answers from: the choices, the press that stores one, and what
// the account's credits say about the one stored.
//
// **the credits are the account's and not a model's**, so they stand once under the choices rather
// than beside each one, and they describe the choice the deployment holds — a choice ticked and not
// yet saved has been read against nothing. an account with none is the one state drawn above the
// form: the chat is already answering from the free model, which no press here changes, and the
// way on is in cloudflare's dashboard.
//
// **its own press, and one value through the door every value goes through**
// (`POST /api/values/vars`). which id is posted is composed from the list (`modelEdit` in
// ./ai-model.ts), so the door's refusal of an id off it is never met from this page.
//
// it is a component and not a screen: ../routes/_sections.ai-model.tsx mounts it and answers its
// presses. every reading it draws is a value out of ./ai-model.ts, which is where they are held
// (./ai-model.spec.ts); the markup it draws them into is held by ./ai-model-section.spec.ts, and a
// press by neither, since this package has no DOM pool.

const DASHBOARD = 'https://dash.cloudflare.com';

export type ModelSectionProps = {
	/** `AI_MODEL` as the deployment holds it. */
	model: DeployedVar;
	/** what the account's credits say about that choice. */
	credits: ModelCredits;
	/** every name on the deployment held in a form nothing can read back, which the free press frees. */
	withheld: readonly DeployVarName[];
	/** how the last press of the save went, or `null` where none has been made. */
	written: VarsWritten | null;
	/** how the last press that frees a withheld value went, or `null`. */
	freed: VarsWritten | null;
	workerName: string;
	accountName: string;
	/** something on the page is writing, which holds every control on it closed. */
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
	/** the router has a press's answer and is reading the page again over it. */
	revalidating: boolean;
};

export function ModelSection({
	model,
	credits,
	withheld,
	written,
	freed,
	workerName,
	accountName,
	busy,
	pending,
	revalidating
}: ModelSectionProps): ReactNode {
	const group = `${useId()}-model`;
	const chosen = chosenModel(model);
	const line = creditsLine(credits);
	const says = pressSays(written);
	const own = pending === MODEL_INTENT;
	const failure = written === null ? null : refusalIn(written);
	const settled = settles(written);
	/* the radios go back to what the deployment holds on the reading that lands after this press,
	   not on the answer ahead of it (./reseed.ts): `model` is the whole of what they are drawn from,
	   so it is what says which reading is on the screen. */
	const spent = useReseeded({ landed: settled, pending: own, reading: model });
	const { underway, closed } = modelPhase({ own, revalidating, busy, settled, spent });

	const { form, state, onInput, onSubmit } = useSavedFormState({
		report: written,
		landed: written?.kind === 'set',
		spent,
		// read off the element at every press, as a block with no form layer does
		// (`SavedFormInputs.changed` in packages/operator/src/saved-form-state.react.ts).
		changed: (element) => {
			const ticked = element.querySelector<HTMLInputElement>(
				`input[name="${MODEL_FIELD}"]:checked`
			);
			return (ticked?.value ?? null) !== chosen;
		},
		busy: closed,
		pending: underway
	});

	/* the race every press on this console meets: the Worker answered a moment ago and is not in the
	   account now, or the sign-in went. the way out is the page read again. */
	const nowhere = (address: AddressRead) =>
		address.kind === 'not-deployed' ? (
			<FieldMessage>
				No Worker called {workerName} is in {accountName} any more, so there was nowhere to store
				this. Nothing was stored. Reload this page.
			</FieldMessage>
		) : (
			<>
				<FieldMessage>
					Nothing was stored, because this console could not find out where this deployment answers.
				</FieldMessage>
				{address.kind === 'deployed' ? null : <Said answer={address} />}
			</>
		);
	const trouble = secretTrouble({ workerName, accountName, nowhere });

	/* a stored id this console does not offer is refused by the deployment on every chat request
	   (packages/operator/src/ai-models.ts), so it is said over the choices rather than drawn as one. */
	const offList =
		model.kind === 'value' && chosen === null ? (
			<>
				This deployment holds <InlineCode>{model.value}</InlineCode>, which this console doesn’t
				offer, so the chat can’t answer until you save one of these.
			</>
		) : null;

	return (
		<>
			{line?.kind === 'missing' ? (
				<Banner
					tone="attention"
					word="No credits"
					actions={
						<Button
							as="a" // full-load-ok: cloudflare's dashboard, never this console's.
							href={DASHBOARD}
							target="_blank"
							rel="noreferrer"
							size="sm"
							markAfter="arrow-up-right"
						>
							Add credits in Cloudflare
						</Button>
					}
				>
					Your Cloudflare account has no credits left, so the chat answers from the free model until
					you add some.
				</Banner>
			) : null}

			<Form
				className="adm-stack"
				method="post"
				preventScrollReset
				ref={form}
				onInput={onInput}
				onSubmit={onSubmit}
			>
				<CheckboxGroup
					id={group}
					name={MODEL_FIELD}
					type="radio"
					boxed
					legend="Model"
					// the rail cell and the tab title already name the page, which is this one choice.
					legendHidden
					hint={offList}
					items={modelOptions().map((option) => ({
						id: `${group}-${option.id}`,
						value: option.id,
						label: option.label,
						sub: option.sub ?? undefined,
						note: option.note ?? undefined,
						defaultChecked: option.id === chosen,
						// closed while this press is underway and while another on the page writes: the
						// choice is read once, at the press.
						disabled: closed
					}))}
				/>

				{line?.kind === 'held' ? (
					<StatedValue label="Cloudflare credits" value={line.figure} num />
				) : null}
				{line?.kind === 'unknown' ? <p className="adm-hint">{line.detail}</p> : null}

				{/* a choice held as a secret has no radio to be read out of, and this press is the only one
				    that writes it — so the block that frees it stands here or nowhere. */}
				<WithheldValues
					names={model.kind === 'withheld' ? [model.name] : []}
					all={withheld}
					consequence="Until a model is saved again, the chat answers from the free one."
					written={freed}
					trouble={trouble}
					busy={closed}
					freeing={pending === FREE_INTENT}
				/>

				<div className="adm-actions">
					<SaveButton name="intent" value={MODEL_INTENT} state={state} label="Save model" />
				</div>

				{/* a press that landed is the button's own tick, so what is left is the ways it did not:
				    one that stored nothing says why here, and one that failed is its trouble. */}
				{says?.tone === 'refused' ? <FieldMessage>{says.sentence}</FieldMessage> : null}
				{/* mounted empty and written into, since a region arriving with its text is announced
				    by nobody. */}
				<p role="status" className={says?.tone === 'status' ? 'adm-hint' : 'adm-vh'}>
					{says?.tone === 'status' ? says.sentence : null}
				</p>
				{failure === null ? null : trouble(failure)}
			</Form>
		</>
	);
}
