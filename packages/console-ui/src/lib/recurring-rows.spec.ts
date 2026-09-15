import { describe, expect, it } from 'vitest';
import type { ProcessorRecurring, RecurringRead } from '../api/types';
import {
	accountsOpening,
	accountsSaid,
	recurringReading,
	recurringRowOf,
	recurringRows
} from './recurring-rows';

// the lines the repeating-gifts block draws, away from the block that draws them.
//
// a module for the reason ./processor-payments.ts is one: this package has no DOM pool
// (../../vite.config.ts), so a reading written inside a component is one nothing here can hold —
// and what these decide is what an operator is told about which account a standing is about.

const entry = (
	processor: 'stripe' | 'paypal',
	label: string,
	reading: ProcessorRecurring['reading']
): ProcessorRecurring => ({ processor, label, reading });

const read = (...processors: ProcessorRecurring[]): RecurringRead => ({
	kind: 'read',
	report: { processors }
});

describe('recurringRows', () => {
	/** one entry per account, carrying which account it is and where it stands. */
	it('takes an account’s standing out of the report', () => {
		const rows = recurringRows(read(entry('paypal', 'PayPal', { state: 'ready' })));

		expect(rows).toEqual([
			{ processor: 'paypal', account: 'PayPal', standing: 'ready', press: false }
		]);
	});

	/**
	 * the one press, on the first account that needs it.
	 *
	 * one press and not one per account: a donor is offered a gift that repeats only where every
	 * configured processor can collect one, so setting one up and not the other is a state that
	 * helps nobody.
	 */
	it('stands the one press on the first account that has nothing', () => {
		const rows = recurringRows(
			read(
				entry('stripe', 'Stripe', { state: 'absent' }),
				entry('paypal', 'PayPal', { state: 'absent' })
			)
		);

		expect(rows.map((row) => row.press)).toEqual([true, false]);
	});

	/** and on the account that needs it rather than on the first line drawn. */
	it('stands the press on the account that has nothing, not on the one that is ready', () => {
		const rows = recurringRows(
			read(
				entry('stripe', 'Stripe', { state: 'ready' }),
				entry('paypal', 'PayPal', { state: 'absent' })
			)
		);

		expect(rows.map((row) => row.press)).toEqual([false, true]);
	});

	/** an archived one is neither set up nor missing, and the press it would need is refused. */
	it('stands no press on an account holding an archived one', () => {
		const rows = recurringRows(read(entry('stripe', 'Stripe', { state: 'archived' })));

		expect(rows[0]?.press).toBe(false);
	});

	/**
	 * a read that could not be made draws no line at all: it is the same read failing that the fold
	 * says once above the boxes, and a row here would be the same sentence twice.
	 */
	it('draws no line for an account whose read could not be made', () => {
		const rows = recurringRows(
			read(
				entry('stripe', 'Stripe', { state: 'unreadable', detail: 'Stripe refused the key.' }),
				entry('paypal', 'PayPal', { state: 'absent' })
			)
		);

		expect(rows.map((row) => row.processor)).toEqual(['paypal']);
	});

	/** a deployment holding no key at all, and the read nobody made: both draw nothing. */
	it('draws nothing where the deployment holds no processor and where nothing was read', () => {
		expect(recurringRows(read())).toEqual([]);
		expect(recurringRows(null)).toEqual([]);
		expect(recurringRows({ kind: 'unread', read: { kind: 'unreachable', detail: 'No.' } })).toEqual(
			[]
		);
	});
});

describe('recurringRowOf', () => {
	/** the second account's line carries the press on its own screen, though the list puts it first. */
	it('stands the press on this account wherever it has nothing', () => {
		const both = read(
			entry('stripe', 'Stripe', { state: 'absent' }),
			entry('paypal', 'PayPal', { state: 'absent' })
		);

		expect(recurringRowOf(both, 'stripe')?.press).toBe(true);
		expect(recurringRowOf(both, 'paypal')?.press).toBe(true);
	});

	it('keeps the standing the list gives it', () => {
		const both = read(
			entry('stripe', 'Stripe', { state: 'ready' }),
			entry('paypal', 'PayPal', { state: 'absent' })
		);

		expect(recurringRowOf(both, 'stripe')).toEqual({
			processor: 'stripe',
			account: 'Stripe',
			standing: 'ready',
			press: false
		});
	});

	it('draws nothing for an account with no line', () => {
		const one = read(
			entry('stripe', 'Stripe', { state: 'unreadable', detail: 'Stripe refused the key.' }),
			entry('paypal', 'PayPal', { state: 'ready' })
		);

		expect(recurringRowOf(one, 'stripe')).toBeNull();
		expect(recurringRowOf(null, 'paypal')).toBeNull();
	});
});

describe('recurringReading', () => {
	/** what one account answered, which is what the fold says once over the whole Stripe half. */
	it('takes one account’s reading out of the report', () => {
		const held = read(
			entry('stripe', 'Stripe', { state: 'unreadable', detail: 'Stripe refused the key.' })
		);

		expect(recurringReading(held, 'stripe')).toEqual({
			state: 'unreadable',
			detail: 'Stripe refused the key.'
		});
	});

	/**
	 * `null` is the deployment holding no key for that processor, and it is not a failure: the boxes
	 * under it are the whole truth of that state, and it is what the fold waits on after a run
	 * stores one.
	 */
	it('answers null for an account the deployment holds no key for', () => {
		expect(
			recurringReading(read(entry('paypal', 'PayPal', { state: 'ready' })), 'stripe')
		).toBeNull();
		expect(recurringReading(null, 'stripe')).toBeNull();
	});
});

describe('accountsSaid', () => {
	it('says one account and more than one in a fundraiser’s words', () => {
		expect(accountsSaid(['Stripe'])).toBe('your Stripe account');
		expect(accountsSaid(['Stripe', 'PayPal'])).toBe('your Stripe and PayPal accounts');
	});

	/** the same phrase opening a sentence, which is where a banner puts it. */
	it('opens a sentence with a capital', () => {
		expect(accountsOpening(['PayPal'])).toBe('Your PayPal account');
	});
});
