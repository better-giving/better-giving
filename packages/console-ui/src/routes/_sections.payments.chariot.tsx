import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { freeWithheldVars, startChariotSetup } from '../api/client';
import type { VarsWritten } from '../api/types';
import type { ChariotPress } from '../lib/chariot-section';
import { ChariotSection } from '../lib/chariot-section';
import { CHARIOT_SETUP_INTENT, chariotPosted } from '../lib/chariot-setup';
import { consoleRereads } from '../lib/dialog-params';
import { forgetReadings, readProcessorPage } from '../lib/processor-cache';
import { usePress } from '../lib/use-press';
import { FREE_INTENT } from '../lib/withheld-values';
import { TITLE as CONSOLE_TITLE } from './_index';
import type { Route } from './+types/_sections.payments.chariot';

// /payments/chariot — Chariot's page, the third under the rail's donation processor heading. what it
// draws is ../lib/chariot-section.tsx whole.
//
// the account, the worker and the values are the sections layout's reading (./_sections.tsx); what
// this page reads on top of them is ../lib/processor-reading.ts's, kept between visits by
// ../lib/processor-cache.ts.

const TITLE = 'Chariot';

export function meta(): Route.MetaDescriptors {
	return [{ title: `${TITLE} · ${CONSOLE_TITLE}` }];
}

export function clientLoader(args: Route.ClientLoaderArgs) {
	return readProcessorPage(args, 'chariot');
}

/**
 * every press this page draws, and nothing else — each one call on the loopback address, with the
 * account, the worker and the address it is spent on read inside the binary and never posted.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
	await forgetReadings();
	const posted = await request.formData();
	const intent = posted.get('intent');

	/**
	 * sets Chariot up from the two boxes: the binary checks the key, finds the organisation, settles
	 * its Connect and the subscription here, and writes the four values in one write
	 * (`packages/console/internal/chariot`).
	 *
	 * started rather than awaited, for the Stripe press's reason (./_sections.payments.stripe.tsx), and
	 * the boxes are read by their own rules first so the binary is sent nothing it would turn down
	 * (../lib/chariot-setup.ts).
	 */
	if (intent === CHARIOT_SETUP_INTENT) {
		const read = chariotPosted(posted);
		if (!read.ok) return { chariot: { errors: read.errors } };
		const pressed = await startChariotSetup(read.boxes);
		if ('turnedDown' in pressed) return { chariot: { turnedDown: true as const } };
		if ('unwritten' in pressed) return { chariot: { unwritten: pressed.unwritten } };
		return { chariot: { started: true as const } };
	}

	/**
	 * takes every value this deployment is holding in a form nothing can read back off it, so the
	 * boxes beside the press can set them.
	 */
	if (intent === FREE_INTENT) return { freed: await freeWithheldVars() };

	// nothing on this page posts anything else. a body naming nothing, or naming a press drawn
	// elsewhere, is answered rather than run.
	return { unknown: true as const };
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	return consoleRereads(args);
}

export default function ChariotPage({ loaderData, actionData, matches }: Route.ComponentProps) {
	const shell = matches[1].loaderData;
	const press = usePress();
	/* a setup run counts as this page writing, although no request is open for it: it writes the four
	   values onto the deployment, and a second press made under it would be reading what this one is
	   still changing. */
	const busy = press.busy || loaderData.run?.kind === 'running';

	const answer = actionData && 'chariot' in actionData ? actionData.chariot : null;
	const chariot: ChariotPress = {
		run: loaderData.run,
		refused: answer !== null && 'errors' in answer ? answer.errors : null,
		turnedDown: answer !== null && 'turnedDown' in answer,
		unwritten: answer !== null && 'unwritten' in answer ? answer.unwritten : null
	};
	const freed: VarsWritten | null = actionData && 'freed' in actionData ? actionData.freed : null;

	return (
		<Column>
			<PageHeader title={TITLE} />
			<ChariotSection
				values={shell.reading.values}
				payments={loaderData.payments}
				workerName={shell.workerName}
				accountName={shell.account}
				chariot={chariot}
				freed={freed}
				revalidating={press.revalidating}
				busy={busy}
				pending={press.intent}
			/>
		</Column>
	);
}
