import { stripComments } from '@better-giving/operator/styles/raw-values';
import { type Oklch, oklchFromHex } from '../page/palette';

// what $lib/donate/page.spec.ts measures contrast with: the page's grounds and inks worked out from
// the stylesheets as written, in node, with no browser.
//
// the custom properties the page and the form declare are unregistered, so a browser keeps each as
// a token list until a standard property reads it. this does the same in two steps: every `var()`
// is substituted from the declarations a node would inherit, then the colour expression left over
// is evaluated — `oklch()`, its relative `from` form, `min()`, `max()`, `clamp()` and `calc()`
// over the channel keywords, and a `#rrggbb` seed. that is every construction either sheet spells
// a colour with; anything else throws and names itself.
//
// out-of-gamut channels are clipped per channel into sRGB before luminance is read. the spec checks
// that choice against the readings packages/form/src/styles/tokens.css states at its own entries,
// which were taken in chromium: an evaluator that disagreed with them would be measuring a
// different card.

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
		const own = scope[name];
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

const TOKEN = /#[0-9a-f]{6}|\d*\.?\d+|[a-z]+|[(),/*+-]/gi;

function tokens(text: string): string[] {
	const found = text.match(TOKEN) ?? [];
	if (found.join('') !== text.replace(/\s+/g, '')) throw new Error(`cannot read ${text}`);
	return found;
}

/** linear sRGB, each channel clipped into [0, 1] — the inverse of ../page/palette.ts's matrices. */
export function linearSrgb({ l, c, h }: Oklch): [number, number, number] {
	const a = c * Math.cos((h * Math.PI) / 180);
	const b = c * Math.sin((h * Math.PI) / 180);
	const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const clip = (v: number) => Math.min(1, Math.max(0, v));
	return [
		clip(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
		clip(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
		clip(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S)
	];
}

/** a colour expression with no `var()` left in it. */
export function colour(text: string): Oklch {
	const list = tokens(text);
	let at = 0;
	const next = () => {
		const token = list[at++];
		if (token === undefined) throw new Error(`ran out reading ${text}`);
		return token;
	};
	const expect = (want: string) => {
		const got = next();
		if (got !== want) throw new Error(`expected ${want}, read ${got} in ${text}`);
	};

	function readColour(): Oklch {
		const head = next();
		if (head.startsWith('#')) return oklchFromHex(head.toLowerCase());
		if (head !== 'oklch') throw new Error(`not a colour this reads: ${head} in ${text}`);
		expect('(');
		let origin: Oklch = { l: 0, c: 0, h: 0 };
		if (list[at] === 'from') {
			next();
			origin = readColour();
		}
		const l = sum(origin);
		const c = sum(origin);
		const h = sum(origin);
		if (list[at] === '/') {
			next();
			sum(origin);
		}
		expect(')');
		return { l, c, h };
	}

	// a channel is a sum. `/` divides only inside a function or parentheses: at a channel's own
	// level it opens the alpha, which is the colour's to read.
	function sum(origin: Oklch, inner = false): number {
		let value = product(origin, inner);
		while (list[at] === '+' || list[at] === '-') {
			const op = next();
			const right = product(origin, inner);
			value = op === '+' ? value + right : value - right;
		}
		return value;
	}

	function product(origin: Oklch, inner: boolean): number {
		let value = unit(origin);
		while (list[at] === '*' || (inner && list[at] === '/')) {
			const op = next();
			const right = unit(origin);
			value = op === '*' ? value * right : value / right;
		}
		return value;
	}

	function args(origin: Oklch): number[] {
		expect('(');
		const found = [sum(origin, true)];
		while (list[at] === ',') {
			next();
			found.push(sum(origin, true));
		}
		expect(')');
		return found;
	}

	function unit(origin: Oklch): number {
		const head = next();
		if (head === '-') return -unit(origin);
		if (head === '(') {
			const value = sum(origin, true);
			expect(')');
			return value;
		}
		if (head === 'l' || head === 'c' || head === 'h') return origin[head];
		if (head === 'min') return Math.min(...args(origin));
		if (head === 'max') return Math.max(...args(origin));
		if (head === 'calc' || head === 'clamp') {
			const [first, value, high] = args(origin);
			if (first === undefined) throw new Error(`an empty ${head}() in ${text}`);
			if (head === 'calc') return first;
			if (value === undefined || high === undefined)
				throw new Error(`clamp() takes three in ${text}`);
			return Math.max(first, Math.min(value, high));
		}
		const number = Number.parseFloat(head);
		if (Number.isNaN(number)) throw new Error(`cannot read ${head} in ${text}`);
		return number;
	}

	const found = readColour();
	if (at !== list.length) throw new Error(`left over after the colour in ${text}`);
	return found;
}

/** WCAG 2 relative luminance. */
export function luminance(value: Oklch): number {
	const [r, g, b] = linearSrgb(value);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const encode = (channel: number) =>
	channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;

/**
 * a translucent colour laid over white, as the browser composites it: in encoded sRGB, channel by
 * channel. the ground a scrim is read on when the photo under it is at its lightest.
 */
export function overWhite(value: Oklch, alpha: number): Oklch {
	const hex = linearSrgb(value)
		.map((v) => alpha * encode(v) + (1 - alpha))
		.map((v) =>
			Math.round(v * 255)
				.toString(16)
				.padStart(2, '0')
		)
		.join('');
	return colour(`#${hex}`);
}

/** WCAG 2 contrast ratio between two colours, lighter over darker. */
export function contrast(one: Oklch, other: Oklch): number {
	const [a, b] = [luminance(one), luminance(other)];
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** the colour a custom property resolves to in the scope. */
export const resolve = (scope: Scope, name: string) => colour(substitute(scope, `var(${name})`));
