import { globSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ruleCopyDrift, tokenCopyDrift } from './design-copy';

// the gate over packages/design/'s copies of ./tokens.css. what a finding means and why the
// direction is one-way is written in ./design-copy.ts; this file holds only what is the caller's —
// which sheets are swept, and the case that says the glob reaching them matched something.
//
// it is the one caller in this suite whose files are outside its own package, and every other
// arrangement here would have missed them: packages/design/ carries no package.json, so it is
// outside the workspace glob and every `pnpm -r` command, and there is no runner that could be put
// beside those sheets. the paths are resolved from `import.meta.url` rather than from the process's
// directory for the same reason — the other callers glob their own package, where a relative path
// is the package that ran them, and a `../` climbing out of one is a path that answers differently
// depending on who invoked vitest.
//
// the sheets are globbed rather than listed, so a fifth artboard directory is covered by existing.
// packages/design/donate-form/_shared.css declares no `--admin-*` name at all: it is swept and
// contributes nothing to either half, which is the right answer for a board dressed from the
// donation form's own system.
//
// the three sheets handed to the rule half are the chain each console copy states it holds, in the
// order packages/console-ui/src/app.css declares — ./fonts.css is the fourth and is the one no copy
// carries, because its `src:` urls are relative to this directory.

const here = dirname(fileURLToPath(import.meta.url));
const tokens = join(here, 'tokens.css');
const sheets = ['tokens.css', 'base.css', 'adm.css'].map((sheet) => join(here, sheet));
const design = join(here, '..', '..', '..', 'design');

describe('packages/design/ copies the token layer without changing it', () => {
	const copies = globSync('*/_shared.css', { cwd: design }).map((file) => join(design, file));

	it('finds the sheets it is meant to be guarding', () => {
		// without this the suite passes loudest when the glob is wrong and nothing is read, which
		// is the failure the whole file exists to refuse — and a glob climbing out of its own
		// package is where that goes wrong. it stays here rather than moving in with the sweep:
		// only the caller that wrote a glob knows what it was supposed to reach.
		expect(copies.length).toBeGreaterThan(0);
	});

	it('sets every token it declares to the value ./tokens.css sets', () => {
		expect(tokenCopyDrift(copies, tokens)).toEqual([]);
	});

	it('draws every rule it draws the way ./base.css and ./adm.css draw it', () => {
		expect(ruleCopyDrift(copies, sheets)).toEqual([]);
	});
});

// the two shapes of finding, opened against a fixture rather than against the tree, for the reason
// ./raw-values.spec.ts states about its own: the cases above can only ever assert that the sheets
// on disk come back clean, and a clean answer is what a working sweep and a blind one both give.
// each pair below is the same declaration twice — once as the gate must refuse it, once as it must
// pass — and the refusal is not decoration: without it the case beside it passes just as well
// against a sweep that reads nothing at all.

const dir = mkdtempSync(join(tmpdir(), 'design-copy-'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** a css fixture on disk, named after the case, and the path the sweep is handed. */
function fixture(name: string, css: string) {
	const file = join(dir, `${name}.css`);
	writeFileSync(file, css);
	return file;
}

describe('a copy that has drifted', () => {
	const source = fixture('tokens', ':root {\n\t--admin-page: var(--admin-neutral-2);\n}');

	it('is a finding when it sets a token to another value', () => {
		const copy = fixture('changed', ':root {\n\t--admin-page: var(--admin-neutral-1);\n}');
		expect(tokenCopyDrift([copy], source)).toEqual([
			`${copy} sets --admin-page to var(--admin-neutral-1) — ${source} sets it to var(--admin-neutral-2)`
		]);
	});

	it('is a finding when it declares a token the source does not', () => {
		// the shape drift takes when a board generates its own palette: the name resolves, because
		// the copy declares it, so every board renders — in a second generation of the system.
		const copy = fixture('invented', ':root {\n\t--admin-n-1: oklch(0.986 0.003 250);\n}');
		expect(tokenCopyDrift([copy], source)).toEqual([
			`${copy} declares --admin-n-1, which ${source} does not`
		]);
	});

	it('is not a finding when it declares fewer tokens than the source', () => {
		const copy = fixture('subset', ':root {\n\tcolor: var(--admin-page);\n}');
		expect(tokenCopyDrift([copy], source)).toEqual([]);
	});

	it('is not a finding when the two differ only in comments and whitespace', () => {
		const copy = fixture(
			'spaced',
			':root {\n\t/* the page. */\n\t--admin-page:   var(--admin-neutral-2)  ;\n}'
		);
		expect(tokenCopyDrift([copy], source)).toEqual([]);
	});
});

// the rule half opened against the same fixtures and for the same reason: the sweep above can only
// ever report that the sheets on disk come back clean, and clean is what a working sweep and a
// blind one both answer. every case here is one of the allowances ./design-copy.ts argues, and the
// refusals beside them are what say the sweep read anything at all.

const drawn = fixture(
	'sheet',
	`@layer elements {
		.adm-btn,
		.adm-btn--primary {
			padding: var(--admin-space-3);
			border-radius: var(--admin-radius);
		}
		.adm-main {
			padding: var(--admin-space-6);
		}
		@media (min-width: 64rem) {
			.adm-main {
				padding: var(--admin-space-9);
			}
		}
	}`
);

/** a copy has to declare a token to be read as one at all, so every fixture below declares one. */
const copyOf = (name: string, css: string) =>
	fixture(name, `:root {\n\t--admin-page: var(--admin-neutral-2);\n}\n${css}`);

describe('a copy of the sheets that has drifted', () => {
	it('is a finding when it sets a property to another value', () => {
		const copy = copyOf('restyled', '.adm-btn {\n\tborder-radius: var(--admin-radius-0);\n}');
		expect(ruleCopyDrift([copy], [drawn])).toEqual([
			`${copy} sets border-radius to var(--admin-radius-0) on .adm-btn — ${drawn} sets it to var(--admin-radius)`
		]);
	});

	it('is a finding when it draws an `.adm-` selector the sheets do not', () => {
		// the shape drift takes when a board grows a part of its own: the class resolves, because
		// the copy draws it, so every board renders — a second generation of the vocabulary.
		const copy = copyOf('invented', '.adm-btn--tertiary {\n\tpadding: var(--admin-space-1);\n}');
		expect(ruleCopyDrift([copy], [drawn])).toEqual([
			`${copy} draws .adm-btn--tertiary, which none of ${drawn} draws`
		]);
	});

	it('is not a finding when it draws a selector of its own that names nothing of the system', () => {
		const copy = copyOf('frame', '.board-frame {\n\tpadding: 40px;\n}');
		expect(ruleCopyDrift([copy], [drawn])).toEqual([]);
	});

	it('is not a finding when it draws fewer rules than the sheets', () => {
		const copy = copyOf('subset', '.adm-main {\n\tpadding: var(--admin-space-6);\n}');
		expect(ruleCopyDrift([copy], [drawn])).toEqual([]);
	});

	it('is not a finding when it drops a property from a rule it draws', () => {
		const copy = copyOf('trimmed', '.adm-btn {\n\tborder-radius: var(--admin-radius);\n}');
		expect(ruleCopyDrift([copy], [drawn])).toEqual([]);
	});

	it('is not a finding when it drops one selector out of a rule naming several', () => {
		const copy = copyOf(
			'unlisted',
			'.adm-btn--primary {\n\tpadding: var(--admin-space-3);\n\tborder-radius: var(--admin-radius);\n}'
		);
		expect(ruleCopyDrift([copy], [drawn])).toEqual([]);
	});

	it('is not a finding when it states a property the sheets state on nothing', () => {
		const copy = copyOf('placed', '.adm-main {\n\tgrid-area: main;\n}');
		expect(ruleCopyDrift([copy], [drawn])).toEqual([]);
	});

	it('is not a finding when the two differ only in comments, whitespace and layers', () => {
		const copy = copyOf(
			'spaced',
			'/* the page. */\n.adm-btn,\n.adm-btn--primary {\n\tpadding:   var(--admin-space-3)  ;\n\tborder-radius: var(--admin-radius);\n}'
		);
		expect(ruleCopyDrift([copy], [drawn])).toEqual([]);
	});

	it('is not a finding when it resolves a condition the sheets state into the rule', () => {
		// a board is one fixed width and has no viewport, so the wide branch is taken unconditioned.
		const copy = copyOf('resolved', '.adm-main {\n\tpadding: var(--admin-space-9);\n}');
		expect(ruleCopyDrift([copy], [drawn])).toEqual([]);
	});

	it('is a finding when a rule it does carry under a condition answers to another one', () => {
		const copy = copyOf(
			'inverted',
			'@media (min-width: 64rem) {\n\t.adm-main {\n\t\tpadding: var(--admin-space-6);\n\t}\n}'
		);
		expect(ruleCopyDrift([copy], [drawn])).toEqual([
			`${copy} sets padding to var(--admin-space-6) on @media (min-width: 64rem) .adm-main — ${drawn} sets it to var(--admin-space-9)`
		]);
	});

	it('is not a finding in a sheet that declares no token of this system', () => {
		// packages/design/donate-form/_shared.css dresses the donation form, whose `body` rule is
		// its own system's and never this one's.
		const copy = fixture('other-system', 'body {\n\tfont-family: ui-sans-serif;\n}');
		expect(ruleCopyDrift([copy], [drawn])).toEqual([]);
	});
});
