import { describe, expect, it } from 'vitest';
import {
	DEDUCTIBILITY_UNKNOWN,
	finderAsk,
	matchCount,
	NO_MATCHES,
	NOT_DEDUCTIBLE,
	standingNote,
	tooManyLookups
} from './nonprofit-finder';

// what a press on "Find your charity" asks, and the words its answers are said in. the screen that
// makes the calls is ../../../routes/_app.admin.settings.dom.spec.tsx's.

describe('what a press asks', () => {
	it('looks a whole EIN up in its stored spelling, however it was typed', () => {
		for (const typed of ['123456789', '12-3456789', ' 12 3456789 ']) {
			expect(finderAsk(typed), typed).toEqual({ kind: 'lookup', ein: '12-3456789' });
		}
	});

	it('searches anything else, digits and all', () => {
		expect(finderAsk('211 LA  County ')).toEqual({ kind: 'search', query: '211 LA County' });
		expect(finderAsk('12345678')).toEqual({ kind: 'search', query: '12345678' });
	});

	it('asks nothing for fewer than two characters', () => {
		for (const typed of ['', '   ', 'a', ' b '])
			expect(finderAsk(typed), typed).toEqual({ kind: 'short' });
		expect(finderAsk('ab')).toEqual({ kind: 'search', query: 'ab' });
	});
});

describe('the wait a rate limit names', () => {
	it('is in seconds under two minutes', () => {
		expect(tooManyLookups(1)).toBe('Too many lookups for now. Try again in 1 second.');
		expect(tooManyLookups(60)).toBe('Too many lookups for now. Try again in 60 seconds.');
		expect(tooManyLookups(119)).toBe('Too many lookups for now. Try again in 119 seconds.');
	});

	it('is in whole minutes, rounded up, from two minutes on', () => {
		expect(tooManyLookups(120)).toBe('Too many lookups for now. Try again in 2 minutes.');
		expect(tooManyLookups(121)).toBe('Too many lookups for now. Try again in 3 minutes.');
	});
});

describe('the standing note', () => {
	it('says a revocation with its date, over any deductibility', () => {
		expect(
			standingNote({ deductible: false, revoked: true, revocationDate: '2023-05-15' })
		).toEqual({ words: 'Tax-exempt status revoked May 15, 2023.', known: true });
		expect(standingNote({ deductible: null, revoked: true, revocationDate: null })?.words).toBe(
			'Tax-exempt status revoked.'
		);
	});

	it('says an organisation not listed as deductible, and one whose listing is not known', () => {
		expect(standingNote({ deductible: false, revoked: false, revocationDate: null })?.words).toBe(
			NOT_DEDUCTIBLE
		);
		expect(standingNote({ deductible: null, revoked: null, revocationDate: null })).toEqual({
			words: DEDUCTIBILITY_UNKNOWN,
			known: false
		});
	});

	it('says nothing of a listed organisation, reinstated since a revocation or never revoked', () => {
		expect(standingNote({ deductible: true, revoked: false, revocationDate: '2019-01-02' })).toBe(
			null
		);
		expect(standingNote({ deductible: true, revoked: null, revocationDate: null })).toBe(null);
	});
});

it('counts the matches, and says when there are none', () => {
	expect(matchCount(0)).toBe(NO_MATCHES);
	expect(matchCount(1)).toBe('1 match.');
	expect(matchCount(3)).toBe('3 matches.');
});
