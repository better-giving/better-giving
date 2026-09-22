import { Column } from '@better-giving/operator/components/shell/Layout';
import { FOLD_LABELS } from '@better-giving/operator/setup-folds';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { saveOrgProfile } from '../api/client';
import { consoleRereads } from '../lib/dialog-params';
import { ORG_INTENT, orgEdits } from '../lib/org-fields';
import { OrgFold } from '../lib/org-fold';
import { storedOrg } from '../lib/org-form';
import { forgetReadings } from '../lib/processor-cache';
import { usePress } from '../lib/use-press';
import { TITLE } from './_index';
import type { Route } from './+types/_sections.organisation';

// /organisation — the legal identity this deployment asks for gifts under, drawn by
// ../lib/org-fold.tsx. ./_sections.notifications.tsx edits the same stored profile.
//
// every reading is the sections layout's (./_sections.tsx); the press is this page's.

export function meta(): Route.MetaDescriptors {
	return [{ title: `${FOLD_LABELS.organisation} · ${TITLE}` }];
}

/**
 * stores the organisation's profile, whole.
 *
 * every box goes, including the empty ones: the endpoint reads a profile whole, so a field left out
 * of the body is one it stores as cleared. this form posts the boxes the notifications page draws as
 * hidden fields at what the deployment holds (../lib/org-fields.ts's `carriedBoxes`), which is why
 * one reading of the body serves both pages.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
	await forgetReadings();
	const posted = await request.formData();
	if (posted.get('intent') === ORG_INTENT) return { write: await saveOrgProfile(orgEdits(posted)) };
	return { unknown: true as const };
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	return consoleRereads(args);
}

export default function OrganisationPage({ actionData, matches }: Route.ComponentProps) {
	const shell = matches[1].loaderData;
	const { intent, busy } = usePress();
	const write = actionData && 'write' in actionData ? actionData.write : null;
	return (
		<Column>
			<OrgFold
				/* taken from the press's own answer from the moment one stores a profile: the reading is
				   taken again after every press, but it commits a render later than the answer does
				   (../lib/org-form.ts). */
				stored={storedOrg(shell.reading.stored, write)}
				write={write}
				busy={busy}
				pending={intent === ORG_INTENT}
			/>
		</Column>
	);
}
