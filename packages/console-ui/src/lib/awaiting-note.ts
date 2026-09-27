import type {
	PaymentProcessor,
	PaymentsRead,
	PaypalSetup,
	RecurringRead,
	StripeSetup
} from '../api/types';
import { paymentsKeyless } from './processor-payments';
import { recurringKeyless, recurringReading } from './recurring-rows';

// what the line a run stopped on draws, where the stop was the deployment not holding the key the
// run had just stored — held against the page's latest reading rather than the run's.
//
// the binary already waited out `KeyBound` (packages/console/internal/deployment/keyed.go) before
// it answered `awaitingKey`, and it keeps the run across a reload, so the outcome outlives the moment
// it was true. what the line says is what the reading says now: the step it stopped on may have
// nothing left to do, may have one press left, or may still be waiting on the edge.
//
// **each outcome consults the one reading about its own step.** a repeating-gift stop is the
// recurring report's, a wallet stop is the payments report's — a stop drawn off the other reading
// would clear on an answer about something else.
//
// **a read that failed or was never made says nothing here.** the fold says so once where that read
// is drawn, and a note under the line would be a second sentence about a key no reading reported on.
//
// the module is here and not in the section for ./processor-payments.ts's reason: this package has
// no DOM pool (../../vite.config.ts).

/** a run outcome that can stop on a deployment still behind its own store. */
type Setup = StripeSetup | PaypalSetup;

/**
 * what the stopped line draws.
 *
 * - `done` — the step has nothing left to do: the line reads as a finished one and says nothing.
 * - `keyless` — the reading still reports no key: the line stays stopped, with the note saying so.
 * - `press` — the key landed and the step is still to do: stopped, and the note points at the press.
 * - `stopped` — anything else: stopped, and the block that holds the reading says the rest.
 */
export type AwaitingLine = 'done' | 'keyless' | 'press' | 'stopped';

/** whether the run stopped on the deployment not holding the key it had just stored. */
export const awaitsKey = (outcome: Setup): boolean =>
	(outcome.kind === 'unrepeating' || outcome.kind === 'uncovered') && outcome.awaitingKey;

/**
 * what the line this outcome stopped on draws, or `null` where it did not stop awaiting the key.
 *
 * **a wallet stop never reads `done` and never points at a press.** nothing in the payments reading
 * says the sites were registered since, so once the key lands the line stays as the run left it and
 * the wallet rows on the payments fold carry their own press.
 */
export function awaitingLine(
	processor: PaymentProcessor,
	outcome: Setup,
	payments: PaymentsRead | null,
	gifts: RecurringRead | null
): AwaitingLine | null {
	if (!awaitsKey(outcome)) return null;
	if (outcome.kind === 'uncovered') {
		return paymentsKeyless(payments, processor) ? 'keyless' : 'stopped';
	}
	if (recurringKeyless(gifts, processor)) return 'keyless';
	const reading = recurringReading(gifts, processor);
	if (reading?.state === 'ready') return 'done';
	// absent is the press ./recurring-block.tsx draws; archived and unreadable say their own way out.
	if (reading?.state === 'absent') return 'press';
	return 'stopped';
}

/**
 * whether the screen reads the deployment again after a run that stored a key.
 *
 * while both readings still report no key, which a screen draws nothing for, and while a stopped
 * line still draws its `keyless` note: in either case the next reading is the one that can change
 * what is on the screen.
 */
export function keepRereading(
	processor: PaymentProcessor,
	outcome: Setup | null,
	payments: PaymentsRead | null,
	gifts: RecurringRead | null
): boolean {
	const noted = outcome === null ? null : awaitingLine(processor, outcome, payments, gifts);
	if (noted === 'keyless') return true;
	return paymentsKeyless(payments, processor) && recurringKeyless(gifts, processor);
}
