import { describe, expect, it } from 'vitest';
import type { PaypalRunRead, PaypalSetup, PaypalStage } from '../api/types';
import {
	LINES,
	PAIR_BLANK,
	PAIR_FIELD,
	lineAt,
	pairArmed,
	pairStanding,
	pairTurnedDown,
	paypalPairPosted,
	reportStands
} from './paypal-setup';

const ended = (stage: PaypalStage, outcome: PaypalSetup): PaypalRunRead => ({
	kind: 'ended',
	stage,
	facts: { registration: null, elsewhere: [] },
	outcome
});

const body = (clientId: string, secret: string): FormData => {
	const posted = new FormData();
	posted.set(PAIR_FIELD('PAYPAL_CLIENT_ID'), clientId);
	posted.set(PAIR_FIELD('PAYPAL_CLIENT_SECRET'), secret);
	return posted;
};

describe('the pair a press posts', () => {
	it('trims both halves rather than sending the binary a value it turns down', () => {
		expect(paypalPairPosted(body('  id ', '\tsecret\n'))).toEqual({
			ok: true,
			pair: { clientId: 'id', secret: 'secret' }
		});
	});

	it('refuses each empty half by its own name', () => {
		expect(paypalPairPosted(body(' ', ''))).toEqual({
			ok: false,
			errors: { PAYPAL_CLIENT_ID: PAIR_BLANK, PAYPAL_CLIENT_SECRET: PAIR_BLANK }
		});
	});
});

describe('the ledger lines', () => {
	it('draws one line per stage, in the order the chain reaches them', () => {
		expect(LINES.map((line) => line.stage)).toEqual([
			'authorizing',
			'registering',
			'storing',
			'repeating'
		]);
	});

	it('draws repeating gifts as the last line, so the store reads done while it runs', () => {
		expect(lineAt('repeating')).toBe(3);
		expect(lineAt('storing')).toBeLessThan(lineAt('repeating'));
	});
});

describe('where a stopped run reports', () => {
	const refused = ended('authorizing', {
		kind: 'unauthorized',
		failure: { kind: 'refused', detail: 'invalid_client' }
	});
	const unreachable = ended('authorizing', {
		kind: 'unauthorized',
		failure: { kind: 'unreachable', detail: 'timeout' }
	});
	const full = ended('registering', { kind: 'full', listeners: [] });

	it('says a turned-down pair at the boxes and nowhere else', () => {
		expect(pairTurnedDown(refused)).toBe(true);
		expect(reportStands(refused, false)).toBe(false);
	});

	it('keeps a ledger for PayPal not answering at the key check, which is not the pair', () => {
		expect(pairTurnedDown(unreachable)).toBe(false);
		expect(reportStands(unreachable, false)).toBe(true);
	});

	it('keeps a ledger for repeating gifts that did not get set up', () => {
		const unrepeating = ended('repeating', {
			kind: 'unrepeating',
			setup: { kind: 'unanswered', read: { kind: 'unreachable', detail: 'timeout' } },
			awaitingKey: true
		});
		expect(reportStands(unrepeating, false)).toBe(true);
	});

	it('stands under the boxes only while no card is up', () => {
		expect(reportStands(full, false)).toBe(true);
		expect(reportStands(full, true)).toBe(false);
	});

	it('draws nothing for a run that landed or is still going', () => {
		expect(reportStands(ended('storing', { kind: 'done' }), false)).toBe(false);
		expect(
			reportStands(
				{
					kind: 'running',
					stage: 'registering',
					facts: { registration: null, elsewhere: [] },
					outcome: null
				},
				false
			)
		).toBe(false);
	});
});

describe('what the boxes are seeded from', () => {
	const reported = { PAYPAL_CLIENT_ID: 'old', PAYPAL_CLIENT_SECRET: 'old-secret' };
	const sent = { PAYPAL_CLIENT_ID: 'new', PAYPAL_CLIENT_SECRET: 'new-secret' };

	it('is the pair sent, from the moment the run says it stored it until the re-read lands', () => {
		const done = ended('storing', { kind: 'done' });
		expect(pairStanding({ reported, sent, run: done, reread: false })).toEqual({
			seeded: sent,
			spent: true
		});
		expect(pairStanding({ reported, sent, run: done, reread: true })).toEqual({
			seeded: reported,
			spent: true
		});
	});

	it('is the pair sent where repeating gifts stopped, which is past the store', () => {
		const unrepeating = (awaitingKey: boolean) =>
			ended('repeating', {
				kind: 'unrepeating',
				setup: { kind: 'unanswered', read: { kind: 'unreachable', detail: 'timeout' } },
				awaitingKey
			});
		for (const awaitingKey of [true, false]) {
			expect(
				pairStanding({ reported, sent, run: unrepeating(awaitingKey), reread: false })
			).toEqual({ seeded: sent, spent: true });
		}
	});

	it('is the pair sent where the run stopped before the write landed', () => {
		const unstored = ended('storing', {
			kind: 'unstored',
			listenerId: 'WH-1',
			written: { kind: 'unreachable', detail: 'timeout' }
		});
		const unauthorized = ended('authorizing', {
			kind: 'unauthorized',
			failure: { kind: 'unreachable', detail: 'timeout' }
		} as PaypalSetup);
		for (const run of [unstored, unauthorized]) {
			expect(pairStanding({ reported, sent, run, reread: false })).toEqual({
				seeded: sent,
				spent: false
			});
		}
	});

	it('is what the deployment reported on a page that pressed nothing, whatever run it holds', () => {
		const unstored = ended('storing', {
			kind: 'unstored',
			listenerId: 'WH-1',
			written: { kind: 'unreachable', detail: 'timeout' }
		});
		for (const run of [unstored, null]) {
			expect(pairStanding({ reported, sent: null, run, reread: false })).toEqual({
				seeded: reported,
				spent: false
			});
		}
		expect(pairStanding({ reported, sent, run: null, reread: false })).toEqual({
			seeded: reported,
			spent: false
		});
	});
});

describe('whether Save is armed over unchanged boxes', () => {
	it('is, after any stop before the pair was stored', () => {
		const stops: PaypalRunRead[] = [
			ended('authorizing', {
				kind: 'unauthorized',
				failure: { kind: 'refused', detail: 'invalid_client' }
			}),
			ended('registering', { kind: 'full', listeners: [] }),
			ended('storing', {
				kind: 'unstored',
				listenerId: 'WH-1',
				written: { kind: 'unreachable', detail: 'timeout' }
			}),
			ended('storing', { kind: 'console-stopped' })
		];
		for (const run of stops) expect(pairArmed(run), run.outcome?.kind).toBe(true);
	});

	it('is not once the pair is stored, while a run is going, or with no run held', () => {
		const unrepeating = ended('repeating', {
			kind: 'unrepeating',
			setup: { kind: 'unanswered', read: { kind: 'unreachable', detail: 'timeout' } },
			awaitingKey: false
		});
		const running: PaypalRunRead = {
			kind: 'running',
			stage: 'registering',
			facts: { registration: null, elsewhere: [] },
			outcome: null
		};
		for (const run of [ended('storing', { kind: 'done' }), unrepeating, running, null]) {
			expect(pairArmed(run)).toBe(false);
		}
	});
});
