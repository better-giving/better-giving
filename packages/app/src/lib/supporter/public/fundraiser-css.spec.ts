import {
	rawColourViolations,
	rawLengthViolations,
	stripComments
} from '@better-giving/operator/styles/raw-values';
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { linkedSheets } from '../linked-sheets.testing';

// the gate over ./fundraiser.css and the components beside it, the supporter pages' half of what
// $lib/donate/page.spec.ts holds page.css to.
//
// values: outside a custom property's own declaration no colour and no length is written, the one
// container width the sheet's header names aside. names: every `--_` name read is the form token
// file's, every `--page-*` name page.css's, and every `--fundraiser-*` name this sheet's own. jobs:
// each colour the sheet writes reads a token whose radix step does that job — text on 11 and 12 or
// the ink on the brand's solid, a ground on 1 and 3 or the brand's solid, an edge on 6, the ring on
// 8. classes: every class the components write is one a sheet the page links draws.

const require = createRequire(import.meta.url);
const SHEET = join(import.meta.dirname, 'fundraiser.css');
const HERE = relative(process.cwd(), SHEET);
const sheetText = readFileSync(SHEET, 'utf8');
const PAGE_CSS = join(import.meta.dirname, '../../donate/page.css');
const pageText = readFileSync(PAGE_CSS, 'utf8');
const formTokens = readFileSync(require.resolve('@better-giving/form/styles/tokens.css'), 'utf8');

const reads = (css: string, prefix: string) =>
	new Set(
		[...stripComments(css).matchAll(new RegExp(`var\\(\\s*(${prefix}[\\w-]*)`, 'g'))].map(
			(m) => m[1] ?? ''
		)
	);
const declares = (css: string, prefix: string) =>
	new Set(
		[...stripComments(css).matchAll(new RegExp(`(?:^|[;{\\s])(${prefix}[\\w-]*)\\s*:`, 'gm'))].map(
			(m) => m[1] ?? ''
		)
	);

describe('the values ./fundraiser.css writes', () => {
	const rules = (() => {
		const stripped = stripComments(sheetText);
		const chars = [...sheetText];
		const blank = (from: number, length: number) => {
			for (let i = from; i < from + length; i++) if (chars[i] !== '\n') chars[i] = ' ';
		};
		for (const m of stripped.matchAll(/--[\w-]+\s*:[^;{}]*;/g)) blank(m.index, m[0].length);
		for (const m of stripped.matchAll(/@container page \(min-width: 60rem\)/g)) {
			blank(m.index + m[0].indexOf('60rem'), '60rem'.length);
		}
		const dir = mkdtempSync(join(tmpdir(), 'fundraiser-css-'));
		afterAll(() => rmSync(dir, { recursive: true }));
		const file = join(dir, 'fundraiser.css');
		writeFileSync(file, chars.join(''));
		return file;
	})();
	const named = (findings: string[]) => findings.map((f) => f.replace(rules, HERE));

	it('writes no colour outside a token declaration', () => {
		expect(named(rawColourViolations([rules]))).toEqual([]);
	});

	it('writes no length outside a token declaration', () => {
		expect(named(rawLengthViolations([rules]))).toEqual([]);
	});

	it('changes layout at no container width but the profile head’s 60rem', () => {
		const widths = [...stripComments(sheetText).matchAll(/@(?:container|media)[^{]*/g)].map((m) =>
			m[0].trim()
		);
		expect(widths.length).toBeGreaterThan(0);
		expect(widths.filter((at) => at !== '@container page (min-width: 60rem)')).toEqual([]);
	});
});

describe('the names ./fundraiser.css reads', () => {
	it('reads every `--_` name from the form token file', () => {
		const declared = declares(formTokens, '--_');
		const read = [...reads(sheetText, '--_')];
		expect(read.length).toBeGreaterThan(0);
		expect(read.filter((name) => !declared.has(name))).toEqual([]);
	});

	it('reads every `--page-*` name from page.css', () => {
		const declared = declares(pageText, '--page-');
		expect([...reads(sheetText, '--page-')].filter((name) => !declared.has(name))).toEqual([]);
	});

	it('reads every `--fundraiser-*` name from itself, and declares none it does not read', () => {
		const read = reads(sheetText, '--fundraiser-');
		const declared = declares(sheetText, '--fundraiser-');
		expect([...read].filter((name) => !declared.has(name))).toEqual([]);
		expect([...declared].filter((name) => !read.has(name))).toEqual([]);
	});
});

describe('every colour lands on a token whose step does its job', () => {
	// the job each property does, and the tokens whose step does it: page.css's header names the
	// step behind each (`--page-quiet` slate 11, `--page-accent` brand 11, `--page-plane` slate 1,
	// `--page-plane-edge` slate 6). a link's ring is page.css's, drawn on every donor page's links.
	const JOBS: [RegExp, readonly string[]][] = [
		[/^color$/, ['--page-quiet', '--_n12', '--page-accent', '--_on-p']],
		[/^background(-color)?$/, ['--page-plane', '--_n3', '--_p']],
		[/^border(?!-radius)/, ['--page-plane-edge']],
		[/^outline$/, []]
	];
	const colourDeclarations = [
		...stripComments(sheetText).matchAll(/(?:^|[;{\s])([a-z-]+)\s*:([^;{}]*);/gm)
	]
		.map((m) => ({ property: m[1] ?? '', value: (m[2] ?? '').trim() }))
		.filter(({ property }) => JOBS.some(([pattern]) => pattern.test(property)));

	it('finds the colours it is meant to be guarding', () => {
		expect(colourDeclarations.length).toBeGreaterThan(8);
	});

	it('reads only the tokens each job allows', () => {
		const off = colourDeclarations.flatMap(({ property, value }) => {
			const allowed = JOBS.find(([pattern]) => pattern.test(property))?.[1] ?? [];
			const tokens = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1] ?? '');
			const colourTokens = tokens.filter(
				(name) => !['--_border', '--_border-strong'].includes(name)
			);
			return colourTokens.every((name) => allowed.includes(name)) && colourTokens.length > 0
				? []
				: [`${property}: ${value}`];
		});
		expect(off).toEqual([]);
	});
});

describe('the classes the supporter pages write', async () => {
	const here = relative(process.cwd(), import.meta.dirname);
	const components = globSync(join(here, '*.tsx')).filter((file) => !file.includes('.spec.'));
	// the sheets the live page links, as `fundraiserPageLinks` emits them.
	const sheets = await linkedSheets(
		[
			join(import.meta.dirname, 'fundraiser-page.tsx'),
			join(import.meta.dirname, '../../donate/plain-page.tsx')
		],
		async () => (await import('./fundraiser-page')).fundraiserPageLinks()
	);
	const drawn = new Set(
		sheets.flatMap((file) =>
			[...stripComments(readFileSync(file, 'utf8')).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(
				(m) => m[1] ?? ''
			)
		)
	);

	it('finds the components it is meant to be guarding', () => {
		expect(components.length).toBeGreaterThanOrEqual(3);
	});

	it('writes no colour and no length into a style object', () => {
		expect([...rawColourViolations(components), ...rawLengthViolations(components)]).toEqual([]);
	});

	it('writes only classes a linked sheet draws', () => {
		const written = components.flatMap((file) =>
			[...readFileSync(file, 'utf8').matchAll(/className="([^"]+)"/g)].flatMap((m) =>
				(m[1] ?? '').split(/\s+/).map((name) => `${relative(here, file)} .${name}`)
			)
		);
		expect(written.length).toBeGreaterThan(0);
		expect(written.filter((entry) => !drawn.has(entry.slice(entry.indexOf(' .') + 2)))).toEqual([]);
	});

	it('writes only template heads a linked sheet draws a class under', () => {
		// a class built in a template (`ds-badge-${tone}`) is checked by its head, the part before `${`.
		const heads = components.flatMap((file) =>
			[...readFileSync(file, 'utf8').matchAll(/\b([a-z][\w]*-)\$\{/g)].map((m) => m[1] ?? '')
		);
		expect(heads.filter((head) => ![...drawn].some((name) => name.startsWith(head)))).toEqual([]);
	});
});
