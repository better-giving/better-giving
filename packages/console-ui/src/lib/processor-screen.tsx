import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import type { ReactNode } from 'react';
import type { AddressRead, NoReport, ValuesRefusal } from '../api/types';
import { Refusal, Said } from './said';
import { secretTrouble } from './secret-trouble';
import { readableRefusal, unreadAnswer } from './unread-answer';

// what both processor screens say in the same words (./stripe-section.tsx, ./paypal-section.tsx):
// a deployment that answered no report, and a refused write of their keys. one module, so the two screens cannot come to word one state two ways.

type Scope = { workerName: string; accountName: string };

/**
 * a read or a press the deployment answered no report to.
 *
 * these say to reload rather than offering a press of their own: a processor screen is reached from
 * the one face that already holds a session, so a deployment that stopped answering between the page
 * load and the press is a page whose next reading is the gate at `/` (../routes/_sections.tsx's
 * loader sends it there) — which draws the press each of these states needs, the connect for a
 * session and the update for a surface (../routes/_index.tsx). a refusal the deployment wrote on
 * purpose is the one arm that says neither: it was read, and its own words say what to change.
 */
export const noAnswer = (read: NoReport, what: string): ReactNode => {
	const refusal = readableRefusal(read);
	if (refusal !== null) return <Refusal refusal={refusal} />;
	return (
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
};

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
