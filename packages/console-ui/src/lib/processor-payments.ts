import type { Tone } from '@better-giving/operator/components/closed-sets';
import type {
	PaymentProcessor,
	PaymentsRead,
	ProcessorPayments,
	RailEvidence,
	RailStanding
} from '../api/types';

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
 * the endpoint this release registers on nobody's behalf: the deployment's own sentence about it,
 * and the address an operator points one at. `null` on every other arm.
 *
 * the two travel together because neither stands without the other — the sentence is what says
 * nothing is wrong, and the address is the whole of what an operator does about it. no hostname is
 * committed to this repository (CLAUDE.md), so this arm is the only place either surface ever
 * learns it.
 */
export function unmanagedEndpoint(
	entry: ProcessorPayments | null
): { readonly detail: string; readonly address: string } | null {
	const configured = configuredStanding(entry);
	if (configured === null || configured.subscription.state !== 'unmanaged') return null;
	return { detail: configured.subscription.detail, address: configured.subscription.address };
}

/**
 * the sentence over a rails ledger, or `null` where the rows already carry it.
 *
 * **two processors report `Approved` and it means two different things, so what is said over a
 * ledger is decided off the evidence rather than off the ledger.** where the processor publishes an
 * approval per rail the word is that approval read back, the rows themselves say nothing under it
 * (`STANDING_NOTE.approved` in packages/app/src/lib/server/forms/rail-notes.ts), and this is the
 * only place the ledger can say what an approval is not.
 *
 * **`credentials_only` says it under every row instead, so nothing is said over them.** there the
 * word means the credentials authenticated and nothing whatever about the rail beside it, and the
 * deployment writes that sentence as the note on each such rail — so a paragraph here would be the
 * same sentence a third time on one screen, over rows that are already carrying it.
 *
 * keyed by `RailEvidence` and not by processor, because that is the fact the deployment answers
 * with: a console picking the sentence off a processor's name is a second list to keep level.
 */
export const EVIDENCE_SAYS: Record<RailEvidence, string | null> = {
	per_rail_approval:
		"Approved is Stripe's permission and not a promise. A gift can still be refused over the currency, the amount, or the donor's own bank.",
	credentials_only: null
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
