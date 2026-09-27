import { describe, expect, it } from 'vitest';
import type {
	NoReport,
	PaymentsRead,
	ProcessorPayments,
	ProcessorRecurring,
	RecurringRead,
	RecurringReading,
	StripeSetup,
	WalletHostLine,
	WalletsReading
} from '../api/types';
import { awaitingLine, keepRereading, walletsDone } from './awaiting-note';

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

const configured = (
	processor: 'stripe' | 'paypal',
	wallets: WalletsReading | null = null
): ProcessorPayments => ({
	processor,
	label: processor,
	state: 'configured',
	rails: {} as never,
	webhook: {} as never,
	subscription: {} as never,
	wallets
});

const active = { state: 'active', detail: null } as const;

const drawing = (host: string): WalletHostLine => ({
	host,
	own: false,
	standing: 'drawing',
	wallets: { apple_pay: active, google_pay: active, link: active }
});

const sites = (...hosts: WalletHostLine[]): WalletsReading => ({ state: 'read', hosts });

const payments = (...processors: ProcessorPayments[]): PaymentsRead => ({
	kind: 'read',
	report: { processors }
});

const paymentsUnread: PaymentsRead = { kind: 'unread', read: noReport };

const registered = payments(
	configured('stripe', sites(drawing('a.example'), drawing('b.example')))
);

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
		['reports every site drawing every wallet', registered, 'done'],
		['reports stripe configured with no site reading', payments(configured('stripe')), 'stopped'],
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

describe('the wallet line behind a stop awaiting the key', () => {
	const inactive = { state: 'inactive', detail: null } as const;

	it.each([
		['a repeating-gift stop', unrepeating(true)],
		['a wallet stop', uncovered(true)]
	] as const)('is done after %s once every site draws every wallet', (_, stop) => {
		expect(walletsDone('stripe', stop, registered)).toBe(true);
	});

	it.each([
		[
			'a site the account holds nothing for',
			sites(drawing('a.example'), { host: 'b.example', own: false, standing: 'unregistered' })
		],
		[
			'a site switched off',
			sites({ ...drawing('a.example'), standing: 'switched_off' } as WalletHostLine)
		],
		[
			'a site holding one wallet back',
			sites({
				host: 'a.example',
				own: true,
				standing: 'wallet_inactive',
				wallets: { apple_pay: active, google_pay: inactive, link: active }
			})
		],
		['a site read that could not be made', { state: 'unreadable', detail: 'x' } as const],
		['a site read that holds no sites', sites()]
	] as const)('is not done on %s', (_, reading) => {
		expect(walletsDone('stripe', unrepeating(true), payments(configured('stripe', reading)))).toBe(
			false
		);
	});

	it.each([
		['failed', paymentsUnread],
		['was never made', null],
		['reports stripe unconfigured', payments(unconfigured('stripe'))],
		['answers for another processor', payments(configured('paypal', sites(drawing('a.example'))))]
	] as const)('is not done where the payments reading %s', (_, read) => {
		expect(walletsDone('stripe', unrepeating(true), read)).toBe(false);
	});

	it('is not done where the stop was not the key arriving late', () => {
		expect(walletsDone('stripe', unrepeating(false), registered)).toBe(false);
		expect(walletsDone('stripe', uncovered(false), registered)).toBe(false);
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
