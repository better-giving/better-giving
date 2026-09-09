import { describe, expect, it } from 'vitest';
import type { WidgetLevel } from '../api/types';
import { widgetTrouble } from './widget-level';

// what a site-list save says about the widget, held to the property tsc cannot see.
//
// what tsc already holds is the covering: `widgetTrouble` in ./widget-level.ts switches over every
// kind of `WidgetLevel` and ends on a `never`, so a kind added to ../api/types.ts with no sentence
// is a compile error rather than a case here. what it cannot hold is that an arm which is drawn
// says anything, or that the arms drawn are the right ones — every one of them type-checks
// perfectly while returning `null`, which is the state this module exists to prevent: an outcome
// the press had and the screen never showed.
//
// so the list below is stated rather than derived. a levelling moved from one side of it to the
// other is a line somebody changed on purpose, where a list derived off `WidgetLevel` would move
// with it and assert nothing.
//
// this package has no DOM pool (../../vite.config.ts), so nothing here is a claim about what
// ./sites-fold.tsx draws. it is a claim about the values that fold draws from.

/** an answer with every field empty, which is what the binary writes on a kind that says nothing. */
const NOTHING: Omit<WidgetLevel, 'kind'> = { domains: [], sitekeys: [], read: null, detail: '' };

/** one of every arm, in the shape the press answers with. */
const ARMS: readonly WidgetLevel[] = [
	{ ...NOTHING, kind: 'level', domains: ['example.org'] },
	{ ...NOTHING, kind: 'levelled', domains: ['example.org'] },
	{ ...NOTHING, kind: 'unasked' },
	{ ...NOTHING, kind: 'nothing' },
	{ ...NOTHING, kind: 'no-widget' },
	{ ...NOTHING, kind: 'many', sitekeys: ['0x1', '0x2'] },
	{ ...NOTHING, kind: 'unread', read: { kind: 'refused', detail: 'code 10000' } },
	{ ...NOTHING, kind: 'unread', read: { kind: 'no-credential', detail: 'not signed in' } },
	{ ...NOTHING, kind: 'unread', read: { kind: 'unreachable', detail: 'getaddrinfo EAI_AGAIN' } },
	{ ...NOTHING, kind: 'refused', detail: 'code 10000' },
	{ ...NOTHING, kind: 'failed', detail: 'code 1000' },
	{ ...NOTHING, kind: 'unreachable', detail: 'socket hang up' },
	{ ...NOTHING, kind: 'unreadable' }
];

/** the arms the fold is silent over, and the only ones it may be silent over. */
const SILENT = ['level', 'levelled', 'unasked', 'nothing'];

describe('what a save says about the spam protection’s list of sites', () => {
	it('has an arm of each kind to read', () => {
		// a list that stopped covering the union would pass every case below by having nothing in it
		// to fail on, which is the loudest way a sweep passes.
		expect([...new Set(ARMS.map((arm) => arm.kind))].sort()).toEqual(
			[
				'failed',
				'level',
				'levelled',
				'many',
				'no-widget',
				'nothing',
				'refused',
				'unasked',
				'unread',
				'unreachable',
				'unreadable'
			].sort()
		);
	});

	it('says nothing where the two lists ended level, or where nothing was asked', () => {
		expect(
			ARMS.filter((arm) => SILENT.includes(arm.kind)).filter((arm) => widgetTrouble(arm) !== null)
		).toEqual([]);
	});

	it('says something about every levelling that did not happen', () => {
		// the reproducing case. before this module the fold read `written` alone, so every one of
		// these was a press that reported a save and said nothing about the half of it that failed.
		expect(
			ARMS.filter((arm) => !SILENT.includes(arm.kind)).filter(
				(arm) => (widgetTrouble(arm)?.said ?? '') === ''
			)
		).toEqual([]);
	});

	it('quotes Cloudflare wherever there are words to quote', () => {
		// the two that carry a detail and do not print it would be a slab an operator is told to read
		// with nothing in it; the ones that carry none may not invent one.
		expect(
			ARMS.map((arm) => [arm.kind, widgetTrouble(arm)?.detail ?? null] as const).filter(
				([kind, detail]) => kind === 'refused' && detail === null
			)
		).toEqual([]);
		expect(
			widgetTrouble({ ...NOTHING, kind: 'unread', read: { kind: 'refused', detail: 'code 10000' } })
		).toEqual({
			said: 'Cloudflare won’t tell this sign-in about the widgets in this account. Ask an administrator of that account for administrator access, or switch account.',
			detail: 'code 10000'
		});
	});

	it('never quotes a body a successful widget request answered with', () => {
		// that body is the widget whole, the secret included (`packages/console/internal/widget`), so
		// the one arm reached by reading a success this console did not recognise carries no words.
		expect(widgetTrouble({ ...NOTHING, kind: 'unreadable' })?.detail).toBeNull();
	});

	it('sends the three ways the account could not be read somewhere different each', () => {
		const unread = ARMS.filter((arm) => arm.kind === 'unread').map(
			(arm) => widgetTrouble(arm)?.said
		);
		expect(new Set(unread).size).toBe(unread.length);
	});
});
