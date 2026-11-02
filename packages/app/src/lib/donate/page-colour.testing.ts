import { stripComments } from '@better-giving/operator/styles/raw-values';

// what $lib/donate/page.spec.ts reads the page's sheet and the form's token file with, in node, with
// no browser: every `{}` block with the preludes it sits in, a custom property's `var()`s substituted
// from a scope, and the radix step a colour declaration lands on.

export type Scope = Readonly<Record<string, string>>;

/** one `{}` block: the preludes it sits inside, outermost first, and what it declares. */
export type Block = { readonly at: readonly string[]; readonly decls: Scope };

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

function declarations(body: string): Scope {
	const found: Record<string, string> = {};
	for (const piece of body.split(';')) {
		const colon = piece.indexOf(':');
		if (colon === -1) continue;
		found[piece.slice(0, colon).trim()] = squash(piece.slice(colon + 1));
	}
	return found;
}

/** every block in a sheet, nested ones included, each with the declarations directly inside it. */
export function blocks(css: string): Block[] {
	const found: Block[] = [];
	const open: { prelude: string; body: string }[] = [];
	let text = '';
	for (const char of stripComments(css)) {
		if (char === '{') {
			const cut = text.lastIndexOf(';');
			const parent = open.at(-1);
			if (parent) parent.body += text.slice(0, cut + 1);
			open.push({ prelude: squash(text.slice(cut + 1)), body: '' });
			text = '';
		} else if (char === '}') {
			const closing = open.pop();
			if (!closing) throw new Error('a `}` closes nothing');
			closing.body += text;
			text = '';
			found.push({
				at: [...open.map((o) => o.prelude), closing.prelude],
				decls: declarations(closing.body)
			});
		} else text += char;
	}
	return found;
}

/** the declarations of the one block whose preludes are exactly these, or a throw naming them. */
export function declared(sheet: readonly Block[], ...at: string[]): Scope {
	const want = at.map(squash).join(' » ');
	const [only, ...more] = sheet.filter((b) => b.at.join(' » ') === want);
	if (!only || more.length > 0)
		throw new Error(`${more.length + (only ? 1 : 0)} blocks at ${want}`);
	return only.decls;
}

/** a custom property's value with every `var()` in it substituted from the scope. */
export function substitute(scope: Scope, value: string, seen: string[] = []): string {
	let out = '';
	let at = 0;
	for (;;) {
		const start = value.indexOf('var(', at);
		if (start === -1) return out + value.slice(at);
		let depth = 1;
		let end = start + 4;
		while (depth > 0) {
			if (end >= value.length) throw new Error(`unbalanced var() in ${value}`);
			if (value[end] === '(') depth++;
			else if (value[end] === ')') depth--;
			end++;
		}
		const inner = value.slice(start + 4, end - 1);
		const comma = inner.indexOf(',');
		const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
		// a custom property set to `initial` is the guaranteed-invalid value, so `var()` takes its
		// fallback (https://www.w3.org/TR/css-variables-1/#guaranteed-invalid).
		const own = scope[name] === 'initial' ? undefined : scope[name];
		let replacement: string;
		if (own !== undefined) {
			if (seen.includes(name)) throw new Error(`${name} refers to itself`);
			replacement = substitute(scope, own, [...seen, name]);
		} else if (comma !== -1) replacement = substitute(scope, inner.slice(comma + 1).trim(), seen);
		else throw new Error(`${name} is declared nowhere in scope`);
		out += `${value.slice(at, start)}${replacement}`;
		at = end;
	}
}

/** the ladder names a colour bottoms out in, by the step radix gives each one's job. */
const LADDER: readonly [RegExp, (m: RegExpExecArray) => string][] = [
	[/^--_n(\d+)$/, (m) => `slate-${m[1]}`],
	[/^--_a(\d+)$/, (m) => `brand-${m[1]}`],
	[/^--_p$/, () => 'brand-9'],
	[/^--_on-p$/, () => 'on-brand-9'],
	[/^--page-scrim$/, () => 'scrim'],
	[/^--_bad$/, () => 'red-11']
];

/**
 * the steps a declaration's colours land on, in the order it reads them, each `var()` followed
 * through the scope until it reaches a ladder name. a name that never reaches one — a width, a
 * corner — is no colour and is left out.
 */
export function steps(scope: Scope, value: string): string[] {
	const found: string[] = [];
	for (const [, name = ''] of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
		const ladder = LADDER.map(([pattern, label]) => {
			const m = pattern.exec(name);
			return m && label(m);
		}).find(Boolean);
		const next = ladder ? [ladder] : scope[name] === undefined ? [] : steps(scope, scope[name]);
		for (const step of next) if (!found.includes(step)) found.push(step);
	}
	return found;
}
