import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { FOLD_LABELS } from '@better-giving/operator/setup-folds';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { freeWithheldVars, sendTestEmail } from '../api/client';
import { consoleRereads } from '../lib/dialog-params';
import { groupPress } from '../lib/group-press';
import { SmtpFold, TEST_EMAIL_INTENT } from '../lib/smtp-fold';
import { TEST_TO_FIELD } from '../lib/smtp-fold-state';
import { usePress } from '../lib/use-press';
import { FREE_INTENT } from '../lib/withheld-values';
import { TITLE } from './_index';
import type { Route } from './+types/_sections.smtp';

// /smtp — what carries this deployment's mail out, receipts included, drawn by
// ../lib/smtp-fold.tsx.
//
// every reading is the sections layout's (./_sections.tsx); the presses are this page's.

export function meta(): Route.MetaDescriptors {
	return [{ title: `${FOLD_LABELS.smtp} · ${TITLE}` }];
}

export async function clientAction({ request }: Route.ClientActionArgs) {
	const posted = await request.formData();
	const intent = posted.get('intent');

	/** the mail group's press, read against the enumeration (../lib/group-press.ts). */
	const group = await groupPress(intent, posted);
	if (group !== null) return group;

	/**
	 * asks the deployment to send a test message to the address in the box beside the button.
	 *
	 * the only press on this console that reaches the deployment's own mail transport, and it is the
	 * deployment's because it has to be: the message goes out over its own SMTP credentials, which
	 * this console does not hold and must not acquire. the destination is the one thing posted with
	 * it, and it is the operator's — a mail host is only checked by an inbox somebody is watching.
	 * what an address may be is the deployment's rule and is not read here.
	 */
	if (intent === TEST_EMAIL_INTENT) {
		const to = posted.get(TEST_TO_FIELD);
		return { test: await sendTestEmail(typeof to === 'string' ? to : '') };
	}

	/**
	 * takes every value this deployment is holding in a form nothing can read back off it. which
	 * names are freed is read inside the binary off cloudflare's own answer and never posted.
	 */
	if (intent === FREE_INTENT) return { freed: await freeWithheldVars() };

	return { unknown: true as const };
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	return consoleRereads(args);
}

export default function SmtpPage({ actionData, matches }: Route.ComponentProps) {
	const shell = matches[1].loaderData;
	const { intent } = usePress();
	return (
		<Column>
			<PageHeader title={FOLD_LABELS.smtp} />
			<SmtpFold
				values={shell.reading.values}
				workerName={shell.workerName}
				accountName={shell.account}
				// the profile, because the test send is seeded from the notification address rather
				// than from a value of its own.
				stored={shell.reading.stored}
				secrets={actionData && 'secrets' in actionData ? actionData.secrets : null}
				freed={actionData && 'freed' in actionData ? actionData.freed : null}
				test={actionData && 'test' in actionData ? actionData.test : null}
				pending={intent}
			/>
		</Column>
	);
}
