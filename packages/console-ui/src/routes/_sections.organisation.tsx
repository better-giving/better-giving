import { Column } from '@better-giving/operator/components/shell/Layout';
import { FOLD_LABELS } from '@better-giving/operator/setup-folds';
import {
	lookUpNonprofit,
	nonprofitsStatus,
	removeOrgLogo,
	saveOrgProfile,
	searchNonprofits
} from '../api/client';
import { watchPress } from '../lib/console-reading';
import {
	LOGO_FILE,
	ORG_INTENT,
	ORG_LOGO_INTENT,
	ORG_LOGO_REMOVE_INTENT,
	type OrgPressAnswer,
	orgEdits
} from '../lib/org-fields';
import { OrgFold } from '../lib/org-fold';
import { storedOrg } from '../lib/org-form';
import { putLogo } from '../lib/org-logo';
import { forgetReadings } from '../lib/processor-cache';
import { usePress } from '../lib/use-press';
import { ConsoleFailure, TITLE } from './_index';
import type { Route } from './+types/_sections.organisation';

// /organisation — the organisation this deployment asks for gifts under: its legal identity, what
// donor pages tell about it, its links and its logo, drawn by ../lib/org-fold.tsx.
// ./_sections.notifications.tsx edits the same stored profile.
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
 * stores the organisation's profile, whole, or puts its logo on or takes it off.
 *
 * every box goes, including the empty ones: the endpoint reads a profile whole, so a field left out
 * of the body is one it stores as cleared. this form posts the boxes the notifications page draws as
 * hidden fields at what the deployment holds (../lib/org-fields.ts's `carriedBoxes`), which is why
 * one reading of the body serves both pages.
 *
 * the logo is a write of its own and answers in the profile's shape, so the boxes and the logo are
 * re-seeded off whichever press landed last (`storedOrg` in ../lib/org-form.ts), and each answer
 * says which press it is to.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
	watchPress(request);
	await forgetReadings();
	const posted = await request.formData();
	const intent = posted.get('intent');
	if (intent === ORG_INTENT) {
		const edits = orgEdits(posted);
		return {
			write: await saveOrgProfile(edits.values, edits.socialLinks),
			press: 'profile'
		} satisfies OrgPressAnswer;
	}
	if (intent === ORG_LOGO_INTENT) {
		return {
			write: await putLogo(posted.get(LOGO_FILE), request.signal),
			press: 'logo'
		} satisfies OrgPressAnswer;
	}
	if (intent === ORG_LOGO_REMOVE_INTENT) {
		return { write: await removeOrgLogo(), press: 'logo' } satisfies OrgPressAnswer;
	}
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
				press={actionData && 'press' in actionData ? actionData.press : null}
				busy={busy}
				pending={intent === ORG_INTENT}
				logoPending={intent === ORG_LOGO_INTENT || intent === ORG_LOGO_REMOVE_INTENT}
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
