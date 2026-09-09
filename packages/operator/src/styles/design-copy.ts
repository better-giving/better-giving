import { readFileSync } from 'node:fs';
import { stripComments } from './raw-values';

// the two assertions behind the gate over packages/design/'s copies of this package's stylesheets
// — one over the tokens a copy declares, one over the rules it draws.
//
// each artboard directory there inlines a `_shared.css` into every `*.dc.html` beside it, and that
// sheet hand-copies the `--admin-*` layer from ./tokens.css and the rules from ./base.css and
// ./adm.css, so a board renders in the system's own values and its own shapes. a copy is a copy:
// nothing recompiles it, packages/design/ carries no package.json and so is outside the workspace
// glob and every `pnpm -r` command, and the raw-value gates each glob their own package and reach
// none of it. so the one place a colour may be spelled freely is also the one place holding a
// second copy of the system, and what this reads is whether the two still agree.
//
// the direction is one-way and is the whole point: ./tokens.css is the source and a copy that
// disagrees is wrong, in every case. a finding here is repaired by re-copying the block, never by
// moving the token.
//
// a name in ./tokens.css and not in a copy is not a finding. a board draws a subset of the system
// and a copy holding only what its boards read is a smaller file to read, so the rule is about the
// names a copy does declare. a name only a copy declares is a finding, because it is a value with
// no entry in the system arguing it — the shape drift takes when a board generates its palette
// instead of taking it.
//
// both halves return what they found rather than asserting it, as ./raw-values.ts does and for the
// same reason: a finding already carries the file and both values a caller's
// `expect(...).toEqual([])` prints. the caller is ./design-copy.spec.ts, which owns the glob
// reaching out of this package and the case asserting that glob matched something.

/** every `--admin-*` declaration in a sheet, last one wins, as css itself resolves them. */
function declarations(file: string) {
	const found = new Map<string, string>();
	// the whole declaration is the one group, and the name and the value are read off either side
	// of its first `:` — as ./raw-values.ts reads a colour. matched as two groups instead, each one
	// is `string | undefined` to tsc even though neither is optional, and the guard that follows is
	// a branch nothing can reach.
	for (const [declaration] of stripComments(readFileSync(file, 'utf8')).matchAll(
		/--admin-[\w-]+\s*:[^;}]*/g
	)) {
		const colon = declaration.indexOf(':');
		found.set(
			declaration.slice(0, colon).trim(),
			declaration
				.slice(colon + 1)
				.trim()
				.replace(/\s+/g, ' ')
		);
	}
	return found;
}

/**
 * every `--admin-*` declaration in the given copies that ./tokens.css does not carry at the same
 * value, as a line naming the copy, the token and both values.
 */
export function tokenCopyDrift(copies: string[], tokens: string) {
	const source = declarations(tokens);
	return copies.flatMap((copy) =>
		[...declarations(copy)].flatMap(([name, value]) => {
			const original = source.get(name);
			if (original === undefined) return [`${copy} declares ${name}, which ${tokens} does not`];
			if (original === value) return [];
			return [`${copy} sets ${name} to ${value} — ${tokens} sets it to ${original}`];
		})
	);
}

// the rule half of the same gate, over the copies of ./base.css and ./adm.css those sheets carry
// beside the token block. the colours were guarded above and the geometry, the states and the
// parts were not, so an artboard could quietly become a picture of a system this repository no
// longer holds. the direction is the same one-way direction and the repair is the same one:
// re-copy the rule from the sheet, never move the sheet to the board.
//
// a copy that declares no `--admin-*` name at all is not a copy of this system and is read no
// further — packages/design/donate-form/_shared.css dresses the donation form, whose system is
// packages/form/src/styles/tokens.css and never meets this one (CLAUDE.md, "two design systems,
// and they never meet"). that is the same test the half above already performs by having nothing
// to say about such a sheet, and it is stated out loud here because a `body` rule collides across
// the two systems where a token name never could.
//
// what is compared, and what is allowed:
//
// - a selector the sheets draw and the copy does not is not a finding. a board draws a subset, as
//   it declares a subset of the tokens.
// - a selector the copy draws is compared property by property, and a property it states at a
//   value the sheets do not is the finding.
// - a property inside that rule that the copy does not state is not a finding: trimming inside a
//   rule is the same allowance as trimming a whole rule, for the same reason.
// - a property the copy states and the sheets state on that selector nowhere is not a finding
//   either. it is the shape a board's own scaffolding takes on a system part — a `grid-area`
//   placing it in the board's frame — and there is no value for it to disagree with.
// - a selector only the copy draws is a finding when it names an `.adm-` class, and is not when it
//   does not. `.adm-*` is this system's element vocabulary and ./adm.css draws every one of them,
//   so a copy declaring one the sheets do not is a second generation of a part — the drift the
//   invented-token line above refuses, in the half of the system that is shapes. a board frame, a
//   `body` override or a layout wrapper names nothing this system owns and is the board's own.
//
// conditions are keyed, with one asymmetry a board makes necessary. a rule the copy carries inside
// a `@media` or `@supports` answers to the sheets' rule under that same condition and no other. a
// rule the copy states unconditionally answers to every value the sheets state for that selector,
// conditioned or not: an artboard is one fixed width with no viewport, so
// packages/design/console-cloudflare/_shared.css resolves the sheets' `(min-width: 64rem)` branch
// into the rule rather than carrying the condition, and every value it takes that way is still a
// value this system states. what that allowance costs is a board taking a narrow value under a
// wide condition, which a board of one width cannot mean.
//
// `@layer` is transparent on both sides: the two console copies keep the wrappers their surface's
// packages/console-ui/src/app.css declares and the cloudflare copy inlines the sheets flattened, and
// a rule is the same rule either way.
//
// a `--admin-*` declaration is left to the half above, which reads it by name wherever it is
// written and so reaches rules this half never keys.

/** one rule as a sheet states it: the selector it names, under the conditions it sits inside. */
type Rule = {
	file: string;
	/** the `@media` and `@supports` headers enclosing it, outermost first, joined by a space. */
	where: string;
	selector: string;
	properties: Map<string, string>;
};

/** the parts of a comma- or semicolon-separated list, at the top level of every bracket. */
function parts(text: string, separator: string) {
	const found: string[] = [];
	let depth = 0;
	let quote = '';
	let buffer = '';
	for (const char of text) {
		if (quote) {
			buffer += char;
			if (char === quote) quote = '';
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (char === '(' || char === '[' || char === '{') depth++;
		else if (char === ')' || char === ']' || char === '}') depth--;
		else if (char === separator && depth === 0) {
			found.push(buffer);
			buffer = '';
			continue;
		}
		buffer += char;
	}
	found.push(buffer);
	return found;
}

// a rule header is read as the selectors it names rather than as one string, so that a copy
// dropping one selector out of a list is trimming and not a rule the sheets never wrote. the
// whitespace inside a descendant selector and around a combinator is flattened, so the same
// selector written across two lines and on one compare equal.
const selectors = (header: string) =>
	parts(header, ',')
		.map((one) =>
			one
				.trim()
				.replace(/\s+/g, ' ')
				.replace(/\s*([>+~])\s*/g, ' $1 ')
		)
		.filter((one) => one !== '');

const condition = (header: string) =>
	header.trim().replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');

/** the body of the block opening at `open`, and the offset just past its closing brace. */
function block(text: string, open: number) {
	let depth = 0;
	let quote = '';
	for (let at = open; at < text.length; at++) {
		const char = text[at];
		if (quote) {
			if (char === quote) quote = '';
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (char === '{') depth++;
		else if (char === '}') {
			depth--;
			if (depth === 0) return { body: text.slice(open + 1, at), end: at + 1 };
		}
	}
	return { body: text.slice(open + 1), end: text.length };
}

/** the declarations a block states itself, last one wins, as css itself resolves them. */
function properties(body: string) {
	const found = new Map<string, string>();
	for (const statement of parts(body, ';')) {
		const text = statement.trim();
		if (text === '' || text.includes('{')) continue;
		const colon = text.indexOf(':');
		if (colon === -1) continue;
		found.set(
			text.slice(0, colon).trim(),
			text
				.slice(colon + 1)
				.trim()
				.replace(/\s+/g, ' ')
		);
	}
	return found;
}

/** every rule a sheet states, in source order, one entry per selector a rule header names. */
function rules(file: string) {
	const found: Rule[] = [];
	const walk = (css: string, context: string[]) => {
		let at = 0;
		let buffer = '';
		while (at < css.length) {
			const char = css[at];
			if (char !== '{') {
				// a `;` ends an at-statement carrying no block — the `@import` and the `@layer`
				// order the copies open with — and a `}` closes a block this walk has read already.
				buffer = char === ';' || char === '}' ? '' : buffer + char;
				at++;
				continue;
			}
			const header = buffer.trim();
			buffer = '';
			const { body, end } = block(css, at);
			at = end;
			const where = condition(header);
			if (header.startsWith('@')) {
				const name = header
					.slice(1)
					.split(/[\s({]/, 1)[0]
					?.toLowerCase();
				if (name === 'layer') walk(body, context);
				else if (body.includes('{')) walk(body, [...context, where]);
				// an at-rule holding declarations rather than rules — `@font-face`, `@property` —
				// is a rule whose selector is its own header.
				else
					found.push({
						file,
						where: context.join(' '),
						selector: where,
						properties: properties(body)
					});
				continue;
			}
			for (const one of selectors(header)) {
				found.push({ file, where: context.join(' '), selector: one, properties: properties(body) });
				// a rule nesting another states the outer one as the inner one's context, so
				// nothing inside a rule is read as a rule of the sheet's own top level.
				if (body.includes('{')) walk(body, [...context, one]);
			}
		}
	};
	walk(stripComments(readFileSync(file, 'utf8')), []);
	return found;
}

/**
 * every rule in the given copies that the given sheets state differently, as a line naming the
 * copy, the selector, the property and both values — and every `.adm-*` selector a copy states
 * that no sheet does.
 */
export function ruleCopyDrift(copies: string[], sheets: string[]) {
	const source = sheets.flatMap(rules);
	const drawn = new Set(source.map((rule) => rule.selector));
	return copies.flatMap((copy) => {
		if (declarations(copy).size === 0) return [];
		return rules(copy).flatMap((rule) => {
			const named = rule.where === '' ? rule.selector : `${rule.where} ${rule.selector}`;
			if (!drawn.has(rule.selector)) {
				if (!/(^|[^\w-])\.adm-/.test(rule.selector)) return [];
				return [`${copy} draws ${named}, which none of ${sheets.join(', ')} draws`];
			}
			const same = source.filter(
				(one) => one.selector === rule.selector && (rule.where === '' || one.where === rule.where)
			);
			return [...rule.properties].flatMap(([property, value]) => {
				if (property.startsWith('--admin-')) return [];
				const stated = same.flatMap((one) => {
					const set = one.properties.get(property);
					return set === undefined ? [] : [{ file: one.file, value: set }];
				});
				if (stated.length === 0 || stated.some((one) => one.value === value)) return [];
				const sets = [...new Set(stated.map((one) => one.value))].join(' or ');
				return [
					`${copy} sets ${property} to ${value} on ${named} — ${stated[0]?.file} sets it to ${sets}`
				];
			});
		});
	});
}
