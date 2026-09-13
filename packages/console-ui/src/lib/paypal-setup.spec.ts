import { describe, expect, it } from 'vitest';
import type { PaypalRunRead, PaypalSetup, PaypalStage } from '../api/types';
import {
	LINES,
	PAIR_BLANK,
	PAIR_FIELD,
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
		expect(LINES.map((line) => line.stage)).toEqual(['authorizing', 'registering', 'storing']);
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

	it('is what the deployment reported where the write did not land', () => {
		const unstored = ended('storing', {
			kind: 'unstored',
			listenerId: 'WH-1',
			written: { kind: 'unreachable', detail: 'timeout' }
		});
		expect(pairStanding({ reported, sent, run: unstored, reread: false })).toEqual({
			seeded: reported,
			spent: false
		});
	});
});
