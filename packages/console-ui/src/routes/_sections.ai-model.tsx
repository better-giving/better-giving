import { Column } from '@better-giving/operator/components/shell/Layout';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { freeWithheldVars, readAiModel, setVars } from '../api/client';
import type { VarsWritten } from '../api/types';
import { MODEL_INTENT, MODEL_TITLE, modelEdit } from '../lib/ai-model';
import { ModelSection } from '../lib/ai-model-section';
import { notReady, readConsole, valuesNotRead, watchPress } from '../lib/console-reading';
import { consoleRereads } from '../lib/dialog-params';
import { heldValues } from '../lib/held-values';
import { forgetReadings, readKeptPage } from '../lib/processor-cache';
import { usePress } from '../lib/use-press';
import { FREE_INTENT } from '../lib/withheld-values';
import { TITLE as CONSOLE_TITLE } from './_index';
import type { Route } from './+types/_sections.ai-model';

// /ai-model — the model the donation page's chat answers from, drawn by ../lib/ai-model-section.tsx
// whole.
//
// the account, the worker and the held values are the sections layout's reading (./_sections.tsx);
// the choice and the account's credits beside it are this page's own, off `GET /api/ai-model`.

export function meta(): Route.MetaDescriptors {
	return [{ title: `${MODEL_TITLE} · ${CONSOLE_TITLE}` }];
}

/**
 * the choice and its credits, under the same ready check every page under this layout makes, and
 * kept between visits as every page that reads the deployment for itself is
 * (../lib/processor-cache.ts).
 *
 * **only a reading that asked about no credits is served to a second visit**: a balance moves with
 * nothing pressed here, and the way out of none is to buy some in cloudflare's dashboard and come
 * back.
 *
 * the layout read the values a moment before, so a read here that did not land is the same failure
 * met a second time, and it stands behind the same gate.
 */
export function clientLoader(args: Route.ClientLoaderArgs) {
	return readKeptPage(
		args,
		async () => {
			const read = await readConsole(args.request);
			if (read.reading.face.kind !== 'ready') notReady(read);
			const choice = await readAiModel();
			if (choice.kind !== 'read') valuesNotRead(read, choice);
			return { choice };
		},
		{ standing: ({ choice }) => choice.credits.kind === 'not-asked' }
	);
}

/**
 * the save and the press that frees a value held in a form nothing can read back, each one call on
 * the loopback address.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
	watchPress(request);
	await forgetReadings();
	const posted = await request.formData();
	const intent = posted.get('intent');

	/* the choice goes through the door every value goes through, composed from the list rather than
	   from the body (`modelEdit` in ../lib/ai-model.ts). a body naming no model on it stores
	   nothing. */
	if (intent === MODEL_INTENT) {
		const edit = modelEdit(posted);
		return edit === null ? { unknown: true as const } : { model: await setVars(edit) };
	}

	if (intent === FREE_INTENT) return { freed: await freeWithheldVars() };

	return { unknown: true as const };
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	return consoleRereads(args);
}

export default function ModelPage({ loaderData, actionData, matches }: Route.ComponentProps) {
	const shell = matches[1].loaderData;
	const { intent, busy, revalidating } = usePress();
	const { vars } = shell.reading.values;
	const written: VarsWritten | null = actionData && 'model' in actionData ? actionData.model : null;
	const freed: VarsWritten | null = actionData && 'freed' in actionData ? actionData.freed : null;
	return (
		<Column>
			<ModelSection
				model={loaderData.choice.model}
				credits={loaderData.choice.credits}
				withheld={heldValues(vars.kind === 'read' ? vars.vars : []).withheld}
				written={written}
				freed={freed}
				workerName={shell.workerName}
				accountName={shell.account}
				busy={busy}
				pending={intent}
				revalidating={revalidating}
			/>
		</Column>
	);
}
