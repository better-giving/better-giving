import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Section } from '@better-giving/operator/components/shell/Layout';
import type { ReactNode } from 'react';
import type { AddressRead, DeployedValues, NoReport, ValuesRefusal } from '../api/types';
import { Said } from './said';
import { secretTrouble } from './secret-trouble';
import { unreadAnswer } from './unread-answer';

// what both processor screens say in the same words (./stripe-section.tsx, ./paypal-section.tsx):
// a values read that did not land, a deployment that answered no report, and a refused write of
// their keys. one module, so the two screens cannot come to word one state two ways.

type Scope = { workerName: string; accountName: string };

/**
 * what a processor screen draws in place of itself where the values read did not land, or `null`
 * where it did.
 *
 * no box where the read did not land: a press is decided against that read and goes through the
 * same sign-in, so a read that was refused is a press that would be.
 */
export function valuesGuard(
	read: DeployedValues['vars'],
	{ workerName, accountName }: Scope
): ReactNode | null {
	if (read.kind === 'read') return null;
	if (read.kind === 'not-deployed') {
		// this screen is drawn over a deployment that answered a moment ago, so the Worker went between
		// that reading and this one. the way out is the page read again, which draws the state it is
		// actually in rather than boxes over something that is not there.
		return (
			<Section>
				<p className="adm-prose">
					No Worker called {workerName} is in {accountName} any more, so there is nothing holding
					these. Reload this page.
				</p>
			</Section>
		);
	}
	return (
		<Section>
			<p className="adm-prose">
				{read.kind === 'refused' ? (
					`Cloudflare won't tell this sign-in what ${accountName} is holding.`
				) : read.kind === 'no-credential' ? (
					<>
						This machine isn&rsquo;t signed in to Cloudflare any more, so nothing here could be
						read. Close the console and run <InlineCode>better-giving start</InlineCode> again to
						sign in.
					</>
				) : read.kind === 'unreachable' ? (
					"Cloudflare didn't answer, so nothing was found out either way."
				) : (
					"Cloudflare answered in a way this console couldn't read."
				)}
			</p>
			<Said answer={read} />
		</Section>
	);
}

/**
 * a read or a press the deployment answered no report to.
 *
 * these say to reload rather than offering a press of their own: a processor screen is reached from
 * the one face that already holds a session, so a deployment that stopped answering between the page
 * load and the press is a page whose next reading is the gate — which draws the press each of these
 * states needs, the connect for a session and the update for a surface (../routes/_index.tsx).
 */
export const noAnswer = (read: NoReport, what: string): ReactNode => (
	<>
		<FieldMessage>
			{read.kind === 'no-session'
				? `This console is no longer connected to this deployment, so ${what}. Reload this page and connect again.`
				: read.kind === 'refused'
					? `This deployment turned this console session down, so ${what}. Reload this page and connect again.`
					: read.kind === 'no-surface'
						? `Something is deployed at that address and it isn't answering this console, so ${what}. It is either older than this console or not this deployment at all. Reload this page and the update press is on it.`
						: read.kind === 'unreachable'
							? `The console couldn't get an answer out of this deployment, so ${what}. Check this machine's internet connection, then reload.`
							: unreadAnswer(what)}
		</FieldMessage>
		{read.kind === 'unreachable' || read.kind === 'unreadable' ? <Said answer={read} /> : null}
	</>
);

/**
 * how a refused write of a processor's values went, at the button that made it.
 *
 * the same reader every other refused credentials write on this surface uses (./secret-trouble.tsx),
 * because it is the same one call refused by the same three states of the same account. `nowhere`
 * is the arm written here: a write reaches no processor, so a sentence about registering would name
 * an errand nobody asked for.
 */
export const keysTrouble = ({
	workerName,
	accountName
}: Scope): ((written: ValuesRefusal) => ReactNode) =>
	secretTrouble({
		workerName,
		accountName,
		nowhere: (read: AddressRead) =>
			read.kind === 'not-deployed' ? (
				<FieldMessage>
					No Worker called {workerName} is in {accountName} any more, so there was nothing to take
					these off. Reload this page.
				</FieldMessage>
			) : read.kind === 'deployed' ? (
				<FieldMessage>
					This deployment answers on no address at all, so there was nowhere to reach it. Nothing
					was taken away. Turn its <InlineCode>workers.dev</InlineCode> address back on, or attach a
					domain, then press again.
				</FieldMessage>
			) : (
				<>
					<FieldMessage>
						The console couldn't work out where this deployment answers, so nothing was taken away.
					</FieldMessage>
					<Said answer={read} />
				</>
			)
	});
