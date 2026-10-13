import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SOCIAL_PLATFORMS } from '../../console/org';
import { ruleOf, sheet } from '../../styles/sheet-rule.testing';
import { render } from '../render.testing';
import { BRAND_MARK_PLATFORMS, BrandMark } from './BrandMark.jsx';

// what a network's mark owes the tree it is drawn into, and which file it is drawn from.
//
// the file half is read off the source: the bundler hands a small file back as a `data:` uri, so
// what a mount carries says nothing about which file it was — and a network drawn from another's
// file is the one wrong answer here that no screen would point out. so the import each platform is
// drawn from is matched against a file named for that platform, and the folder is held to the
// seven files, the declaration that types them and the config that keeps biome off them.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'BrandMark.jsx'), 'utf8');

/** the element the mark drew, which is where a case reads it off. */
function drawn(root: HTMLElement): Element {
	const found = root.firstElementChild;
	if (found === null) throw new Error('the mark drew nothing');
	return found;
}

describe('a network mark mounted into a document', () => {
	it('is drawn for every platform an organisation lists, and for WhatsApp', () => {
		expect(BRAND_MARK_PLATFORMS).toEqual([...SOCIAL_PLATFORMS, 'whatsapp']);
	});

	it.each(BRAND_MARK_PLATFORMS)(
		'draws %s as an image out of the tree, wearing the caller’s class',
		(platform) => {
			const mark = drawn(render(BrandMark, { platform, className: 'adm-brand-mark' }));

			expect(mark.tagName.toLowerCase()).toBe('img');
			expect(mark.getAttribute('alt')).toBe('');
			expect(mark.getAttribute('aria-hidden')).toBe('true');
			expect(mark.getAttribute('class')).toBe('adm-brand-mark');
			expect(mark.getAttribute('src')).toBeTruthy();
		}
	);

	it('draws no two platforms from the same file', () => {
		const files = BRAND_MARK_PLATFORMS.map((platform) =>
			drawn(render(BrandMark, { platform, className: 'adm-brand-mark' })).getAttribute('src')
		);

		expect(new Set(files).size).toBe(BRAND_MARK_PLATFORMS.length);
	});
});

describe('the file a mark is drawn from', () => {
	it.each(BRAND_MARK_PLATFORMS)('draws %s from the file named for it', (platform) => {
		expect(source).toMatch(
			new RegExp(`^import ${platform} from '\\./brand-marks/${platform}\\.(svg|png)';$`, 'm')
		);
		expect(source).toMatch(new RegExp(`^\\t${platform},?$`, 'm'));
	});

	it('holds the seven files, what types them and what keeps biome off them, and nothing else', () => {
		expect(readdirSync(join(here, 'brand-marks')).sort()).toEqual([
			'biome.jsonc',
			'facebook.svg',
			'files.d.ts',
			'instagram.svg',
			'linkedin.png',
			'tiktok.svg',
			'whatsapp.svg',
			'x.svg',
			'youtube.svg'
		]);
	});
});

describe('a network mark on an operator screen', () => {
	it('is drawn at the brand-mark height, which no company logo shares', () => {
		const base = sheet('base.css');

		expect(ruleOf(base, '.adm-brand-mark').get('block-size')).toBe('var(--admin-brand-mark-size)');
		expect(ruleOf(base, '.adm-brand').get('block-size')).toBe('var(--admin-mark-size)');
	});
});
