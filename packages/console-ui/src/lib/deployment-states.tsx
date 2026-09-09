import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Said } from './said';
import type { NoReport } from '../api/types';
import { unreadAnswer } from './unread-answer';

// the five ways a deployment does not answer, drawn the same on every screen that asks it something.
//
// one reader rather than one per screen, because the five are not this screen's or that one's: a
// read that could not be made and a write that could not be made fail in exactly the same ways —
// the session, the surface, the route to it — and each of those has one way out that does not
// change with what was being asked. what does change is what this particular request cost, which is
// `what`.
//
// it is a component and not vocabulary, so it sits beside the folds that draw it rather than beside
// the reading it is about: the answer it draws is classified in the binary
// (`packages/console/internal/deployment/report.go`) and arrives as `NoReport` in ../api/types.ts.
//
// **a refusal is drawn whole.** the deployment writes two sentences a reader reads, and the second
// is the only thing on a screen that says how to get out of the state the console is in. neither is
// shortened here and neither is rewritten — `packages/console/internal/deployment/report.go` states
// that rule and this is where it is kept. both are drawn through `MarkedText`
// (`@better-giving/operator/marked-text.react`), because a deployment marks the variable name and
// the command in them with paired backticks and a sentence printed raw shows an operator the marks.

/**
 * where the connect control is, for a screen that is not the one it is on.
 *
 * one phrase for the screens that say it, so where the control lives is written once. the console
 * is one page and the control is on the face that page draws when a deployment is up and will not
 * answer this console (../routes/_index.tsx), which is exactly the state a screen saying this is
 * in. that page passes its own phrase instead: a page linking to a section of itself is not an
 * answer to where something is.
 */
export const CONNECT_ELSEWHERE: ReactNode = (
	<>
		on <Link to="/">the console page</Link>
	</>
);

/**
 * why the deployment answered with nothing, in the read's own terms.
 *
 * `what` is what this request cost, written to follow "so": _nothing was saved_, _there is nothing
 * to edit here yet_. it is a sentence fragment rather than a heading because it lands inside three
 * different sentences below.
 *
 * `where` is where the connect control is, as a phrase following "Connect it" — _on Status_
 * from a screen that is somewhere else, _under Console session below_ on the screen the control is
 * on. this cannot tell which screen drew it, and a page linking to a section of itself is not an
 * answer to where something is, so the caller states it.
 *
 * the last of the five is a hand-drawn refusal and announces: the live region is written here
 * rather than taken from the shared `Field` (`@better-giving/operator/components/forms/Field`)
 * because `Field` draws its region only under the box it labels, and what this answers is a press
 * of a submit button or a read a screen made on arrival — neither of which has a box for it to hang
 * one off. a section that draws nothing but this on arrival is one a reader is otherwise never told
 * about.
 */
export function WhyNot({
	answer,
	what,
	where
}: {
	answer: NoReport;
	what: string;
	where: ReactNode;
}): ReactNode {
	if (answer.kind === 'no-session') {
		return (
			<p className="adm-prose">
				This console isn't connected to your deployment, so {what}. Connect it {where}.
			</p>
		);
	}

	if (answer.kind === 'refused') {
		return (
			<>
				<Banner tone="blocker" word="This deployment turned this console away">
					{answer.message === null ? (
						'It refused this console session and said nothing this console could read.'
					) : (
						<MarkedText text={answer.message} />
					)}
				</Banner>
				{answer.fix === null ? null : (
					<p className="adm-prose">
						<MarkedText text={answer.fix} />
					</p>
				)}
				<p className="adm-hint">
					Connect again {where}, and {what}.
				</p>
			</>
		);
	}

	if (answer.kind === 'no-surface') {
		return (
			<Banner tone="blocker" word="Nothing answers there">
				Something is deployed at that address and it isn't answering this console, so it is either
				older than this console or not this deployment at all. Reload this page and the press that
				updates it is on the gate. Until then {what}.
			</Banner>
		);
	}

	return (
		<>
			<FieldMessage>
				{answer.kind === 'unreachable'
					? `The console couldn't get an answer out of this deployment, so ${what}. Check this machine's internet connection, then try again.`
					: unreadAnswer(what)}
			</FieldMessage>
			<Said answer={answer} />
		</>
	);
}

/**
 * the one way a console screen learns the console itself has stopped: a request it cannot reach the
 * local process with at all.
 *
 * without it the operator meets react router's own error page, which says nothing about the
 * terminal the fix is in. the same words wherever it is met, because it is the same failure.
 *
 * **the words are the operator's own command and never a script.** this page is served by the
 * binary they ran, so what starts it again is that binary — a repository script names a checkout
 * they do not have.
 *
 * no retry control: the fix is in a terminal, and a button that cannot reach the thing it would
 * retry is a second refusal. no reload either: `better-giving start` opens a page of its own, so an
 * operator told to reload this one is being asked for a step the command already took.
 */
export function ConsoleStopped(): ReactNode {
	return (
		<Banner tone="blocker" word="The console has stopped">
			This page can't reach the console any more. Run <InlineCode>better-giving start</InlineCode>{' '}
			again. It opens a fresh page.
		</Banner>
	);
}

/**
 * the console closed because the operator asked it to, which is the same page with nothing wrong.
 *
 * the note tone and never the blocker one beside it: nothing failed, nothing is being held up, and
 * the operator already knows what they pressed — what this page is for is the tab they are left
 * looking at, because the run was ended from inside a browser the binary cannot close.
 *
 * it names the same command ./ConsoleStopped does, because it is the same errand: `start` opens the
 * console, and it also stands the deployment up where there is none — so the two banners a couple of
 * presses apart do not send an operator to two different commands.
 */
export function ConsoleClosed(): ReactNode {
	return (
		<Banner tone="note" word="The console is closed">
			Run <InlineCode>better-giving start</InlineCode> to open it again. This tab can be closed.
		</Banner>
	);
}
