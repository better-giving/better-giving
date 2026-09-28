import { Button } from '@better-giving/operator/components/controls/Button';
import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { getFormProps } from '@conform-to/react';
import type { MouseEvent } from 'react';
import { Form, href, Link, useNavigation } from 'react-router';
import type { CrumbHandle } from '$lib/admin/crumbs';
import { screenTitle } from '$lib/admin/screen-title';
import { useAdminForm } from '$lib/admin/use-admin-form';
import { DestinationFields, eventsBox } from '$lib/admin/webhooks/destination-fields';
import { defineForm } from '$lib/forms/definition';
import { DESTINATION_INPUT } from '$lib/webhooks/destination-input';
import { STAFF_USER_ID } from '$lib/server/auth';
import { invalid, parseForm } from '$lib/server/conform';
import { notFound } from '$lib/server/db/load-failure';
import { CREATED_FLASH, redirectWithFlash } from '$lib/server/flash';
import { createDestination } from '$lib/server/webhooks/destinations';
import { database, staff } from '../context';
import type { Route } from './+types/_app.admin.integrations.webhooks.new';

// adding a webhook destination: its address and the events it takes, one form and one action. the
// address is judged by `createDestination` ($lib/server/webhooks/destinations.ts), and a refusal
// is said under the URL box in the words the write answered with.
//
// **only the deployer's session reaches this page**, as ./_app.admin.integrations.webhooks._index.tsx
// argues; a member's GET and POST alike are answered with the dashboard's not-found.
//
// a destination added lands on its own page, where its signing secret is shown; the new id rides
// the redirect as a flash, so that page says it was just added.

const SCREEN_TITLE = 'Add destination';

const SCREEN = '/admin/integrations/webhooks/new';

const ADD_FORM = defineForm({ id: 'webhook-destination-add', schema: DESTINATION_INPUT });

const NOT_HERE =
	`No page at ${SCREEN} for a member’s session. Webhook destinations are added from the ` +
	'deployer’s session: sign in with `ADMIN_PASSWORD` at /login.';

export const handle = {
	crumbs: ({ pathname }) => [
		{ href: href('/admin/integrations/webhooks'), label: 'Webhooks' },
		{ href: pathname, label: SCREEN_TITLE }
	]
} satisfies CrumbHandle;

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export function loader({ context }: Route.LoaderArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);
	return null;
}

/**
 * add the destination. **the request body is read exactly once, here** — and not at all for a
 * member, who is answered before it.
 */
export async function action({ context, request }: Route.ActionArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const submission = parseForm(await request.formData(), ADD_FORM);
	if (!submission.ok) return invalid(400, submission.reject());

	const made = await createDestination(context.get(database), submission.value);
	if (!made.ok) return invalid(400, submission.reject({ fieldErrors: { url: [made.box] } }));

	return redirectWithFlash(
		request,
		CREATED_FLASH,
		href('/admin/integrations/webhooks/:id', { id: made.destination.id }),
		made.destination.id
	);
}

export default function NewDestination({ actionData }: Route.ComponentProps) {
	const [form, fields] = useAdminForm(ADD_FORM, actionData);
	const navigation = useNavigation();
	// the whole navigation this form started, through the `loading` the redirect begins: a press
	// re-armed before the destination's page renders is a second destination for one intent.
	const adding = navigation.state !== 'idle' && navigation.formAction === SCREEN;

	return (
		<Column>
			<PageHeader title={SCREEN_TITLE} />
			<Form method="post" {...getFormProps(form)}>
				<div className="adm-stack">
					<DestinationFields boxes={{ url: fields.url, events: eventsBox(fields.events) }} />
					<div className="adm-actions">
						<Button
							variant="primary"
							aria-disabled={adding}
							aria-busy={adding}
							onClick={(event: MouseEvent<HTMLButtonElement>) => {
								if (adding) event.preventDefault();
							}}
						>
							Add destination
						</Button>
						{/* a link dressed as a button, because it writes nothing: it leaves. */}
						<Button as={Link} to={href('/admin/integrations/webhooks')}>
							Cancel
						</Button>
					</div>
				</div>
			</Form>
		</Column>
	);
}
