import { Column } from '@better-giving/operator/components/shell/Layout';
import { FOLD_LABELS } from '@better-giving/operator/setup-folds';
import { lookUpNonprofit, nonprofitsStatus, saveOrgProfile, searchNonprofits } from '../api/client';
import { watchPress } from '../lib/console-reading';
import { ORG_INTENT, orgEdits } from '../lib/org-fields';
import { OrgFold } from '../lib/org-fold';
import { storedOrg } from '../lib/org-form';
import { forgetReadings } from '../lib/processor-cache';
import { usePress } from '../lib/use-press';
import { ConsoleFailure, TITLE } from './_index';
import type { Route } from './+types/_sections.organisation';

// /organisation — the legal identity this deployment asks for gifts under, drawn by
// ../lib/org-fold.tsx. ./_sections.notifications.tsx edits the same stored profile.
//
// every reading is the sections layout's (./_sections.tsx) but one, and the press is this page's.
// the one is whether this console can ask the IRS list at all, which asks the list nothing.

export function meta(): Route.MetaDescriptors {
	return [{ title: `${FOLD_LABELS.organisation} · ${TITLE}` }];
}

/**
 * whether the IRS list can be asked, read once per visit: the binary answers it from how it was
 * built, so a read after a press would read the same thing. a binary that does not answer is one
 * whose lookups would not answer either, so it reads as one that cannot ask.
 */
export async function clientLoader() {
	return {
		lookups: await nonprofitsStatus().then(
			(status) => status.built,
			() => false
		)
	};
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
	watchPress(request);
	await forgetReadings();
	const posted = await request.formData();
	if (posted.get('intent') === ORG_INTENT) return { write: await saveOrgProfile(orgEdits(posted)) };
	return { unknown: true as const };
}

// this page's own reading is the build's and never changes after a press; the profile is the
// layout's, read again by its own rule.
export function shouldRevalidate(): boolean {
	return false;
}

export default function OrganisationPage({
	actionData,
	loaderData,
	matches
}: Route.ComponentProps) {
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
				lookups={loaderData.lookups}
				lookUp={lookUpNonprofit}
				search={searchNonprofits}
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
