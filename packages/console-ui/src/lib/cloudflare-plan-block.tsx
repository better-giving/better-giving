import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { CheckboxGroup } from '@better-giving/operator/components/forms/CheckboxGroup';
import { DELIVERY_PACE, planAnswered } from '@better-giving/operator/delivery-pace';
import { useSavedFormState } from '@better-giving/operator/saved-form-state.react';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { Form } from 'react-router';
import type { ValuesRefusal, VarsWritten } from '../api/types';
import { PAID_PLAN, PLAN_FIELD, PLAN_INTENT, PLAN_PAID } from './cloudflare-plan';
import type { HeldValues } from './held-values';
import { withheldAmong } from './held-values';
import { refusalIn } from './secret-trouble';
import { FREE_INTENT, WithheldValues } from './withheld-values';

// whether the Cloudflare account this deployment runs on is on the Workers Paid plan, as a switch
// with two positions, and what the answer changes.
//
// **it is ./paypal-section.tsx's charity-rate switch in another place**: its own press and its own
// form, no third position, off as the name taken away — ./cloudflare-plan.ts argues all three.
//
// **what the switch changes is stated from the table the deployment paces by**
// (`DELIVERY_PACE` in packages/operator/src/delivery-pace.ts), so no number on this screen can
// drift from the one the minute cron claims at.
//
// **it draws no heading.** the page that mounts it is named for it, and a heading here would say
// that name a second time directly over the box.

export type CloudflarePlanProps = {
	/** what the deployment is holding, which is what the switch is drawn in (./held-values.ts). */
	values: HeldValues;
	/** how the last press of the switch went, or `null`. */
	written: VarsWritten | null;
	/** how the last press that frees a withheld value went, drawn in the block that frees this one. */
	freed: VarsWritten | null;
	/** what a failed write says (./processor-screen.tsx's `keysTrouble`). */
	trouble: (written: ValuesRefusal) => ReactNode;
	/** something else on the page is writing, which holds every control on it closed. */
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
};

const { free: FREE, paid: PAID } = DELIVERY_PACE;

/** what ticking the box changes, and what ticking it wrongly costs. */
const PLAN_NOTE = `On the Free plan this deployment sends gifts to Zapier at ${FREE.zapier} a minute, to webhook destinations at ${FREE.webhooks} and to QuickBooks at ${FREE.books}, to stay inside the plan’s limits. On the Workers Paid plan it sends ${PAID.zapier}, ${PAID.webhooks} and ${PAID.books}. Ticked on a Free account, what goes past those limits fails.`;

export function CloudflarePlan({
	values,
	written,
	freed,
	trouble,
	busy,
	pending
}: CloudflarePlanProps): ReactNode {
	const box = `${useId()}-paid-plan`;
	const paid = planAnswered(values.seeds[PAID_PLAN]) === 'paid';
	const sending = pending === PLAN_INTENT;
	const failure = written === null ? null : refusalIn(written);

	const { form, state, onInput, onSubmit } = useSavedFormState({
		report: written,
		landed: written?.kind === 'set',
		// read off the element at every press, as the charity-rate switch is.
		changed: (element) => {
			const control = element.elements.namedItem(PLAN_FIELD);
			return (control instanceof HTMLInputElement ? control.checked : false) !== paid;
		},
		busy,
		pending: sending
	});

	return (
		<Form
			className="adm-stack"
			method="post"
			preventScrollReset
			ref={form}
			onInput={onInput}
			onSubmit={onSubmit}
		>
			<CheckboxGroup
				id={box}
				items={[
					{
						id: box,
						name: PLAN_FIELD,
						value: PLAN_PAID,
						label: 'This Cloudflare account is on the Workers Paid plan',
						note: PLAN_NOTE,
						defaultChecked: paid,
						// the position is read once, at the press.
						disabled: busy || sending
					}
				]}
			/>

			{/* this press is the only one that writes the name, so the block that frees it stands here
			    or nowhere. */}
			<WithheldValues
				names={withheldAmong(values, [PAID_PLAN])}
				all={values.withheld}
				consequence="Until this is saved again, this deployment delivers at the Free plan’s pace."
				written={freed}
				trouble={trouble}
				busy={busy}
				freeing={pending === FREE_INTENT}
			/>

			<div className="adm-actions">
				<SaveButton name="intent" value={PLAN_INTENT} state={state} />
			</div>

			{/* a press that landed is the button's own tick; what is left is the ways it did not. */}
			{failure === null ? null : trouble(failure)}
		</Form>
	);
}
