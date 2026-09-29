import { DELIVERY_PACE, planAnswered } from '@better-giving/operator/delivery-pace';
import type { ReactNode } from 'react';
import type { ValuesRefusal, VarsWritten } from '../api/types';
import { AnswerSwitchBlock } from './answer-switch-block';
import { PAID_PLAN, PLAN_SWITCH } from './cloudflare-plan';
import type { HeldValues } from './held-values';

// whether the Cloudflare account this deployment runs on is on the Workers Paid plan, as a switch
// with two positions, and what the answer changes.
//
// **it is ./answer-switch-block.tsx over the paid-plan answer** (./cloudflare-plan.ts), the block
// ./paypal-section.tsx draws the charity rate with.
//
// **what the switch changes is stated from the table the deployment paces by**
// (`DELIVERY_PACE` in packages/operator/src/delivery-pace.ts), so no number on this screen can
// drift from the one the minute cron claims at.
//
// **it draws no heading.** what mounts it is headed by the account it is about
// (./cloudflare-account.tsx), and the box's own label names the plan.

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
const PLAN_NOTE = `On the Free plan this deployment makes ${FREE.zapier} deliveries a minute to Zapier, ${FREE.webhooks} to webhook destinations and ${FREE.books} to QuickBooks, to stay inside the plan’s limits. On the Workers Paid plan it makes ${PAID.zapier}, ${PAID.webhooks} and ${PAID.books}. Ticked on a Free account, what goes past those limits fails.`;

export function CloudflarePlan({
	values,
	written,
	freed,
	trouble,
	busy,
	pending
}: CloudflarePlanProps): ReactNode {
	return (
		<AnswerSwitchBlock
			answer={PLAN_SWITCH}
			values={values}
			on={planAnswered(values.seeds[PAID_PLAN]) === 'paid'}
			label="This Cloudflare account is on the Workers Paid plan"
			note={PLAN_NOTE}
			consequence="Until this is saved again, this deployment delivers at the Free plan’s pace."
			written={written}
			freed={freed}
			trouble={trouble}
			busy={busy}
			pending={pending}
		/>
	);
}
