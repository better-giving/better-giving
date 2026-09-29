import { Column } from '@better-giving/operator/components/shell/Layout';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { freeWithheldVars, setVars } from '../api/client';
import { PLAN_INTENT, planEdit } from '../lib/cloudflare-plan';
import { CloudflarePlan } from '../lib/cloudflare-plan-block';
import { CLOUDFLARE_PLAN_TITLE } from '../lib/console-pages';
import { consoleRereads } from '../lib/dialog-params';
import { heldValues } from '../lib/held-values';
import { forgetReadings } from '../lib/processor-cache';
import { keysTrouble } from '../lib/processor-screen';
import { usePress } from '../lib/use-press';
import { FREE_INTENT } from '../lib/withheld-values';
import { TITLE } from './_index';
import type { Route } from './+types/_sections.cloudflare-plan';

// /cloudflare-plan — whether the Cloudflare account this deployment runs on is on the Workers Paid
// plan, drawn by ../lib/cloudflare-plan-block.tsx whole.
//
// every reading is the sections layout's (./_sections.tsx): the switch is drawn from the values it
// already holds, so this page reads nothing of its own. the presses are this page's.

export function meta(): Route.MetaDescriptors {
	return [{ title: `${CLOUDFLARE_PLAN_TITLE} · ${TITLE}` }];
}

export async function clientAction({ request }: Route.ClientActionArgs) {
	await forgetReadings();
	const posted = await request.formData();
	const intent = posted.get('intent');

	/**
	 * stores that the account is on the Workers Paid plan, or takes the name off. one of the
	 * deploy-time values, through the door every other one goes through, with the payload composed
	 * from the switch's two positions rather than from what the body claimed (`planEdit` in
	 * ../lib/cloudflare-plan.ts).
	 */
	if (intent === PLAN_INTENT) return { plan: await setVars(planEdit(posted)) };

	/**
	 * takes every value this deployment is holding in a form nothing can read back off it. which
	 * names are freed is read inside the binary off cloudflare's own answer and never posted.
	 */
	if (intent === FREE_INTENT) return { freed: await freeWithheldVars() };

	// nothing on this page posts anything else. a body naming nothing, or naming a press drawn
	// elsewhere, is answered rather than run.
	return { unknown: true as const };
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	return consoleRereads(args);
}

export default function CloudflarePlanPage({ actionData, matches }: Route.ComponentProps) {
	const shell = matches[1].loaderData;
	const { intent, busy } = usePress();
	const { vars } = shell.reading.values;
	// never drawn: the sections layout stands a gate in this page's place (../lib/cloudflare-gate.ts).
	if (vars.kind !== 'read') return null;
	return (
		<Column>
			<CloudflarePlan
				values={heldValues(vars.vars)}
				written={actionData && 'plan' in actionData ? actionData.plan : null}
				freed={actionData && 'freed' in actionData ? actionData.freed : null}
				trouble={keysTrouble({ workerName: shell.workerName, accountName: shell.account })}
				busy={busy}
				pending={intent}
			/>
		</Column>
	);
}
