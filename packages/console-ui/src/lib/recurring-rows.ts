import type {
	PaymentProcessor,
	ProcessorRecurring,
	RecurringRead,
	RecurringReading,
	RecurringStanding
} from '../api/types';

// the lines the repeating-gifts block draws, taken out of the report that answers for every account
// this deployment can reach.
//
// **it is a module and not an expression in the fold**, for ./processor-payments.ts's reason: this
// package has no DOM pool (../../vite.config.ts), so a reading written inside a component is one
// nothing here can hold. what it decides is which account a standing is about and where the one
// press stands — and a line that named the wrong account would send an operator to a dashboard they
// hold no account on.
//
// **one press over every account, and that is the product decision rather than a convenience.** a
// donor is offered a gift that repeats only where every configured processor can collect one, so an
// account set up on its own moves nothing a donor can see and a control offering that choice would
// be offering a state that helps nobody.
//
// nothing here reaches a network.

/**
 * what the repeating-gifts line is called.
 *
 * a cadence rather than a product name: what a fundraiser has to know is that a donor can ask to
 * give again every month or every year, and the single item a processor collects it against is the
 * mechanism under that.
 */
export const RECURRING_LABEL = 'Monthly and yearly';

/** one account's line: what it is called, where it stands, and whether the press stands on it. */
export type RecurringRow = {
	readonly processor: PaymentProcessor;
	/** what an operator is shown that processor as, which the deployment decides. */
	readonly account: string;
	/**
	 * the name on the line.
	 *
	 * the cadence alone where this deployment holds one account — the block's own heading says what
	 * the subject is, and naming the account there would be a distinction with nothing on the other
	 * side of it — and the cadence under the account's name where it holds more, or neither line
	 * says which account it is about.
	 */
	readonly label: string;
	readonly standing: RecurringStanding;
	/** whether the one press stands on this line. */
	readonly press: boolean;
};

/**
 * one line per account this deployment can reach and has a standing for.
 *
 * **an account whose read could not be made draws no line.** it is the same read failing that the
 * fold says once above the boxes, and a row here would be the same sentence in two places with two
 * places to look for the one that names what to do.
 *
 * **and it still counts for how the other lines are named**, because what decides that is how many
 * accounts this deployment holds rather than how many answered.
 *
 * the press stands on the first account holding nothing, and on no other: it acts on every one of
 * them, so a second control would be a second way to do the one thing.
 */
export function recurringRows(read: RecurringRead | null): RecurringRow[] {
	const held = read !== null && read.kind === 'read' ? read.report.processors : [];
	const named = held.length > 1;

	let pressed = false;
	return held.flatMap((entry): RecurringRow[] => {
		if (entry.reading.state === 'unreadable') return [];
		const press = !pressed && entry.reading.state === 'absent';
		pressed = pressed || press;
		return [
			{
				processor: entry.processor,
				account: entry.label,
				label: named ? `${RECURRING_LABEL} on ${entry.label}` : RECURRING_LABEL,
				standing: entry.reading.state,
				press
			}
		];
	});
}

/**
 * what one account answered, or `null` where this deployment holds no key for it.
 *
 * **`null` is not a failure and a screen may not draw it as one.** it is the deployment reporting a
 * standing only for the accounts it can reach, which is what the boxes under it are for — and it is
 * what the fold waits on while a stored key reaches the edge.
 */
export function recurringReading(
	read: RecurringRead | null,
	processor: PaymentProcessor
): RecurringReading | null {
	if (read === null || read.kind !== 'read') return null;
	const entry: ProcessorRecurring | undefined = read.report.processors.find(
		(one) => one.processor === processor
	);
	return entry?.reading ?? null;
}

/**
 * the accounts a sentence is about, in a fundraiser's words.
 *
 * written once and read by every sentence in the block, because the alternative is each of them
 * naming Stripe and quietly being wrong on the deployment that holds PayPal.
 */
export function accountsSaid(accounts: readonly string[]): string {
	return accounts.length > 1
		? `your ${accounts.slice(0, -1).join(', ')} and ${accounts[accounts.length - 1]} accounts`
		: `your ${accounts[0]} account`;
}

/**
 * the same phrase where it opens a sentence.
 *
 * a second reader rather than a capital written at the call site, because the phrase is built here
 * and a sentence starting with a lowercase `your` is the sort of thing every gate on this package
 * passes.
 */
export function accountsOpening(accounts: readonly string[]): string {
	const said = accountsSaid(accounts);
	return said.charAt(0).toUpperCase() + said.slice(1);
}
