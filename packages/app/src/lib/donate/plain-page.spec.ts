import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
import { donorPageLinks } from './plain-page';

// the sheets a donor page links, in the order `donorPageLinks()` in ./plain-page.tsx states: the
// form's in the order `sheetsFor` in packages/form/src/element.ts adopts them — its tokens, the
// registry's button, text box and tick box, then its parts, layout and motion — and then the faces
// and the page's own chrome.
//
// the spec pool processes no css, so a `?url` import of a sheet reads as an empty string here and
// nine empty hrefs would say nothing about which sheet stands where. each import is answered with
// its own specifier instead.

vi.mock('@better-giving/form/styles/tokens.css?url', () => ({ default: 'form/tokens' }));
vi.mock('@better-giving/form/registry/styles/button-css.css?url', () => ({
	default: 'registry/button'
}));
vi.mock('@better-giving/form/registry/styles/field-css.css?url', () => ({
	default: 'registry/field'
}));
vi.mock('@better-giving/form/registry/styles/checkbox-css.css?url', () => ({
	default: 'registry/checkbox'
}));
vi.mock('@better-giving/form/styles/parts.css?url', () => ({ default: 'form/parts' }));
vi.mock('@better-giving/form/styles/layout.css?url', () => ({ default: 'form/layout' }));
vi.mock('@better-giving/form/styles/motion.css?url', () => ({ default: 'form/motion' }));
vi.mock('@better-giving/operator/styles/fonts.css?url', () => ({ default: 'operator/fonts' }));
vi.mock('./page.css?url', () => ({ default: 'page' }));

it('links the form’s sheets with the registry’s controls between its tokens and its parts', () => {
	const links = donorPageLinks();
	expect(links.every((link) => link.rel === 'stylesheet')).toBe(true);
	expect(links.map((link) => link.href)).toEqual([
		'form/tokens',
		'registry/button',
		'registry/field',
		'registry/checkbox',
		'form/parts',
		'form/layout',
		'form/motion',
		'operator/fonts',
		'page'
	]);
});

// the mocks above answer the specifiers whether or not the form package exports them, so the three
// registry sheets are resolved here the way the build resolves them, through its `exports` map.
it('reaches the registry’s control sheets through the form package’s exports', () => {
	const require = createRequire(import.meta.url);
	for (const name of ['button-css', 'field-css', 'checkbox-css']) {
		expect(require.resolve(`@better-giving/form/registry/styles/${name}.css`)).toMatch(
			new RegExp(`/packages/form/src/registry/styles/${name}\\.css$`)
		);
	}
});
