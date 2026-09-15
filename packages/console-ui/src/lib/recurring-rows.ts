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
 * the lines the repeating-gifts block draws, one per cadence.
 *
 * cadences rather than a product name: what a fundraiser has to know is that a donor can ask to
 * give again every month or every year, and the single item a processor collects it against is the
 * mechanism under that. both stand on that one item, so they always share a standing.
 */
export const CADENCES = ['Monthly', 'Yearly'] as const;

/** one account's standing, and whether the press stands on it. */
export type RecurringRow = {
	readonly processor: PaymentProcessor;
	/** what an operator is shown that processor as, which the deployment decides. */
	readonly account: string;
	readonly standing: RecurringStanding;
	/** whether the one press stands on this line. */
	readonly press: boolean;
};

/**
 * one entry per account this deployment can reach and has a standing for.
 *
 * **an account whose read could not be made draws no line.** it is the same read failing that the
 * fold says once above the boxes, and a row here would be the same sentence in two places with two
 * places to look for the one that names what to do.
 *
 * the press stands on the first account holding nothing, and on no other: it acts on every one of
 * them, so a second control would be a second way to do the one thing.
 */
export function recurringRows(read: RecurringRead | null): RecurringRow[] {
	const held = read !== null && read.kind === 'read' ? read.report.processors : [];

	let pressed = false;
	return held.flatMap((entry): RecurringRow[] => {
		if (entry.reading.state === 'unreadable') return [];
		const press = !pressed && entry.reading.state === 'absent';
		pressed = pressed || press;
		return [
			{
				processor: entry.processor,
				account: entry.label,
				standing: entry.reading.state,
				press
			}
		];
	});
}

/**
 * one account's standing on that processor's own screen, or `null` where it draws none.
 *
 * **pressed as the list presses it, with one difference: the press stands on this account wherever
 * it needs it.** the press acts on every account that needs it, so a
 * screen showing one account's line puts the one press there whether or not another account's line,
 * on another screen, would have carried it first.
 */
export function recurringRowOf(
	read: RecurringRead | null,
	processor: PaymentProcessor
): RecurringRow | null {
	const row = recurringRows(read).find((one) => one.processor === processor);
	return row === undefined ? null : { ...row, press: row.standing === 'absent' };
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
