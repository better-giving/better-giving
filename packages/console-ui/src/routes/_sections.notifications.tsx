import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { FOLD_LABELS } from '@better-giving/operator/setup-folds';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { saveOrgProfile } from '../api/client';
import { consoleRereads } from '../lib/dialog-params';
import { NotificationsFold } from '../lib/notifications-fold';
import { NOTIFICATIONS_INTENT, orgEdits } from '../lib/org-fields';
import { storedOrg } from '../lib/org-form';
import { usePress } from '../lib/use-press';
import { TITLE } from './_index';
import type { Route } from './+types/_sections.notifications';

// /notifications — where the mail this deployment sends the organisation lands, drawn by
// ../lib/notifications-fold.tsx. it is last in the rail because an address is worth nothing until
// something carries the mail to it.
//
// every reading is the sections layout's (./_sections.tsx); the press is this page's.

export function meta(): Route.MetaDescriptors {
	return [{ title: `${FOLD_LABELS.notifications} · ${TITLE}` }];
}

/**
 * stores the organisation's profile, whole — the same write ./_sections.organisation.tsx makes, for
 * the reason stated over it: this form carries the identity boxes as hidden fields.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
	const posted = await request.formData();
	if (posted.get('intent') === NOTIFICATIONS_INTENT) {
		return { write: await saveOrgProfile(orgEdits(posted)) };
	}
	return { unknown: true as const };
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	return consoleRereads(args);
}

export default function NotificationsPage({ actionData, matches }: Route.ComponentProps) {
	const shell = matches[1].loaderData;
	const { intent, busy } = usePress();
	const write = actionData && 'write' in actionData ? actionData.write : null;
	return (
		<Column>
			<PageHeader title={FOLD_LABELS.notifications} />
			<NotificationsFold
				stored={storedOrg(shell.reading.stored, write)}
				write={write}
				busy={busy}
				pending={intent === NOTIFICATIONS_INTENT}
			/>
		</Column>
	);
}
