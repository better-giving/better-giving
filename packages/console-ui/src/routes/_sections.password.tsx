import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { FOLD_LABELS } from '@better-giving/operator/setup-folds';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { freeWithheldVars } from '../api/client';
import { consoleRereads } from '../lib/dialog-params';
import { groupPress } from '../lib/group-press';
import { PasswordFold } from '../lib/password-fold';
import { usePress } from '../lib/use-press';
import { FREE_INTENT } from '../lib/withheld-values';
import { TITLE } from './_index';
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
	const posted = await request.formData();
	const intent = posted.get('intent');

	const group = await groupPress(intent, posted);
	if (group !== null) return group;

	if (intent === FREE_INTENT) return { freed: await freeWithheldVars() };

	return { unknown: true as const };
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	return consoleRereads(args);
}

export default function PasswordPage({ actionData, matches }: Route.ComponentProps) {
	const shell = matches[1].loaderData;
	const { intent, busy, revalidating } = usePress();
	return (
		<Column>
			<PageHeader title={FOLD_LABELS.password} />
			<PasswordFold
				values={shell.reading.values}
				secrets={actionData && 'secrets' in actionData ? actionData.secrets : null}
				freed={actionData && 'freed' in actionData ? actionData.freed : null}
				workerName={shell.workerName}
				accountName={shell.account}
				busy={busy}
				pending={intent}
				revalidating={revalidating}
			/>
		</Column>
	);
}
