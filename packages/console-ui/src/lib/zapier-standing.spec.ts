import type { ZapierReport } from '@better-giving/operator/console/zapier';
import { describe, expect, it } from 'vitest';
import type { ZapierAnswer } from './zapier-standing';
import { deliveriesSay, keyStanding, listeningSays } from './zapier-standing';

describe('listeningSays', () => {
	it.each([
		[0, null],
		[1, '1 Zap listening'],
		[3, '3 Zaps listening']
	])('%i reads %s', (count, said) => {
		expect(listeningSays(count)).toBe(said);
	});
});

const report = (key: ZapierReport['key']): ZapierReport => ({
	key,
	listening: { newGift: 0, newDonor: 0 },
	deliveries: { waiting: 0, failed: 0, oldestWaitingAt: null }
});

const MADE = '2026-09-01T00:00:00.000Z';

const made = (key: string): ZapierAnswer => ({
	kind: 'reported',
	report: { ok: true, press: 'replace', key, madeAt: MADE, disconnected: 0 }
});

describe('keyStanding', () => {
	it('is none before a key is made', () => {
		expect(keyStanding(report(null), null)).toEqual({ kind: 'none' });
	});

	it('is the key the reading carries', () => {
		expect(keyStanding(report({ madeAt: MADE, key: 'bgz_read' }), null)).toEqual({
			kind: 'known',
			key: 'bgz_read'
		});
	});

	it('takes the reading’s key over the answer’s, since the reading is read after the press', () => {
		expect(keyStanding(report({ madeAt: MADE, key: 'bgz_later' }), made('bgz_answered'))).toEqual({
			kind: 'known',
			key: 'bgz_later'
		});
	});

	it('falls back to the answer’s key where the reading has none to show', () => {
		expect(keyStanding(report(null), made('bgz_new'))).toEqual({ kind: 'known', key: 'bgz_new' });
	});

	it('draws the answer’s key where the reading after the press did not come back', () => {
		expect(keyStanding(null, made('bgz_new'))).toEqual({ kind: 'known', key: 'bgz_new' });
	});

	it('is none with no reading and no landed press', () => {
		const refused: ZapierAnswer = {
			kind: 'reported',
			report: { ok: false, press: 'make', detail: 'A key already exists.' }
		};
		expect(keyStanding(null, null)).toEqual({ kind: 'none' });
		expect(keyStanding(null, refused)).toEqual({ kind: 'none' });
	});
});

describe('deliveriesSay', () => {
	const NOW = new Date('2026-09-02T12:00:00.000Z');
	const failing = (failed: number): ZapierReport => ({
		...report({ madeAt: MADE, key: 'bgz_read' }),
		deliveries: { waiting: 0, failed, oldestWaitingAt: null }
	});

	it.each([
		[1, '1 delivery to your Zaps failed.'],
		[4, '4 deliveries to your Zaps failed.']
	])('counts %i failure as deliveries, never as gifts', (failed, said) => {
		expect(deliveriesSay(failing(failed), NOW)).toEqual([said]);
	});

	it('says nothing with no key, whatever the rows hold', () => {
		expect(deliveriesSay({ ...failing(2), key: null }, NOW)).toEqual([]);
	});
});
