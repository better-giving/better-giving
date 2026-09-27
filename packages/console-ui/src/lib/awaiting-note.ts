import type {
	PaymentProcessor,
	PaymentsRead,
	PaypalSetup,
	RecurringRead,
	StripeSetup
} from '../api/types';
import type { Rereading } from './key-rereads';
import { configuredStanding, paymentsKeyless, processorStanding } from './processor-payments';
import { recurringKeyless, recurringRowOf } from './recurring-rows';
import { sitesCovered } from './wallet-rows';

// what each line of a processor's run ledger reads — its word, its tone, whether it is lit and
// whether its steps are open — and the note under the line a run stopped on while the deployment was
// still behind the key it had just stored. both processor screens draw their ledger off this and
// decide nothing about a line themselves.
//
// the binary already waited out `KeyBound` (packages/console/internal/deployment/keyed.go) before
// it answered `awaitingKey`, and it keeps the run across a reload, so the outcome outlives the moment
// it was true. what a stopped line says is what the page's latest reading says now: the step it
// stopped on may have nothing left to do, or may still be waiting on the edge.
//
// **each line consults the one reading about its own subject.** the repeating-gift line is the
// recurring report's, the wallet line is the payments report's — a line drawn off the other reading
// would clear on an answer about something else.
//
// **a line the run never reached is not one it did.** once the run is over it reads `Not ran`, or
// `Done` where the reading shows that thing in place anyway — and either way its steps stay shut,
// because none of them was this run's.
//
// **a read that failed or was never made says nothing here.** the fold says so once where that read
// is drawn, and a note under the line would be a second sentence about a key no reading reported on.
//
// the module is here and not in the section for ./processor-payments.ts's reason: this package has
// no DOM pool (../../vite.config.ts).

/** a run outcome that can stop on a deployment still behind its own store. */
type Setup = StripeSetup | PaypalSetup;

/** whether the run stopped on the deployment not holding the key it had just stored. */
export const awaitsKey = (outcome: Setup): boolean =>
	(outcome.kind === 'unrepeating' || outcome.kind === 'uncovered') && outcome.awaitingKey;

/**
 * the note under a line a run stopped on awaiting the key: `keyless` while that line's own reading
 * still reports no key, and `null` otherwise — including every stop that was not the key arriving
 * late.
 *
 * the only note there is. a repeating-gift item still missing is the Set up press the recurring
 * block draws off the same row (./recurring-block.tsx), and a site still short of a wallet is the
 * payments fold's own panel's press, so a note pointing at either would say what the screen already
 * shows.
 */
export type AwaitingNote = 'keyless' | null;

export function awaitingNote(
	processor: PaymentProcessor,
	outcome: Setup,
	payments: PaymentsRead | null,
	gifts: RecurringRead | null
): AwaitingNote {
	if (!awaitsKey(outcome)) return null;
	const keyless =
		outcome.kind === 'uncovered'
			? paymentsKeyless(payments, processor)
			: recurringKeyless(gifts, processor);
	return keyless ? 'keyless' : null;
}

/**
 * whether the page's latest reading shows a line's subject in place, whoever put it there.
 *
 * the repeating-gift item off the row the recurring block draws its press from
 * (`recurringRowOf` in ./recurring-rows.ts), so the line and the press answer one question from one
 * rule; the wallet line off `sitesCovered` in ./wallet-rows.ts, so a line saying done never stands
 * beside a panel still offering the Register press. no other line has a reading of its own.
 */
function inPlace(
	subject: string,
	processor: PaymentProcessor,
	payments: PaymentsRead | null,
	gifts: RecurringRead | null
): boolean {
	if (subject === 'repeating') return recurringRowOf(gifts, processor)?.standing === 'ready';
	if (subject === 'wallets') {
		const wallets = configuredStanding(processorStanding(payments, processor))?.wallets ?? null;
		return wallets?.state === 'read' && sitesCovered(wallets.hosts);
	}
	return false;
}

/**
 * how a line's steps are drawn: none, every one of them done, or each by where the run stands.
 *
 * a line with no steps of its own ignores this.
 */
export type LedgerSteps = 'shut' | 'done' | 'live';

/** what one ledger line reads. */
export type LedgerLine = {
	readonly word: 'Working' | 'Waiting' | 'Done' | 'Stopped' | 'Not ran';
	readonly tone: 'running' | 'note' | 'done' | 'blocker';
	/** a line whose subject nothing shows done yet, drawn muted with an open mark. */
	readonly dim: boolean;
	readonly mark: 'circle-dashed' | undefined;
	readonly steps: LedgerSteps;
	/** only ever on the line the run stopped on. */
	readonly note: AwaitingNote;
};

/** the run a ledger is drawn over. */
export type LedgerRun = {
	/** each line's subject, in the order the chain reaches them. */
	readonly subjects: readonly string[];
	/** the line the run is at, or stopped on. */
	readonly reached: number;
	/** `null` while the run is going. */
	readonly outcome: Setup | null;
};

const DONE: LedgerLine = {
	word: 'Done',
	tone: 'done',
	dim: false,
	mark: undefined,
	steps: 'done',
	note: null
};

const unmade = (word: 'Waiting' | 'Not ran'): LedgerLine => ({
	word,
	tone: 'note',
	dim: true,
	mark: 'circle-dashed',
	steps: 'shut',
	note: null
});

/**
 * every line of the run's ledger, against the page's latest readings — `null` for a reading not
 * made, not landed, or not arrived yet.
 *
 * - behind the run: `Done`, its steps done.
 * - where a running run is: `Working`, its steps live. ahead of it: `Waiting`.
 * - where an ended run stopped: `Stopped`, steps shut — `Done` instead only on a stop awaiting the
 *   key whose reading now shows the thing in place, and a `keyless` note while that reading still
 *   reports no key.
 * - past where an ended run stopped: `Not ran`, or `Done` with its steps shut where the reading
 *   shows the thing in place.
 */
export function ledgerLines(
	processor: PaymentProcessor,
	run: LedgerRun,
	payments: PaymentsRead | null,
	gifts: RecurringRead | null
): LedgerLine[] {
	const { subjects, reached, outcome } = run;
	const settled = (subject: string) => inPlace(subject, processor, payments, gifts);
	return subjects.map((subject, at): LedgerLine => {
		if (at < reached) return DONE;
		if (outcome === null) {
			return at === reached
				? {
						word: 'Working',
						tone: 'running',
						dim: false,
						mark: undefined,
						steps: 'live',
						note: null
					}
				: unmade('Waiting');
		}
		if (at > reached) return settled(subject) ? { ...DONE, steps: 'shut' } : unmade('Not ran');
		if (awaitsKey(outcome) && settled(subject)) return DONE;
		return {
			word: 'Stopped',
			tone: 'blocker',
			dim: false,
			mark: undefined,
			steps: 'shut',
			note: awaitingNote(processor, outcome, payments, gifts)
		};
	});
}

/**
 * whether the screen reads the deployment again after a run that stored a key, and for how long
 * (./key-rereads.ts).
 *
 * - `unbounded` while a stopped line draws its `keyless` note: the note says the page will show the
 *   press once the key lands, so the page goes on reading until it does.
 * - `bounded` while both readings report no key, which a screen draws nothing for.
 * - `null` otherwise.
 */
export function keepRereading(
	processor: PaymentProcessor,
	outcome: Setup | null,
	payments: PaymentsRead | null,
	gifts: RecurringRead | null
): Rereading {
	if (outcome !== null && awaitingNote(processor, outcome, payments, gifts) === 'keyless') {
		return 'unbounded';
	}
	return paymentsKeyless(payments, processor) && recurringKeyless(gifts, processor)
		? 'bounded'
		: null;
}
