import type { PaymentProcessor } from '@better-giving/operator/console/payments';
import { PROCESSOR_NAMES, type ProcessorName } from '../payments/provider';
import type { Agreed, SameNames } from './report';

// the processors the console's payments and repeating-gift surfaces answer for, which is every
// processor at the port: the console draws a fold for each, so a processor left off here is a fold
// with no entry to key off and a report the console refuses whole.

/** the port's processors the console names, in `PROCESSOR_NAMES` order. */
export const CONSOLE_PROCESSORS: readonly PaymentProcessor[] = PROCESSOR_NAMES;

/**
 * one processor vocabulary at both ends of the wire, held the way ./report.ts holds the
 * organisation's.
 *
 * `packages/operator` reaches nothing of this app's (CLAUDE.md), so the console's copy is declared
 * there and this is where the two meet. each has to extend the other, because either direction alone
 * lets one list grow a member the other has never heard of: a processor this deployment reports on
 * and no console can name, or a fold drawn for a processor nothing here answers for.
 *
 * a type and not a value, so it costs the worker nothing.
 */
export type ProcessorWireNames = Agreed<SameNames<ProcessorName, PaymentProcessor>>;
