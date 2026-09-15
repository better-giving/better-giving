import type { Tone } from '@better-giving/operator/components/closed-sets';
import type { PaymentProcessor, PaymentsRead, ProcessorPayments, RailStanding } from '../api/types';

// where one processor stands, taken out of the report that answers for every one of them, and what
// the standings under a rails reading are worth in words.
//
// **it is a module and not an expression in the fold**, for ./wallet-rows.ts's reason: this package
// has no DOM pool (../../vite.config.ts), so a reading written inside a component is one nothing
// here can hold. what it decides is the mistake the wire was shaped to make impossible — a
// processor this deployment holds no credentials for was asked nothing, and a screen that read that
// as a reading which came back empty would draw a fault on keys nobody has set.
//
// the two processors' sections draw one ledger each, so what a standing is called and what a ledger
// says over its rows are here rather than beside either of them: two records would be two
// vocabularies for one reading, a section apart.
//
// nothing here reaches a network.

/** the readings a processor this deployment can call answered with. */
export type ConfiguredPayments = Extract<ProcessorPayments, { state: 'configured' }>;

/**
 * where one processor stands, or `null` where there is no reading of it to draw.
 *
 * `null` covers the read nobody took and the deployment that answered nothing, which are two states
 * a caller already has to draw apart above this — what they have in common here is that neither
 * says anything about the account.
 */
export function processorStanding(
	read: PaymentsRead | null,
	processor: PaymentProcessor
): ProcessorPayments | null {
	if (read === null || read.kind !== 'read') return null;
	return read.report.processors.find((one) => one.processor === processor) ?? null;
}

/**
 * the readings a configured processor answered with, or `null` where it holds no credentials.
 *
 * **`null` here is not a failure and a screen may not draw it as one.** it is the deployment saying
 * nothing was asked, which is what the boxes under it are for.
 */
export const configuredStanding = (entry: ProcessorPayments | null): ConfiguredPayments | null =>
	entry?.state === 'configured' ? entry : null;

/**
 * one sentence the rows all carry, lifted out once, and the rows left with no note of it.
 *
 * lifted only where two or more rows carry a note and every one of those notes is the same string —
 * the deployment writes `CREDENTIALS_ONLY_NOTE` (packages/app/src/lib/server/forms/rail-notes.ts)
 * into every approved rail of a PayPal account, and under each row it is one long sentence read
 * twice. a row with no note neither joins nor breaks the match. notes that differ, or a single noted
 * row, come back exactly as they arrived, since there each note is about its own row.
 */
export const hoistSharedNote = <Row extends { readonly note: string | null }>(
	rows: readonly Row[]
): { shared: string | null; rows: readonly Row[] } => {
	const notes = rows.flatMap((row) => (row.note === null ? [] : [row.note]));
	const [first] = notes;
	if (notes.length < 2 || notes.some((note) => note !== first)) return { shared: null, rows };
	return { shared: first ?? null, rows: rows.map((row) => ({ ...row, note: null })) };
};

/**
 * what each standing is called on the page and how loudly it is said.
 *
 * **named for approval and never for outcome.** an approved rail is a necessary condition and never
 * a sufficient one — a real gift still fails on the currency, the amount, or where the donor's bank
 * is — so no word here may be read as saying a way of paying will work. `Approved` rather than
 * `Ready` for exactly that reason.
 *
 * the four that are somebody's to fix are told apart rather than collapsed, because they send an
 * operator to four different places: waiting, a requirement on the processor's dashboard, asking for
 * the rail in the first place, and one switch. the sentence under each says which, and it is the
 * deployment's own.
 */
export const STANDING: Record<RailStanding, { word: string; tone: Tone }> = {
	approved: { word: 'Approved', tone: 'done' },
	in_review: { word: 'Being reviewed', tone: 'note' },
	not_approved: { word: 'Not usable yet', tone: 'attention' },
	never_requested: { word: 'Not asked for', tone: 'attention' },
	switched_off: { word: 'Switched off', tone: 'attention' },
	account_cannot_charge: { word: 'Blocked', tone: 'blocker' }
};
