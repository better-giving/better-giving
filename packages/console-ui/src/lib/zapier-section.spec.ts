import type { ZapierReport } from '@better-giving/operator/console/zapier';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ZapierRead } from '../api/types';
import type { ZapierAnswer, ZapierSectionProps } from './zapier-section';
import { ZapierSection } from './zapier-section';
import { TRIGGER_MARK, TRIGGER_NAME } from './zapier-standing';

// the Zapier section as markup: the trigger cards it lists, and its answer to a replace — what it
// says under the press, and that the status region it says it in is drawn whether or not there is
// anything to say.
// ../../vite.config.ts pins `node` and there is no dom, so every wording is held in
// ./zapier-standing.spec.ts (`replacedSays`) and this holds where it is drawn.

const REPORT: ZapierReport = {
	key: { madeAt: '2026-09-01T00:00:00.000Z', key: 'bgz_new' },
	listening: { newGift: 0, newDonor: 0, giftRefunded: 0 },
	deliveries: { waiting: 0, failed: 0, oldestWaitingAt: null }
};

const replaced = (paused: number, notPaused: number): ZapierAnswer => ({
	kind: 'reported',
	report: {
		ok: true,
		press: 'replace',
		key: 'bgz_new',
		madeAt: '2026-09-22T00:00:00.000Z',
		disconnected: paused + notPaused,
		paused,
		notPaused
	}
});

const drawn = (
	answer: ZapierAnswer | null,
	zapier: ZapierRead = { kind: 'read', report: REPORT }
): string =>
	renderToStaticMarkup(
		createElement(ZapierSection, {
			zapier,
			answer,
			pending: null,
			address: 'https://a.example',
			onPress: () => {}
		} satisfies ZapierSectionProps)
	);

/** the text of the section's one status region, or `null` where it is drawn empty. */
const status = (page: string): string | null => {
	const regions = [...page.matchAll(/<p role="status" class="([^"]*)">([^<]*)<\/p>/g)];
	expect(regions).toHaveLength(1);
	const [, className, text = ''] = regions[0] as RegExpExecArray;
	if (text === '') {
		expect(className).toBe('adm-vh');
		return null;
	}
	return text;
};

const SWITCHED_OFF = /Zapier has turned off/;
const STILL_ON = /may still show as on in Zapier/;

describe('ZapierSection after a replace', () => {
	it('says how many Zaps were switched off, and nothing about any still on', () => {
		const said = status(drawn(replaced(2, 0)));
		expect(said).toMatch(/^Zapier has turned off 2 Zaps that used the old key\. Their owners/);
		expect(said).not.toMatch(STILL_ON);
	});

	it('says how many Zaps may still look on where none was switched off', () => {
		const said = status(drawn(replaced(0, 1)));
		expect(said).toMatch(/^1 Zap may still show as on in Zapier/);
		expect(said).not.toMatch(SWITCHED_OFF);
	});

	it('says both, the switched-off ones first', () => {
		expect(status(drawn(replaced(1, 2)))).toMatch(
			/^Zapier has turned off 1 Zap that used the old key\..* 2 more Zaps may still show as on in Zapier/
		);
	});

	it('draws the region empty where no Zap was listening, and where nothing has been pressed', () => {
		expect(status(drawn(replaced(0, 0)))).toBeNull();
		expect(status(drawn(null))).toBeNull();
	});

	it('still says it where the reading after the replace did not come back', () => {
		const page = drawn(replaced(3, 0), { kind: 'unread', read: { kind: 'no-session' } });
		expect(status(page)).toMatch(/^Zapier has turned off 3 Zaps/);
	});
});

/** each trigger card's title, mark and listeners, in the order the section draws them. */
const cards = (page: string) =>
	[
		...page.matchAll(
			/<div class="adm-record">.*?class="lucide lucide-([a-z-]+) .*?<h2 class="adm-record__title">([^<]*)<\/h2>(?:<span class="adm-prose">([^<]*)<\/span>)?<\/div><\/div>/g
		)
	].map(([, mark, name, listening]) => ({ name, mark, listening: listening ?? null }));

describe('ZapierSection’s triggers', () => {
	it('draws the three cards, refunds last, each with its own mark and its own listeners', () => {
		const page = drawn(null, {
			kind: 'read',
			report: { ...REPORT, listening: { newDonor: 0, newGift: 1, giftRefunded: 2 } }
		});
		expect(cards(page)).toEqual([
			{ name: TRIGGER_NAME.newDonor, mark: TRIGGER_MARK.newDonor, listening: null },
			{ name: TRIGGER_NAME.newGift, mark: TRIGGER_MARK.newGift, listening: '1 Zap listening' },
			{
				name: TRIGGER_NAME.giftRefunded,
				mark: TRIGGER_MARK.giftRefunded,
				listening: '2 Zaps listening'
			}
		]);
	});

	it('counts no listeners on any card where there is no key', () => {
		const page = drawn(null, {
			kind: 'read',
			report: { ...REPORT, key: null, listening: { newDonor: 1, newGift: 1, giftRefunded: 1 } }
		});
		expect(cards(page).map((card) => card.listening)).toEqual([null, null, null]);
	});
});
