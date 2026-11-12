import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ./area.css writes no value of its own (its header): every colour, length, weight and duration
// is a `var()` of the donor page's, the form's or the registry's. and every `sa-*` class the
// screens wear is one it draws, and every one it draws is worn: a class nothing draws paints
// nothing and errors nowhere.

const HERE = import.meta.dirname;
const SHEET = readFileSync(join(HERE, 'area.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** what a screen may write that is structure rather than a value (./area.css's header). */
const STRUCTURE = new Set(['0', '100%', '100vmax', '100dvh', '1', '2', '3', '-1']);

/** each `property: value` outside a custom property, with every `var(...)` taken out. */
function literalsIn(css: string): { readonly declaration: string; readonly literal: string }[] {
	const found: { declaration: string; literal: string }[] = [];
	for (const match of css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)) {
		const [declaration, property = '', value = ''] = match;
		// a custom property is a name, and a photo's shape is the photo's (`PHOTO_RATIO` in ./photo-crop.ts).
		if (property.startsWith('--') || property === 'aspect-ratio') continue;
		const bare = value.replace(/var\([^()]*\)/g, ' ');
		for (const literal of bare.match(
			/#[0-9a-f]{3,8}\b|-?\d*\.?\d+(?:px|rem|em|ms|s|ch|%|vmax|dvh)?/gi
		) ?? []) {
			if (!STRUCTURE.has(literal)) found.push({ declaration: declaration.trim(), literal });
		}
	}
	return found;
}

const screens = readdirSync(HERE)
	.filter(
		(file) => file.endsWith('.tsx') && !file.includes('.spec.') && !file.includes('.testing.')
	)
	.map((file) => readFileSync(join(HERE, file), 'utf8'))
	.join('\n');

describe('./area.css', () => {
	it('writes no value of its own', () => {
		expect(literalsIn(SHEET.replace(/@container page \(min-width: 48rem\)/g, ''))).toEqual([]);
	});

	it('draws every sa- class the screens wear, and wears every one it draws', () => {
		const drawn = new Set(SHEET.match(/\.sa-[a-z0-9-]+/g)?.map((name) => name.slice(1)));
		const worn = new Set(screens.match(/\bsa-[a-z0-9-]+/g));
		expect([...worn].filter((name) => !drawn.has(name))).toEqual([]);
		expect([...drawn].filter((name) => !worn.has(name))).toEqual([]);
	});
});

const WIDE = /@container page \(min-width: 48rem\)\s*\{([\s\S]*?)\n\}/g;

/** what the rules whose selector is exactly `selector` state: on a phone, or from 48rem. */
function stated(selector: string, at: 'phone' | 'wide' = 'phone'): Record<string, string> {
	const source =
		at === 'wide'
			? [...SHEET.matchAll(WIDE)].map((m) => m[1] ?? '').join('\n')
			: SHEET.replace(WIDE, '');
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const out: Record<string, string> = {};
	for (const [, body = ''] of source.matchAll(
		new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g')
	)) {
		for (const [, property = '', value = ''] of body.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) {
			out[property] = value.trim();
		}
	}
	return out;
}

// happy-dom lays nothing out, so where a box stands is read off the rule that places it.
describe('the placements the frames draw', () => {
	it('stands the goal’s sign on the input’s line, the input taking the rest of the row', () => {
		expect(stated('.ds-field-input-container:has(> .sa-prefix)')).toMatchObject({
			display: 'flex',
			'align-items': 'center'
		});
		expect(stated('.ds-field-input-container > .sa-prefixed')).toMatchObject({
			flex: '1',
			'min-inline-size': '0'
		});
	});

	it('gives the signed-in address and Sign out a row of their own on a phone, sharing it from 48rem', () => {
		expect(stated('.page-mast-in:has(> .sa-account)')['flex-wrap']).toBe('wrap');
		expect(stated('.page-mast-in:has(> .sa-account) > .page-mast-name')['white-space']).toBe(
			'normal'
		);
		expect(stated('.sa-account')['flex-basis']).toBe('100%');
		expect(stated('.sa-account', 'wide')['flex-basis']).toBe('auto');
		expect(stated('.sa-account-email')['overflow-wrap']).toBe('break-word');
		expect(stated('.sa-account > .ds-btn')).toMatchObject({
			flex: 'none',
			'white-space': 'nowrap'
		});
	});

	it('tops the start form’s intro beside the form, and never sticks it', () => {
		expect(stated('.sa-start')['align-items']).toBe('start');
		expect(SHEET).not.toMatch(/position:\s*sticky/);
	});
});
