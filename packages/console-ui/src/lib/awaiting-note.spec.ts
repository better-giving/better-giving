import { describe, expect, it } from 'vitest';
import type {
	NoReport,
	PaymentsRead,
	ProcessorPayments,
	ProcessorRecurring,
	RecurringRead,
	RecurringReading,
	StripeSetup
} from '../api/types';
import { awaitingLine, keepRereading } from './awaiting-note';

// the line a run stopped on while the deployment was still behind its own store, held against the
// page's latest reading. this package has no DOM pool (../../vite.config.ts), so the rule is a value
// these can hold.

const noReport = {} as NoReport;

const gifts = (...processors: ProcessorRecurring[]): RecurringRead => ({
	kind: 'read',
	report: { processors }
});

const standing = (
	processor: 'stripe' | 'paypal',
	reading: RecurringReading
): ProcessorRecurring => ({
	processor,
	label: processor === 'stripe' ? 'Stripe' : 'PayPal',
	reading
});

const giftsUnread: RecurringRead = { kind: 'unread', read: noReport };

const unconfigured = (processor: 'stripe' | 'paypal'): ProcessorPayments => ({
	processor,
	label: processor,
	state: 'unconfigured',
	unset: []
});

const configured = (processor: 'stripe' | 'paypal'): ProcessorPayments => ({
	processor,
	label: processor,
	state: 'configured',
	rails: {} as never,
	webhook: {} as never,
	subscription: {} as never,
	wallets: null
});

const payments = (...processors: ProcessorPayments[]): PaymentsRead => ({
	kind: 'read',
	report: { processors }
});

const paymentsUnread: PaymentsRead = { kind: 'unread', read: noReport };

const unrepeating = (awaitingKey: boolean) =>
	({ kind: 'unrepeating', setup: {} as never, awaitingKey }) as const;

const uncovered = (awaitingKey: boolean): StripeSetup => ({
	kind: 'uncovered',
	levelled: {} as never,
	awaitingKey
});

describe.each(['stripe', 'paypal'] as const)('a repeating-gift stop on %s', (processor) => {
	const stop = unrepeating(true);
	// the payments reading says the opposite of the recurring one throughout, so a line drawn off it
	// would fail every case.
	const other = payments(configured(processor));

	it.each([
		['still carries no standing', gifts(), 'keyless'],
		['reads ready', gifts(standing(processor, { state: 'ready' })), 'done'],
		['reads absent', gifts(standing(processor, { state: 'absent' })), 'press'],
		['reads archived', gifts(standing(processor, { state: 'archived' })), 'stopped'],
		['is unreadable', gifts(standing(processor, { state: 'unreadable', detail: 'x' })), 'stopped'],
		['failed', giftsUnread, 'stopped'],
		['was never made', null, 'stopped']
	] as const)('where the recurring reading %s draws %s', (_, read, line) => {
		expect(awaitingLine(processor, stop, other, read)).toBe(line);
	});

	it('is read off its own processor and not another', () => {
		const elsewhere = processor === 'stripe' ? 'paypal' : 'stripe';
		expect(
			awaitingLine(processor, stop, other, gifts(standing(elsewhere, { state: 'ready' })))
		).toBe('keyless');
	});

	it('is drawn as the run left it where the stop was not the key arriving late', () => {
		expect(awaitingLine(processor, unrepeating(false), other, gifts())).toBeNull();
	});
});

describe('a wallet stop on stripe', () => {
	const stop = uncovered(true);
	// the recurring reading says no key throughout, so a line drawn off it would fail every case.
	const other = gifts();

	it.each([
		['reports stripe unconfigured', payments(unconfigured('stripe')), 'keyless'],
		// no reading says the sites were registered since, so the line never reads done.
		['reports stripe configured', payments(configured('stripe')), 'stopped'],
		['leaves stripe out', payments(unconfigured('paypal')), 'stopped'],
		['failed', paymentsUnread, 'stopped'],
		['was never made', null, 'stopped']
	] as const)('where the payments reading %s draws %s', (_, read, line) => {
		expect(awaitingLine('stripe', stop, read, other)).toBe(line);
	});

	it('is drawn as the run left it where the stop was not the key arriving late', () => {
		expect(
			awaitingLine('stripe', uncovered(false), payments(unconfigured('stripe')), other)
		).toBeNull();
	});
});

describe('reading the page again after a run that stored a key', () => {
	const landed = payments(configured('stripe'));

	it('goes on while both readings report no key', () => {
		expect(
			keepRereading('stripe', { kind: 'done' }, payments(unconfigured('stripe')), gifts())
		).toBe(true);
	});

	it('stops once either reading reports the key, with no note waiting on the other', () => {
		expect(keepRereading('stripe', { kind: 'done' }, landed, gifts())).toBe(false);
		expect(keepRereading('stripe', null, landed, gifts())).toBe(false);
	});

	it('goes on while a drawn note is still about a key its own reading has not reported', () => {
		expect(keepRereading('stripe', unrepeating(true), landed, gifts())).toBe(true);
		expect(
			keepRereading(
				'stripe',
				uncovered(true),
				payments(unconfigured('stripe')),
				gifts(standing('stripe', { state: 'ready' }))
			)
		).toBe(true);
		expect(
			keepRereading('paypal', unrepeating(true), payments(configured('paypal')), gifts())
		).toBe(true);
	});

	it('stops once the note is gone, whatever the other reading says', () => {
		const ready = gifts(standing('stripe', { state: 'ready' }));
		expect(keepRereading('stripe', unrepeating(true), landed, ready)).toBe(false);
	});

	it('stops on a read that failed, which draws no note', () => {
		expect(keepRereading('stripe', unrepeating(true), paymentsUnread, giftsUnread)).toBe(false);
		expect(keepRereading('stripe', null, null, null)).toBe(false);
	});
});
