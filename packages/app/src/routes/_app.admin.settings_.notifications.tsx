import { Field } from '@better-giving/operator/components/forms/Field';
import { PageHeading } from '@better-giving/operator/components/shell/PageHeading';
import {
	SettingsLayout,
	SettingsSave
} from '@better-giving/operator/components/shell/SettingsLayout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { ORG_PROFILE_FIELD_RULES } from '@better-giving/operator/console/org-rules';
import { useSaveState } from '@better-giving/operator/save-state.react';
import { getFormProps } from '@conform-to/react';
import { data, Form } from 'react-router';
import { z } from 'zod';
import { type CrumbHandle, useCrumbs } from '$lib/admin/crumbs';
import { RouterLink } from '$lib/admin/router-link';
import { savedSection } from '$lib/admin/saved-section';
import { screenTitle } from '$lib/admin/screen-title';
import {
	FormRefusal,
	marked,
	STALE_SAVE,
	settingsCrumbs,
	useSettingsSave,
	useSubmitting,
	WRITE_FAILED
} from '$lib/admin/settings/settings-card';
import { formPress } from '$lib/admin/unreached';
import { recordVersion, useAdminForm, whichForm } from '$lib/admin/use-admin-form';
import { defineForm } from '$lib/forms/definition';
import { STAFF_USER_ID } from '$lib/server/auth';
import { readSetupState } from '$lib/server/config/setup-state';
import { invalid, parseForm, submittedForm, submittedVersion } from '$lib/server/conform';
import { loadFailed, notFound } from '$lib/server/db/load-failure';
import { redirectWithFlash, SAVED_FLASH, takeFlash } from '$lib/server/flash';
import { parseNotificationEmail } from '$lib/server/org/org-input';
import { orgProfileVersion, updateOrgNotificationEmail } from '$lib/server/org/queries';
import { database, platform, staff } from '../context';
import type { Route } from './+types/_app.admin.settings_.notifications';

// the address this deployment reaches the organisation at: one box, one save, written against the
// version of the profile the page was drawn from and naming that column alone
// ($lib/server/org/queries.ts), so it leaves what Organisation details stores alone.
//
// **only the deployer's session reaches this page**, the predicate ./_app.admin.members.tsx reads —
// `context.get(staff).id === STAFF_USER_ID` — read by the loader and by the action alike, and by
// ./_app.tsx to leave the rail's Settings row out for anyone else ($lib/admin/destinations.ts). a
// member's GET and POST are answered with not-found, before the body is read.

const SCREEN_TITLE = 'Notifications';

/** the address this screen answers on, and the one a save redirects back to. */
const SCREEN = '/admin/settings/notifications';

/** the body of a member's not-found. the page the layout draws does not show it; an agent reads it. */
const NOT_HERE =
	`No page at ${SCREEN} for a member’s session. The organisation’s notification address is the ` +
	'deployer’s: sign in with `ADMIN_PASSWORD` at /login.';

/** an address saved ahead of the details: a profile row cannot exist without a legal name. */
const NO_PROFILE_YET = 'Save the organisation details first, then the notification address.';

const NOTIFICATIONS_FORM_ID = 'settings-notifications';

/** the one box this screen draws, at the rule the leaf states for it. */
const NOTIFICATIONS_FORM = defineForm({
	id: NOTIFICATIONS_FORM_ID,
	schema: z.object({ notification_email: z.string().optional() }).superRefine((held, ctx) => {
		const read = ORG_PROFILE_FIELD_RULES.notification_email.safeParse(
			held.notification_email ?? ''
		);
		if (read.success) return;
		for (const issue of read.error.issues) {
			ctx.addIssue({ code: 'custom', message: issue.message, path: ['notification_email'] });
		}
	})
});

export const handle = {
	crumbs: ({ pathname }) => settingsCrumbs(pathname, SCREEN_TITLE)
} satisfies CrumbHandle;

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const state = await readSetupState(context.get(database), context.get(platform).env);
	if (state === null) loadFailed('Settings');

	// the save that just redirected here, taken: read and cleared on this one response.
	const landed = await takeFlash(request, SAVED_FLASH);
	return data(
		{
			notificationEmail: state.profile?.notificationEmail ?? null,
			saved: savedSection(landed?.marker ?? null, ['notifications'] as const),
			// the version the save is written against, carried back in the `<form>`.
			version: orgProfileVersion(state.profile)
		},
		// a `Set-Cookie` from a loader is sent without this route exporting `headers`.
		landed === null ? {} : { headers: { 'Set-Cookie': landed.clear } }
	);
}

/**
 * the notification address, and no other column; an emptied box clears it. **the request body is
 * read exactly once, here** — and not at all for a member, who is answered before it.
 */
export async function action({ context, request }: Route.ActionArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const body = await request.formData();
	submittedForm(body, [NOTIFICATIONS_FORM_ID]);
	const submission = parseForm(body, NOTIFICATIONS_FORM);
	if (!submission.ok) return invalid(400, submission.reject());
	const parsed = parseNotificationEmail(submission.value.notification_email);
	if (!parsed.ok) {
		return invalid(400, submission.reject({ fieldErrors: { notification_email: [parsed.error] } }));
	}

	const version = submittedVersion(body);
	let saved: Awaited<ReturnType<typeof updateOrgNotificationEmail>>;
	try {
		saved = await updateOrgNotificationEmail(context.get(database), version, parsed.value);
	} catch (e) {
		console.error('saving the notification address failed:', e);
		return invalid(500, submission.reject({ formErrors: [WRITE_FAILED] }));
	}
	if (saved !== 'saved') {
		return invalid(
			409,
			submission.reject({ formErrors: [saved === 'stale' ? STALE_SAVE : NO_PROFILE_YET] })
		);
	}
	return redirectWithFlash(request, SAVED_FLASH, SCREEN, 'notifications');
}

/**
 * a press whose request never reached the server, answered in the browser as the form's refusal
 * rather than with the error boundary ($lib/admin/unreached.ts).
 */
export function clientAction({ request, serverAction }: Route.ClientActionArgs) {
	return formPress(request, serverAction);
}

export default function Notifications({ loaderData, actionData }: Route.ComponentProps) {
	const { notificationEmail: address, version } = loaderData;
	const [form, fields] = useAdminForm(NOTIFICATIONS_FORM, actionData, {
		defaultValue: { notification_email: address ?? '' }
	});
	const save = useSettingsSave(
		useSaveState({
			// `!actionData`: a refused write answers with a rejection rather than a redirect, so the
			// marker the last landing published may still be on the page.
			landed: loaderData.saved === 'notifications' && !actionData,
			changed: form.dirty,
			pending: useSubmitting(NOTIFICATIONS_FORM)
		})
	);

	return (
		<>
			<PageHeading title={SCREEN_TITLE} crumbs={useCrumbs()} link={RouterLink} />
			<SettingsLayout>
				<section className="ds-card" aria-labelledby={`${form.id}-title`}>
					<header className="ds-card-header">
						<h2 id={`${form.id}-title`}>Notifications</h2>
					</header>
					<Form method="post" className="ds-card-body" {...getFormProps(form)}>
						<input {...whichForm(NOTIFICATIONS_FORM.id)} />
						<input {...recordVersion(version)} />
						{/* read off the stored row rather than the box: what is dropped is decided by what is
						    saved, and a box typed into and not saved reaches nobody yet either. */}
						{address === null ? (
							<Banner tone="attention" word="Nothing reaches you yet">
								Alerts about gifts, refunds and dispute deadlines are dropped until an address is
								saved here.
							</Banner>
						) : null}
						<Field
							{...marked(fields.notification_email)}
							label="Notification email"
							hint="Where this site reaches you about the gifts it takes and anything that goes wrong."
							type="email"
							autoComplete="email"
							placeholder="alerts@better.giving"
						/>
						<FormRefusal errors={form.errors} />
					</Form>
					<footer className="ds-card-footer">
						<SettingsSave
							state={save}
							form={form.id}
							saveLabel="Save address"
							onDiscard={() => form.reset()}
						/>
					</footer>
				</section>
			</SettingsLayout>
		</>
	);
}
