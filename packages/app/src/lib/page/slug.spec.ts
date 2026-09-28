import { describe, expect, it } from 'vitest';
import { checkSlug, RESERVED_SEGMENTS, reservedSegments, slugFromTitle } from './slug';

// node pool, no database: the rule is a pure function, and vitest reads the route files through the
// same `virtual:route-files` plugin the build does (../../../vitest.config.ts registers it).

describe('the top-level segments a route file answers', () => {
	it('reads the first segment under a pathless layout', () => {
		expect([...reservedSegments(['_app.admin._index.tsx'])]).toEqual(['admin']);
	});

	it('reserves nothing for a route whose first segment is a parameter or the index', () => {
		expect([...reservedSegments(['$formId.tsx', '_app._index.tsx', '$.tsx', '_app.tsx'])]).toEqual(
			[]
		);
	});

	it('reads an escaped character as part of the segment rather than as a convention', () => {
		expect([...reservedSegments(['[_well-known].tsx', 'dolla-[$].ts', '[$]x.ts'])]).toEqual([
			'_well-known',
			'dolla-$',
			'$x'
		]);
	});

	it('drops the underscore that opts a segment out of its layout', () => {
		expect([...reservedSegments(['events_.$id.tsx', '[events_].tsx'])]).toEqual([
			'events',
			'events_'
		]);
	});

	it('reserves an optional segment and the one after it, since the address answers with or without it', () => {
		expect([
			...reservedSegments(['(en).about.tsx', '($lang).pricing.tsx', '($lang).$id.tsx'])
		]).toEqual(['en', 'about', 'pricing']);
	});

	it('reads a folder route by its folder’s name', () => {
		expect([...reservedSegments(['_marketing/route.tsx', 'events.$id/index.ts'])]).toEqual([
			'events'
		]);
	});

	it('reserves a segment in lowercase, since the router matches an address in any case', () => {
		expect([...reservedSegments(['About.tsx'])]).toEqual(['about']);
	});
});

describe('the reserved segments this app answers today', () => {
	it('are read off the route files themselves', () => {
		// `quickbooks`, `zapier` and `image` are named in no rule: only the route files say they are taken
		expect([...RESERVED_SEGMENTS]).toEqual(
			expect.arrayContaining(['admin', 'api', 'console', 'login', 'quickbooks', 'zapier', 'image'])
		);
	});

	it('take nothing from the parameter route that answers every other address', () => {
		expect([...RESERVED_SEGMENTS].filter((segment) => segment.startsWith(':'))).toEqual([]);
	});

	it('take a route file added later without the rule being edited', () => {
		expect(reservedSegments(['events.$id.tsx']).has('events')).toBe(true);
	});
});

describe('a campaign address', () => {
	it.each([
		['admin', '/admin'],
		['api', '/api'],
		['console', '/console'],
		['donate', '/donate'],
		['login', '/login'],
		['assets', '/assets']
	])('is refused as %s, naming the address it would shadow', (slug, clashesWith) => {
		expect(checkSlug(slug)).toEqual({ ok: false, reason: 'reserved', clashesWith });
	});

	it.each([
		['Winter-coats', 'W'],
		['winter coats', ' '],
		['winter_coats', '_'],
		['-winter-coats', '-'],
		['winter-coats-', '-'],
		['winter--coats', '-'],
		['coats.html', '.'],
		['café', 'é']
	])('is refused as %j, naming the character %j', (slug, character) => {
		expect(checkSlug(slug)).toEqual({ ok: false, reason: 'character', character });
	});

	it('is taken when it is lowercase words and digits joined by single hyphens', () => {
		expect(checkSlug('winter-coat-drive-2026')).toEqual({
			ok: true,
			slug: 'winter-coat-drive-2026'
		});
	});

	it('is refused when empty', () => {
		expect(checkSlug('')).toEqual({ ok: false, reason: 'empty' });
	});

	it('is refused past sixty characters, naming the limit', () => {
		expect(checkSlug('a'.repeat(60))).toEqual({ ok: true, slug: 'a'.repeat(60) });
		expect(checkSlug('a'.repeat(61))).toEqual({ ok: false, reason: 'length', max: 60 });
	});
});

describe('the address a campaign’s name suggests', () => {
	it('is its words in lowercase joined by single hyphens', () => {
		expect(slugFromTitle('  Winter Coat Drive — 2026!  ')).toBe('winter-coat-drive-2026');
	});

	it('keeps an accented letter as its plain one', () => {
		expect(slugFromTitle('Día de los Muertos')).toBe('dia-de-los-muertos');
	});

	it('stops at the length an address may have, on a whole word where the cut allows', () => {
		const title = `${'a'.repeat(58)} bc`;
		expect(slugFromTitle(title)).toBe('a'.repeat(58));
		expect(checkSlug(slugFromTitle('word '.repeat(30)))).toMatchObject({ ok: true });
	});
});
