import type { ZapierReport } from '@better-giving/operator/console/zapier';
import { describe, expect, it } from 'vitest';
import type { ZapierAnswer } from './zapier-standing';
import { keyStanding, listeningSays } from './zapier-standing';

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

	it('is unshown for a key made before the deployment stored it', () => {
		expect(keyStanding(report({ madeAt: MADE, key: null }), null)).toEqual({ kind: 'unshown' });
	});

	it('takes the reading’s key over the answer’s, since the reading is read after the press', () => {
		expect(keyStanding(report({ madeAt: MADE, key: 'bgz_later' }), made('bgz_answered'))).toEqual({
			kind: 'known',
			key: 'bgz_later'
		});
	});

	it('falls back to the answer’s key where the reading has none to show', () => {
		expect(keyStanding(report({ madeAt: MADE, key: null }), made('bgz_new'))).toEqual({
			kind: 'known',
			key: 'bgz_new'
		});
		expect(keyStanding(report(null), made('bgz_new'))).toEqual({ kind: 'known', key: 'bgz_new' });
	});

	it('reads the reading where the last press did not land', () => {
		const refused: ZapierAnswer = {
			kind: 'reported',
			report: { ok: false, press: 'make', detail: 'A key already exists.' }
		};
		expect(keyStanding(report({ madeAt: MADE, key: null }), refused)).toEqual({
			kind: 'unshown'
		});
	});
});
