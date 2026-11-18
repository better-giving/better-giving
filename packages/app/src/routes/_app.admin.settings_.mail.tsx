import { Button } from '@better-giving/operator/components/controls/Button';
import { CodeSlab } from '@better-giving/operator/components/data/CodeSlab';
import { Field } from '@better-giving/operator/components/forms/Field';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { SettingsLayout } from '@better-giving/operator/components/shell/SettingsLayout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { EMAIL, MAX_EMAIL, REQUIRED } from '@better-giving/operator/console/org-rules';
import type { TestSendReport } from '@better-giving/operator/console/test-send';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { getFormProps } from '@conform-to/react';
import { useFetcher } from 'react-router';
import { z } from 'zod';
import { ScreenHeading } from '$lib/admin/crumbs';
import { screenTitle } from '$lib/admin/screen-title';
import { marked } from '$lib/admin/settings/settings-card';
import { formPress } from '$lib/admin/unreached';
import { useAdminForm, whichForm } from '$lib/admin/use-admin-form';
import { defineForm, type FormRejection } from '$lib/forms/definition';
import { STAFF_USER_ID } from '$lib/server/auth';
import { readConfigEnv } from '$lib/server/config/env';
import { readSetupState } from '$lib/server/config/setup-state';
import { invalid, parseForm, submittedForm } from '$lib/server/conform';
import { loadFailed, notFound } from '$lib/server/db/load-failure';
import { mailDelivers } from '$lib/server/email/delivers';
import { createEmailProvider } from '$lib/server/email/factory';
import { sendTestEmail } from '$lib/server/email/test-send';
import { database, platform, staff } from '../context';
import type { Route } from './+types/_app.admin.settings_.mail';

// what this deployment sends with. **mail is the deployment's `.env` and nothing here writes it.**
// the card states the sender and the host, never the username or the password. values present is
// the setup reading's `smtp` line ($lib/server/config/readiness.ts); whether anything is delivered
// is `mailDelivers` ($lib/server/email/delivers.ts), which is false for the placeholders
// `.env.example` ships. the test send answers on this screen through a fetcher, since it writes
// nothing and an outcome is all it has to report, so the card has no save row.
//
// **only the deployer's session reaches this page**, the predicate ./_app.admin.members.tsx reads —
// `context.get(staff).id === STAFF_USER_ID` — read by the loader and by the action alike. a
// member's GET and POST are answered with not-found, before the body is read.

const SCREEN_TITLE = 'Mail';

/** the body of a member's not-found. the page the layout draws does not show it; an agent reads it. */
const NOT_HERE =
	'No page at /admin/settings/mail for a member’s session. The mail check is the deployer’s: ' +
	'sign in with `ADMIN_PASSWORD` at /login.';

const TEST_EMAIL_FORM_ID = 'settings-test-email';

/** what a test destination that is not one address is told. */
const NOT_AN_ADDRESS = 'That is not an address this deployment can send to. Nothing was sent.';

/**
 * the test send's destination. the caller's own and not the organisation's row, so a mail host is
 * checked against an inbox somebody is watching ($lib/server/email/test-send.ts).
 */
const TEST_EMAIL_FORM = defineForm({
	id: TEST_EMAIL_FORM_ID,
	schema: z.object({
		to: z
			.string({ error: REQUIRED })
			.trim()
			.max(MAX_EMAIL, { error: NOT_AN_ADDRESS })
			.regex(EMAIL, { error: NOT_AN_ADDRESS })
	})
});

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context }: Route.LoaderArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const env = context.get(platform).env;
	const state = await readSetupState(context.get(database), env);
	if (state === null) loadFailed('Settings');

	const config = readConfigEnv(env);
	const mailSet = state.lines.find((line) => line.id === 'smtp')?.state === 'ready';
	return {
		// the test send's box is seeded with it.
		notificationEmail: state.profile?.notificationEmail ?? null,
		mail: mailSet
			? { from: config.MAIL_FROM ?? '', host: config.SMTP_HOST ?? '', delivers: mailDelivers(env) }
			: null
	};
}

/**
 * the test message, over this request's own transport. a send that did not go is the form's
 * refusal carrying the port's sentence, which names the value to set; nothing is written either way.
 * **the request body is read exactly once, here** — and not at all for a member.
 */
export async function action({ context, request }: Route.ActionArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const body = await request.formData();
	submittedForm(body, [TEST_EMAIL_FORM_ID]);
	const submission = parseForm(body, TEST_EMAIL_FORM);
	if (!submission.ok) return invalid(400, submission.reject());

	const mail = createEmailProvider(context.get(platform).env);
	const testSend = await sendTestEmail({
		to: submission.value.to,
		send: (message) => mail.send(message)
	});
	if (testSend.outcome === 'sent') return { testSend };
	const formErrors = testSend.detail === null ? [] : [testSend.detail];
	return invalid(500, submission.reject({ formErrors }), { testSend });
}

/**
 * a press whose request never reached the server, answered in the browser as the form's refusal
 * rather than with the error boundary ($lib/admin/unreached.ts).
 */
export function clientAction({ request, serverAction }: Route.ClientActionArgs) {
	return formPress(request, serverAction);
}

export default function Mail({ loaderData }: Route.ComponentProps) {
	const { mail, notificationEmail } = loaderData;
	return (
		<>
			<ScreenHeading title={SCREEN_TITLE} />
			<SettingsLayout>
				<section className="ds-card" aria-labelledby="settings-mail-title">
					<header className="ds-card-header">
						<h2 id="settings-mail-title">Mail</h2>
					</header>
					<div className="ds-card-body adm-stack">
						{mail === null ? (
							<MailUnset />
						) : (
							<>
								{mail.delivers ? null : <MailPlaceholders />}
								<MailSet mail={mail} to={notificationEmail} />
							</>
						)}
					</div>
				</section>
			</SettingsLayout>
		</>
	);
}

/** the command both mail banners hand whoever runs the server. */
const RECREATE_APP = 'docker compose up -d --force-recreate app';

/**
 * the card with no mail values, one banner in two parts for two readers: the staff sentence, and
 * under it the steps for whoever runs the server, since no box on this screen sets a mail value.
 */
function MailUnset() {
	return (
		<Banner
			tone="attention"
			word="Receipts aren’t being sent"
			body={
				<>
					<h3 className="adm-banner__head">For whoever runs the server</h3>
					<p>
						<MarkedText text="Add the mail values to `.env` (DEPLOY.md, Mail), then recreate the app:" />
					</p>
					<CodeSlab oneline content={RECREATE_APP} copyable copyLabel="Copy the command" />
				</>
			}
		>
			Donors get no receipt and you get no notice of their gifts until mail is set up. Ask whoever
			set up this site to add it. The steps below are for them.
		</Banner>
	);
}

/**
 * the banner when the mail values are still the placeholders `.env.example` ships. the pair under
 * it stays, so the operator can see the values; nothing is delivered until they are replaced.
 * the steps below are for whoever set the site up.
 */
function MailPlaceholders() {
	return (
		<Banner
			tone="attention"
			word="Receipts aren’t being sent"
			body={
				<>
					<h3 className="adm-banner__head">For whoever runs the server</h3>
					<p>
						<MarkedText text="Replace the placeholders from `.env.example`, then recreate the app:" />
					</p>
					<CodeSlab oneline content={RECREATE_APP} copyable copyLabel="Copy the command" />
				</>
			}
		>
			<MarkedText text="These are still the placeholders from `.env.example`. Nothing is delivered until they are replaced and the app is recreated." />{' '}
			Ask whoever set up this site to replace them. The steps below are for them.
		</Banner>
	);
}

/** what a test send's fetcher is answered with: the outcome, and the form's refusal where it failed. */
type TestAnswer = { readonly form?: FormRejection; readonly testSend?: TestSendReport };

type MailValues = NonNullable<Route.ComponentProps['loaderData']['mail']>;

function MailSet({ mail, to }: { readonly mail: MailValues; readonly to: string | null }) {
	const fetcher = useFetcher<TestAnswer>();
	const [form, fields] = useAdminForm(TEST_EMAIL_FORM, fetcher.data, {
		defaultValue: { to: to ?? '' }
	});
	const sending = fetcher.state !== 'idle';
	// the answer to the last press, and nothing while the next one is away: the outcome of the send,
	// or, for a press that never reached the server, the form's refusal saying so.
	const report = sending ? undefined : fetcher.data?.testSend;
	const unsent = sending || report !== undefined ? undefined : form.errors?.[0];

	return (
		<>
			<div className="adm-pair adm-pair--side">
				<StatedValue label="Sends from" value={mail.from} />
				<StatedValue label="Mail host" value={mail.host} />
			</div>
			{mail.delivers ? (
				<p className="adm-hint">Receipts to donors and notices to you go out from this address.</p>
			) : null}
			<fetcher.Form method="post" {...getFormProps(form)}>
				<input {...whichForm(TEST_EMAIL_FORM.id)} />
				<Field
					{...marked(fields.to)}
					label="Send a test email to"
					hint="Nothing is recorded and no donor hears about it."
					type="email"
					beside={
						// held with `aria-disabled` rather than `disabled`, so the focus stays on the press: one
						// press is one message.
						<Button
							type="submit"
							aria-busy={sending || undefined}
							aria-disabled={sending || undefined}
							onClick={(event) => {
								if (sending) event.preventDefault();
							}}
						>
							Send test email
						</Button>
					}
				/>
			</fetcher.Form>
			{/* mounted in every state, so the sentence arriving in it is a change a reader is told. */}
			<p className="adm-hint adm-sendnote" role="status">
				{report?.outcome === 'sent' ? 'Sent. Check that inbox for it.' : null}
			</p>
			{report?.outcome === 'failed' ? (
				<>
					<Banner tone="blocker" word="Nothing was sent">
						This deployment could not hand the message to its mail host.
					</Banner>
					{report.detail === null ? null : (
						<p className="adm-prose">
							<MarkedText text={report.detail} />
						</p>
					)}
				</>
			) : unsent === undefined ? null : (
				<Banner tone="blocker" word="Nothing was sent">
					<MarkedText text={unsent} />
				</Banner>
			)}
		</>
	);
}
