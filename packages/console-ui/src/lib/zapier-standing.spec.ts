import type { ZapierReport } from '@better-giving/operator/console/zapier';
import { describe, expect, it } from 'vitest';
import type { ZapierAnswer } from './zapier-standing';
import { deliveriesSay, keyStanding, listeningSays, replacedSays } from './zapier-standing';

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
	report: {
		ok: true,
		press: 'replace',
		key,
		madeAt: MADE,
		disconnected: 0,
		paused: 0,
		notPaused: 0
	}
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

describe('replacedSays', () => {
	const replaced = (paused: number, notPaused: number): ZapierAnswer => ({
		kind: 'reported',
		report: {
			ok: true,
			press: 'replace',
			key: 'bgz_new',
			madeAt: MADE,
			disconnected: paused + notPaused,
			paused,
			notPaused
		}
	});

	const PAUSED_ONE =
		'Zapier has switched off 1 Zap that used the old key. Its owner needs to reconnect it with the new key and switch it back on.';
	const PAUSED_THREE =
		'Zapier has switched off 3 Zaps that used the old key. Their owners need to reconnect them with the new key and switch them back on.';

	it.each([
		[1, PAUSED_ONE],
		[3, PAUSED_THREE]
	])('asks the owners of %i paused Zaps to reconnect and switch back on', (paused, said) => {
		expect(replacedSays(replaced(paused, 0))).toEqual([said]);
	});

	it.each([
		[
			1,
			'1 Zap may still look switched on in Zapier, but it hears nothing. Its owner needs to reconnect it with the new key, then switch it off and on by hand.'
		],
		[
			2,
			'2 Zaps may still look switched on in Zapier, but they hear nothing. Their owners need to reconnect them with the new key, then switch them off and on by hand.'
		]
	])('says %i Zaps that did not answer may still look on, to switch by hand', (notPaused, said) => {
		expect(replacedSays(replaced(0, notPaused))).toEqual([said]);
	});

	it('counts the ones that did not answer as more, after the paused ones', () => {
		expect(replacedSays(replaced(3, 1))).toEqual([
			PAUSED_THREE,
			'1 more Zap may still look switched on in Zapier, but it hears nothing. Its owner needs to reconnect it with the new key, then switch it off and on by hand.'
		]);
	});

	it('says nothing where no Zap was listening, and nothing for a press that did not land', () => {
		expect(replacedSays(replaced(0, 0))).toEqual([]);
		expect(replacedSays(null)).toEqual([]);
		expect(
			replacedSays({
				kind: 'reported',
				report: { ok: false, press: 'replace', detail: 'There is no key to replace.' }
			})
		).toEqual([]);
		expect(
			replacedSays({ kind: 'unanswered', press: 'replace', read: { kind: 'no-session' } })
		).toEqual([]);
	});
});
