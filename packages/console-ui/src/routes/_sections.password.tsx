import { Column } from '@better-giving/operator/components/shell/Layout';
import { FOLD_LABELS } from '@better-giving/operator/setup-folds';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { freeWithheldVars } from '../api/client';
import type { VarsWritten } from '../api/types';
import { watchPress } from '../lib/console-reading';
import { consoleRereads } from '../lib/dialog-params';
import { groupPress } from '../lib/group-press';
import { PasswordFold } from '../lib/password-fold';
import { forgetReadings } from '../lib/processor-cache';
import type { GroupReport } from '../lib/secret-group-form';
import { useKeptAnswers } from '../lib/smtp-answers';
import { usePress } from '../lib/use-press';
import { FREE_INTENT } from '../lib/withheld-values';
import { ConsoleFailure, TITLE } from './_index';
import type { Route } from './+types/_sections.password';

// /password — the password that opens the dashboard for the operator who set the deployment up,
// drawn by ../lib/password-fold.tsx. it is first in the rail because it is how the operator gets
// into the dashboard at all, and answers to none of the jobs a gift needs (../lib/home-sections.ts).
//
// every reading is the sections layout's (./_sections.tsx); the presses are this page's.

export function meta(): Route.MetaDescriptors {
	return [{ title: `${FOLD_LABELS.password} · ${TITLE}` }];
}

/**
 * the password group's press, and the press that frees a value held in a form nothing can read back.
 * each is one call on the loopback address, and neither posts a name the binary acts on: the group
 * is read against the enumeration (../lib/group-press.ts), and which values are freed is read inside
 * the binary off cloudflare's own answer.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
	watchPress(request);
	await forgetReadings();
	const posted = await request.formData();
	const intent = posted.get('intent');

	const group = await groupPress(intent, posted);
	if (group !== null) return group;

	if (intent === FREE_INTENT) return { freed: await freeWithheldVars() };

	return { unknown: true as const };
}

/**
 * each press's last answer, kept apart: the freeing press stays pressable over a credentials press,
 * and its answer landing must not take that press's refusal or Saved off the fold
 * (../lib/smtp-answers.ts).
 */
const NO_ANSWERS: { readonly secrets: GroupReport | null; readonly freed: VarsWritten | null } = {
	secrets: null,
	freed: null
};

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	return consoleRereads(args);
}

export default function PasswordPage({ actionData, matches }: Route.ComponentProps) {
	const shell = matches[1].loaderData;
	const { intent, busy, revalidating } = usePress();
	const { secrets, freed } = useKeptAnswers(NO_ANSWERS, actionData);
	return (
		<Column>
			{/* no page title: it would say the box's own label directly over it. */}
			<PasswordFold
				values={shell.reading.values}
				secrets={secrets}
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

// a failure on this page stands in its place under the shell, so the rail and the other pages stay
// reachable (`ConsoleFailure` in ./_index.tsx says what each failure draws).
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return (
		<Column>
			<ConsoleFailure error={error} />
		</Column>
	);
}
