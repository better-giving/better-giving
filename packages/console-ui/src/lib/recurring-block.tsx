import { Button } from '@better-giving/operator/components/controls/Button';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusLedger, StatusLine } from '@better-giving/operator/components/status/StatusLine';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import type { ReactNode } from 'react';
import type { PaymentProcessor, RecurringRead, RecurringSetup } from '../api/types';
import { noAnswer } from './processor-screen';
import type { RecurringRow } from './recurring-rows';
import {
	CADENCES,
	accountsOpening,
	accountsSaid,
	recurringRowOf,
	recurringRows
} from './recurring-rows';

// where one account stands on gifts that repeat, and the one press that changes it — drawn on each
// processor's own screen for that processor's account alone (./stripe-section.tsx,
// ./paypal-section.tsx).
//
// **the press is one press over every account, on both screens.** it posts an intent and nothing
// else, and the binary asks the deployment to set up every account that needs it
// (`POST /api/deployment/recurring` in packages/console/internal/server/errands.go names no
// processor to `deployment.SetUpRecurring`): a donor is offered
// a gift that repeats only where every configured processor can collect one (./recurring-rows.ts).
// so the sentence beside it names every account it would reach, and its outcome names every
// account it touched, whichever screen it was pressed on.
//
// the block stands inside the caller's own form: the Stripe screen's holds a second press beside
// this one.

/**
 * what the press that provisions repeating gifts posts.
 *
 * it survives the keys press on each screen because it is a different act and a cheaper one: the
 * item can be archived or deleted on the processor's dashboard long after a deployment is set up,
 * and asking the deployment to put it back costs a request where re-pasting the keys costs a
 * re-registration and a deploy.
 */
export const RECURRING_INTENT = 'recurring';

export type RecurringBlockInput = {
	processor: PaymentProcessor;
	/** the recurring read as the loader resolved it, or `null` where it was never taken. */
	gifts: RecurringRead | null;
	/** how the last repeating-gifts press went, or `null`. */
	provision: RecurringSetup | null;
	/** something else on the page is writing, which holds the press closed and its outcome back. */
	busy: boolean;
	/** a run on this screen is going, which holds the press closed as well. */
	working: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
};

/**
 * the block, or `null` where it has nothing to draw.
 *
 * a plain function rather than a component because the caller decides off its `null` whether the
 * form around it draws at all.
 *
 * **not set up is not a fault and is never drawn as one.** a deployment that only ever wants
 * one-time gifts is complete, so the lines take the note tone rather than attention.
 *
 * **a read that could not be made draws no lines**: it is the same read failing that the screen says
 * once above, among that account's other unreadable readings.
 */
export function recurringBlock({
	processor,
	gifts,
	provision,
	busy,
	working,
	pending
}: RecurringBlockInput): ReactNode | null {
	if (gifts === null) return null;
	if (gifts.kind === 'unread') {
		return noAnswer(gifts.read, "it can't say whether repeating gifts are set up");
	}
	/* the press's own outcome keeps the block on its own, because an outcome reports at the control
	   that caused it and the press that failed is very often the press whose next read fails too. it
	   is drawn last, under the press. */
	const outcome = busy ? null : provisionOutcome(provision);
	const row = recurringRowOf(gifts, processor);
	if (row === null && outcome === null) return null;
	const wanting = recurringRows(gifts)
		.filter((one) => one.standing === 'absent')
		.map((one) => one.account);
	return (
		<div className="adm-named">
			<h3>Recurring donations</h3>
			{row === null ? null : repeatingLines(row, wanting, busy || working, pending)}
			{outcome}
		</div>
	);
}

/**
 * one line per cadence, and the sentence and the press where the account stands short.
 *
 * both cadences stand on the one item, so both lines take the one standing, and what is said about
 * that standing and the press that changes it are drawn once under the pair rather than under each.
 * the account is named in no label: the block stands on that processor's own page, which already
 * says whose account it is.
 */
function repeatingLines(
	row: RecurringRow,
	wanting: readonly string[],
	closed: boolean,
	pending: string | null
): ReactNode {
	/* in a fundraiser's words — what has to be known is that a donor can ask to give again, and that
	   the account needs one item before that. the account is not named: the page already is. */
	const explains = `Recurring gifts are collected against one item on your account, and it has to exist before the first one is.`;

	if (row.standing === 'absent') {
		return (
			<>
				<StatusLedger>
					{CADENCES.map((cadence) => (
						<StatusLine
							key={cadence}
							labelAs="span"
							label={cadence}
							word="Not set up"
							tone="note"
						/>
					))}
				</StatusLedger>
				<p className="adm-prose">
					{row.press
						? `${explains} Setting it up adds that item to ${accountsSaid(wanting)}.`
						: explains}
				</p>
				{row.press ? (
					<div className="adm-actions">
						<Button
							type="submit"
							name="intent"
							value={RECURRING_INTENT}
							variant="primary"
							disabled={closed}
							aria-busy={pending === RECURRING_INTENT}
						>
							Set up recurring gifts
						</Button>
					</div>
				) : null}
			</>
		);
	}
	if (row.standing === 'archived') {
		// archived is neither set up nor missing, and the difference is what an operator has to be
		// told: the press would be refused, and the way out is on a screen this product does not
		// have.
		return (
			<>
				<StatusLedger>
					{CADENCES.map((cadence) => (
						<StatusLine
							key={cadence}
							labelAs="span"
							label={cadence}
							word="Archived"
							tone="attention"
						/>
					))}
				</StatusLedger>
				<p className="adm-prose">
					{`${explains} Yours is archived, so nothing can be collected against it. Unarchive it in the ${row.account} dashboard, under Product catalogue.`}
				</p>
			</>
		);
	}
	// the finished state, and the whole of it: the label says what repeats and the tick says the
	// account can take it. the word is stated and drawn nowhere — it is the mark's own name, so
	// a state a reader could only get from a shape still reaches somebody being read to.
	return (
		<StatusLedger>
			{CADENCES.map((cadence) => (
				<StatusLine
					key={cadence}
					labelAs="span"
					label={cadence}
					word="Set up"
					wordOnMark
					tone="done"
				/>
			))}
		</StatusLedger>
	);
}

/**
 * what the last repeating-gifts press did, drawn at the button that made it.
 *
 * **one press over every account, and the accounts are named rather than collected into a
 * number.** the press acts on each of them and one can refuse while another lands, so what an
 * operator is owed is which account is which: a sentence saying nothing was changed over a
 * press that changed one of the two would be the one thing on this screen that is not true.
 */
function provisionOutcome(provision: RecurringSetup | null): ReactNode {
	if (provision === null) return null;
	if (provision.kind === 'unanswered') return noAnswer(provision.read, 'nothing was set up');

	const report = provision.report;
	const failed = report.processors.filter((one) => one.outcome === 'failed');
	const landed = report.processors.filter((one) => one.outcome !== 'failed');

	if (failed.length > 0) {
		const detail = failed.find((one) => one.detail !== null)?.detail ?? null;
		return (
			<>
				<FieldMessage>
					This deployment could not set it up on {accountsSaid(failed.map((one) => one.label))}
					{landed.length === 0
						? ', and nothing was changed.'
						: `, and ${accountsSaid(landed.map((one) => one.label))} is set up.`}
				</FieldMessage>
				{detail === null ? null : (
					<p className="adm-prose">
						<MarkedText text={detail} />
					</p>
				)}
			</>
		);
	}

	// the two successes are drawn apart and both are the same finished state. an operator who
	// pressed the button and changed nothing is owed that — without it, a second press reads as a
	// second setup.
	const created = report.processors.filter((one) => one.outcome === 'set_up');
	return created.length > 0 ? (
		<Banner tone="done" word="Set up">
			{accountsOpening(created.map((one) => one.label))} can now collect gifts that repeat.
		</Banner>
	) : (
		<Banner tone="done" word="Already set up">
			{accountsOpening(report.processors.map((one) => one.label))} already had this, so nothing was
			changed.
		</Banner>
	);
}
