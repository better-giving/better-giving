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
import type { LedgerLine } from './awaiting-note';
import { awaitingNote, keepRereading, ledgerLines } from './awaiting-note';

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

const STRIPE = ['keys', 'telling', 'repeating', 'wallets'] as const;
const PAYPAL = ['authorizing', 'registering', 'storing', 'repeating'] as const;
const subjectsOf = (processor: 'stripe' | 'paypal') => (processor === 'stripe' ? STRIPE : PAYPAL);

const ready = (processor: 'stripe' | 'paypal') => gifts(standing(processor, { state: 'ready' }));
const absent = (processor: 'stripe' | 'paypal') => gifts(standing(processor, { state: 'absent' }));

/** the word each line reads, which is what most of these hold. */
const words = (lines: LedgerLine[]) => lines.map((line) => line.word);

describe.each(['stripe', 'paypal'] as const)(
	'a repeating-gift stop awaiting the key on %s',
	(processor) => {
		const subjects = subjectsOf(processor);
		const run = {
			subjects,
			reached: subjects.indexOf('repeating'),
			outcome: unrepeating(true)
		};
		const stopLine = run.reached;
		// the payments reading says the opposite of the recurring one throughout, so a stopped line drawn
		// off it would fail every case.
		const other = payments(configured(processor));

		it.each([
			['still carries no standing', gifts(), 'Stopped', 'keyless'],
			['reads ready', ready(processor), 'Done', null],
			['reads absent', absent(processor), 'Stopped', null],
			['reads archived', gifts(standing(processor, { state: 'archived' })), 'Stopped', null],
			[
				'is unreadable',
				gifts(standing(processor, { state: 'unreadable', detail: 'x' })),
				'Stopped',
				null
			],
			['failed', giftsUnread, 'Stopped', null],
			['was never made', null, 'Stopped', null]
		] as const)(
			'where the recurring reading %s, the line reads %s with note %s',
			(_, read, word, note) => {
				const line = ledgerLines(processor, run, other, read)[stopLine];
				expect(line?.word).toBe(word);
				expect(line?.note).toBe(note);
				expect(awaitingNote(processor, run.outcome, other, read)).toBe(note);
			}
		);

		it('draws the stopped line done with every step done once the item stands', () => {
			expect(ledgerLines(processor, run, other, ready(processor))[stopLine]).toMatchObject({
				tone: 'done',
				dim: false,
				steps: 'done'
			});
		});

		it('keeps the stopped line shut and blocking while it is still to do', () => {
			expect(ledgerLines(processor, run, other, absent(processor))[stopLine]).toMatchObject({
				tone: 'blocker',
				steps: 'shut'
			});
		});

		it('is read off its own processor and not another', () => {
			const elsewhere = processor === 'stripe' ? 'paypal' : 'stripe';
			expect(ledgerLines(processor, run, other, ready(elsewhere))[stopLine]?.note).toBe('keyless');
		});

		it('draws every line behind the stop done, with its steps done', () => {
			for (const line of ledgerLines(processor, run, other, gifts()).slice(0, stopLine)) {
				expect(line).toMatchObject({ word: 'Done', tone: 'done', steps: 'done', note: null });
			}
		});
	}
);

describe('the wallet line behind a repeating-gift stop on stripe', () => {
	const run = { subjects: STRIPE, reached: 2, outcome: unrepeating(true) };

	it.each([
		['recurring ready', ready('stripe')],
		['recurring absent', absent('stripe')],
		['recurring keyless', gifts()],
		['recurring unread', giftsUnread]
	] as const)(
		'reads Done with its steps shut once every site shows every wallet, %s',
		(_, read) => {
			expect(ledgerLines('stripe', run, registered, read)[3]).toMatchObject({
				word: 'Done',
				tone: 'done',
				dim: false,
				steps: 'shut',
				note: null
			});
		}
	);

	it.each([
		[
			'sites short of a wallet',
			payments(
				configured('stripe', sites({ host: 'b.example', own: false, standing: 'unregistered' }))
			)
		],
		['no site reading', payments(configured('stripe'))],
		['stripe unconfigured', payments(unconfigured('stripe'))],
		['a read that failed', paymentsUnread],
		['a read never made', null]
	] as const)('reads Not ran, muted and shut, on %s', (_, read) => {
		for (const gift of [ready('stripe'), absent('stripe'), gifts(), giftsUnread]) {
			expect(ledgerLines('stripe', run, read, gift)[3]).toEqual({
				word: 'Not ran',
				tone: 'note',
				dim: true,
				mark: 'circle-dashed',
				steps: 'shut',
				note: null
			});
		}
	});

	it('is never left Waiting once the run has ended', () => {
		expect(
			words(ledgerLines('stripe', run, payments(configured('stripe')), ready('stripe')))
		).toEqual(['Done', 'Done', 'Done', 'Not ran']);
	});
});

describe('a wallet stop awaiting the key on stripe', () => {
	const run = { subjects: STRIPE, reached: 3, outcome: uncovered(true) };

	it.each([
		['reports stripe unconfigured', payments(unconfigured('stripe')), 'Stopped', 'keyless'],
		['reports every site drawing every wallet', registered, 'Done', null],
		[
			'reports stripe configured with no site reading',
			payments(configured('stripe')),
			'Stopped',
			null
		],
		['leaves stripe out', payments(unconfigured('paypal')), 'Stopped', null],
		['failed', paymentsUnread, 'Stopped', null],
		['was never made', null, 'Stopped', null]
	] as const)(
		'where the payments reading %s, the line reads %s with note %s',
		(_, read, word, note) => {
			// the recurring reading says the opposite throughout: ready, and never keyless.
			for (const gift of [ready('stripe'), gifts()]) {
				const line = ledgerLines('stripe', run, read, gift)[3];
				expect(line?.word).toBe(word);
				expect(line?.note).toBe(note);
			}
		}
	);

	it('draws no note on the repeating line behind it, which it passed', () => {
		expect(ledgerLines('stripe', run, registered, gifts())[2]).toMatchObject({
			word: 'Done',
			note: null
		});
	});
});

describe('a stop that was not the key arriving late', () => {
	it.each([
		['stripe', STRIPE, 2, unrepeating(false)],
		['stripe', STRIPE, 3, uncovered(false)],
		['paypal', PAYPAL, 3, unrepeating(false)]
	] as const)(
		'on %s stays Stopped whatever the reading says',
		(processor, subjects, reached, outcome) => {
			const lines = ledgerLines(
				processor,
				{ subjects, reached, outcome },
				payments(unconfigured(processor)),
				gifts()
			);
			expect(lines[reached]).toMatchObject({ word: 'Stopped', note: null });
			expect(
				ledgerLines(processor, { subjects, reached, outcome }, registered, ready(processor))[
					reached
				]?.word
			).toBe('Stopped');
		}
	);

	it('still reads a line past it as done where the reading shows the thing in place', () => {
		const early = { subjects: STRIPE, reached: 1, outcome: uncovered(false) };
		expect(words(ledgerLines('stripe', early, registered, ready('stripe')))).toEqual([
			'Done',
			'Stopped',
			'Done',
			'Done'
		]);
		expect(ledgerLines('stripe', early, registered, ready('stripe'))[2]?.steps).toBe('shut');
		expect(words(ledgerLines('stripe', early, null, null))).toEqual([
			'Done',
			'Stopped',
			'Not ran',
			'Not ran'
		]);
	});
});

describe('a run still going', () => {
	it.each(['stripe', 'paypal'] as const)('on %s reads Done, Working, then Waiting', (processor) => {
		const lines = ledgerLines(
			processor,
			{ subjects: subjectsOf(processor), reached: 1, outcome: null },
			registered,
			ready(processor)
		);
		expect(words(lines)).toEqual(['Done', 'Working', 'Waiting', 'Waiting']);
		expect(lines.map((line) => line.steps)).toEqual(['done', 'live', 'shut', 'shut']);
		expect(lines.map((line) => line.dim)).toEqual([false, false, true, true]);
	});
});

describe('reading the page again after a run that stored a key', () => {
	const landed = payments(configured('stripe'));

	it('goes on, bounded, while both readings report no key', () => {
		expect(
			keepRereading('stripe', { kind: 'done' }, payments(unconfigured('stripe')), gifts())
		).toBe('bounded');
	});

	it('stops once either reading reports the key, with no note waiting on the other', () => {
		expect(keepRereading('stripe', { kind: 'done' }, landed, gifts())).toBeNull();
		expect(keepRereading('stripe', null, landed, gifts())).toBeNull();
	});

	it('goes on past the bound while a drawn note is still about a key its own reading has not reported', () => {
		expect(
			keepRereading('stripe', unrepeating(true), payments(unconfigured('stripe')), gifts())
		).toBe('unbounded');
		expect(keepRereading('stripe', unrepeating(true), landed, gifts())).toBe('unbounded');
		expect(
			keepRereading(
				'stripe',
				uncovered(true),
				payments(unconfigured('stripe')),
				gifts(standing('stripe', { state: 'ready' }))
			)
		).toBe('unbounded');
		expect(
			keepRereading('paypal', unrepeating(true), payments(configured('paypal')), gifts())
		).toBe('unbounded');
	});

	it('stops once the note is gone, whatever the other reading says', () => {
		const ready = gifts(standing('stripe', { state: 'ready' }));
		expect(keepRereading('stripe', unrepeating(true), landed, ready)).toBeNull();
		const missing = gifts(standing('stripe', { state: 'absent' }));
		expect(keepRereading('stripe', unrepeating(true), landed, missing)).toBeNull();
	});

	it('stops on a read that failed, which draws no note', () => {
		expect(keepRereading('stripe', unrepeating(true), paymentsUnread, giftsUnread)).toBeNull();
		expect(keepRereading('stripe', null, null, null)).toBeNull();
	});
});
