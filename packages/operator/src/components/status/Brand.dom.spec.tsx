import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { Brand } from './Brand.jsx';

// what a company's logo owes the tree it is drawn into, and what its class list owes the sheet.
//
// the tree half is ./Mark.dom.spec.tsx's two shapes over a different component, and the reason is
// the same: a logo standing where a company's name would have stood carries that name itself, a
// logo standing beside that name in the same control is decoration and belongs to neither the tree
// nor the reading, and one that is both at once is named to nobody. ./Brand.jsx argues which of the
// two a case is.
//
// the class half is this file's own and covers nothing ./Mark.dom.spec.tsx has to. a brand's
// modifier is what carries the picture, so a name spelled one way in the component and another in
// ../../styles/base.css draws an empty box that fails on no other gate — and a name assembled from
// the `name` prop is one packages/app/src/lib/admin/styles/conformance.spec.ts cannot read at all.
// so the modifiers are read off the markup the real component drew and matched against the sheet,
// the way ../../styles/field-on-a-tight-stack.dom.spec.tsx matches a selector against real markup.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** every brand and the modifier it is drawn with, which is the pairing both halves below read. */
const BRANDS = [
	['cloudflare', 'adm-brand--cloudflare'],
	['quickbooks', 'adm-brand--quickbooks'],
	['xero', 'adm-brand--xero']
] as const;

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'Brand.jsx'), 'utf8');
const sheet = readFileSync(join(here, '../../styles/base.css'), 'utf8');

/** the element the logo drew, which is where a case reads it off. */
function drawn(root: HTMLElement): Element {
	const found = root.firstElementChild;
	if (found === null) throw new Error('the logo drew nothing');
	return found;
}

describe('a company logo mounted into a document', () => {
	it.each(BRANDS)('draws %s wearing the base class and its own modifier', (name, modifier) => {
		const logo = drawn(render(Brand, { name }));

		expect([...logo.classList]).toContain('adm-brand');
		expect([...logo.classList]).toContain(modifier);
	});

	it('is out of the tree entirely when it is given no name', () => {
		const logo = drawn(render(Brand, { name: 'quickbooks' }));

		expect(logo.getAttribute('aria-hidden')).toBe('true');
		expect(logo.hasAttribute('role')).toBe(false);
		expect(logo.hasAttribute('aria-label')).toBe(false);
	});

	it('is an image carrying that name when it is given one', () => {
		const logo = drawn(render(Brand, { name: 'xero', label: 'Xero' }));

		expect(logo.getAttribute('role')).toBe('img');
		expect(logo.getAttribute('aria-label')).toBe('Xero');
		expect(logo.hasAttribute('aria-hidden')).toBe(false);
	});

	it('keeps a class a caller hands it beside both of its own', () => {
		const logo = drawn(render(Brand, { name: 'quickbooks', className: 'adm-mark--lg' }));

		expect([...logo.classList].sort()).toEqual([
			'adm-brand',
			'adm-brand--quickbooks',
			'adm-mark--lg'
		]);
	});
});

describe('every brand modifier is a name a reader can find', () => {
	it('gives each brand a modifier of its own', () => {
		const modifiers = BRANDS.map(([, modifier]) => modifier);

		expect(new Set(modifiers).size).toBe(modifiers.length);
	});

	it.each(BRANDS)('spells %s’s modifier in the component source', (_name, modifier) => {
		// a rule reading this source is what gates the class list, and it reads text.
		expect(source).toContain(modifier);
	});

	it('assembles no modifier out of the name it was handed', () => {
		// the same class list read the other way: a name built at runtime is a name that rule cannot
		// see, and a modifier nothing draws paints an empty box.
		expect(source).not.toMatch(/adm-brand--\$\{/);
	});

	it.each(BRANDS)('draws %s from a file that is in ../../styles/brand/', (_name, modifier) => {
		const rule = sheet.match(new RegExp(`\\.${modifier}\\s*\\{([^}]*)\\}`));
		const file = rule?.[1]?.match(/url\('\.\/brand\/([\w.-]+)'\)/)?.[1];

		expect(file).toBeDefined();
		expect(existsSync(join(here, '../../styles/brand', file ?? ''))).toBe(true);
	});
});
