import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// every destination inside the console is reached through react router, and never through a bare
// anchor.
//
// **what a bare anchor to an internal address costs is the console's whole state.** every screen
// is loader data — the connection, the account, the readings each section page draws — and the rail
// between the pages holds it across them. a full document load throws all of it
// away and pays for it again, which reads to an operator as the console forgetting what it just
// told them.
//
// **the type system cannot say it.** `as="a"` and a plain `<a href>` are both legitimate — the
// console links out to the cloudflare dashboard, to stripe, to five smtp providers — and what
// separates a correct one from a defect is whether the address is this app's, which is a fact about
// the string rather than about the element. so it is a source sweep, in the idiom of
// ./raw-values.spec.ts: the surface that owns the screens writes the glob, and the case below says
// the glob still reaches them.
//
// **an internal address is one written as a literal beginning with `/`.** an address held in a
// variable is not read here and cannot be — `href={DASHBOARD}` is external and `href={dashboard}` is
// a value the loader computed — so what this catches is the shape somebody types by hand.

/** the bargain for a case this rule is genuinely wrong about: on the line `<a` opens on, or on any
 * later line of the same opening tag. */
const EXEMPT = 'full-load-ok:';

// an `href` whose value is a literal beginning with `/`: a quoted attribute, or an expression
// holding one quoted or template literal. the opening tag is matched whole, so the attribute may
// stand on a later line than the `<a`, which is where biome puts it once the tag is long.
const INTERNAL_HREF =
	/\bhref\s*=\s*(?:"\/[^"]*"|'\/[^']*'|\{\s*(?:"\/[^"]*"|'\/[^']*'|`\/[^`]*`)\s*\})/;
const TAG_NAME_ANCHOR = /\bas="a"/;

/** the text of each `<a …>` opening tag and the lines it spans. the tag ends at the first `>`
 * outside a quoted attribute and outside braces, so `onClick={() => x}` does not end it. */
function anchorTags(source: string) {
	const tags: { line: number; lastLine: number; text: string }[] = [];
	for (const opener of source.matchAll(/<a(?![\w-])/g)) {
		let depth = 0;
		let quote = '';
		let end = opener.index + opener[0].length;
		for (; end < source.length; end++) {
			const ch = source[end];
			if (quote) {
				if (ch === quote) quote = '';
			} else if (depth === 0 && (ch === '"' || ch === "'")) quote = ch;
			else if (ch === '{') depth++;
			else if (ch === '}') depth--;
			else if (ch === '>' && depth <= 0) break;
		}
		const line = source.slice(0, opener.index).split('\n').length;
		const text = source.slice(opener.index, end + 1);
		tags.push({ line, text, lastLine: line + text.split('\n').length - 1 });
	}
	return tags;
}

/** one entry per offending anchor or `as="a"` line: the file, the line it starts on, and that line
 * as written. */
function violationsIn(source: string, file: string) {
	const found: string[] = [];
	const lines = source.split('\n');
	for (const { line, lastLine, text } of anchorTags(source)) {
		if (!INTERNAL_HREF.test(text)) continue;
		if (lines.slice(line - 1, lastLine).some((l) => l.includes(EXEMPT))) continue;
		found.push(`${file}:${line} ${(lines[line - 1] ?? '').trim()}`);
	}
	lines.forEach((line, index) => {
		if (line.includes(EXEMPT) || !TAG_NAME_ANCHOR.test(line)) return;
		found.push(`${file}:${index + 1} ${line.trim()}`);
	});
	return found;
}

const violations = (files: string[]) =>
	files.flatMap((file) => violationsIn(readFileSync(file, 'utf8'), file));

describe('no internal destination outside the router', () => {
	const screens = globSync('src/**/*.tsx').filter((file) => !file.includes('.spec.'));

	it('finds the files it is meant to be guarding', () => {
		// without this the suite passes loudest when the glob is wrong and nothing is read, which is
		// the failure the whole file exists to refuse — ./raw-values.spec.ts states the same case for
		// the same reason.
		expect(screens.length).toBeGreaterThan(0);
	});

	it('reaches no internal address through a bare anchor', () => {
		// `<Link to="/…">` is the shape, and `<Button as={Link} to="/…">` where the destination is
		// drawn as a press. packages/operator declares no router and cannot, which is why `as` takes
		// an element type and the surface hands its own `Link` in.
		expect(violations(screens)).toEqual([]);
	});

	it('sees an internal anchor in every shape it is written', () => {
		// the rule is a regular expression over source text, so it is worth cases proving it says
		// something — a gate that matches nothing passes exactly like a gate that has nothing to say.
		// each fixture is a shape the gate must refuse, reported at the line `<a` starts on.
		const caught = {
			quoted: '<p>on <a href="/">the console page</a></p>',
			multiline: '<a\n\t\thref="/setup"\n\t\tclassName="x"\n>',
			singleQuoted: "<a href='/setup'>",
			braceSingle: "<a href={'/setup'}>",
			braceDouble: '<a href={"/setup"}>',
			braceTemplate: '<a href={`/setup`}>',
			braceMultiline: '<a\n\thref={\n\t\t`/setup`\n\t}\n>',
			afterArrow: '<a onClick={() => go()} href="/setup">'
		};
		for (const [name, source] of Object.entries(caught)) {
			expect(violationsIn(`const x = 1;\n${source}`, 'f.tsx'), name).toHaveLength(1);
			expect(violationsIn(`const x = 1;\n${source}`, 'f.tsx')[0], name).toMatch(/^f\.tsx:2 /);
		}
		expect(violationsIn('<p>\n\t<a\n\t\thref="/setup"\n\t>', 'f.tsx')).toEqual(['f.tsx:2 <a']);
	});

	it('passes an external anchor, however it is laid out', () => {
		const passes = [
			'<a\n\thref="https://dash.cloudflare.com"\n\ttarget="_blank"\n\trel="noreferrer"\n>',
			'<a href="https://dash.cloudflare.com" target="_blank">',
			'<a href={DASHBOARD}>',
			'<a href={`https://x.test/`}>',
			'<a\n\thref="https://x.test/"\n>go to <b href="/ignored">b</b> </a>',
			'<Button as={Link} to="/setup">'
		];
		for (const source of passes) expect(violationsIn(source, 'f.tsx'), source).toEqual([]);
	});

	it('honours the exemption on the opening line or any line of the tag', () => {
		expect(violationsIn('<a href="/x"> {/* full-load-ok: a file download */}', 'f.tsx')).toEqual(
			[]
		);
		expect(
			violationsIn('<a\n\t// full-load-ok: served by the binary\n\thref="/x"\n>', 'f.tsx')
		).toEqual([]);
		expect(
			violationsIn('<a\n\thref="/x"\n>\n// full-load-ok: below the tag', 'f.tsx')
		).toHaveLength(1);
	});

	it('sees the tag-name form', () => {
		expect(violationsIn('<Button as="a" href="/setup">', 'f.tsx')).toHaveLength(1);
		expect(violationsIn('<Button as={Link} to="/setup">', 'f.tsx')).toEqual([]);
		expect(violationsIn('<Button as="a" href="/x"> // full-load-ok: x', 'f.tsx')).toEqual([]);
	});
});
